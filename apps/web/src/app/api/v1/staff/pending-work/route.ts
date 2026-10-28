import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { istTodayIso } from "@/lib/monthRange";
import { reminderLinks, reminderText, REMINDER_RULE_LABELS } from "@/lib/staffReminders";
import { staffPendingWorkFor } from "@/lib/staffReminders.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/pending-work — the signed-in member of staff's own
 * pending work today, from the same computation the reminders use
 * (lib/staffRemindersRun.computePendingWork): punch-in, class registers,
 * homework, exam marks, approvals waiting. Drives the "My pending work"
 * card on every staff home.
 *
 * `unknown` lists the parts that could not be read — the card says "could
 * not check" for them rather than leaving them out as if nothing were due.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    // The same gate as "Waiting for you" (/api/v1/staff/approvals): a staff
    // session whose classes can be worked out (403 / 503 otherwise). Every
    // item below is the caller's OWN work, decided by the reminder rules.
    await staffSectionScope(ctx);
    const staffId = ctx.session.staffId || "";
    const date = istTodayIso();
    if (!staffId) return apiOk({ date, items: [], unknown: [] });
    const r = await staffPendingWorkFor(staffId, date);
    return apiOk({
      date,
      items: r.items.map((i) => {
        const t = reminderText(i);
        return {
          rule: i.rule,
          label: REMINDER_RULE_LABELS[i.rule],
          title: t.title.en,
          body: t.body.en,
          lines: i.lines.map((l) => l.en),
          count: i.count,
          link: reminderLinks(i).app,
          ...(i.dueOn ? { dueOn: i.dueOn, overdue: !!i.overdue } : {}),
        };
      }),
      unknown: r.unknown.map((rule) => ({ rule, label: REMINDER_RULE_LABELS[rule] })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
