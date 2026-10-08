/**
 * Run: npx tsx src/lib/upiProofMatch.selftest.ts
 *
 * Director, 7 Oct 2026: a GPay screenshot sent to the school WhatsApp number
 * finds the one payment it pays — exact amount, same person, not already
 * recorded — and nothing else.
 */
import assert from "node:assert/strict";
import { matchUpiProof, parseUpiProofButton, upiProofButtonId, type UpiCandidate } from "./upiProofMatch";

console.log("upiProofMatch.selftest.ts");

const salary: UpiCandidate = {
  kind: "payroll_line", targetId: "pr_709|stf_wm25", label: "Salary 2026-09 — RAJESH PATEL",
  amountPaise: 1425000, payeeName: "RAJESH PATEL", payeeVpa: "rajesh@okaxis", date: "2026-09-01", dateWindowDays: -1,
};
const advance: UpiCandidate = {
  kind: "staff_advance", targetId: "adv_1", label: "Advance 6 Oct — RAJESH PATEL",
  amountPaise: 200000, payeeName: "RAJESH PATEL", payeeVpa: "", date: "2026-10-06", dateWindowDays: 3,
};
const otherAdvance: UpiCandidate = { ...advance, targetId: "adv_2", payeeName: "SURAJ KUMAR", label: "Advance — SURAJ KUMAR" };
const voucher: UpiCandidate = {
  kind: "ledger_voucher", targetId: "v1", label: "Payment PY/00571 — Sharma Stationers",
  amountPaise: 200000, payeeName: "Sharma Stationers", payeeVpa: "", date: "2026-10-05", dateWindowDays: 3,
};
const all = [salary, advance, otherAdvance, voucher];
const none = new Set<string>();

/* Salary by UPI ID, paid a week after the month */
{
  const m = matchUpiProof({ amountPaise: 1425000, payeeName: "RAJESH PATEL", payeeVpa: "rajesh@okaxis", paidOn: "2026-10-07" }, all, none);
  assert.deepEqual(m.map((x) => [x.targetId, x.strength]), [["pr_709|stf_wm25", "upi_id"]]);
}

/* ₹2,000 to Rajesh: his advance only — not Suraj's, not the stationer */
{
  const m = matchUpiProof({ amountPaise: 200000, payeeName: "RAJESH PATEL", payeeVpa: "9876543210@ybl", paidOn: "2026-10-06" }, all, none);
  assert.deepEqual(m.map((x) => x.targetId), ["adv_1"]);
  assert.equal(m[0]!.strength, "name", "the advance carries no UPI ID, the name decides");
}

/* A different UPI ID on the salary line is a different person */
assert.equal(matchUpiProof({ amountPaise: 1425000, payeeName: "RAJESH PATEL", payeeVpa: "someone@okaxis", paidOn: "2026-10-07" }, all, none).length, 0);

/* Wrong amount, already recorded, too late / too early */
assert.equal(matchUpiProof({ amountPaise: 1425100, payeeName: "RAJESH PATEL", payeeVpa: "", paidOn: "2026-10-07" }, all, none).length, 0);
assert.equal(
  matchUpiProof({ amountPaise: 200000, payeeName: "RAJESH PATEL", payeeVpa: "", paidOn: "2026-10-06" }, all, new Set(["staff_advance:adv_1"])).length,
  0,
  "a payment with a UTR already recorded is never offered again",
);
assert.equal(matchUpiProof({ amountPaise: 200000, payeeName: "RAJESH PATEL", payeeVpa: "", paidOn: "2026-10-20" }, all, none).length, 0, "an advance paid 14 days later is not this one");
assert.equal(matchUpiProof({ amountPaise: 1425000, payeeName: "RAJESH PATEL", payeeVpa: "", paidOn: "2026-08-25" }, all, none).length, 0, "salary paid before its month");

/* A screenshot that shows nobody: amount only, all candidates, marked as such */
{
  const m = matchUpiProof({ amountPaise: 200000, payeeName: "", payeeVpa: "", paidOn: "2026-10-06" }, all, none);
  assert.equal(m.length, 3);
  assert.ok(m.every((x) => x.strength === "amount_only"));
}

/* Buttons */
assert.equal(upiProofButtonId("upd_abc123", 0), "upiproof|upd_abc123|0");
assert.deepEqual(parseUpiProofButton("upiproof|upd_abc123|2"), { draftId: "upd_abc123", choice: 2 });
assert.deepEqual(parseUpiProofButton("upiproof|upd_abc123|no"), { draftId: "upd_abc123", choice: "no" });
assert.equal(parseUpiProofButton("upiproof|x|1"), null, "short ids are not ours");
assert.equal(parseUpiProofButton("hello"), null);

console.log("  ✓ UPI screenshot → the one payment it pays (amount, person, not yet recorded)");
