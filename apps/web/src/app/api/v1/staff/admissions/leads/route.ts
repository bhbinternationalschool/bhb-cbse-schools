import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import {
  followUpChannelLabel,
  followUpOutcomeLabel,
  loadAdmissions,
  stageLabel,
  type AdmissionLead,
} from "@/lib/admissions";
import { istToday } from "@/lib/api/v1/staffFees";

export const runtime = "nodejs";

const OPEN_STAGES = new Set(["enquiry", "applied", "verified"]);

/**
 * GET /api/v1/staff/admissions/leads?filter=due|overdue|mine|all&q=
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

    const counts = { overdue: 0, today: 0, later: 0, none: 0 };
    for (const l of state.leads) {
      if (!OPEN_STAGES.has(l.stage)) continue;
      counts[bucketOf(l)] += 1;
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
        };
      }),
    });
  } catch (e) {
    return apiErr(e);
  }
}
