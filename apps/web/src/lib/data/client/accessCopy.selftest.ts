/**
 * The access copy's rules (data-layer 2.3a, lib/data/client/accessCopy.ts):
 *
 *  1. "ready" only when BOTH the rbac and the staff-list views have answered;
 *     a failed staff list (no answer) is "failed", never "ready" with an
 *     empty roster, and the same for rbac; a failed background refetch keeps
 *     an earlier answer ready.
 *  2. The roster built from the staff list resolves the signed-in person: by
 *     staffId, then by name — a teacher's own record is in it, with her
 *     designation and her class-teacher / subject links, so her roles are
 *     her assignment's, not a guess.
 *  3. No field the staff list withholds appears (phone, e-mail, Aadhaar,
 *     salary, password are empty), and no Masters book key is filled (the
 *     access copy is the roster, not the school's classes).
 *  4. The rbac copy is normalised as the page copy was (built-in roles
 *     always present).
 *
 *   npx tsx src/lib/data/client/accessCopy.selftest.ts
 */
import assert from "node:assert/strict";
import { accessMastersOf, accessRbacOf, accessStatusOf, staffRecordOfEntry } from "./accessCopy";
import type { StaffListEntry, StaffListView } from "../viewTypes";
import { defaultRbacState, hasPermission, inferRoleCodes, resolveSessionRoles } from "@/lib/rbac";
import { resolveSessionStaff } from "@/lib/staffResolve";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}

const q = (hasData: boolean, isError: boolean) => ({ hasData, isError });

console.log("accessStatusOf");
check("both answered = ready", () => {
  assert.equal(accessStatusOf({ remote: true, mounted: true, rbac: q(true, false), staff: q(true, false) }), "ready");
});
check("staff list failed (no answer) = failed, never ready", () => {
  assert.equal(accessStatusOf({ remote: true, mounted: true, rbac: q(true, false), staff: q(false, true) }), "failed");
});
check("rbac failed (no answer) = failed", () => {
  assert.equal(accessStatusOf({ remote: true, mounted: true, rbac: q(false, true), staff: q(true, false) }), "failed");
});
check("one still loading = loading", () => {
  assert.equal(accessStatusOf({ remote: true, mounted: true, rbac: q(true, false), staff: q(false, false) }), "loading");
  assert.equal(accessStatusOf({ remote: true, mounted: true, rbac: q(false, false), staff: q(false, false) }), "loading");
});
check("a failed background refetch keeps an earlier answer ready", () => {
  assert.equal(accessStatusOf({ remote: true, mounted: true, rbac: q(true, true), staff: q(true, true) }), "ready");
});
check("server render = loading; no database = ready", () => {
  assert.equal(accessStatusOf({ remote: true, mounted: false, rbac: q(true, false), staff: q(true, false) }), "loading");
  assert.equal(accessStatusOf({ remote: false, mounted: true, rbac: q(false, false), staff: q(false, false) }), "ready");
});

const teacher: StaffListEntry = {
  id: "stf-teacher-1",
  empCode: "T001",
  fullName: "Asha Verma",
  stream: "teaching",
  status: "active",
  departmentId: "dep-acad",
  departmentName: "Academics",
  designationId: "des-tgt",
  designationName: "TGT",
  classTeacherLinks: [{ id: "ctl-1", classId: "cls-n", sectionId: "sec-na", academicYearCode: "2026-27", isPrimary: true }],
  subjectTeachingLinks: [
    { id: "stl-1", classId: "cls-5", sectionId: "sec-5a", subjectId: "sub-math", academicYearCode: "2026-27", periodsPerWeek: 6 },
  ],
  dutyLinks: [{ id: "d-1", role: "exam_duty" as StaffListEntry["dutyLinks"][number]["role"], label: "Exams", academicYearCode: "2026-27" }],
  vehicleLinks: [],
};
const office: StaffListEntry = {
  ...teacher,
  id: "stf-office-1",
  empCode: "O001",
  fullName: "Ravi Kumar",
  stream: "non_teaching",
  designationId: "des-office",
  designationName: "Office Clerk",
  classTeacherLinks: [],
  subjectTeachingLinks: [],
  dutyLinks: [],
};
const view: StaffListView = {
  staff: [teacher, office],
  departments: [{ id: "dep-acad", code: "ACAD", name: "Academics", isActive: true }],
  designations: [
    { id: "des-tgt", code: "TGT", name: "TGT", departmentId: "dep-acad", isActive: true },
    { id: "des-office", code: "CLERK", name: "Office Clerk", departmentId: null, isActive: true },
  ],
};

console.log("accessMastersOf");
const m = accessMastersOf(view);
check("the roster, departments and designations come from the staff list", () => {
  assert.deepEqual(m.staff.map((s) => s.id), ["stf-teacher-1", "stf-office-1"]);
  assert.equal(m.departments.length, 1);
  assert.equal(m.designations.length, 2);
});
check("a teacher's own record resolves by staffId, with her links", () => {
  const me = resolveSessionStaff({ staffId: "stf-teacher-1", fullName: "x" }, m);
  assert.ok(me, "her record is found");
  assert.equal(me!.designationId, "des-tgt");
  assert.equal(me!.classTeacherLinks[0]?.sectionId, "sec-na");
  assert.equal(me!.subjectTeachingLinks[0]?.subjectId, "sub-math");
  assert.equal(me!.dutyLinks[0]?.notes, "");
});
check("…and by name when the session carries no staffId", () => {
  assert.equal(resolveSessionStaff({ fullName: "Ravi Kumar" }, m)?.id, "stf-office-1");
});
check("the designation still decides a role for someone with no assignment", () => {
  const codes = inferRoleCodes({ roleCode: "staff", staffId: "stf-office-1", fullName: "Ravi Kumar" }, m);
  assert.ok(codes.includes("office"), `office inferred from "Office Clerk" (got ${codes.join(",")})`);
});
check("an explicit assignment is found through the roster", () => {
  const rbac = defaultRbacState();
  const officeRole = rbac.roles.find((r) => r.code === "office")!;
  rbac.assignments = [{ id: "a1", staffId: "stf-teacher-1", roleId: officeRole.id, scope: { campusIds: [], classIds: [], departmentIds: [] }, expiresOn: "", note: "" } as unknown as (typeof rbac.assignments)[number]];
  const roles = resolveSessionRoles(rbac, { roleCode: "teacher", staffId: "stf-teacher-1", fullName: "Asha Verma" }, m);
  assert.ok(roles.some((r) => r.code === "office"), "her assigned role");
  // Without the roster the same check falls back to guessing from the session alone.
  const withRoster = hasPermission({ roleCode: "teacher", staffId: "stf-teacher-1", fullName: "Asha Verma" }, m, "students", "edit", rbac);
  assert.equal(withRoster, true, "the office role's students · edit, through her assignment");
});
check("withheld fields are empty — never copied from anywhere", () => {
  const r = staffRecordOfEntry({ ...teacher, ...({ mobile: "9999999999", aadhaarNo: "1234", basicPay: "50000", loginPassword: "x", email: "a@b" } as object) } as StaffListEntry);
  assert.equal(r.mobile, "");
  assert.equal(r.aadhaarNo, "");
  assert.equal(r.basicPay, "");
  assert.equal(r.loginPassword, "");
  assert.equal(r.email, "");
});
check("no Masters book key is filled (classes, sections, fee lists stay empty)", () => {
  assert.equal(m.classes.length, 0);
  assert.equal(m.sections.length, 0);
  assert.equal(m.feeHeads.length, 0);
  assert.equal(m.students.length, 0);
});
check("an empty staff list is an empty roster, not an error (the status decides readiness)", () => {
  assert.deepEqual(accessMastersOf({ staff: [], departments: [], designations: [] }).staff, []);
});

console.log("accessRbacOf");
check("built-in roles are present even when the server's set lacks them", () => {
  const r = accessRbacOf({ rbac: { ...defaultRbacState(), roles: [] }, ownOnly: true, known: true });
  assert.ok(r.roles.some((x) => x.code === "teacher" && x.isBuiltIn));
  assert.ok(r.roles.some((x) => x.code === "office" && x.isBuiltIn));
});

if (failures) {
  console.error(`\naccessCopy: ${failures} failed`);
  process.exit(1);
}
console.log("\naccessCopy: all passed");
