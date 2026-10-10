/**
 * Weekly collections note — bands, weeks, figures block, parser.
 * Run: npx tsx src/lib/collectionsWeeklyAi.selftest.ts
 */
import assert from "node:assert/strict";
import {
  ageingBandFor,
  buildAgeing,
  buildCollectionsWeeklyUserPrompt,
  buildReceiptWeeks,
  lastCompleteWeek,
  parseCollectionsWeeklyJson,
  renderCollectionsWeeklyFigures,
} from "./collectionsWeeklyAi";

console.log("collectionsWeeklyAi.selftest.ts");

assert.equal(ageingBandFor("2026-05-01", "2026-09-08"), "over90");
assert.equal(ageingBandFor("2026-07-15", "2026-09-08"), "d31to90");
assert.equal(ageingBandFor("2026-09-01", "2026-09-08"), "d0to30");
assert.equal(ageingBandFor("2026-09-08", "2026-09-08"), "d0to30", "due today is current, not future");
assert.equal(ageingBandFor("2026-10-01", "2026-09-08"), "notDue");

{
  const a = buildAgeing(
    [
      { studentId: "s1", dueOn: "2026-04-10", balancePaise: 100000 },
      { studentId: "s1", dueOn: "2026-05-10", balancePaise: 100000 },
      { studentId: "s2", dueOn: "2026-07-20", balancePaise: 50000 },
      { studentId: "s3", dueOn: "2026-09-05", balancePaise: 0 },
      { studentId: "s4", dueOn: "2026-10-10", balancePaise: 20000 },
    ],
    "2026-09-08",
  );
  assert.equal(a.totalOpenPaise, 270000);
  assert.equal(a.childrenOwing, 3, "a zero balance is not owing");
  assert.deepEqual(a.ageing[0], { band: "over90", amountPaise: 200000, children: 1 }, "two months, one child");
  assert.deepEqual(a.ageing[1], { band: "d31to90", amountPaise: 50000, children: 1 });
  assert.deepEqual(a.ageing[3], { band: "notDue", amountPaise: 20000, children: 1 });
}

{
  const w = lastCompleteWeek("2026-09-08"); // a Tuesday
  assert.deepEqual(w, { weekFrom: "2026-08-31", weekTo: "2026-09-06" });
  assert.deepEqual(lastCompleteWeek("2026-09-07"), { weekFrom: "2026-08-31", weekTo: "2026-09-06" }, "Monday reports last week");
  assert.deepEqual(lastCompleteWeek("2026-09-06"), { weekFrom: "2026-08-24", weekTo: "2026-08-30" }, "Sunday: the week that just ended is not complete until Monday");
  const r = buildReceiptWeeks(
    [
      { collectionDate: "2026-09-01", totalPaise: 500000 },
      { collectionDate: "2026-09-06", totalPaise: 100000 },
      { collectionDate: "2026-09-06", totalPaise: 999, voidedAt: "2026-09-07T00:00:00Z" },
      { collectionDate: "2026-08-25", totalPaise: 200000 },
      { collectionDate: "2026-04-01", totalPaise: 1000000 },
    ],
    w.weekFrom,
    w.weekTo,
  );
  assert.deepEqual(r.thisWeek, { count: 2, amountPaise: 600000 }, "voided receipts are not collections");
  assert.deepEqual(r.lastWeek, { count: 1, amountPaise: 200000 });
  assert.equal(r.sessionAmountPaise, 1800000);
}

{
  const facts = {
    schoolName: "BHB",
    academicYearCode: "2026-27",
    weekFrom: "2026-08-31",
    weekTo: "2026-09-06",
    receipts: { thisWeek: { count: 12, amountPaise: 600000 }, lastWeek: { count: 9, amountPaise: 200000 }, sessionAmountPaise: 2116181_00, sessionBilledPaise: null },
    ageing: [
      { band: "over90" as const, amountPaise: 837877_00, children: 120 },
      { band: "d31to90" as const, amountPaise: 300000_00, children: 80 },
      { band: "d0to30" as const, amountPaise: 100000_00, children: 40 },
      { band: "notDue" as const, amountPaise: 0, children: 0 },
    ],
    totalOpenPaise: 1237877_00,
    childrenOwing: 200,
    meetings: null,
  };
  const fig = renderCollectionsWeeklyFigures(facts);
  assert.match(fig, /Collected this week: \*₹6,000\*/);
  assert.match(fig, /₹4,000 more than the week before/);
  assert.match(fig, /Over 90 days: ₹8,37,877 · 120 children/);
  assert.doesNotMatch(fig, /Not yet due/, "an empty band is not printed");
  assert.doesNotMatch(fig, /Parent meetings/, "absent stays absent");
  const user = buildCollectionsWeeklyUserPrompt(facts);
  assert.match(user, /Parent meetings: not available\. Do not comment/);
  assert.match(user, /Reminders sent and promises to pay: not available/);
}

assert.deepEqual(
  parseCollectionsWeeklyJson('{"headline":"Old debt still dominates.","note":"Most of what is owed is more than three months old. Collections were well above the week before."}'),
  { headline: "Old debt still dominates.", note: "Most of what is owed is more than three months old. Collections were well above the week before." },
);
assert.equal(parseCollectionsWeeklyJson('{"headline":"Collected 6 lakh","note":"x"}'), null, "digits are discarded");
assert.equal(parseCollectionsWeeklyJson('{"headline":"","note":"x"}'), null);

console.log("  ok");
