#!/usr/bin/env npx tsx
/**
 * Seed attendance_desk_* from active SIS students (one register per class-section for today).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-attendance-from-sis.ts
 *   cd apps/web && npx tsx scripts/seed-attendance-from-sis.ts --date=2026-08-02
 */

import {
  DEFAULT_ATTENDANCE_POLICY,
  type AttendanceRegister,
  type AttendanceState,
} from "../src/lib/attendance";
import { DEFAULT_AY } from "../src/lib/masters";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchAttendanceDeskFromDb,
  pushAttendanceDeskToDb,
} from "../src/lib/attendanceNormalized.server";

function todayYmd(): string {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  if (arg) return arg.split("=")[1]!;
  return new Date().toISOString().slice(0, 10);
}

function groupKey(classId: string, sectionId: string) {
  return `${classId}::${sectionId}`;
}

async function main() {
  const date = todayYmd();
  const { bundle } = await fetchSisFromDb();
  const active = bundle.students.filter(
    (s) => s.status === "active" && s.classId && s.sectionId,
  );
  if (!active.length) {
    throw new Error("No active SIS students with class/section — cannot seed attendance.");
  }

  const bySection = new Map<string, typeof active>();
  for (const s of active) {
    const key = groupKey(s.classId, s.sectionId);
    const list = bySection.get(key) ?? [];
    list.push(s);
    bySection.set(key, list);
  }

  const now = new Date().toISOString();
  const registers: AttendanceRegister[] = [];

  for (const [, students] of bySection) {
    const sample = students[0]!;
    const registerId = `ar_seed_${sample.classId}_${sample.sectionId}_${date}`;
    registers.push({
      id: registerId,
      academicYearCode: sample.academicYearCode || DEFAULT_AY,
      campusId: sample.campusId || "",
      classId: sample.classId,
      sectionId: sample.sectionId,
      date,
      marks: students.map((st, i) => ({
        studentId: st.id,
        status: i % 17 === 0 ? "A" : "P",
        note: "",
      })),
      markedBy: "seed-attendance-from-sis",
      markedAt: now,
      remark: "Seeded from SIS roster for desk cutover",
    });
  }

  const state: AttendanceState = {
    version: 2,
    registers,
    policy: { ...DEFAULT_ATTENDANCE_POLICY },
    absentNudges: [],
    exceptions: [],
  };

  console.log(`Seeding ${registers.length} registers for ${date} (${active.length} students)`);

  const before = await fetchAttendanceDeskFromDb();
  console.log(`DB before: ${before.registers.length} registers`);

  const result = await pushAttendanceDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchAttendanceDeskFromDb();
  console.log(
    `Seed OK — ${result.registerCount} registers written (DB now ${after.registers.length})`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
