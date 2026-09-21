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
import { templateButtonComponents } from "@/lib/waTemplates";
import { duePayTokenFor, duePayUrl } from "@/lib/duePayToken.server";
import { listOptedOutSet, toE164India } from "@/lib/waContactState.server";
import { listKnownNotOnWhatsApp } from "@/lib/waNumberHealth.server";
import { householdCandidateNumbers, liveNumberInstead } from "@/lib/waHouseholdNumbers";
import { childrenOfHousehold, loadSis } from "@/lib/sis";
import { currentAcademicYearCode, formatInr, loadMasters } from "@/lib/masters";
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
  /** No number the school holds for them can receive WhatsApp. Shown on the card by name. */
  unreachable: FeeReminderRecipient[];
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
  // Every number each family has, so a dead designated number falls to the
  // other parent's phone. WHY (21 Sep 2026): a fee reminder to a number Meta
  // calls undeliverable is ACCEPTED and only fails later by webhook, so the
  // card said "sent" and nobody ever knew to try the second parent — and
  // families with no working number at all simply vanished from view.
  const sis = loadSis();
  // This session's children only: a raw status filter returns every year's
  // row, and an old row's parent number is exactly the kind that is dead.
  const ay = currentAcademicYearCode(loadMasters());
  const candidatesFor = (householdId: string) =>
    householdCandidateNumbers({
      household: (sis.households ?? []).find((h) => h.id === householdId) ?? null,
      students: childrenOfHousehold(sis, householdId, ay),
    });
  const candidates = new Map(opts.recipients.map((r) => [r.householdId, candidatesFor(r.householdId)]));
  const knownDead = await listKnownNotOnWhatsApp([
    ...opts.recipients.map((r) => r.mobile),
    ...[...candidates.values()].flat().map((c) => c.mobile10),
  ].filter(Boolean)).catch(() => new Set<string>());

  const plan: FeeReminderPlan = { send: [], tooSoon: [], optedOut: [], unreachable: [] };
  const withLive: FeeReminderRecipient[] = [];
  for (const r of opts.recipients) {
    const live = liveNumberInstead(r.mobile, candidates.get(r.householdId) ?? [], knownDead);
    if (!live) {
      // A family with no number at all was always dropped here; one whose
      // only number is dead is now named on the card instead of vanishing.
      if (r.mobile) plan.unreachable.push(r);
      continue;
    }
    withLive.push(live.replaced ? { ...r, mobile: live.mobile10 } : r);
  }

  const mobiles = withLive.map((r) => r.mobile).filter(Boolean);
  const optedOutSet = await listOptedOutSet(mobiles).catch(() => new Set<string>());
  for (const r of withLive) {
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
      // The family's direct payment for what is overdue, not the portal login.
      payLink:
        r.payLink ||
        duePayUrl(`https://${(TENANT.publicPortal || "bhbinternational.school").replace(/^https?:\/\//, "")}`, {
          householdId: r.householdId,
          scope: "overdue",
        }) ||
        `${TENANT.publicPortal || "bhbinternational.school"}/parent`,
      duePayToken: duePayTokenFor({ householdId: r.householdId, scope: "overdue" }),
    };
    const tpl = templateForFamily(opts.templatesByLang ?? null, r.language, opts.template)
      ?? opts.template;
    const buttons = templateButtonComponents({ buttons: (tpl as { buttons?: import("@/lib/waTemplates").WaTemplateButton[] }).buttons ?? [] }, vars);
    if (buttons.missing.length) {
      out.failed += 1;
      if (out.errors.length < 3) out.errors.push(`Template button needs ${buttons.missing.join(", ")}`);
      continue;
    }
    const res = await sendWaWithFailover({
      primaryMobile: r.mobile,
      template: {
        name: tpl.metaName,
        language: tpl.language,
        components: [buildWaTemplateBodyComponent(tpl.variables, vars), ...buttons.components],
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
