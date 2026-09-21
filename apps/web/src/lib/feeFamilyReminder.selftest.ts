/**
 * Self-test: one fee reminder per family, every child, every kind of due.
 * Run: npx tsx src/lib/feeFamilyReminder.selftest.ts
 *
 * What must hold:
 *  - two children in arrears are BOTH in the message, with their own amounts;
 *  - transport and store are in the total and named in it;
 *  - the total is the family's, so the ₹2,000 floor can be the family's;
 *  - every value is one line (Meta #132000) and the filled-in Hindi
 *    template stays under 1,024 characters (#132005) even for the largest
 *    family on the roll.
 */

import assert from "node:assert/strict";

import {
  familyReminderValues,
  familyTotal,
  oneLine,
  type FamilyChildDue,
} from "./feeFamilyReminder";
import { seedWaTemplates } from "./waTemplates";

console.log("feeFamilyReminder.selftest.ts");

const child = (name: string, classLabel: string, fees: number, transport = 0, store = 0): FamilyChildDue => ({
  name,
  classLabel,
  feesPaise: fees * 100,
  transportPaise: transport * 100,
  storePaise: store * 100,
});

/* ── One child, school fee only: exactly as before ───────────────── */
{
  const v = familyReminderValues({ children: [child("AARAV YADAV", "IV-A", 3500)], hindi: true });
  assert.equal(v.childName, "AARAV YADAV");
  assert.equal(v.classLabel, "IV-A");
  assert.equal(v.feeDue, "₹3,500");
  assert.equal(v.totalPaise, 350_000);
}

/* ── Two children: both named, each with their own amount ────────── */
{
  // The 21 Sep failure: a family with two children in arrears was told
  // about the first one only.
  const v = familyReminderValues({
    children: [child("ANAYA YADAV", "LKG-A", 2000), child("AARAV YADAV", "IV-A", 3500)],
    hindi: true,
  });
  assert.equal(v.childName, "AARAV YADAV और ANAYA YADAV", "largest first, joined the Hindi way");
  assert.equal(v.classLabel, "IV-A, LKG-A");
  assert.equal(v.feeDue, "₹5,500 — AARAV ₹3,500 · ANAYA ₹2,000");
  assert.equal(v.totalPaise, 550_000);

  const en = familyReminderValues({
    children: [child("ANAYA YADAV", "LKG-A", 2000), child("AARAV YADAV", "IV-A", 3500)],
    hindi: false,
  });
  assert.equal(en.childName, "AARAV YADAV and ANAYA YADAV");
}

/* ── Transport and store are in the total, and said ──────────────── */
{
  const v = familyReminderValues({ children: [child("RIYA SINGH", "VIII-A", 3000, 1000, 500)], hindi: true });
  assert.equal(v.totalPaise, 450_000, "fee + bus + store");
  assert.equal(v.feeDue, "₹4,500 — इसमें बस ₹1,000, स्टोर ₹500");

  const en = familyReminderValues({ children: [child("RIYA SINGH", "VIII-A", 3000, 1000, 500)], hindi: false });
  assert.equal(en.feeDue, "₹4,500 — incl. transport ₹1,000, store ₹500");

  // Both children, and the kinds across both.
  const two = familyReminderValues({
    children: [child("KRITI YADAV", "VIII-A", 4000, 1200), child("RIYA YADAV", "VIII-A", 3000, 0, 800)],
    hindi: true,
  });
  assert.equal(two.feeDue, "₹9,000 — KRITI ₹5,200 · RIYA ₹3,800; इसमें बस ₹1,200, स्टोर ₹800");

  // A child who owes the store alone is a child who owes the school.
  const storeOnly = familyReminderValues({ children: [child("VEER MISHRA", "VIII-A", 0, 0, 1850)], hindi: false });
  assert.equal(storeOnly.totalPaise, 185_000);
  assert.equal(storeOnly.feeDue, "₹1,850 — incl. store ₹1,850");
}

/* ── The floor is the family's ───────────────────────────────────── */
{
  // Two children at ₹1,500 each: under ₹2,000 each, ₹3,000 together. The
  // per-child floor never reminded three such families.
  const kids = [child("A ONE", "I-A", 1500), child("B TWO", "II-A", 1500)];
  assert.equal(familyTotal(kids), 300_000);
  assert.ok(familyTotal(kids) >= 200_000, "the family clears a ₹2,000 floor");
}

/* ── A child who owes nothing is not in a dues message ───────────── */
{
  const v = familyReminderValues({
    children: [child("PAID UP", "V-A", 0), child("OWING", "III-A", 2500)],
    hindi: true,
  });
  assert.equal(v.childName, "OWING");
  assert.equal(v.feeDue, "₹2,500", "one child owing reads exactly like a single-child message");
  assert.equal(familyReminderValues({ children: [child("PAID UP", "V-A", 0)], hindi: true }).totalPaise, 0);
}

/* ── The largest family on the roll still fits ───────────────────── */
{
  // Seven children share one number on 21 Sep 2026.
  const seven = ["KAVYA", "PRIYAL", "PRIYAM", "SAUMYA", "SHASHWAT", "SHIVAY", "TANYA"].map((n, i) =>
    child(`${n} MISHRA`, `${["I", "II", "III", "IV", "V", "VI", "VII"][i]}-A`, 5000 + i * 700, i % 2 ? 1200 : 0, i === 3 ? 900 : 0),
  );
  const v = familyReminderValues({ children: seven, hindi: true });
  assert.match(v.childName, /और 3$/, "four named, the rest counted");
  assert.equal(v.childName.split(",").length, 4);
  assert.equal(v.totalPaise, familyTotal(seven), "every child in the total even when not every child is named");
  for (const s of [v.childName, v.classLabel, v.feeDue]) {
    assert.ok(!/[\r\n]/.test(s), "one line — Meta refuses a newline in a parameter");
  }

  // Fill the real approved Hindi stage reminder and measure it.
  const tpl = seedWaTemplates().find((t) => t.metaName === "bhb_fee_stage_reminder" && t.language === "hi");
  assert.ok(tpl, "the stage reminder template is in the seed set");
  const filled = tpl!.body
    .replace(/\{\{guardianName\}\}/g, "श्री अशुतोष कुमार मिश्रा")
    .replace(/\{\{childName\}\}/g, v.childName)
    .replace(/\{\{stage\}\}/g, "S4 Hard")
    .replace(/\{\{feeDue\}\}/g, v.feeDue)
    .replace(/\{\{payLink\}\}/g, "https://bhbinternational.school/pay/due/abcdefghijklmnopqrstuvwxyz0123456789");
  assert.ok(!/\{\{/.test(filled), "every placeholder filled");
  assert.ok(filled.length <= 1024, `hydrated message ${filled.length} chars — Meta refuses past 1,024 (#132005)`);
}

/* ── Anything reaching a parameter is flattened ──────────────────── */
{
  assert.equal(oneLine("A\nB\r\nC\tD", 50), "A B C D");
  assert.equal(oneLine("x".repeat(20), 10).length, 10);
  assert.ok(oneLine("x".repeat(20), 10).endsWith("…"));
}

console.log("  ok");
