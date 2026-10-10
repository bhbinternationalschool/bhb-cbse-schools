/**
 * Self-test: reading a pasted Nucleus "Teacher Timeliness" table.
 * The sample is the shape the portal's own copy produces (18 Sep 2026).
 * Run: npx tsx apps/web/src/lib/nucleusProgress.selftest.ts
 */
import assert from "node:assert/strict";
import {
  BEHIND_THRESHOLD,
  parseNucleusTimeliness,
  readingIsStale,
  summariseNucleus,
} from "@/lib/nucleusProgress";

/** How the table arrives when selected and copied out of the portal. */
const PASTE = `Class Timeliness Performance
Select Teacher
Select Class
0%
10%
100%
SR	Teacher Name	Class/Div/Subject	Required Progress	Current Progress	Status

1	Kiran patel	Class1-Propel Hindi	35% Course (49/140 day plans)

	8% Course (10/140 day plans)
39 Day Plans Behind

2	Sunidhi Singh	Class1-Propel English	35% Course (49/140 day plans)

	4% Course (5/140 day plans)
44 Day Plans Behind

9	Devendra Kumar Pandey	Class3-Propel Math	35% Course (49/140 day plans)

	68% Course (94/140 day plans)
45 Day Plans Ahead

23	Vishnu Om Tripathi	Class6-Propel English	37% Course (51/140 day plans)

	36% Course (50/140 day plans)
1 Day Plan Behind
`;

// ── The rows, as read ───────────────────────────────────────────────────
{
  const { rows, errors } = parseNucleusTimeliness(PASTE);
  assert.deepEqual(errors, [], errors.join(" | "));
  assert.equal(rows.length, 4);

  const first = rows[0]!;
  assert.equal(first.position, 1);
  assert.equal(first.teacherName, "Kiran patel");
  assert.equal(first.classLabel, "Class1");
  assert.equal(first.subjectLabel, "Propel Hindi");
  assert.equal(first.totalPlans, 140);
  assert.equal(first.requiredPlans, 49);
  assert.equal(first.currentPlans, 10);
  assert.equal(first.gapPlans, -39, "behind is negative");

  // A teacher ahead of schedule, and the singular "1 Day Plan Behind".
  assert.equal(rows[2]!.gapPlans, 45);
  assert.equal(rows[3]!.gapPlans, -1);
  // The chart's axis labels ("0%", "10%") and the header are not rows.
  assert.deepEqual(rows.map((r) => r.position), [1, 2, 9, 23]);
}

// ── Nucleus disagreeing with its own arithmetic is an error, not a guess ─
{
  const bad = `1	A Teacher	Class2-Propel Math	38% Course (52/140 day plans)
	20% Course (27/140 day plans)
99 Day Plans Behind`;
  const { rows, errors } = parseNucleusTimeliness(bad);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /Row 1/);
  assert.match(errors[0]!, /99 day plans behind/i);
  assert.match(errors[0]!, /25 behind/);
}

// ── Half-read rows are named, never half-imported ───────────────────────
{
  const partial = `1	Only Name	Class1-Propel Hindi	35% Course (49/140 day plans)`;
  const r1 = parseNucleusTimeliness(partial);
  assert.equal(r1.rows.length, 0);
  assert.match(r1.errors[0]!, /only one progress figure/i);

  const noName = `1	35% Course (49/140 day plans)
	8% Course (10/140 day plans)`;
  const r2 = parseNucleusTimeliness(noName);
  assert.equal(r2.rows.length, 0);
  assert.match(r2.errors[0]!, /teacher name/i);

  const mismatched = `1	A Teacher	Class1-Propel Hindi	35% Course (49/140 day plans)
	8% Course (10/120 day plans)`;
  const r3 = parseNucleusTimeliness(mismatched);
  assert.equal(r3.rows.length, 0);
  assert.match(r3.errors[0]!, /different courses/i);

  // Nothing pasted at all: no rows, no invented errors.
  assert.deepEqual(parseNucleusTimeliness(""), { rows: [], errors: [] });
}

// ── The same row twice (a double paste) ─────────────────────────────────
{
  const twice = `1	A Teacher	Class1-Propel Hindi	35% Course (49/140 day plans)
	8% Course (10/140 day plans)
1	A Teacher	Class1-Propel Hindi	35% Course (49/140 day plans)
	8% Course (10/140 day plans)`;
  const { rows, errors } = parseNucleusTimeliness(twice);
  assert.equal(rows.length, 1);
  assert.match(errors[0]!, /twice/i);
}

// ── What the principal's screen leads with ──────────────────────────────
{
  const { rows } = parseNucleusTimeliness(PASTE);
  const s = summariseNucleus(rows);
  assert.equal(s.rowCount, 4);
  assert.equal(s.ahead, 1);
  assert.equal(s.behind.length, 2, "−39 and −44 are behind; −1 is not");
  assert.equal(s.onTrack, 1);
  assert.equal(s.worst[0]!.gapPlans, -44, "worst first");
  assert.ok(BEHIND_THRESHOLD > 1);
}

// ── A reading is of a date, and says so when it is old ──────────────────
{
  assert.equal(readingIsStale("2026-09-18", "2026-09-18"), false);
  assert.equal(readingIsStale("2026-09-11", "2026-09-18"), false, "exactly 7 days is not stale");
  assert.equal(readingIsStale("2026-09-10", "2026-09-18"), true);
  assert.equal(readingIsStale("", "2026-09-18"), true, "an unreadable date counts as stale");
}

console.log("nucleusProgress.selftest: all assertions passed");
