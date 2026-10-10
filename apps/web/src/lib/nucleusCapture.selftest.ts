import assert from "node:assert/strict";
import { readCapture } from "./nucleusCapture";
import { parseNucleusTimeliness } from "./nucleusProgress";
import { parseNucleusAssessments } from "./nucleusAssessments";

console.log("nucleusCapture.selftest.ts");

// A pasted table is not a capture — saying so is how the caller knows to
// fall back to the table parser instead of reporting a parse failure.
assert.equal(readCapture("1\tKiran patel\tClass1-Propel Hindi"), null);
assert.equal(readCapture(""), null);
assert.equal(readCapture("{ not json"), null);
assert.equal(readCapture('{"capturedOn":"2026-09-19"}'), null, "a capture with no sections is none");

// The papers capture shipped calling its one section `rows`.
{
  const c = readCapture('{"capturedOn":"2026-09-18","rows":[{"paperId":"1"}]}');
  assert.ok(c);
  assert.equal(c.papers?.length, 1);
  assert.equal(c.timeliness, undefined);
}

// One click on one page can carry several readings.
{
  const c = readCapture(
    JSON.stringify({ capturedOn: "2026-09-19", timeliness: [{}], assessments: [{}, {}] }),
  );
  assert.ok(c);
  assert.equal(c.timeliness?.length, 1);
  assert.equal(c.assessments?.length, 2);
  assert.equal(c.capturedOn, "2026-09-19");
}

/* -------------------------------------------------------------------------- */
/* Timeliness                                                                 */
/* -------------------------------------------------------------------------- */

{
  // The real shape, as the Teacher Timeliness table gives it.
  const text = JSON.stringify({
    capturedOn: "2026-09-19",
    timeliness: [
      { position: 1, teacherName: "Kiran patel", classLabel: "Class1", subjectLabel: "Propel Hindi",
        totalPlans: 140, requiredPlans: 50, currentPlans: 10 },
      { position: 35, teacherName: "Shweta S", classLabel: "Class8", subjectLabel: "Propel Science",
        totalPlans: 140, requiredPlans: 51, currentPlans: 23 },
    ],
  });
  const r = parseNucleusTimeliness(text);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.gapPlans, -40, "ten done against fifty required is forty behind");
  assert.equal(r.rows[1]!.gapPlans, -28);
  assert.equal(r.rows[0]!.teacherName, "Kiran patel");
  assert.equal(r.rows[0]!.subjectLabel, "Propel Hindi");
}

{
  // A capture is easier to trust than a clipboard, not exempt from checking.
  const r = parseNucleusTimeliness(
    JSON.stringify({
      timeliness: [
        { teacherName: "", classLabel: "Class1", subjectLabel: "Hindi", totalPlans: 140 },
        { teacherName: "A", classLabel: "Class2", subjectLabel: "Math", totalPlans: 0 },
        { teacherName: "B", classLabel: "Class3", subjectLabel: "EVS", totalPlans: 140, requiredPlans: 50, currentPlans: 60 },
      ],
    }),
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.gapPlans, 10, "ahead of schedule reads positive");
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0]!, /missing teacher, class or subject/);
  assert.match(r.errors[1]!, /no day-plan total/);
}

{
  // The old paste still works, unchanged.
  const pasted = [
    "1\tKiran patel\tClass1-Propel Hindi\t36% Course (50/140 day plans)\t8% Course (10/140 day plans)\t40 Day Plans Behind",
  ].join("\n");
  const r = parseNucleusTimeliness(pasted);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.currentPlans, 10);
}

/* -------------------------------------------------------------------------- */
/* Assessments                                                                */
/* -------------------------------------------------------------------------- */

{
  const r = parseNucleusAssessments(
    JSON.stringify({
      assessments: [
        { classLabel: "Nursery", division: "A", subject: "Hindi",
          title: "Formative Assessment 1 - Set 1", chapters: "2 Chapters",
          statusText: "Ready to Download" },
        { classLabel: "Nursery", division: "A", subject: "Hindi",
          title: "Formative Assessment 2", chapters: "", statusText: "Not Created" },
        { classLabel: "", subject: "Hindi", title: "x", statusText: "Ready to Download" },
      ],
    }),
  );
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.status, "ready");
  assert.equal(r.rows[1]!.status, "not_created");
  assert.equal(
    r.rows[0]!.statusText,
    "Ready to Download",
    "the publisher's own wording is kept, not translated",
  );
  assert.equal(r.errors.length, 1);
}

console.log("OK — nucleusCapture.selftest.ts");
