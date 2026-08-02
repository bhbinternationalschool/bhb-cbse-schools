#!/usr/bin/env npx tsx
/**
 * Seed staff_attendance_desk_* from active staff roster (one day register).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-staff-attendance-from-roster.ts
 *   cd apps/web && npx tsx scripts/seed-staff-attendance-from-roster.ts --date=2026-08-02
 */

import {
  defaultAttendanceSettings,
  type StaffAttendanceRegister,
  type StaffAttendanceState,
} from "../src/lib/staffAttendance";
import { DEFAULT_AY } from "../src/lib/masters";
import { fetchStaffRemoteServer } from "../src/lib/staffPersistence";
import {
  fetchStaffAttendanceDeskFromDb,
  pushStaffAttendanceDeskToDb,
} from "../src/lib/staffAttendanceNormalized.server";

function todayYmd(): string {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  if (arg) return arg.split("=")[1]!;
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const date = todayYmd();
  const roster = await fetchStaffRemoteServer();
  if (!roster?.staff.length) {
    throw new Error(
      "No staff in sis_staff — run backfill-staff-roster.ts first.",
    );
  }

  const active = roster.staff.filter((s) => s.status === "active");
  if (!active.length) {
    throw new Error("No active staff in roster.");
  }

  const now = new Date().toISOString();
  const register: StaffAttendanceRegister = {
    id: `sar_seed_${date}`,
    academicYearCode: DEFAULT_AY,
    date,
    marks: active.map((st, i) => ({
      staffId: st.id,
      status: i % 11 === 0 ? "A" : "P",
      note: "",
      inTime: "08:45",
      outTime: "15:30",
      punchWay: "manual",
    })),
    markedBy: "seed-staff-attendance-from-roster",
    markedAt: now,
    remark: "Seeded from staff roster for desk cutover",
  };

  const state: StaffAttendanceState = {
    version: 1,
    settings: defaultAttendanceSettings(),
    registers: [register],
  };

  console.log(`Seeding 1 staff register for ${date} (${active.length} staff)`);

  const before = await fetchStaffAttendanceDeskFromDb();
  console.log(`DB before: ${before.registers.length} registers`);

  const result = await pushStaffAttendanceDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchStaffAttendanceDeskFromDb();
  console.log(
    `Seed OK — ${result.registerCount} register written (DB now ${after.registers.length})`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
