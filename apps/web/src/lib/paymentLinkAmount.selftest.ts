import assert from "node:assert/strict";
import { createPaymentLink } from "./payments";
import type { FeeDueLine } from "./fees";

console.log("paymentLinkAmount.selftest.ts");

/**
 * A payment link must ask for what the counter is showing.
 *
 * The bug this guards: the link was always raised for the GROSS balance of
 * the ticked heads. A clerk granted a discount, or typed a smaller figure
 * into the collect box, sent the link — and the parent was asked for the
 * undiscounted amount. Nothing on screen said so; the counter showed the
 * right number and the link carried a different one.
 *
 * The gateway charges `amountPaise`, so this is the number that leaves the
 * school's control. It gets a test of its own.
 */

// localStorage is what the payments store writes through; stub it so the
// module under test can run outside a browser.
const store = new Map<string, string>();
// Some modules pulled in transitively register listeners at import time, so
// the stub needs those too — otherwise the test crashes AFTER passing, which
// looks like a failure and hides a real one later.
(globalThis as unknown as { window: unknown }).window = Object.assign(
  globalThis,
  {
    addEventListener: () => {},
    removeEventListener: () => {},
  },
);
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

const due = (dueKey: string, balancePaise: number, dueOn: string): FeeDueLine =>
  ({
    dueKey,
    studentId: "st1",
    label: dueKey,
    kind: "academic",
    dueOn,
    balancePaise,
    billedPaise: balancePaise,
    paidPaise: 0,
  }) as unknown as FeeDueLine;

const base = {
  householdId: "hh1",
  studentId: "st1",
  studentName: "Anaya Kumari",
  classLabel: "IV-B",
  createdBy: "Counter",
  academicYearCode: "2026-27",
};

// Two heads, ₹1,000 and ₹1,500 → ₹2,500 gross.
const dues = [due("apr", 100000, "2026-04-01"), due("may", 150000, "2026-05-01")];

// ── No target: the whole balance, exactly as before ─────────────────────
{
  const res = createPaymentLink({ ...base, dues });
  assert.ok(res.ok);
  if (!res.ok) throw new Error("unreachable");
  assert.equal(res.link.amountPaise, 250000, "gross must be unchanged");
  assert.equal(res.link.lines.length, 2);
}

// ── A discount must reach the parent ────────────────────────────────────
{
  // ₹400 off the April head: the counter shows ₹2,100, so must the link.
  const discounted = [due("apr", 60000, "2026-04-01"), dues[1]];
  const res = createPaymentLink({
    ...base,
    dues: discounted,
    targetPaise: 210000,
  });
  assert.ok(res.ok);
  if (!res.ok) throw new Error("unreachable");
  assert.equal(
    res.link.amountPaise,
    210000,
    "the link billed the undiscounted figure — the original defect",
  );
  assert.equal(
    res.link.lines.reduce((s, l) => s + l.amountPaise, 0),
    210000,
    "the breakup must agree with the total the gateway charges",
  );
}

// ── A part payment is allocated oldest first, like the counter ──────────
{
  // ₹1,200 against ₹1,000 (April) + ₹1,500 (May).
  const res = createPaymentLink({ ...base, dues, targetPaise: 120000 });
  assert.ok(res.ok);
  if (!res.ok) throw new Error("unreachable");
  assert.equal(res.link.amountPaise, 120000);
  const byKey = new Map(res.link.lines.map((l) => [l.dueKey, l.amountPaise]));
  assert.equal(byKey.get("apr"), 100000, "April settles in full first");
  assert.equal(byKey.get("may"), 20000, "the remainder lands on May");
}

// ── A target cannot exceed the balance, or invent money ─────────────────
{
  const res = createPaymentLink({ ...base, dues, targetPaise: 900000 });
  assert.ok(res.ok);
  if (!res.ok) throw new Error("unreachable");
  assert.equal(
    res.link.amountPaise,
    250000,
    "a link must never ask for more than is owed",
  );
}

// ── Nothing payable is refused, not raised for zero ─────────────────────
{
  const res = createPaymentLink({ ...base, dues, targetPaise: 0 });
  assert.equal(res.ok, false, "a zero link would be sent and could not be paid");
}

console.log("paymentLinkAmount.selftest: all assertions passed");
