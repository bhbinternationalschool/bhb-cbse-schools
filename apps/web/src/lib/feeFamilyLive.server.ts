/**
 * A fee card, brought up to the minute before it is sent.
 *
 * WHY (director, 21 Sep 2026): "it would be send live actual due amount".
 * A card is a snapshot — built when the rule ran, sent when someone
 * approves it. The card from 14 Sep sat a week; 51 of its 104 families paid
 * in between, and approving it would have told them they still owed the
 * old figure. The 12-hour staleness rule stops the worst of that, but even
 * an hour is long enough for a parent to pay at the counter.
 *
 * So at the moment of sending, every family on the card is looked up again
 * from the live fee engine and the store:
 *   - owes nothing now, or less than the rule's floor → not messaged;
 *   - owes something → the message carries TODAY's children, kinds and
 *     total, whatever the card said.
 * The phone number, language and pay link stay as the card had them. The
 * pay link was always live — it builds the checkout when it is tapped.
 *
 * An entry with no household on it (a card raised before this existed) is
 * left exactly as it was: there is nothing to look up, and such a card is
 * older than the 12-hour limit anyway.
 */
import "server-only";

import type { AutomationApprovalItem, AutomationDispatchEntry } from "@/lib/automation";
import { liveFeeFamilies } from "@/lib/automationAudience.server";
import { formatInr } from "@/lib/masters";

export type LiveFeeCardResult = {
  item: AutomationApprovalItem;
  /** Families dropped because they have paid (or now owe under the floor). */
  settled: number;
  /** Families whose figure changed since the card was built. */
  changed: number;
};

function istToday(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export async function liveFeeCard(item: AutomationApprovalItem): Promise<LiveFeeCardResult> {
  const byScope = new Map<"overdue" | "due_soon", Set<string>>();
  for (const e of item.dispatchPayload) {
    const hh = e.variables?.householdId;
    const scope = e.variables?.feeScope === "due_soon" ? "due_soon" : e.variables?.feeScope === "overdue" ? "overdue" : null;
    if (!hh || !scope) continue;
    if (!byScope.has(scope)) byScope.set(scope, new Set());
    byScope.get(scope)!.add(hh);
  }
  if (!byScope.size) return { item, settled: 0, changed: 0 };

  const today = istToday();
  const live = new Map<string, Awaited<ReturnType<typeof liveFeeFamilies>>[number]>();
  for (const [scope, households] of byScope) {
    // Only the families on this card — a card never grows at send time; a
    // family who fell into arrears since waits for the next evaluation.
    for (const f of await liveFeeFamilies(scope, today, households)) {
      live.set(`${scope}:${f.householdId}`, f);
    }
  }

  let settled = 0;
  let changed = 0;
  const payload: AutomationDispatchEntry[] = [];
  for (const e of item.dispatchPayload) {
    const hh = e.variables?.householdId;
    const scope = e.variables?.feeScope;
    if (!hh || (scope !== "overdue" && scope !== "due_soon")) {
      payload.push(e);
      continue;
    }
    const f = live.get(`${scope}:${hh}`);
    const floor = Number(e.variables?.minPaise) || 0;
    if (!f || f.totalPaise <= 0 || (floor > 0 && f.totalPaise < floor)) {
      settled += 1;
      continue;
    }
    const next = {
      ...e.variables,
      childName: f.values.childName,
      classLabel: f.values.classLabel,
      feeDue: f.values.feeDue,
      amount: formatInr(f.totalPaise),
      dueDate: f.earliestDueOn,
      overdueDays: String(Math.max(0, f.overdueDays)),
      stage: f.stageLabel,
    };
    if (next.feeDue !== e.variables?.feeDue) changed += 1;
    payload.push({ ...e, variables: next, label: `${f.values.childName} · ${f.values.classLabel}` });
  }
  if (settled || changed) {
    console.info(`[feeFamilyLive] card ${item.id}: ${settled} settled since the card, ${changed} amounts updated`);
  }
  return { item: { ...item, dispatchPayload: payload }, settled, changed };
}
