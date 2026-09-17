/**
 * Self-test: reading a pasted Nucleus "Assessments & Answer key" table.
 * The sample follows the shape the portal's copy produces (18 Sep 2026).
 * Run: npx tsx apps/web/src/lib/nucleusAssessments.selftest.ts
 */
import assert from "node:assert/strict";
import { parseNucleusAssessments, summariseAssessments } from "@/lib/nucleusAssessments";

const PASTE = `Class	Division	Subject	Title	Chapters/Units	Teacher Name	Status	Preview & Download

Nursery	A	Hindi	Formative Assessment 1 - Set 1	2 Chapters
-

Ready to Download

View Paper

Nursery	A	Hindi	Formative Assessment 2	-
-

Not Created

Nursery	A	English Literacy	Summative Assessment 1 - Set 1	4 Chapters
-

Ready to Download

View Paper

Class 8	A	Science	Formative Assessment 3	-
-

Not Created

Class 8	A	Science	Summative Assessment 2	-
-

Not Created

`;

// ── The rows, as read ───────────────────────────────────────────────────
{
  const { rows, errors } = parseNucleusAssessments(PASTE);
  assert.deepEqual(errors, [], errors.join(" | "));
  assert.equal(rows.length, 5);

  const first = rows[0]!;
  assert.equal(first.classLabel, "Nursery");
  assert.equal(first.division, "A");
  assert.equal(first.subject, "Hindi");
  assert.equal(first.title, "Formative Assessment 1 - Set 1");
  assert.equal(first.chapters, "2 Chapters");
  assert.equal(first.status, "ready");
  assert.equal(first.statusText, "Ready to Download", "Nucleus's own wording is kept");

  // A dash means "nothing here", not a chapter count of "-".
  assert.equal(rows[1]!.chapters, "");
  assert.equal(rows[1]!.status, "not_created");

  // The header row is not a paper.
  assert.ok(!rows.some((r) => r.subject === "Subject"));
}

// ── What the office is asked to act on ──────────────────────────────────
{
  const { rows } = parseNucleusAssessments(PASTE);
  const s = summariseAssessments(rows);
  assert.equal(s.rowCount, 5);
  assert.equal(s.ready, 2);
  assert.equal(s.notCreated, 3);

  // Grouped by class-division-subject, worst first.
  assert.equal(s.gaps.length, 2);
  assert.equal(s.gaps[0]!.subject, "Science");
  assert.deepEqual(s.gaps[0]!.missing, ["Formative Assessment 3", "Summative Assessment 2"]);
  assert.equal(s.gaps[1]!.subject, "Hindi");
  assert.deepEqual(s.gaps[1]!.missing, ["Formative Assessment 2"]);
}

// ── A row without a status is named, not assumed ready ──────────────────
{
  const noStatus = `Class 6	A	Maths	Formative Assessment 1	3 Chapters

-
`;
  const { rows, errors } = parseNucleusAssessments(noStatus);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /no status/i);
  assert.match(errors[0]!, /Maths/);
}

// ── An unknown status word is kept, not forced into ready/not created ───
{
  const odd = `Class 7	B	English	Summative Assessment 1	5 Chapters

-

In Progress
`;
  const { rows, errors } = parseNucleusAssessments(odd);
  // "In Progress" is not one we know, so the row has no recognised status and
  // is reported rather than counted as ready.
  assert.equal(rows.length, 0);
  assert.match(errors[0]!, /no status/i);
}

// ── Nothing pasted ──────────────────────────────────────────────────────
{
  assert.deepEqual(parseNucleusAssessments(""), { rows: [], errors: [] });
}

console.log("nucleusAssessments.selftest: all assertions passed");
