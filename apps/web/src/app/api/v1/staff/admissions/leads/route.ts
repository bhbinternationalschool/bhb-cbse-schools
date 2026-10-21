import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import {
  createEnquiry,
  followUpChannelLabel,
  followUpOutcomeLabel,
  loadAdmissions,
  registrationBalancePaise,
  registrationCollectedPaise,
  stageLabel,
  type AdmissionLead,
} from "@/lib/admissions";
import { istToday } from "@/lib/api/v1/staffFees";
import {
  assertAdmissionsGrant,
  saveAdmissionsFromStaffApp,
} from "@/lib/api/v1/staffAdmissions.server";
import { isRegisteredStage } from "@/lib/staffAdmissionsApp";
import { writeAudit } from "@/lib/audit.server";

export const runtime = "nodejs";

const OPEN_STAGES = new Set(["enquiry", "applied", "verified"]);

/**
 * GET /api/v1/staff/admissions/leads?filter=due|overdue|mine|all|registered|general&q=
 *
 * `registered` = Registered + Verified (fee set, not yet sent to SIS);
 * `general` = open enquiries that are not registered yet.
 *
 * The counsellor's call list. Overdue first, then today's, because that is
 * the order the phone gets worked through. Closed leads (enrolled / lost)
 * are out unless explicitly asked for.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "admission_leads");
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") || "due";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();

    await ensureSchoolMirrorHydrated();
    await ensureAdmissionsHydratedServer();
    const state = loadAdmissions();
    const today = istToday();
    const me = (ctx.session.fullName || "").trim().toLowerCase();

    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";

    const bucketOf = (l: AdmissionLead): "overdue" | "today" | "later" | "none" => {
      const next = (l.nextFollowUpAt || "").slice(0, 10);
      if (!next) return "none";
      if (next < today) return "overdue";
      if (next === today) return "today";
      return "later";
    };

    let leads = state.leads.filter((l) => OPEN_STAGES.has(l.stage));
    if (filter === "mine") {
      leads = leads.filter((l) => (l.assignedTo || "").trim().toLowerCase() === me);
    } else if (filter === "overdue") {
      leads = leads.filter((l) => bucketOf(l) === "overdue");
    } else if (filter === "due") {
      leads = leads.filter((l) => bucketOf(l) === "overdue" || bucketOf(l) === "today");
    } else if (filter === "registered") {
      leads = leads.filter((l) => isRegisteredStage(l.stage));
    } else if (filter === "general") {
      leads = leads.filter((l) => !isRegisteredStage(l.stage));
    } else if (filter === "closed") {
      leads = state.leads.filter((l) => !OPEN_STAGES.has(l.stage));
    }
    if (q) {
      leads = leads.filter((l) =>
        `${l.childName} ${l.guardianName} ${l.mobile} ${l.enquiryNo} ${l.locality}`
          .toLowerCase()
          .includes(q),
      );
    }

    const order = { overdue: 0, today: 1, none: 2, later: 3 } as const;
    leads = leads
      .slice()
      .sort(
        (a, b) =>
          order[bucketOf(a)] - order[bucketOf(b)] ||
          (a.nextFollowUpAt || "").localeCompare(b.nextFollowUpAt || ""),
      )
      .slice(0, 300);

    const counts = { overdue: 0, today: 0, later: 0, none: 0, registered: 0 };
    for (const l of state.leads) {
      if (!OPEN_STAGES.has(l.stage)) continue;
      counts[bucketOf(l)] += 1;
      if (isRegisteredStage(l.stage)) counts.registered += 1;
    }

    return apiOk({
      filter,
      today,
      counts,
      leads: leads.map((l) => {
        const last = (l.followUps || [])[0];
        return {
          id: l.id,
          enquiryNo: l.enquiryNo,
          childName: l.childName,
          guardianName: l.guardianName,
          mobile: l.mobile,
          whatsapp: l.whatsapp || l.mobile,
          stage: l.stage,
          stageLabel: stageLabel(l.stage),
          classSought: classNameOf(l.classSoughtId),
          locality: l.locality || "",
          source: l.source,
          assignedTo: l.assignedTo || "",
          mine: (l.assignedTo || "").trim().toLowerCase() === me,
          nextFollowUpAt: (l.nextFollowUpAt || "").slice(0, 10),
          bucket: bucketOf(l),
          lastOutcome: last ? followUpOutcomeLabel(last.outcome) : "",
          lastChannel: last ? followUpChannelLabel(last.channel) : "",
          lastNote: last?.note || "",
          lastAt: last?.at || "",
          followUpCount: (l.followUps || []).length,
          registered: isRegisteredStage(l.stage),
          applicationNo: l.applicationNo || "",
          // Rupees. Zero fee = none set; the app says "fee not set", never "paid".
          registrationFeeRupees: Math.round((l.registrationFeeAmountPaise || 0) / 100),
          registrationCollectedRupees: Math.round(registrationCollectedPaise(state, l.id) / 100),
          registrationBalanceRupees: Math.round(registrationBalancePaise(state, l) / 100),
          registrationPaymentStatus: l.registrationPaymentStatus || "none",
        };
      }),
    });
  } catch (e) {
    return apiErr(e);
  }
}

type WalkInBody = {
  childName?: string;
  classSoughtId?: string;
  guardianName?: string;
  mobile?: string;
  note?: string;
};

/**
 * POST /api/v1/staff/admissions/leads — "Add walk-in lead" from the phone.
 *
 * The web's walk-in enquiry form, minus the extras: child, class sought,
 * parent, mobile (the fields createEnquiry itself requires) and a note.
 * Same createEnquiry, so the enquiry number, the household link for a
 * family already on file and the duplicate rule are the web's. The lead is
 * due for a call today and assigned to whoever took it.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "admission_leads");
    assertAdmissionsGrant(ctx, "admissions.leads", "create");

    const body = (await request.json().catch(() => ({}))) as WalkInBody;
    const childName = (body.childName || "").trim().slice(0, 120);
    const guardianName = (body.guardianName || "").trim().slice(0, 120);
    const mobile = (body.mobile || "").replace(/\D/g, "").slice(-10);
    const classSoughtId = (body.classSoughtId || "").trim();
    const note = (body.note || "").trim().slice(0, 500);
    if (classSoughtId && !ctx.masters.classes.some((c) => c.id === classSoughtId)) {
      throw new ApiError("bad_request", "Unknown class", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureAdmissionsHydratedServer();
    const state = loadAdmissions();
    const by = ctx.session.fullName || "Counsellor";
    const today = istToday();
    const r = createEnquiry(
      state,
      {
        source: "walk_in",
        childName,
        guardianName,
        mobile,
        classSoughtId,
        note,
        leadDate: today,
        nextFollowUpAt: today,
        assignedTo: by,
      },
      by,
    );
    if (!r.ok) throw new ApiError("bad_request", r.reason, 400);

    await saveAdmissionsFromStaffApp(r.state, "walk-in lead");

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "admissions",
      action: "create",
      entityType: "lead",
      entityId: r.lead.id,
      summary: `Walk-in lead ${r.lead.enquiryNo} from the staff app${r.linkedExisting ? " (family already on file)" : ""}`,
      after: { enquiryNo: r.lead.enquiryNo, classSoughtId, source: "walk_in" },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      leadId: r.lead.id,
      enquiryNo: r.lead.enquiryNo,
      linkedExisting: r.linkedExisting,
      householdCode: r.household.code,
    });
  } catch (e) {
    return apiErr(e);
  }
}
