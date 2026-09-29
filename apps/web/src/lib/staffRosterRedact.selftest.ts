/**
 * staffRosterRedact — colleagues' private fields never reach a non-editor.
 * Run: npx tsx src/lib/staffRosterRedact.selftest.ts
 */
import { redactStaffRoster } from "./staffRosterRedact";
import { normalizeStaffRecord, type StaffRecord } from "./foundationMasters";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const rec = (id: string): StaffRecord =>
  normalizeStaffRecord({
    id, empCode: id.toUpperCase(), fullName: `Staff ${id}`,
    aadhaarNo: "123412341234", panNo: "ABCDE1234F", bankAccountNo: "000111222",
    bankIfsc: "SBIN0000001", basicPay: "25000", loginPassword: "secret",
    uanNumber: "100", addressCurrent: "Home", mobile: "9876543210",
    classTeacherLinks: [{ id: "l", classId: "c", sectionId: "s", academicYearCode: "2026-27", isPrimary: true }],
  });
const roster = [rec("me"), rec("other")];

const teacherView = redactStaffRoster(roster, { canEditStaff: false, selfStaffId: "me" });
const other = teacherView.find((s) => s.id === "other")!;
const me = teacherView.find((s) => s.id === "me")!;
for (const k of ["aadhaarNo", "panNo", "bankAccountNo", "bankIfsc", "basicPay", "uanNumber", "addressCurrent", "loginPassword"] as const) {
  expect(`colleague ${k} hidden`, other[k], "");
}
expect("colleague directory kept", [other.fullName, other.mobile, other.classTeacherLinks.length], ["Staff other", "9876543210", 1]);
expect("own record kept", [me.aadhaarNo, me.bankAccountNo, me.basicPay], ["123412341234", "000111222", "25000"]);
expect("own password never sent", me.loginPassword, "");

const officeView = redactStaffRoster(roster, { canEditStaff: true, selfStaffId: "" });
expect("office sees records", officeView[1]!.aadhaarNo, "123412341234");
expect("office never sees passwords", officeView.map((s) => s.loginPassword), ["", ""]);

if (failed) {
  console.error(`staffRosterRedact: ${failed} failure(s)`);
  process.exit(1);
}
console.log("staffRosterRedact: ok");
