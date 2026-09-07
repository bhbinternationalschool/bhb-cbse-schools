/**
 * Fee reminders to a class's defaulting families, server-side.
 *
 * Unlike a notice broadcast, every family gets different words — their own
 * child, their own amount, their own overdue days — so this sends one
 * templated message per recipient rather than one payload to many. Three
 * rules protect families from the desk being used carelessly:
 *
 *   1. Quiet hours (20:00–08:00 IST, the school's automation default): a
 *      fee chase must not arrive at night.
 *   2. Once a week per family: the fee desk, a class teacher and an
 *      automation can each think of reminding on the same Tuesday.
 *   3. STOP is honoured, exactly as every other outbound path honours it.
 *
 * The once-a-week ledger lives in the command desk's own store slice, so
 * this adds no state to a module the data-registry migration has yet to
 * reach.
 */

import { sendWaWithFailover, buildWaTemplateBodyComponent } from "@/lib/waSend";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { formatInr } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { feeReminderTooSoon, istHourOf, templateForFamily } from "@/lib/erpCommands";

// The guards themselves are pure and live with the rest of the command
// desk's testable logic; a second copy here would be a second set of rules.
export {
  FEE_REMINDER_QUIET_START,
  FEE_REMINDER_QUIET_END,
  FEE_REMINDER_MIN_DAYS_BETWEEN,
  inFeeReminderQuietHours,
} from "@/lib/erpCommands";

export function istHourNow(now = new Date()): number {
  return istHourOf(now);
}

export type FeeReminderRecipient = {
  householdId: string;
  mobile: string;
  guardianName: string;
  studentName: string;
  classLabel: string;
  amountPaise: number;
  overdueDays: number;
  payLink?: string;
  /** The family's own WhatsApp template language, "en" or "hi". */
  language?: string;
};

export type FeeReminderPlan = {
  send: FeeReminderRecipient[];
  /** Reminded within the last week — householdId → days ago. */
  tooSoon: { recipient: FeeReminderRecipient; daysAgo: number }[];
  optedOut: FeeReminderRecipient[];
};

/**
 * Split the defaulters into who may be messaged now and who may not, so the
 * confirm card can show both before anything is sent.
 */
export async function planFeeReminders(opts: {
  recipients: FeeReminderRecipient[];
  lastRemindedByHousehold: Record<string, string>;
  todayIso: string;
}): Promise<FeeReminderPlan> {
  const mobiles = opts.recipients.map((r) => r.mobile).filter(Boolean);
  const optedOutSet = await listOptedOutSet(mobiles).catch(() => new Set<string>());
  const plan: FeeReminderPlan = { send: [], tooSoon: [], optedOut: [] };
  for (const r of opts.recipients) {
    if (!r.mobile) continue;
    if (optedOutSet.has(toE164India(r.mobile))) {
      plan.optedOut.push(r);
      continue;
    }
    const cap = feeReminderTooSoon(opts.lastRemindedByHousehold[r.householdId], opts.todayIso);
    if (cap.skip) {
      plan.tooSoon.push({ recipient: r, daysAgo: cap.daysAgo ?? 0 });
      continue;
    }
    plan.send.push(r);
  }
  return plan;
}

export type FeeReminderSendResult = {
  sent: number;
  failed: number;
  /** householdId → the date it was reminded, for the once-a-week ledger. */
  remindedOn: Record<string, string>;
  errors: string[];
};

export async function sendFeeReminders(opts: {
  recipients: FeeReminderRecipient[];
  template: { metaName: string; language: string; variables: string[] };
  /** Same message per language, so each family is written to in theirs. */
  templatesByLang?: Record<string, { metaName: string; language: string; variables: string[] } | null>;
  todayIso: string;
}): Promise<FeeReminderSendResult> {
  const out: FeeReminderSendResult = { sent: 0, failed: 0, remindedOn: {}, errors: [] };
  for (const r of opts.recipients) {
    const vars: Record<string, string> = {
      schoolName: TENANT.nameDisplay,
      guardianName: r.guardianName || "Parent",
      childName: r.studentName,
      classLabel: r.classLabel,
      feeDue: formatInr(r.amountPaise),
      amount: formatInr(r.amountPaise),
      overdueDays: String(Math.max(0, r.overdueDays)),
      payLink: r.payLink || `${TENANT.publicPortal || "bhbinternational.school"}/parent`,
    };
    const tpl = templateForFamily(opts.templatesByLang ?? null, r.language, opts.template)
      ?? opts.template;
    const res = await sendWaWithFailover({
      primaryMobile: r.mobile,
      template: {
        name: tpl.metaName,
        language: tpl.language,
        components: [buildWaTemplateBodyComponent(tpl.variables, vars)],
      },
      clientMessageId: `feerem_${opts.todayIso}_${r.householdId}`,
    });
    if (res.ok) {
      out.sent += 1;
      out.remindedOn[r.householdId] = opts.todayIso;
    } else {
      out.failed += 1;
      if (res.error && out.errors.length < 3) out.errors.push(res.error);
    }
  }
  return out;
}
