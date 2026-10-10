/**
 * Self-test: who gets the tutor free, and at what price.
 * Run: npx tsx apps/web/src/lib/tutorAccess.selftest.ts
 */
import assert from "node:assert/strict";
import {
  accessForChild,
  freeUntilLabel,
  priceAfterDiscount,
  type TutorAccessRule,
} from "@/lib/tutorAccess";

console.log("tutorAccess.selftest.ts");

const rule = (p: Partial<TutorAccessRule>): TutorAccessRule => ({
  id: p.id ?? "r",
  kind: p.kind ?? "free",
  scope: p.scope ?? "all",
  scopeId: p.scopeId ?? "",
  freeUntil: p.freeUntil ?? null,
  discountPercent: p.discountPercent ?? null,
  note: "",
  isActive: p.isActive ?? true,
  createdBy: "",
  createdAt: "",
});

const child = { studentId: "stu_1", classId: "cls_5" };

/* ── a free window, and its last day ────────────────────────────────── */
{
  const rules = [rule({ id: "exam", freeUntil: "2026-09-26" })];
  assert.equal(accessForChild(rules, child, "2026-09-19").free, true);
  assert.equal(accessForChild(rules, child, "2026-09-26").free, true, "the last day is free");
  assert.equal(accessForChild(rules, child, "2026-09-27").free, false, "the day after is not");
  assert.equal(accessForChild(rules, child, "2026-09-19").freeUntil, "2026-09-26");
  assert.equal(accessForChild(rules, child, "2026-09-19").freeRuleId, "exam");
}

/* ── scope: everybody, a class, a child ─────────────────────────────── */
{
  const classRule = rule({ id: "c", scope: "class", scopeId: "cls_5", freeUntil: "2026-10-31" });
  const otherClass = rule({ id: "c2", scope: "class", scopeId: "cls_8", freeUntil: "2026-10-31" });
  const studentRule = rule({ id: "s", scope: "student", scopeId: "stu_1", freeUntil: "2026-12-31" });
  const otherStudent = rule({ id: "s2", scope: "student", scopeId: "stu_9", freeUntil: "2026-12-31" });

  assert.equal(accessForChild([classRule], child, "2026-10-01").free, true);
  assert.equal(accessForChild([otherClass], child, "2026-10-01").free, false, "another class is not this one");
  assert.equal(accessForChild([studentRule], child, "2026-10-01").free, true);
  assert.equal(accessForChild([otherStudent], child, "2026-10-01").free, false);

  // Most generous wins: a stale class rule must not cancel a wider grant.
  const all = rule({ id: "all", freeUntil: "2026-12-31" });
  const shortClass = rule({ id: "c", scope: "class", scopeId: "cls_5", freeUntil: "2026-09-20" });
  const got = accessForChild([shortClass, all], child, "2026-10-01");
  assert.equal(got.free, true);
  assert.equal(got.freeRuleId, "all", "the longer promise is the one kept");
}

/* ── switched off means off ─────────────────────────────────────────── */
{
  const off = rule({ id: "x", freeUntil: "2026-12-31", isActive: false });
  assert.equal(accessForChild([off], child, "2026-10-01").free, false);
  // A free rule with no date cannot be live — it would never end.
  assert.equal(accessForChild([rule({ id: "y", freeUntil: null })], child, "2026-10-01").free, false);
}

/* ── discounts: best one wins, never stacked ────────────────────────── */
{
  const half = rule({ id: "h", kind: "discount", discountPercent: 50 });
  const quarter = rule({ id: "q", kind: "discount", scope: "class", scopeId: "cls_5", discountPercent: 25 });
  const got = accessForChild([quarter, half], child, "2026-10-01");
  assert.equal(got.discountPercent, 50, "the best single discount, not 75");
  assert.equal(got.discountRuleId, "h");

  // A discount may carry an end date too.
  const expired = rule({ id: "e", kind: "discount", discountPercent: 80, freeUntil: "2026-09-01" });
  assert.equal(accessForChild([expired], child, "2026-10-01").discountPercent, 0);
  assert.equal(accessForChild([expired], child, "2026-09-01").discountPercent, 80, "inclusive here too");
}

/* ── the price a parent is actually shown ───────────────────────────── */
{
  assert.equal(priceAfterDiscount(49900, 0), 49900);
  assert.equal(priceAfterDiscount(49900, 50), 24900, "₹499 → ₹249, whole rupees");
  assert.equal(priceAfterDiscount(4900, 50), 2400, "₹49 → ₹24, rounded DOWN not up");
  assert.equal(priceAfterDiscount(19900, 100), 0);
  assert.equal(priceAfterDiscount(19900, 130), 0, "a nonsense percentage cannot go negative");
  assert.equal(priceAfterDiscount(19900, -5), 19900);
}

/* ── what the parent reads ──────────────────────────────────────────── */
{
  assert.equal(freeUntilLabel("2026-09-26", false), "Free till 26 Sep");
  assert.equal(freeUntilLabel("2026-09-26", true), "26 सितंबर तक मुफ़्त");
}

console.log("  ok — the widest promise is kept, discounts do not stack, and the last day is free");
