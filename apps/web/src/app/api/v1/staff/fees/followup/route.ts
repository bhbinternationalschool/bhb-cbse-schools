import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { classLabelOf, istToday, loadFeeContext, openDuesFor } from "@/lib/api/v1/staffFees";
import { logFeeFollowup } from "@/lib/api/v1/feeFollowups.server";
import { formatInr } from "@/lib/fees";
import { householdWhatsApp } from "@/lib/sis";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

type Body = {
  studentId?: string;
  channel?: string;
  outcome?: string;
  note?: string;
  promisedOn?: string;
};

const CHANNELS = new Set(["call", "whatsapp", "visit", "sms"]);
const OUTCOMES = new Set(["promised", "no_answer", "refused", "paid", "wrong_number"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/v1/staff/fees/followup — record what happened when the school
 * chased a family: the channel, what they said, and the date they promised.
 * Lands in the same fee-recovery list the Fees desk works from.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "fee_defaulters");

    const body = (await request.json().catch(() => ({}))) as Body;
    const studentId = (body.studentId || "").trim();
    const channel = (body.channel || "call").trim();
    const outcome = (body.outcome || "promised").trim();
    const note = (body.note || "").trim().slice(0, 300);
    const promisedOn = (body.promisedOn || "").trim();
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);
    if (!CHANNELS.has(channel)) throw new ApiError("bad_request", "Unknown channel", 400);
    if (!OUTCOMES.has(outcome)) throw new ApiError("bad_request", "Unknown outcome", 400);
    if (outcome === "promised" && !ISO_DAY.test(promisedOn)) {
      throw new ApiError("bad_request", "Give the date the family promised to pay", 400);
    }
    if (promisedOn && !ISO_DAY.test(promisedOn)) {
      throw new ApiError("bad_request", "Date must be YYYY-MM-DD", 400);
    }

    const scope = await staffSectionScope(ctx);
    const { sis, fees, masters } = await loadFeeContext();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (!scopeAllows(scope, student.classId, student.sectionId)) {
      throw new ApiError("forbidden", "Not a student of your class", 403);
    }

    const today = istToday();
    const dues = openDuesFor(student, masters, fees, today);
    const openPaise = dues.reduce((n, d) => n + d.balancePaise, 0);
    const hh = sis.households.find((h) => h.id === student.householdId);

    const result = await logFeeFollowup({
      studentId,
      householdId: student.householdId,
      studentName: student.fullName,
      classLabel: classLabelOf(ctx, student),
      admissionNo: student.admissionNo || "",
      amountPaise: openPaise,
      overdueDays: 0,
      mobile: householdWhatsApp(hh) || hh?.mobile || "",
      channel,
      note: note || outcome,
      promisedOn: promisedOn || today,
      status: outcome === "paid" ? "done" : outcome === "refused" ? "cancelled" : "scheduled",
      by: ctx.session.fullName || "Staff",
    });
    if (!result.ok) throw new ApiError("server_error", result.error, 503);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "fees",
      action: "edit",
      entityType: "fee_followup",
      entityId: result.meeting.id,
      summary: `Fee follow-up (${channel}, ${outcome}) for ${student.fullName} · ${formatInr(openPaise)} open`,
      after: { channel, outcome, promisedOn, note },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      id: result.meeting.id,
      studentId,
      status: result.meeting.status,
      promisedOn: result.meeting.scheduledOn,
      openLabel: formatInr(openPaise),
    });
  } catch (e) {
    return apiErr(e);
  }
}
