/**
 * Run: npx tsx src/lib/timetableSubstitutionAuto.selftest.ts
 *
 * absentTeachersForDate()/listSubstitutionsForDate() are localStorage-gated
 * (return empty outside a browser, per this app's convention — see
 * lib/staffAttendance.ts's `typeof window === "undefined"` guard), so
 * autoRunSubstitutionForDate's happy path can't be driven end-to-end from a
 * plain Node run. What IS fully testable here: the entry/exit conditions
 * that don't depend on browser state, and buildSubstituteNotifyMessages
 * (pure formatting, no storage). The "someone got auto-arranged and
 * notified" full flow is verified live in the browser instead.
 */
import assert from "node:assert/strict";

import {
  autoRunSubstitutionForDate,
  buildSubstituteNotifyMessages,
} from "./timetableSubstitutionAuto";
import { emptyMastersShell } from "./masters";
import type { TimetableSubstitution } from "./timetable";

console.log("timetableSubstitutionAuto.selftest.ts");

const masters = emptyMastersShell();
masters.staff = [
  {
    id: "stf_sub1",
    empCode: "S001",
    fullName: "Substitute One",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9876543210",
    email: "sub1@example.com",
    status: "active",
  },
  {
    id: "stf_sub2",
    empCode: "S002",
    fullName: "Substitute Two",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "",
    email: "sub2@example.com",
    status: "active",
  },
  {
    id: "stf_absent1",
    empCode: "S003",
    fullName: "Absent Teacher",
    stream: "teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "9000000000",
    email: "absent1@example.com",
    status: "active",
  },
] as unknown as typeof masters.staff;
masters.classes = [
  { id: "cls_a", name: "VI", isActive: true, sortOrder: 1 },
] as unknown as typeof masters.classes;
masters.sections = [
  { id: "sec_a", classId: "cls_a", name: "A", isActive: true },
] as unknown as typeof masters.sections;
masters.subjects = [
  { id: "sub_math", code: "MAT", name: "Mathematics" },
] as unknown as typeof masters.subjects;

// --- No absentees for the date → does nothing, cheaply -----------------
{
  const outcome = autoRunSubstitutionForDate(masters, "2026-27", "2026-09-15");
  assert.equal(outcome.ran, false);
  assert.equal(outcome.reason, "no-absentees");
  assert.deepEqual(outcome.created, []);
}

// --- buildSubstituteNotifyMessages: groups multiple periods per teacher,
// skips teachers with no mobile on file --------------------------------
{
  const subs: TimetableSubstitution[] = [
    {
      id: "sub_1",
      academicYearCode: "2026-27",
      date: "2026-09-15",
      weekday: 2,
      periodNo: 1,
      classId: "cls_a",
      sectionId: "sec_a",
      subjectId: "sub_math",
      absentTeacherId: "stf_absent1",
      substituteTeacherId: "stf_sub1",
      source: "auto",
      note: "",
      createdAt: "",
    },
    {
      id: "sub_2",
      academicYearCode: "2026-27",
      date: "2026-09-15",
      weekday: 2,
      periodNo: 3,
      classId: "cls_a",
      sectionId: "sec_a",
      subjectId: "sub_math",
      absentTeacherId: "stf_absent1",
      substituteTeacherId: "stf_sub1",
      source: "auto",
      note: "",
      createdAt: "",
    },
    {
      id: "sub_3",
      academicYearCode: "2026-27",
      date: "2026-09-15",
      weekday: 2,
      periodNo: 2,
      classId: "cls_a",
      sectionId: "sec_a",
      subjectId: "sub_math",
      absentTeacherId: "stf_absent1",
      substituteTeacherId: "stf_sub2", // no mobile on file
      source: "auto",
      note: "",
      createdAt: "",
    },
    {
      id: "sub_4",
      academicYearCode: "2026-27",
      date: "2026-09-15",
      weekday: 2,
      periodNo: 4,
      classId: "cls_a",
      sectionId: "sec_a",
      subjectId: "sub_math",
      absentTeacherId: "stf_absent1",
      substituteTeacherId: "", // uncovered period — no substitute assigned
      source: "auto",
      note: "",
      createdAt: "",
    },
  ];

  const messages = buildSubstituteNotifyMessages(subs, masters, "2026-09-15");

  assert.equal(
    messages.length,
    1,
    "THE REGRESSION THIS GUARDS: one message per teacher (2 periods merged into 1 msg), and the mobile-less/unassigned rows must be skipped — not 4 separate messages",
  );
  assert.equal(messages[0]!.mobile, "9876543210");
  assert.ok(messages[0]!.body.includes("Period 1"));
  assert.ok(messages[0]!.body.includes("Period 3"));
  assert.ok(
    !messages[0]!.body.includes("Period 2"),
    "stf_sub2's period must not leak into stf_sub1's message",
  );
  assert.ok(messages[0]!.body.includes("Absent Teacher"));
  assert.ok(messages[0]!.body.includes("VI-A"));
}

console.log("OK — timetableSubstitutionAuto.selftest.ts");
