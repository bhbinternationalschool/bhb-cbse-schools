#!/usr/bin/env npx tsx
/**
 * Backfill staff_attendance_desk_* from staff_attendance_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-staff-attendance-desk.ts
 */

import type { StaffAttendanceState } from "../src/lib/staffAttendance";
import {
  fetchStaffAttendanceDeskFromDb,
  pushStaffAttendanceDeskToDb,
} from "../src/lib/staffAttendanceNormalized.server";

async function main() {
  const { fetchServerBlob } = await import("../src/lib/serverBlob");
  const blob = await fetchServerBlob<StaffAttendanceState>(
    "staff_attendance_state",
  );
  const state = blob.state;
  if (!state?.registers?.length && !state?.settings) {
    throw new Error("No staff attendance desk data in staff_attendance_state blob.");
  }

  console.log("Loaded from staff_attendance_state blob:", {
    registers: state?.registers?.length ?? 0,
    settings: !!state?.settings,
  });

  const before = await fetchStaffAttendanceDeskFromDb();
  console.log(`DB before: ${before.registers.length} registers`);

  const result = await pushStaffAttendanceDeskToDb(state!);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchStaffAttendanceDeskFromDb();
  console.log(
    `Backfill OK — wrote ${result.registerCount} registers (DB now ${after.registers.length})`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
