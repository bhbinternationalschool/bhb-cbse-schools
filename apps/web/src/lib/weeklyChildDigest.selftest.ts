/**
 * Self-test: the weekly digest never says more than the school knows.
 * Run: npx tsx apps/web/src/lib/weeklyChildDigest.selftest.ts
 *
 * This message goes to every family every week, so its failure mode is not
 * an error — it is a confident sentence that is not true. The rules:
 *
 *  - an unmarked register says NOTHING. "0 days absent" and "nobody marked
 *    the register" read identically to a parent and mean opposite things;
 *  - no marks this week is not "0 marks";
 *  - a family with nothing true to report gets no message at all, because an
 *    empty digest teaches parents to ignore the next one;
 *  - every template value is ONE line. Meta refuses a parameter carrying a
 *    newline, a tab, or four consecutive spaces (error 132000), and the
 *    refusal would take the whole week's send down.
 */

import assert from "node:assert/strict";

import {
  attendanceLine,
  childLine,
  digestFreeText,
  digestVariables,
  feeLine,
  marksLine,
  type DigestFamily,
} from "./weeklyChildDigest";

console.log("weeklyChildDigest.selftest.ts");

/* ── 1. What the school does not know, it does not say ──────────────── */

assert.equal(
  attendanceLine(null, true),
  null,
  "no register at all → no attendance line",
);
assert.equal(
  attendanceLine({ markedDays: 0, present: 0, absent: 0, leave: 0, late: 0 }, true),
  null,
  "a week nobody marked must not become '0 दिन अनुपस्थित'",
);
assert.equal(marksLine([], false), null, "no marks published is not zero marks");
assert.equal(
  marksLine([{ subject: "Hindi", scored: 0, outOf: 0, examName: "x" }], false),
  null,
  "a mark out of nothing is not a mark",
);
assert.equal(feeLine(null, true), null, "dues not computed → silence, not ₹0");

/* ── 2. What it does know, it says plainly ──────────────────────────── */

const att = attendanceLine(
  { markedDays: 6, present: 5, absent: 1, leave: 0, late: 2 },
  false,
);
assert.equal(att, "Present 5 of 6 days · absent 1 · late 2");
assert.ok(
  attendanceLine({ markedDays: 6, present: 6, absent: 0, leave: 0, late: 0 }, true)!.includes("6/6"),
  "a perfect week still gets its line",
);

assert.equal(
  marksLine(
    [
      { subject: "Hindi", scored: 18, outOf: 20, examName: "Unit" },
      { subject: "Maths", scored: 15, outOf: 20, examName: "Unit" },
    ],
    false,
  ),
  "Hindi 18/20, Maths 15/20",
);

// Five subjects would run long; the message names four and counts the rest.
const many = marksLine(
  ["Hindi", "Maths", "EVS", "English", "Sanskrit"].map((subject) => ({
    subject,
    scored: 10,
    outOf: 20,
    examName: "Unit",
  })),
  false,
)!;
assert.ok(many.includes("and 1 more"), many);

assert.equal(feeLine(0, false), "Nothing pending — thank you 🙏");
assert.equal(feeLine(325000, false), "₹3,250 pending");
assert.equal(feeLine(325000, true), "₹3,250 बकाया");

/* ── 3. A child with no news at all is left out ─────────────────────── */

const silentChild = {
  studentId: "s1",
  name: "Aarav",
  classLabel: "III A",
  attendance: null,
  marks: [],
  duePaise: null,
};
assert.equal(childLine(silentChild, true), null);

/* ── 4. …and a family of silent children gets NO message ────────────── */

const silentFamily: DigestFamily = {
  householdId: "hh1",
  guardianName: "Ramesh",
  mobile: "9000000000",
  hindi: true,
  children: [silentChild],
};
const silentVars = digestVariables(silentFamily, "8–13 Sep");
assert.equal(silentVars.empty, true, "nothing true to say → do not send");
assert.equal(digestFreeText(silentFamily, "8–13 Sep"), "");

/* ── 5. One message for the whole family, one line per child ────────── */

const family: DigestFamily = {
  householdId: "hh2",
  guardianName: "Ramesh",
  mobile: "9000000000",
  hindi: false,
  children: [
    {
      studentId: "s1",
      name: "Aarav",
      classLabel: "III A",
      attendance: { markedDays: 6, present: 5, absent: 1, leave: 0, late: 0 },
      marks: [{ subject: "Hindi", scored: 18, outOf: 20, examName: "Unit" }],
      duePaise: 325000,
    },
    {
      studentId: "s2",
      name: "Anaya",
      classLabel: "LKG A",
      attendance: { markedDays: 6, present: 6, absent: 0, leave: 0, late: 0 },
      marks: [],
      duePaise: 0,
    },
    silentChild,
  ],
};

const vars = digestVariables(family, "8–13 Sep");
assert.equal(vars.empty, false);
assert.ok(vars.childSummary.includes("Aarav (III A)"));
assert.ok(vars.childSummary.includes("Anaya (LKG A)"));
assert.ok(
  !vars.childSummary.includes("Aarav (III A) —  |"),
  "the silent child is left out, not padded",
);
assert.equal(
  vars.childSummary.split("  |  ").length,
  2,
  "two children have news, the third does not",
);

/* ── 6. Every template value is one line — Meta refuses otherwise ───── */

for (const [key, value] of Object.entries(vars)) {
  if (typeof value !== "string") continue;
  assert.ok(!value.includes("\n"), `${key} must not contain a newline`);
  assert.ok(!value.includes("\t"), `${key} must not contain a tab`);
  assert.ok(!/ {4,}/.test(value), `${key} must not contain 4+ spaces`);
  assert.ok(value.trim().length > 0, `${key} must not be blank — Meta refuses it`);
}

/* ── 7. A nameless guardian is still greeted ────────────────────────── */

assert.equal(
  digestVariables({ ...family, guardianName: "  " }, "8–13 Sep").guardianName,
  "Parent",
);
assert.equal(
  digestVariables({ ...family, guardianName: "", hindi: true }, "8–13 Sep").guardianName,
  "अभिभावक",
);

/* ── 8. The free-text version (in-window families) may use real lines ── */

const free = digestFreeText(family, "8–13 Sep");
assert.ok(free.includes("\n"), "free text is not a template — it can breathe");
assert.ok(free.includes("• Aarav (III A)"));
assert.ok(free.includes("Reply to this message"));

console.log("  ok — nothing claimed that the school does not know");
