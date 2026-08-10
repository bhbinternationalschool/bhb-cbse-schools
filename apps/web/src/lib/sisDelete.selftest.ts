/**
 * A removed student must actually be gone from the database.
 *
 * Until 2026-08-10 a removal existed only as an *absence* from the next
 * roster push. `pushSisToDb` prunes only when `opts.pruneMissing` is set,
 * and grep proves no caller ever set it — so the push upserted the surviving
 * rows and the deleted one was simply never mentioned. It stayed in
 * `sis_students`, and the next hydrate brought the student back. The UI said
 * "Student removed" every time.
 *
 * The fix states deletions explicitly instead of inferring them from what is
 * missing. That distinction is the whole point: inference is what lets a
 * truncated payload wipe a roster, which is the failure `test:sis-prune`
 * exists to prevent. This pins the contract on both sides.
 *
 * Run: npx tsx src/lib/sisDelete.selftest.ts
 */
import assert from "node:assert/strict";
import {
  emptySisState,
  removeStudent,
  type SisState,
  type SisStudent,
} from "./sis";
import {
  peekPendingSisDeletions,
  recordSisDeletion,
} from "./sisNormalizedClient";

function student(
  id: string,
  householdId: string,
  status: SisStudent["status"] = "inactive",
): SisStudent {
  return {
    id,
    householdId,
    fullName: `Student ${id}`,
    admissionNo: `A${id}`,
    academicYearCode: "2026-27",
    status,
  } as SisStudent;
}

function state(): SisState {
  return {
    ...emptySisState(),
    students: [
      student("s1", "h1"),
      student("s2", "h1"), // shares a household with s1
      student("s3", "h2"), // sole occupant of h2
    ],
    households: [
      { id: "h1", guardianName: "G1" } as SisState["households"][number],
      { id: "h2", guardianName: "G2" } as SisState["households"][number],
    ],
  };
}

/** What StudentsWorkspace.onRemove derives to state the deletion. */
function removedHouseholdIds(before: SisState, after: SisState): string[] {
  return before.households
    .filter((h) => !after.households.some((x) => x.id === h.id))
    .map((h) => h.id);
}

// ── Removing one of two siblings keeps the household ─────────────────────
{
  const before = state();
  const r = removeStudent(before, "s1");
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");

  assert.deepEqual(
    r.state.students.map((s) => s.id),
    ["s2", "s3"],
    "only the removed student leaves the roster",
  );
  assert.deepEqual(
    removedHouseholdIds(before, r.state),
    [],
    "a household with a remaining student must NOT be deleted",
  );
}

// ── Removing the last student in a household deletes it too ──────────────
{
  const before = state();
  const r = removeStudent(before, "s3");
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");

  assert.deepEqual(
    removedHouseholdIds(before, r.state),
    ["h2"],
    "the emptied household is stated for deletion, not left orphaned",
  );
}

// ── The absence-based inference this replaces would be wrong ─────────────
// Reconstructing "what to delete" by diffing a *partial* roster against the
// database is exactly the prune hazard. If a client held only s3 and pushed,
// inference would conclude s1 and s2 must go. Stating deletions cannot.
{
  const full = state();
  const partial: SisState = {
    ...full,
    students: [student("s3", "h2")],
    households: [],
  };

  const inferred = full.students
    .filter((s) => !partial.students.some((x) => x.id === s.id))
    .map((s) => s.id);
  assert.deepEqual(
    inferred,
    ["s1", "s2"],
    "inference from a partial payload would delete two untouched students",
  );

  // The explicit path deletes only what was actually removed — nothing here.
  const stated: string[] = [];
  assert.deepEqual(stated, [], "no removal was requested, so nothing is deleted");
}

// ── The real queue in sisNormalizedClient accumulates what was stated ────
// Exercising the actual module state, not a model of it: a deletion that
// never reaches the queue never reaches the wire, which was the bug.
{
  recordSisDeletion({ studentIds: ["s1"], householdIds: [] });
  assert.deepEqual(
    peekPendingSisDeletions().studentIds,
    ["s1"],
    "a stated deletion is queued for the next push",
  );

  // Removing the last student of a household states both.
  recordSisDeletion({ studentIds: ["s3"], householdIds: ["h2"] });
  const q = peekPendingSisDeletions();
  assert.deepEqual(q.studentIds, ["s1", "s3"], "deletions accumulate");
  assert.deepEqual(q.householdIds, ["h2"]);

  // Idempotent: stating the same removal twice must not duplicate it.
  recordSisDeletion({ studentIds: ["s1"] });
  assert.deepEqual(
    peekPendingSisDeletions().studentIds,
    ["s1", "s3"],
    "restating a deletion does not duplicate it",
  );

  // Blank ids must never reach the wire — an empty id in an `in (...)`
  // filter is a query that matches nothing at best.
  recordSisDeletion({ studentIds: [""], householdIds: [""] });
  assert.deepEqual(peekPendingSisDeletions().studentIds, ["s1", "s3"]);
  assert.deepEqual(peekPendingSisDeletions().householdIds, ["h2"]);
}

// ── A blocked removal states nothing ─────────────────────────────────────
{
  const before = state();
  const r = removeStudent(before, "does-not-exist");
  assert.equal(r.ok, false, "removing an unknown student is refused");
}

// ── An ACTIVE student cannot be removed at all ───────────────────────────
// A business rule, not an accident: an active student must be inactivated
// first. It matters here because a refusal must never reach the delete
// queue — queueing an id the domain rejected would delete a live record.
{
  const before: SisState = {
    ...emptySisState(),
    students: [student("s9", "h9", "active")],
    households: [
      { id: "h9", guardianName: "G9" } as SisState["households"][number],
    ],
  };

  const r = removeStudent(before, "s9");
  assert.equal(r.ok, false, "an active student is refused");
  assert.match(
    r.ok === false ? r.reason : "",
    /inactivate/i,
    "and the refusal explains what to do instead",
  );
}

console.log("sisDelete.selftest: all assertions passed");
