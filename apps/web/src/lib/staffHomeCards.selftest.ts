/**
 * The principal home's staff cards and what they open (approved requests,
 * 20 Oct 2026):
 *   - mr_mv9ym54sdge3: Present / Absent count and list the same rows, and
 *     staff exempt from attendance are in neither (lib/staffToday);
 *   - mr_mva0mcxt0c3h: Staff today lists what each person did
 *     (lib/staffActivityToday);
 *   - mr_mv9yf8qf6y0j: a colleague's profile never carries identity, bank
 *     or statutory numbers (colleagueProfileView);
 *
 * Run: npx tsx src/lib/staffHomeCards.selftest.ts
 */
import assert from "node:assert/strict";
import type { StaffRecord } from "@/lib/foundationMasters";
import type { StaffAttendanceMark } from "@/lib/staffAttendance";
import { filterStaffToday, staffTodayRows, staffTodayTotals } from "@/lib/staffToday";
import {
  auditActivity,
  buildStaffActivityToday,
  schoolClock,
  schoolDate,
} from "@/lib/staffActivityToday";
import { colleagueProfileView } from "@/lib/staffSelfProfile";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const mark = (staffId: string, status: string, inTime = ""): StaffAttendanceMark =>
  ({ staffId, status, note: "", inTime, outTime: "", punchWay: "" }) as StaffAttendanceMark;

const staff = [
  { id: "s1", fullName: "Asha", status: "active", designationId: "d1", mobile: "9000000001" },
  { id: "s2", fullName: "Bina", status: "active", designationId: null, mobile: "" },
  { id: "s3", fullName: "Chetan", status: "active" },
  { id: "s4", fullName: "Director", status: "active" },
  { id: "s5", fullName: "Gone", status: "inactive" },
  { id: "s6", fullName: "Late Lal", status: "active" },
];
const marks = [mark("s1", "P", "08:10"), mark("s2", "A"), mark("s4", "A"), mark("s5", "P"), mark("s6", "L", "09:01")];
const exempt = new Set(["s4"]);

test("exempt staff are in neither the rows nor the counts", () => {
  const rows = staffTodayRows({ staff, designations: [{ id: "d1", name: "PGT" }], marks, exempt });
  assert.ok(!rows.some((r) => r.staffId === "s4"), "exempt director listed");
  assert.ok(!rows.some((r) => r.staffId === "s5"), "inactive listed");
  const t = staffTodayTotals(rows);
  assert.deepEqual(t, { present: 2, absent: 1, leave: 0, notMarked: 1, total: 4 });
});

test("the Present and Absent lists have exactly as many rows as their cards", () => {
  const rows = staffTodayRows({ staff, designations: [], marks, exempt });
  const t = staffTodayTotals(rows);
  assert.equal(filterStaffToday(rows, "present").length, t.present);
  assert.equal(filterStaffToday(rows, "absent").length, t.absent);
  assert.deepEqual(filterStaffToday(rows, "present").map((r) => r.staffId).sort(), ["s1", "s6"]);
  assert.deepEqual(filterStaffToday(rows, "absent").map((r) => r.staffId), ["s2"]);
  assert.equal(filterStaffToday(rows, null).length, rows.length);
});

test("school clock and date are India time", () => {
  assert.equal(schoolClock("2026-10-20T03:00:00.000Z"), "08:30");
  assert.equal(schoolClock("9:05"), "09:05");
  assert.equal(schoolDate("2026-10-19T19:00:00.000Z"), "2026-10-20");
  assert.equal(schoolClock("garbage"), "");
});

test("audit rows map to activities; desk-owned kinds and noise are dropped", () => {
  assert.deepEqual(
    auditActivity({ module: "exams", action: "edit", entityType: "mark_sheet", summary: "Marks entered from app: 32 students, subject x" }),
    { kind: "marks", qty: 32 },
  );
  assert.equal(auditActivity({ module: "attendance", action: "edit", entityType: "register", summary: "Marked attendance" }), null);
  assert.equal(auditActivity({ module: "homework", action: "edit", entityType: "post", summary: "Posted homework" }), null);
  assert.equal(auditActivity({ module: "fees", action: "create", entityType: "collection_voucher", summary: "Collected receipt" }), null);
  assert.equal(auditActivity({ module: "staff_attendance", action: "edit", entityType: "punch", summary: "punch-in" }), null);
  assert.deepEqual(auditActivity({ module: "students", action: "edit", entityType: "student", summary: "Class sheet (heightCm): 3 children" }), { kind: "class_sheet" });
  assert.deepEqual(auditActivity({ module: "student_leave", action: "approve", entityType: "", summary: "" }), { kind: "student_leave_decided" });
});

test("activities are grouped per person and kind, matched by id or by a unique name", () => {
  const { rows, unmatched } = buildStaffActivityToday({
    staff: [
      { id: "s1", fullName: "Asha Rani", status: "active" },
      { id: "s2", fullName: "Bina", status: "active" },
      { id: "s3", fullName: "Same Name", status: "active" },
      { id: "s4", fullName: "same  name", status: "active" },
      { id: "s5", fullName: "Gone", status: "inactive" },
    ],
    designations: [],
    events: [
      { staffId: "s1", kind: "punch_in", at: "08:05" },
      { actorName: " asha rani ", kind: "attendance_register", at: "2026-10-20T03:00:00Z", detail: "V A" },
      { actorName: "Asha Rani", kind: "attendance_register", at: "2026-10-20T03:30:00Z", detail: "V B" },
      { actorName: "Asha Rani", kind: "marks", at: "2026-10-20T05:00:00Z", qty: 30 },
      { actorName: "Asha Rani", kind: "marks", at: "2026-10-20T06:00:00Z", qty: 28 },
      { actorName: "Bina", kind: "fee_receipts", at: "2026-10-20T04:00:00Z", qty: 150000 },
      { actorName: "Same Name", kind: "homework", at: "2026-10-20T04:00:00Z" },
      { actorName: "Gone", kind: "homework", at: "2026-10-20T04:00:00Z" },
      { staffId: "nobody", kind: "punch_in", at: "08:00" },
    ],
  });
  assert.equal(unmatched, 3, "ambiguous name, inactive person and unknown id are not given to anyone");
  assert.equal(rows[0]!.staffId, "s1", "who did the most comes first");
  const asha = rows[0]!;
  assert.deepEqual(asha.items.map((i) => i.kind), ["punch_in", "attendance_register", "marks"]);
  const reg = asha.items.find((i) => i.kind === "attendance_register")!;
  assert.equal(reg.count, 2);
  assert.deepEqual(reg.details, ["V A", "V B"]);
  assert.equal(reg.firstAt, "08:30");
  assert.equal(reg.lastAt, "09:00");
  assert.equal(asha.items.find((i) => i.kind === "marks")!.qty, 58);
  assert.equal(rows.find((r) => r.staffId === "s2")!.items[0]!.qty, 150000);
  assert.ok(rows.find((r) => r.staffId === "s3")!.items.length === 0);
  assert.equal(rows.length, 4, "inactive staff not listed");
});

test("a colleague's profile carries no identity, bank or statutory numbers", () => {
  const s = {
    id: "s1",
    fullName: "Asha",
    email: "a@example.test",
    city: "Town",
    bloodGroup: "O+",
    qualification: "B.Ed",
    aadhaarNo: "123412341234",
    panNo: "ABCDE1234F",
    bankAccountNo: "000111222333",
    bankIfsc: "SBIN0000001",
    uanNumber: "100200300400",
    dateOfBirth: "1990-01-01",
    altMobile: "",
  } as unknown as StaffRecord;
  const view = colleagueProfileView(s);
  const keys = view.map((f) => f.key);
  assert.deepEqual(keys.sort(), ["bloodGroup", "city", "email", "qualification"].sort());
  const all = JSON.stringify(view);
  for (const secret of ["123412341234", "ABCDE1234F", "000111222333", "SBIN0000001", "100200300400", "1990-01-01"]) {
    assert.ok(!all.includes(secret), `leaked ${secret}`);
  }
});

console.log(`\n${passed} passed`);
