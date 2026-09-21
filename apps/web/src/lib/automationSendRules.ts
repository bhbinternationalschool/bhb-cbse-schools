/**
 * When an automation card may be sent — the rules, pure, in one place.
 *
 * WHY (director, 21 Sep 2026): "is fee reminder is following rules". It was
 * not, on the one path that actually sent any. All 1,126 fee messages went
 * out through the automation rule "Fee stage reminders"; the ERP command,
 * which has quiet hours and a weekly cap, was never used. On that path:
 *
 *   - 11 Sep, 00:24 IST — 146 families, every one of them seven times over
 *     (seven presses of Approve & send; fixed in #157 by a send claim).
 *   - 14 Sep, 00:30 IST — 104 families, 95 of them reminded three days
 *     before. The run was started at 00:28 and approved at 00:30.
 *
 * Meta's own delivery clock agrees with both times, and 326 of the 11 Sep
 * messages were read before 6 am. The rule's 20:00–08:00 setting only ever
 * stopped the SCHEDULER from starting a run; nothing stopped a person
 * approving one at night. And the 12-hour staleness rule this module leans
 * on already existed — the tick applied it, the Approve button did not — so
 * a card from 14 Sep sat "pending" for a week with 104 families' amounts
 * frozen in it, 51 of whom had paid since.
 *
 * Every path that sends a card asks these, so the button and the scheduler
 * can no longer disagree about what is allowed.
 */

import {
  approvalIsStale,
  APPROVAL_STALE_AFTER_MS,
  type AutomationApprovalItem,
  type AutomationModule,
  type QuietHours,
} from "@/lib/automation";
import {
  daysSince,
  FEE_REMINDER_MIN_DAYS_BETWEEN,
  FEE_REMINDER_QUIET_END,
  FEE_REMINDER_QUIET_START,
  inFeeReminderQuietHours,
  istHourOf,
} from "@/lib/erpCommands";

/** The hour of day in the rule's own timezone. */
function hourIn(timezone: string, at: Date): number | null {
  try {
    const h = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        hour12: false,
        timeZone: timezone || "Asia/Kolkata",
      }).format(at),
    );
    // en-GB prints midnight as "24" on some runtimes.
    return Number.isFinite(h) ? h % 24 : null;
  } catch {
    return null;
  }
}

function insideWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/**
 * Why nothing may be sent right now, or null when it may.
 *
 * Fee messages always keep the school's own 20:00–08:00 IST, whatever the
 * rule's setting says: a fee chase at midnight is the thing the director
 * asked about, and a rule edited to switch its quiet hours off must not be
 * the way back to it. Every other module keeps its rule's own window — the
 * health and transport rules switch theirs off on purpose, because a sick
 * child or a late bus cannot wait for morning.
 */
export function quietHoursRefusal(
  rule: { module: AutomationModule; quietHours: QuietHours } | null | undefined,
  at: Date,
): string | null {
  if (!rule) return null;
  if (rule.module === "fees") {
    if (inFeeReminderQuietHours(istHourOf(at))) {
      return `Fee reminders are not sent between ${FEE_REMINDER_QUIET_START}:00 and 0${FEE_REMINDER_QUIET_END}:00 IST — nothing was sent. Approve again after 0${FEE_REMINDER_QUIET_END}:00.`;
    }
    return null;
  }
  const q = rule.quietHours;
  if (!q?.enabled) return null;
  const hour = hourIn(q.timezone, at);
  // An hour we cannot read is not proof it is daytime.
  if (hour === null) return "Could not tell the time in this rule's timezone — nothing was sent.";
  if (insideWindow(hour, q.startHour, q.endHour)) {
    return `Inside this rule's quiet hours (${q.startHour}:00–${q.endHour}:00) — nothing was sent. Approve again after ${q.endHour}:00.`;
  }
  return null;
}

export type ApproveRefusal =
  /** The card's contents are out of date: close it, a fresh one comes next. */
  | { kind: "stale"; message: string }
  /** Right card, wrong hour: leave it pending for the morning. */
  | { kind: "quiet"; message: string };

/**
 * May a person's "Approve & send" go out now?
 *
 * Staleness is checked first. A card that is out of date is out of date at
 * any hour, and saying "come back after 8" about it would only send the
 * office back in the morning to approve figures that are wrong.
 */
export function approveRefusal(input: {
  rule: { module: AutomationModule; quietHours: QuietHours } | null | undefined;
  item: Pick<AutomationApprovalItem, "createdAt">;
  now: Date;
}): ApproveRefusal | null {
  if (approvalIsStale(input.item as AutomationApprovalItem, input.now)) {
    const raised = Date.parse(input.item.createdAt || "");
    const when = Number.isFinite(raised)
      ? new Date(raised).toLocaleString("en-IN", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        })
      : "an unknown time";
    return {
      kind: "stale",
      message: `Not sent — this card was raised ${when}, more than ${APPROVAL_STALE_AFTER_MS / 3_600_000} hours ago, and its amounts may be out of date. Run the evaluation again for today's list.`,
    };
  }
  const quiet = quietHoursRefusal(input.rule, input.now);
  return quiet ? { kind: "quiet", message: quiet } : null;
}

/**
 * Has this family had a fee reminder too recently for another?
 *
 * The same whole-calendar-day count the ERP command uses, so both paths
 * agree: reminded on the 11th, next allowed on the 18th.
 */
export function remindedTooRecently(lastSentIso: string | undefined, todayIso: string): boolean {
  const ago = daysSince(lastSentIso, todayIso);
  return ago !== null && ago < FEE_REMINDER_MIN_DAYS_BETWEEN;
}

/** The bare ten digits, for matching a card's numbers against the send log. */
export function mobileKey(mobile: string | undefined): string {
  const d = String(mobile ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}
