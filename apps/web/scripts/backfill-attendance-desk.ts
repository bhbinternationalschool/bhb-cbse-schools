#!/usr/bin/env npx tsx
/**
 * Backfill attendance_desk_* tables from attendance_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-attendance-desk.ts
 */

import type { AttendanceState } from "../src/lib/attendance";
import {
  fetchAttendanceDeskFromDb,
  pushAttendanceDeskToDb,
} from "../src/lib/attendanceNormalized.server";

async function loadFromBlob(): Promise<AttendanceState | null> {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<AttendanceState>("attendance_state");
  return blob.state ?? null;
}

function hasDeskData(state: AttendanceState | null): boolean {
  if (!state) return false;
  return (
    (state.registers?.length ?? 0) > 0 ||
    (state.absentNudges?.length ?? 0) > 0 ||
    (state.exceptions?.length ?? 0) > 0
  );
}

async function main() {
  const state = await loadFromBlob();
  if (!hasDeskData(state)) {
    throw new Error("No attendance desk data in attendance_state blob.");
  }

  console.log("Loaded from attendance_state blob:", {
    registers: state!.registers.length,
    nudges: state!.absentNudges?.length ?? 0,
    exceptions: state!.exceptions?.length ?? 0,
  });

  const before = await fetchAttendanceDeskFromDb();
  console.log(
    `DB before: ${before.registers.length} registers, ${before.ancillary.absentNudges.length} nudges, ${before.ancillary.exceptions.length} exceptions`,
  );

  const result = await pushAttendanceDeskToDb(state!);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchAttendanceDeskFromDb();
  console.log(
    `Backfill OK — wrote ${result.registerCount} registers (DB now ${after.registers.length})`,
  );
  console.log(
    `Ancillary: ${after.ancillary.absentNudges.length} nudges, ${after.ancillary.exceptions.length} exceptions`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
