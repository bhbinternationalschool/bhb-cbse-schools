import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureAdmissionsHydratedServer,
  pushAdmissionsRemoteServer,
} from "@/lib/admissionsPersistence";
import {
  loadAdmissions,
  logFollowUp,
  writeAdmissionsLocalRaw,
  type FollowUpChannel,
  type FollowUpOutcome,
} from "@/lib/admissions";
import { istToday } from "@/lib/api/v1/staffFees";

export const runtime = "nodejs";

type Body = {
  leadId?: string;
  channel?: string;
  outcome?: string;
  note?: string;
  nextFollowUpAt?: string;
  assignToSelf?: boolean;
};

const CHANNELS = new Set(["call", "whatsapp", "visit", "sms", "email"]);
const OUTCOMES = new Set([
  "connected",
  "no_answer",
  "busy",
  "wrong_number",
  "not_interested",
  "visit_scheduled",
  "admitted",
]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/v1/staff/admissions/followup — the counsellor logs a call from
 * the phone: channel, outcome, what was said, and when to try again. Same
 * record the Admissions desk shows, so nothing is kept in two places.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "admission_leads");

    const body = (await request.json().catch(() => ({}))) as Body;
    const leadId = (body.leadId || "").trim();
    const channel = (body.channel || "call").trim();
    const outcome = (body.outcome || "connected").trim();
    const note = (body.note || "").trim().slice(0, 400);
    const next = (body.nextFollowUpAt || "").trim();
    if (!leadId) throw new ApiError("bad_request", "leadId required", 400);
    if (!CHANNELS.has(channel)) throw new ApiError("bad_request", "Unknown channel", 400);
    if (!OUTCOMES.has(outcome)) throw new ApiError("bad_request", "Unknown outcome", 400);
    if (next && !ISO_DAY.test(next)) {
      throw new ApiError("bad_request", "Next follow-up must be YYYY-MM-DD", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureAdmissionsHydratedServer();
    const state = loadAdmissions();
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) throw new ApiError("not_found", "Lead not found", 404);

    const result = logFollowUp(
      state,
      leadId,
      {
        channel: channel as FollowUpChannel,
        outcome: outcome as FollowUpOutcome,
        note,
        nextFollowUpAt: next || istToday(),
        assignToSelf: body.assignToSelf !== false,
      },
      ctx.session.fullName || "Counsellor",
    );
    if (!result.ok) throw new ApiError("bad_request", result.reason, 400);

    writeAdmissionsLocalRaw(result.state);
    const pushed = await pushAdmissionsRemoteServer(result.state);
    if (!pushed.ok) {
      console.warn("[staff-admissions-v1] push failed", pushed.error);
      throw new ApiError("server_error", "Could not save the call — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "admissions",
      action: "edit",
      entityType: "lead_followup",
      entityId: leadId,
      summary: `Lead follow-up (${channel}, ${outcome}) for ${lead.childName} — next ${next || istToday()}`,
      after: { channel, outcome, next, note },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const updated = result.state.leads.find((l) => l.id === leadId);
    return apiOk({
      leadId,
      nextFollowUpAt: (updated?.nextFollowUpAt || "").slice(0, 10),
      assignedTo: updated?.assignedTo || "",
      followUpCount: (updated?.followUps || []).length,
    });
  } catch (e) {
    return apiErr(e);
  }
}
