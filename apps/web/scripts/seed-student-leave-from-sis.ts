#!/usr/bin/env npx tsx
/**
 * Seed student_leave_desk_requests from active SIS students (demo pending + approved).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-student-leave-from-sis.ts
 */

import {
  emptyStudentLeaveState,
  type StudentLeaveRequest,
  type StudentLeaveState,
} from "../src/lib/studentLeave";
import { DEFAULT_AY } from "../src/lib/masters";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchStudentLeaveDeskFromDb,
  pushStudentLeaveDeskToDb,
} from "../src/lib/studentLeaveNormalized.server";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const today = todayYmd();
  const tomorrow = plusDaysYmd(1);
  const now = new Date().toISOString();

  const { bundle } = await fetchSisFromDb();
  const active = bundle.students.filter(
    (s) => s.status === "active" && s.householdId,
  );
  if (active.length < 3) {
    throw new Error("Need at least 3 active SIS students — seed SIS first.");
  }

  const requests: StudentLeaveRequest[] = [
    {
      id: `slr_seed_${active[0]!.id}_pending`,
      academicYearCode: active[0]!.academicYearCode || DEFAULT_AY,
      studentId: active[0]!.id,
      fromDate: tomorrow,
      toDate: tomorrow,
      leaveType: "SL",
      reason: "Family function — seeded pending request",
      attachmentUrl: "",
      status: "pending",
      requestedBy: "Parent",
      householdId: active[0]!.householdId,
      createdAt: now,
      decidedBy: "",
      decidedAt: "",
      decisionNote: "",
      attendanceApplied: false,
    },
    {
      id: `slr_seed_${active[1]!.id}_approved`,
      academicYearCode: active[1]!.academicYearCode || DEFAULT_AY,
      studentId: active[1]!.id,
      fromDate: today,
      toDate: today,
      leaveType: "ML",
      reason: "Medical — seeded approved request",
      attachmentUrl: "",
      status: "approved",
      requestedBy: "Parent",
      householdId: active[1]!.householdId,
      createdAt: now,
      decidedBy: "seed-student-leave-from-sis",
      decidedAt: now,
      decisionNote: "Approved for desk cutover seed",
      attendanceApplied: false,
    },
    {
      id: `slr_seed_${active[2]!.id}_hd`,
      academicYearCode: active[2]!.academicYearCode || DEFAULT_AY,
      studentId: active[2]!.id,
      fromDate: today,
      toDate: today,
      leaveType: "HD_AM",
      reason: "Doctor appointment — half day AM",
      attachmentUrl: "",
      status: "approved",
      requestedBy: "Parent",
      householdId: active[2]!.householdId,
      createdAt: now,
      decidedBy: "seed-student-leave-from-sis",
      decidedAt: now,
      decisionNote: "",
      attendanceApplied: false,
    },
  ];

  const state: StudentLeaveState = {
    ...emptyStudentLeaveState(),
    requests,
  };

  console.log(`Seeding ${requests.length} leave requests`);

  const before = await fetchStudentLeaveDeskFromDb();
  console.log(`DB before: ${before.bundle.requests.length} requests`);

  const result = await pushStudentLeaveDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchStudentLeaveDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.requests.length} requests (${after.meta?.pendingCount ?? 0} pending, ${after.meta?.approvedCount ?? 0} approved)`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
