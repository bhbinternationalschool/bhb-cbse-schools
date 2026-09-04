import assert from "node:assert/strict";
import {
  concessionRowMatches,
  groupConcessionRowsByFamily,
  isCounterGeneratedConcession,
  type ConcessionStudentListRow,
} from "./concessionStudentList";

console.log("concessionStudentList.selftest.ts");

const row = (p: Partial<ConcessionStudentListRow>): ConcessionStudentListRow => ({
  id: Math.random().toString(36).slice(2),
  studentId: "st1",
  admissionNo: "BHB-2026-27-1222",
  studentName: "ANKIT MISHTRI",
  fatherName: "AJAY MISHTRI",
  classLabel: "IV-A",
  status: "approved",
  effectiveFrom: "2026-05-01",
  reason: "Hardship",
  siblingNote: "—",
  concessionCode: "IMP_TUIT_10PCT",
  concessionName: "Discount 10%",
  householdId: "hh1",
  ...p,
});

// ── Searching the way the office does ───────────────────────────────────
{
  const r = row({});
  assert.ok(concessionRowMatches(r, ""), "no query lists everyone");
  assert.ok(concessionRowMatches(r, "ankit"));
  assert.ok(concessionRowMatches(r, "ANKIT"), "case must not matter");
  assert.ok(concessionRowMatches(r, "ajay"), "father is searchable — a parent asks by their own name");
  assert.ok(concessionRowMatches(r, "1222"), "admission no.");
  assert.ok(concessionRowMatches(r, "IV-A"), "class");
  assert.ok(concessionRowMatches(r, "10%"), "the discount's own name");

  // Every word must land, or "ankit mishtri" matches every Ankit in school.
  assert.ok(concessionRowMatches(r, "ankit mishtri"));
  assert.equal(
    concessionRowMatches(r, "ankit sharma"),
    false,
    "a word that matches nothing must exclude the row",
  );
  assert.equal(concessionRowMatches(r, "zzz"), false);
}

// ── Siblings land under one family ──────────────────────────────────────
{
  const rows = [
    row({ id: "a", studentId: "s1", studentName: "ANKIT", householdId: "hh1", classLabel: "IV-A" }),
    row({ id: "b", studentId: "s2", studentName: "ABHIMANYU", householdId: "hh1", classLabel: "VIII-A" }),
    row({ id: "c", studentId: "s3", studentName: "SOLO CHILD", householdId: "hh2", fatherName: "RAM" }),
  ];
  const families = groupConcessionRowsByFamily(rows);
  assert.equal(families.length, 2);

  // The family being compared comes first — that is the one being justified.
  assert.equal(families[0].rows.length, 2);
  assert.equal(families[0].householdId, "hh1");
  assert.deepEqual(
    families[0].rows.map((r) => r.studentName),
    ["ANKIT", "ABHIMANYU"],
    "order within a family is the order given, not re-sorted",
  );
  assert.equal(families[1].rows.length, 1);
}

// ── A missing household is not a shared one ─────────────────────────────
{
  // The trap: keying on "" would fold every child with no household on file
  // into a single fictitious family, which reads as a real finding.
  const rows = [
    row({ id: "a", studentId: "s1", studentName: "ONE", householdId: "", fatherName: "" }),
    row({ id: "b", studentId: "s2", studentName: "TWO", householdId: "", fatherName: "" }),
  ];
  const families = groupConcessionRowsByFamily(rows);
  assert.equal(families.length, 2, "two children, no household — two groups");
  for (const f of families) assert.equal(f.rows.length, 1);
}

// ── Every row survives grouping ─────────────────────────────────────────
{
  const rows = [
    row({ id: "a", studentId: "s1", householdId: "hh1" }),
    row({ id: "b", studentId: "s2", householdId: "hh1" }),
    row({ id: "c", studentId: "s3", householdId: "hh2" }),
    row({ id: "d", studentId: "s4", householdId: "" }),
  ];
  const families = groupConcessionRowsByFamily(rows);
  assert.equal(
    families.reduce((n, f) => n + f.rows.length, 0),
    rows.length,
    "grouping must not lose a student — the list is used to justify money",
  );
  const ids = families.flatMap((f) => f.rows.map((r) => r.id)).sort();
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
}

// ── A family takes a father's name from whichever row has one ───────────
{
  const families = groupConcessionRowsByFamily([
    row({ id: "a", householdId: "hh9", fatherName: "" }),
    row({ id: "b", householdId: "hh9", fatherName: "MOHAN SINGH" }),
  ]);
  assert.equal(families.length, 1);
  assert.equal(
    families[0].fatherName,
    "MOHAN SINGH",
    "a blank on one child must not leave the family unnamed",
  );
}

// ── Counter-minted rules are told apart from real policies ─────────────
{
  /**
   * The fee counter mints a rule per discount AMOUNT when a clerk makes a
   * discount recurring. Production holds 106 concessions, nearly all of them
   * these — and several share a code, which made one child appear 82 times
   * on the all-discounts list before the dedupe. They stay in the list (a
   * child really does hold them) but must never reach the picker.
   */
  assert.equal(isCounterGeneratedConcession("CTR-TUITION-15000"), true);
  assert.equal(isCounterGeneratedConcession("ctr-tuition-15000"), true, "case");
  assert.equal(isCounterGeneratedConcession("IMP_TUIT_10PCT"), false);
  assert.equal(isCounterGeneratedConcession("IMP_SIB4_100PCT"), false);
  assert.equal(isCounterGeneratedConcession(""), false);
  // Not a prefix match on something that merely starts with the letters.
  assert.equal(isCounterGeneratedConcession("CTRL_GROUP"), false);
}

// ── Nothing in, nothing out ─────────────────────────────────────────────
{
  assert.deepEqual(groupConcessionRowsByFamily([]), []);
}

console.log("concessionStudentList.selftest: all assertions passed");
