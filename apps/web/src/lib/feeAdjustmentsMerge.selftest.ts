/**
 * Self-test: merging fee adjustments, and waiving many lines at once.
 * Run: npx tsx src/lib/feeAdjustmentsMerge.selftest.ts
 *
 * What must hold:
 *  - a browser's stale copy can never erase an adjustment another PC posted;
 *  - a later decision (approve, reject, void) beats an earlier copy of the row;
 *  - a bulk waiver's Principal limit is on the TOTAL, not each line.
 */

import assert from "node:assert/strict";

import type { FeeAdjustment } from "./feeAdjustments";
import { bulkWaiverPlan, mergeFeeAdjustmentRows, newWaiverBatchId } from "./feeAdjustmentsMerge";

console.log("feeAdjustmentsMerge.selftest.ts");

const row = (id: string, over: Partial<FeeAdjustment> = {}): FeeAdjustment => ({
  id,
  studentId: "stu_1",
  academicYearCode: "2026-27",
  type: "waiver",
  dueKey: `due_${id}`,
  label: id,
  amountPaise: 100_000,
  reasonCode: "management",
  reason: "r",
  status: "posted",
  stopAfterDate: null,
  fromFeeGroupId: null,
  toFeeGroupId: null,
  feeHeadId: null,
  dueOn: "2026-09-10",
  createdAt: "2026-09-21T05:00:00.000Z",
  createdBy: "office",
  decidedAt: "2026-09-21T05:00:00.000Z",
  decidedBy: "office",
  decisionNote: "",
  sourceVoucherId: "",
  ...over,
});

/* ── A stale browser cannot erase anything ───────────────────────── */
{
  // PC A has had the desk open since the morning. PC B posts three waivers
  // at noon. PC A saves one adjustment of its own at 3 pm. Before this,
  // B's three were gone.
  const server = [row("b1"), row("b2"), row("b3"), row("old")];
  const staleA = [row("old"), row("a1", { createdAt: "2026-09-21T09:30:00.000Z" })];
  const merged = mergeFeeAdjustmentRows(server, staleA);
  assert.deepEqual(merged.map((r) => r.id).sort(), ["a1", "b1", "b2", "b3", "old"]);
  assert.equal(merged[0]!.id, "a1", "newest first, as the desk shows them");

  // And the other way round: an empty push erases nothing either.
  assert.equal(mergeFeeAdjustmentRows(server, []).length, 4);
  // Rows without an id are not rows.
  assert.equal(mergeFeeAdjustmentRows([], [row("") as FeeAdjustment]).length, 0);
}

/* ── The later decision wins ─────────────────────────────────────── */
{
  const waiting = row("x", { status: "pending_approval", decidedAt: null, decidedBy: "" });
  const approved = row("x", { status: "posted", decidedAt: "2026-09-21T10:00:00.000Z" });
  const voided = row("x", { status: "voided", decidedAt: "2026-09-21T11:00:00.000Z" });

  // The Principal approved on one PC; another PC still shows it waiting.
  assert.equal(mergeFeeAdjustmentRows([approved], [waiting])[0]!.status, "posted", "a stale 'waiting' does not un-approve");
  assert.equal(mergeFeeAdjustmentRows([waiting], [approved])[0]!.status, "posted");

  // Voided after it was approved: the void stands, whichever side has it.
  assert.equal(mergeFeeAdjustmentRows([voided], [approved])[0]!.status, "voided", "a stale copy does not revive a void");
  assert.equal(mergeFeeAdjustmentRows([approved], [voided])[0]!.status, "voided");

  // Same decision time, no way to tell: the further-along status.
  const t = "2026-09-21T12:00:00.000Z";
  assert.equal(
    mergeFeeAdjustmentRows([row("y", { status: "posted", decidedAt: t })], [row("y", { status: "voided", decidedAt: t })])[0]!.status,
    "voided",
  );

  // A receipt link is only ever added — kept from whichever copy has it.
  const linked = row("z", { sourceVoucherId: "fv_1" });
  const unlinkedLater = row("z", { status: "voided", decidedAt: "2026-09-21T13:00:00.000Z" });
  const m = mergeFeeAdjustmentRows([linked], [unlinkedLater])[0]!;
  assert.equal(m.status, "voided");
  assert.equal(m.sourceVoucherId, "fv_1", "voiding does not lose which receipt it came from");
}

/* ── Waiving many lines: the limit is on the total ───────────────── */
{
  const limit = 10_000_00; // ₹10,000
  const today = "2026-09-21";
  // A year of tuition as monthly lines of ₹3,300, April to March, plus bus.
  const months = ["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"];
  const lines = months.map((m, i) => ({
    dueKey: `tuition_${m}`,
    label: `Tuition · ${m}`,
    balancePaise: 3_300_00,
    dueOn: `${i < 9 ? "2026" : "2027"}-${m}-10`,
  }));
  lines.push({ dueKey: "bus_09", label: "Transport · Sep", balancePaise: 1_000_00, dueOn: "2026-09-10" });

  const all = bulkWaiverPlan(lines, new Set(lines.map((l) => l.dueKey)), { limitPaise: limit, todayIso: today });
  assert.equal(all.lines.length, 13);
  assert.equal(all.totalPaise, 12 * 3_300_00 + 1_000_00, "₹40,600");
  assert.equal(all.current, 7, "Apr–Sep tuition and September bus are due now");
  assert.equal(all.future, 6, "Oct–Mar are in the future");
  assert.equal(all.needsApproval, true, "every line is under ₹10,000; together they are ₹40,600");

  // Each line alone would have auto-posted — which is the whole reason.
  assert.ok(lines.every((l) => l.balancePaise <= limit));

  // Three lines under the limit together post straight away.
  const few = bulkWaiverPlan(lines, new Set(["tuition_04", "tuition_05", "bus_09"]), { limitPaise: limit, todayIso: today });
  assert.equal(few.totalPaise, 7_600_00);
  assert.equal(few.needsApproval, false);

  // Exactly at the limit is within it, as for a single adjustment.
  const exact = bulkWaiverPlan([{ dueKey: "a", label: "a", balancePaise: limit, dueOn: today }], new Set(["a"]), { limitPaise: limit, todayIso: today });
  assert.equal(exact.needsApproval, false);

  // Nothing ticked is nothing to do; a line already at zero is not waivable.
  assert.equal(bulkWaiverPlan(lines, new Set(), { limitPaise: limit, todayIso: today }).lines.length, 0);
  const paidUp = bulkWaiverPlan([{ dueKey: "p", label: "p", balancePaise: 0, dueOn: today }], new Set(["p"]), { limitPaise: limit, todayIso: today });
  assert.equal(paidUp.lines.length, 0);

  // A line due today is due now, not future.
  const todayLine = bulkWaiverPlan([{ dueKey: "t", label: "t", balancePaise: 100, dueOn: today }], new Set(["t"]), { limitPaise: limit, todayIso: today });
  assert.equal(todayLine.current, 1);
}

/* ── Batch ids ───────────────────────────────────────────────────── */
{
  const a = newWaiverBatchId(1_000);
  const b = newWaiverBatchId(1_000);
  assert.match(a, /^fwb_/);
  assert.notEqual(a, b, "two waivers in the same millisecond are still two batches");
}

console.log("  ok");
