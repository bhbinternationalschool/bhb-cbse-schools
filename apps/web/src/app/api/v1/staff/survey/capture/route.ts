import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureAdmissionsHydratedServer,
  pushAdmissionsRemoteServer,
} from "@/lib/admissionsPersistence";
import { loadAdmissions, writeAdmissionsLocalRaw } from "@/lib/admissions";
import { captureFieldSurveyWithExtras } from "@/lib/fieldSurvey";
import { normalizeMobile } from "@/lib/sis";
import { recordSurveyCapture } from "@/lib/surveyDay.server";
import type { SurveyFix } from "@/lib/surveyDay";

export const runtime = "nodejs";

type Body = {
  beatId?: string;
  childName?: string;
  guardianName?: string;
  mobile?: string;
  classSoughtId?: string;
  ageYearsApprox?: number;
  gender?: string;
  locality?: string;
  address?: string;
  previousSchool?: string;
  note?: string;
  parentConsent?: boolean;
  /** Idempotency for a doorstep retry on a bad signal. */
  clientRef?: string;
  /**
   * Where the family lives (15 Oct 2026): the phone's location, or a pin the
   * surveyor placed on the map. Kept as a point with no survey day.
   */
  location?: { lat?: number; lng?: number; accuracyM?: number; source?: "map" | "gps" };
};

/** A usable point (inside India's bounding box), or null. */
function pointOf(l: Body["location"]): { lat: number; lng: number; accuracyM: number; source: "map" | "gps" } | null {
  if (!l) return null;
  const lat = Number(l.lat);
  const lng = Number(l.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 6 || lat > 37.5 || lng < 68 || lng > 97.5) return null;
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracyM: Math.max(0, Math.round(Number(l.accuracyM) || 0)),
    source: l.source === "gps" ? "gps" : "map",
  };
}

/**
 * POST /api/v1/staff/survey/capture — a family recorded at their doorstep
 * becomes an admissions lead assigned to the agent, with today as the first
 * follow-up.
 *
 * Consent is required, and an age in years is kept as an age — never turned
 * into a birth date, because a parent saying "about four" is not a fact the
 * office should later read off a form as one.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "field_survey");

    const body = (await request.json().catch(() => ({}))) as Body;
    const childName = (body.childName || "").trim();
    const guardianName = (body.guardianName || "").trim();
    const mobile = normalizeMobile(body.mobile || "");
    const clientRef = (body.clientRef || "").trim().slice(0, 60);
    if (childName.length < 2) throw new ApiError("bad_request", "Child's name is required", 400);
    if (guardianName.length < 2) throw new ApiError("bad_request", "Parent's name is required", 400);
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      throw new ApiError("bad_request", "Enter a 10-digit mobile number", 400);
    }
    if (body.parentConsent !== true) {
      throw new ApiError("bad_request", "Record the parent's consent before saving", 400);
    }

    const point = pointOf(body.location);
    if (body.location && !point) {
      throw new ApiError("bad_request", "That location is not usable — place the pin on the family's home and try again.", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureAdmissionsHydratedServer();
    const state = loadAdmissions();

    if (clientRef) {
      const seen = state.leads.find((l) => (l.campaignId || "") === clientRef);
      if (seen) {
        return apiOk({ duplicate: true, leadId: seen.id, enquiryNo: seen.enquiryNo });
      }
    }

    const by = ctx.session.fullName || "Survey agent";
    const beat = (state.surveyBeats ?? []).find((b) => b.id === (body.beatId || ""));
    const result = captureFieldSurveyWithExtras(
      state,
      {
        beatId: beat?.id || "",
        beatName: beat?.name || "",
        childName,
        guardianName,
        mobile,
        whatsappSame: true,
        classSoughtId: (body.classSoughtId || "").trim(),
        ageYearsApprox: Math.max(0, Math.min(25, Math.round(Number(body.ageYearsApprox) || 0))),
        gender: (body.gender || "").trim(),
        locality: (body.locality || beat?.area || "").trim(),
        address: (body.address || "").trim(),
        previousSchool: (body.previousSchool || "").trim(),
        concerns: [
          ...((body.note || "").trim() ? [(body.note || "").trim().slice(0, 400)] : []),
          ...(point
            ? [
                `Recorded without a survey day · home ${point.source === "map" ? "pinned on the map" : "at the phone's location"}: https://maps.google.com/?q=${point.lat},${point.lng}`,
              ]
            : []),
        ],
        campaignId: clientRef,
        parentConsent: true,
      },
      by,
    );
    if (!result.ok) throw new ApiError("bad_request", result.reason, 400);

    writeAdmissionsLocalRaw(result.state);
    const pushed = await pushAdmissionsRemoteServer(result.state);
    if (!pushed.ok) {
      console.warn("[staff-survey-v1] push failed", pushed.error);
      throw new ApiError("server_error", "Could not save this family — try again", 503);
    }

    // The point, beside the survey days' captures (no day). A failed pin is
    // said in the audit line, not hidden; the lead itself is saved.
    let pinned = true;
    if (point) {
      pinned = await recordSurveyCapture({
        dayId: null,
        locatedBy: point.source,
        memberKey: ctx.session.staffId || `session:${by}`.slice(0, 80),
        leadId: result.lead.id,
        enquiryNo: result.lead.enquiryNo,
        childName,
        geo: { lat: point.lat, lng: point.lng, accuracyM: point.accuracyM, at: new Date().toISOString() } satisfies SurveyFix,
      });
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "admissions",
      action: "create",
      entityType: "lead",
      entityId: result.lead.id,
      summary: `Field survey: ${childName} (${guardianName}) captured in ${beat?.name || "no beat"}${point ? ` · no survey day · ${point.source === "map" ? "map pin" : "phone GPS"}${pinned ? "" : " (point NOT saved)"}` : ""}`,
      after: { beatId: beat?.id || "", mobile, classSoughtId: body.classSoughtId || "", location: point },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      duplicate: false,
      leadId: result.lead.id,
      enquiryNo: result.lead.enquiryNo,
      childName: result.lead.childName,
      beatName: beat?.name || "",
    });
  } catch (e) {
    return apiErr(e);
  }
}
