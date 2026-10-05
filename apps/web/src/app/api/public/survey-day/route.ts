import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta } from "@/lib/api/v1/auth";
import { cleanJwk, verifyPunchSignature } from "@/lib/punchDevices.server";
import { punchCodeIsValid } from "@/lib/punchCode.server";
import { cleanPunchCode } from "@/lib/punchCode";
import { loadPunchOptions } from "@/lib/punchOptions.server";
import { punchWindowMessage, punchWindowState } from "@/lib/punchSchedule";
import { campusGeofenceFromSettings, validateStaffPunchLocation } from "@/lib/staffGeofence.server";
import { fetchStaffAttendanceSettingsFromDb } from "@/lib/staffAttendanceDeskAncillary.server";
import { applyStaffDayMarkServer } from "@/lib/staffAttendance.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAdmissionsHydratedServer, pushAdmissionsRemoteServer } from "@/lib/admissionsPersistence";
import { loadAdmissions, writeAdmissionsLocalRaw } from "@/lib/admissions";
import { captureFieldSurveyWithExtras } from "@/lib/fieldSurvey";
import { loadMasters } from "@/lib/masters";
import { normalizeMobile } from "@/lib/sis";
import {
  applySurveyStep,
  checkSurveyFix,
  surveyMessage,
  surveyWorkedMs,
  SURVEY_SIGN_SKEW_MS,
  type SurveyDay,
  type SurveyDayAction,
} from "@/lib/surveyDay";
import {
  completeSurveyPairing,
  insertSurveyDay,
  istDateAndTime,
  listSurveyDays,
  loadSurveyBeats,
  loadSurveyDay,
  recordSurveyCapture,
  surveyMemberForKey,
  updateSurveyDay,
  type SurveyMember,
} from "@/lib/surveyDay.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: "pair" | "status" | SurveyDayAction;
  /** pair: the office's 6-digit code; start (school mode): the gate QR code. */
  code?: string;
  beatId?: string;
  geo?: { lat?: number; lng?: number; accuracyM?: number; mocked?: boolean };
  device?: { jwk?: unknown; signature?: string; ts?: number; label?: string };
  family?: {
    childName?: string;
    guardianName?: string;
    mobile?: string;
    classSoughtId?: string;
    ageYearsApprox?: number;
    gender?: string;
    locality?: string;
    note?: string;
    parentConsent?: boolean;
    clientRef?: string;
  };
};

/**
 * POST /api/public/survey-day — a field surveyor's day (director, 5 Oct 2026).
 *
 * No ERP login: the surveyor IS their registered phone key. Every request is
 * signed by it (lib/surveyDay surveyMessage); the server maps the key to the
 * survey team member it was registered to — a staff member's punch phone, or
 * an outside surveyor's phone registered with an office pairing code.
 *
 * Every step carries the phone's live GPS. START for a surveyor set to
 * "starts at school" also needs the gate QR's rotating code and a fix inside
 * the campus. Each family captured becomes an admissions lead AND a GPS
 * point on the day, so the office sees the route walked.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const action = body.action;
    const allowed = ["pair", "status", "start", "break", "resume", "end", "capture"];
    if (!action || !allowed.includes(action)) throw new ApiError("bad_request", "Unknown action", 400);

    const jwk = cleanJwk(body.device?.jwk);
    const ts = Number(body.device?.ts);
    if (!jwk || !body.device?.signature || !Number.isFinite(ts)) {
      throw new ApiError("bad_request", "This phone's key is missing — reload the page and try again.", 400);
    }
    if (Math.abs(Date.now() - ts) > SURVEY_SIGN_SKEW_MS) {
      throw new ApiError("bad_request", "Your phone's clock is wrong. Set date & time to automatic, then try again.", 400);
    }
    const extra =
      action === "pair"
        ? String(body.code ?? "").replace(/\D/g, "")
        : action === "start"
          ? cleanPunchCode(body.code)
          : action === "capture"
            ? String(body.family?.clientRef ?? "").slice(0, 60)
            : "";
    if (!(await verifyPunchSignature(jwk, surveyMessage({ action, extra, ts }), body.device.signature))) {
      throw new ApiError("forbidden", "This request was not signed by this phone. Reload the page and try again.", 403);
    }
    const meta = requestMeta(request);

    if (action === "pair") {
      const r = await completeSurveyPairing({ code: body.code, jwk, label: String(body.device.label || "") });
      if (!r.ok) throw new ApiError(r.status === 409 ? "conflict" : r.status === 503 ? "server_error" : "forbidden", r.error, r.status);
      await writeAudit({
        module: "admissions",
        action: "edit",
        entityType: "survey_phone",
        entityId: r.memberKey,
        summary: `Survey phone registered by office code (${String(body.device.label || "phone").slice(0, 60)})`,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ paired: true });
    }

    const who = await surveyMemberForKey(jwk);
    if (!who.ok) {
      if (who.reason === "not_registered") {
        throw new ApiError(
          "forbidden",
          "This phone is not registered for the survey. Type the pairing code from the office — or, school staff: punch IN once at the gate from this phone.",
          403,
          { reason: "not_registered" },
        );
      }
      if (who.reason === "not_on_team") {
        throw new ApiError(
          "forbidden",
          "You are not on the survey team today. Ask the office to add you (Admissions → Field survey → Team).",
          403,
          { reason: "not_on_team" },
        );
      }
      throw new ApiError("server_error", "Could not check your phone right now — try again in a minute.", 503);
    }
    const member = who.member;
    const { date, time } = istDateAndTime();
    const day = await loadSurveyDay(member.memberKey, date);
    if (day === undefined) throw new ApiError("server_error", "Could not read today's survey — try again.", 503);

    if (action === "status") {
      return apiOk(await statusPayload(member, day));
    }

    const fixCheck = checkSurveyFix(body.geo, Date.now());
    if (!fixCheck.ok) throw new ApiError("forbidden", fixCheck.error, 403);
    const fix = fixCheck.fix;

    if (action === "start") {
      if (day) throw new ApiError("conflict", day.status === "ended" ? "Today's survey is already ended." : "Today's survey is already started.", 409);
      const options = await loadPunchOptions();
      const gate = punchWindowState(options, Date.now());
      if (!gate.open) throw new ApiError("forbidden", punchWindowMessage(options, gate), 403, { reason: "closed" });
      const beats = await loadSurveyBeats();
      const beat = beats.find((b) => b.id === body.beatId);
      if (!beat) throw new ApiError("bad_request", "Choose the beat (area) you are surveying today.", 400);
      if (member.startMode === "school") {
        if (!extra) {
          throw new ApiError("bad_request", "You start at school: type the 6-digit code on the gate QR screen.", 400, { reason: "needs_code" });
        }
        if (!punchCodeIsValid(extra)) {
          throw new ApiError("bad_request", "That code has expired — it changes every 30 seconds. Look at the gate screen again.", 400);
        }
        const fence = campusGeofenceFromSettings(await fetchStaffAttendanceSettingsFromDb());
        const where = validateStaffPunchLocation({ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM }, fence);
        if (!where.ok) throw new ApiError("forbidden", where.reason || "You start at school — be inside the campus to start.", 403);
      }
      const saved = await insertSurveyDay(
        {
          memberKey: member.memberKey,
          memberName: member.name,
          staffId: member.staffId,
          day: date,
          startMode: member.startMode,
          beatId: beat.id,
          status: "active",
          startedAt: fix.at,
          startGeo: fix,
          endedAt: null,
          endGeo: null,
          breaks: [],
        },
        who.deviceId,
      );
      if (!saved.ok) throw new ApiError(saved.status === 409 ? "conflict" : "server_error", saved.error, saved.status);
      // School staff: the day is outdoor duty in the staff register.
      let register = "";
      if (member.staffId) {
        await ensureSchoolMirrorHydrated();
        const r = await applyStaffDayMarkServer({
          staffId: member.staffId,
          date,
          markedBy: `${member.name} (survey)`,
          build: (m) => ({
            status: "P",
            inTime: m?.inTime || time,
            outTime: m?.outTime || "",
            note: `Field survey · ${beat.name} (${member.startMode === "school" ? "started at school" : "started in field"})`,
            punchWay: "survey",
          }),
        }).catch(() => ({ ok: false as const, error: "register" }));
        register = r.ok ? "marked present" : "register NOT updated";
      }
      await writeAudit({
        module: "admissions",
        action: "create",
        entityType: "survey_day",
        entityId: saved.day.id,
        summary: `${member.name} started survey (${member.startMode}) at ${time} · ${beat.name}${register ? ` · ${register}` : ""}`,
        after: { fix, beatId: beat.id, startMode: member.startMode },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk(await statusPayload(member, saved.day));
    }

    if (action === "capture") {
      const step = applySurveyStep(day, "capture", fix);
      if (!step.ok || !day) throw new ApiError("bad_request", step.ok ? "Start your survey day first." : step.error, 400);
      const f = body.family ?? {};
      const childName = (f.childName || "").trim();
      const guardianName = (f.guardianName || "").trim();
      const mobile = normalizeMobile(f.mobile || "");
      if (childName.length < 2) throw new ApiError("bad_request", "Child's name is required", 400);
      if (guardianName.length < 2) throw new ApiError("bad_request", "Parent's name is required", 400);
      if (!/^[6-9]\d{9}$/.test(mobile)) throw new ApiError("bad_request", "Enter the parent's 10-digit mobile number", 400);
      if (f.parentConsent !== true) throw new ApiError("bad_request", "Record the parent's consent before saving", 400);

      await ensureSchoolMirrorHydrated();
      await ensureAdmissionsHydratedServer();
      const state = loadAdmissions();
      const clientRef = extra;
      if (clientRef) {
        const seen = state.leads.find((l) => (l.campaignId || "") === clientRef);
        if (seen) return apiOk({ duplicate: true, enquiryNo: seen.enquiryNo, ...(await statusPayload(member, day)) });
      }
      const beat = (state.surveyBeats ?? []).find((b) => b.id === day.beatId);
      const result = captureFieldSurveyWithExtras(
        state,
        {
          beatId: beat?.id || "",
          beatName: beat?.name || "",
          childName,
          guardianName,
          mobile,
          whatsappSame: true,
          classSoughtId: (f.classSoughtId || "").trim(),
          ageYearsApprox: Math.max(0, Math.min(25, Math.round(Number(f.ageYearsApprox) || 0))),
          gender: (f.gender || "").trim(),
          locality: (f.locality || beat?.area || "").trim(),
          concerns: (f.note || "").trim() ? [(f.note || "").trim().slice(0, 400)] : [],
          campaignId: clientRef,
          parentConsent: true,
        },
        member.name,
      );
      if (!result.ok) throw new ApiError("bad_request", result.reason, 400);
      writeAdmissionsLocalRaw(result.state);
      const pushed = await pushAdmissionsRemoteServer(result.state);
      if (!pushed.ok) throw new ApiError("server_error", "Could not save this family — try again", 503);
      const pinned = await recordSurveyCapture({
        dayId: day.id,
        memberKey: member.memberKey,
        leadId: result.lead.id,
        enquiryNo: result.lead.enquiryNo,
        childName,
        geo: fix,
      });
      await writeAudit({
        module: "admissions",
        action: "create",
        entityType: "lead",
        entityId: result.lead.id,
        summary: `Field survey: ${childName} (${guardianName}) captured by ${member.name} in ${beat?.name || "no beat"}${pinned ? "" : " · GPS point NOT saved"}`,
        after: { fix, beatId: beat?.id || "" },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ duplicate: false, enquiryNo: result.lead.enquiryNo, ...(await statusPayload(member, day)) });
    }

    // break / resume / end
    const step = applySurveyStep(day, action, fix);
    if (!step.ok || !day) throw new ApiError("bad_request", step.ok ? "Start your survey day first." : step.error, 400);
    const saved = await updateSurveyDay(day, step.day);
    if (!saved.ok) throw new ApiError(saved.status === 409 ? "conflict" : "server_error", saved.error, saved.status);
    if (action === "end" && member.staffId) {
      await ensureSchoolMirrorHydrated();
      await applyStaffDayMarkServer({
        staffId: member.staffId,
        date,
        markedBy: `${member.name} (survey)`,
        build: (m) => ({
          status: m?.status || "P",
          inTime: m?.inTime || "",
          outTime: time,
          note: m?.note || "Field survey",
          punchWay: "survey",
        }),
      }).catch(() => null);
    }
    await writeAudit({
      module: "admissions",
      action: "edit",
      entityType: "survey_day",
      entityId: day.id,
      summary: `${member.name} survey ${action} at ${time}${action === "end" ? ` · worked ${Math.round(surveyWorkedMs(step.day, Date.now()) / 60000)} min` : ""}`,
      after: { fix },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk(await statusPayload(member, step.day));
  } catch (e) {
    return apiErr(e);
  }
}

async function statusPayload(member: SurveyMember, day: SurveyDay | null) {
  const beats = await loadSurveyBeats().catch(() => []);
  const today = day ? await listSurveyDays(day.day).catch(() => null) : null;
  const mine = (today?.captures ?? []).filter((c) => c.surveyDayId === day?.id);
  let classes: { id: string; name: string }[] = [];
  try {
    await ensureSchoolMirrorHydrated();
    classes = (loadMasters().classes ?? [])
      .filter((c) => c.isActive !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ id: c.id, name: c.name }));
  } catch {
    classes = [];
  }
  return {
    member: { name: member.name, startMode: member.startMode, kind: member.kind },
    day: day
      ? {
          status: day.status,
          beatId: day.beatId,
          startedAt: day.startedAt,
          endedAt: day.endedAt,
          breaks: day.breaks.length,
          workedMs: surveyWorkedMs(day, Date.now()),
        }
      : null,
    captures: mine.map((c) => ({ enquiryNo: c.enquiryNo, childName: c.childName, at: c.capturedAt })),
    beats: beats.map((b) => ({ id: b.id, name: b.name, area: b.area })),
    classes,
  };
}

