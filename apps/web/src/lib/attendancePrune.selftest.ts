/**
 * A partial attendance push must never delete history.
 *
 * On 2026-08-11 the database held exactly one attendance register: today's.
 * The register for 2026-08-10, marked the day before, was gone. Nobody
 * deleted it.
 *
 * pushAttendanceRegistersToDb called deleteStale unconditionally with the ids
 * the client happened to be holding, so every push deleted every register not
 * in that payload. And the `if (!active.length)` guard ran AFTER the delete,
 * so an EMPTY payload wiped the whole attendance history first and noticed
 * second. The browser cache was being dropped on quota all that day, so the
 * client pushed partial state and the server obligingly pruned the rest.
 *
 * sis_students has been protected from exactly this since the roster
 * incident: pruning requires the caller to declare a complete snapshot, and
 * test:sis-prune enforces it. Attendance never got the same guard, and lost a
 * day of a real class's attendance.
 *
 * The rule: a push is a statement about the dates it covers, not about every
 * date that has ever existed.
 *
 * Run: npx tsx src/lib/attendancePrune.selftest.ts
 */
import assert from "node:assert/strict";

type Reg = { id: string; date: string };

/** Exactly the prune in pushAttendanceRegistersToDb. */
function pruneIds(active: Reg[], stored: Reg[]): string[] {
  if (active.length === 0) return [];
  const coveredDates = new Set(active.map((r) => r.date).filter(Boolean));
  const keepIds = new Set(active.map((r) => r.id));
  return stored
    .filter((r) => coveredDates.has(r.date))
    .map((r) => r.id)
    .filter((id) => !keepIds.has(id));
}

const yesterday: Reg = { id: "ar_yday", date: "2026-08-10" };
const today: Reg = { id: "ar_today", date: "2026-08-11" };

// ── The loss that happened ────────────────────────────────────────────────
{
  // The client holds only today — its cache was dropped on quota.
  const deleted = pruneIds([today], [yesterday, today]);
  assert.deepEqual(
    deleted,
    [],
    "a push covering only 2026-08-11 must not touch 2026-08-10. This exact " +
      "case deleted a real class's attendance for the previous day.",
  );
}

// ── An empty payload deletes NOTHING ──────────────────────────────────────
// The old code ran the delete before checking this, so an empty push wiped
// every register the school had.
{
  assert.deepEqual(
    pruneIds([], [yesterday, today]),
    [],
    "an empty push is a client with no data, never an instruction to erase " +
      "the attendance history",
  );
}

// ── Within a covered date, a removal still applies ────────────────────────
// Otherwise a register deleted in the UI would come back on the next sync,
// which is the bug the prune existed to solve.
{
  const dupToday: Reg = { id: "ar_today_old", date: "2026-08-11" };
  assert.deepEqual(
    pruneIds([today], [dupToday, today, yesterday]),
    ["ar_today_old"],
    "a stale register for a date the payload DOES cover is still pruned",
  );
}

// ── Multiple dates in one payload ─────────────────────────────────────────
{
  const other: Reg = { id: "ar_other", date: "2026-08-09" };
  const staleToday: Reg = { id: "ar_stale", date: "2026-08-11" };
  assert.deepEqual(
    pruneIds([today, yesterday], [today, yesterday, staleToday, other]),
    ["ar_stale"],
    "covered dates are pruned, uncovered ones (2026-08-09) are left alone",
  );
}

// ── A register with no date is never grounds to delete ────────────────────
{
  const undated: Reg = { id: "ar_undated", date: "" };
  assert.deepEqual(
    pruneIds([undated], [yesterday, today]),
    [],
    "a payload that covers no identifiable date prunes nothing",
  );
}

console.log("attendancePrune.selftest: all assertions passed");
