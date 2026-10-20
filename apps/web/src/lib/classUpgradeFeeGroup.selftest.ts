/**
 * Run: npx tsx src/lib/classUpgradeFeeGroup.selftest.ts
 *
 * Students → Upgrade said "(no matching group found — keep current)" when no
 * fee group matched the new class / type, and then saved the child with NO
 * fee group: upgradeStudentClass() assigned resolveFeeGroupId()'s null
 * straight onto the student (found 15 Oct 2026). A child without a fee group
 * drops out of fee assignment. The words are the rule: no match keeps the
 * current group; a match still re-maps; an explicit override still wins.
 *
 * Drives the real upgradeStudentClass on the server-side path (the SIS comes
 * from the in-process mirror) — no network, no database.
 */
import assert from "node:assert/strict";
import { upgradeStudentClass } from "./classUpgrade";
import { defaultMasters, type FeeGroup, type MastersState } from "./masters";
import { normalizeStudent, type SisState } from "./sis";
import { getSchoolMirrorSync, setMirrorSlice } from "./schoolDataMirror";

console.log("classUpgradeFeeGroup.selftest.ts");

const AY = "2026-27";
const base = defaultMasters();
const classes = base.classes.filter((c) => c.isActive).slice(0, 3);
assert.ok(classes.length >= 3, "default masters carry at least three classes");
const [c1, c2, c3] = classes as [typeof classes[number], typeof classes[number], typeof classes[number]];
const sec = (classId: string, id: string) => ({
  ...(base.sections[0] ?? ({} as MastersState["sections"][number])),
  id,
  classId,
  name: "A",
  isActive: true,
});
const group = (id: string, classIds: string[], studentType: FeeGroup["studentType"]): FeeGroup =>
  ({
    ...(base.feeGroups[0] ?? ({} as FeeGroup)),
    id,
    code: id.toUpperCase(),
    name: id,
    classIds,
    studentType,
    academicYearCode: AY,
    isActive: true,
  }) as FeeGroup;

const masters: MastersState = {
  ...base,
  sections: [sec(c1.id, "sec_1"), sec(c2.id, "sec_2"), sec(c3.id, "sec_3")],
  // c1 PROMOTE and c2 PROMOTE have groups; c3 has none; no NEW group for c1.
  feeGroups: [group("fg_c1_promote", [c1.id], "PROMOTE"), group("fg_c2_promote", [c2.id], "PROMOTE")],
};

function seed(): void {
  const sis: SisState = {
    version: 1,
    households: [],
    students: [
      normalizeStudent({
        id: "stu_1",
        fullName: "Test Child",
        status: "active",
        classId: c1.id,
        sectionId: "sec_1",
        studentType: "PROMOTE",
        feeGroupId: "fg_c1_promote",
        academicYearCode: AY,
      } as never),
    ],
    curriculumRequests: [],
    tags: [],
    classUpgrades: [],
  } as unknown as SisState;
  setMirrorSlice("sis", sis);
}
const feeGroupNow = () =>
  (getSchoolMirrorSync().sis as SisState).students.find((s) => s.id === "stu_1")!.feeGroupId;

// 1. Class change with no matching group → the current group is kept.
seed();
let r = upgradeStudentClass({ studentId: "stu_1", toClassId: c3.id, toSectionId: "sec_3", remapFeeGroup: true, resetCurriculum: false, masters });
assert.ok(r.ok, r.ok ? "" : r.error);
assert.equal(r.student.feeGroupId, "fg_c1_promote", "no match for the new class keeps the current fee group (was null)");
assert.equal(r.record.toFeeGroupId, "fg_c1_promote", "the history row records the kept group, not —");
assert.equal(feeGroupNow(), "fg_c1_promote", "the saved roster keeps the group");

// 2. Type change with no matching group (no NEW group for c1) → kept.
seed();
r = upgradeStudentClass({ studentId: "stu_1", toClassId: c1.id, toSectionId: "sec_1", toStudentType: "NEW", remapFeeGroup: true, masters });
assert.ok(r.ok, r.ok ? "" : r.error);
assert.equal(r.student.studentType, "NEW", "the type still changes");
assert.equal(r.student.feeGroupId, "fg_c1_promote", "no match for the new type keeps the current fee group");

// 3. Class change WITH a matching group → re-mapped as before.
seed();
r = upgradeStudentClass({ studentId: "stu_1", toClassId: c2.id, toSectionId: "sec_2", remapFeeGroup: true, resetCurriculum: false, masters });
assert.ok(r.ok, r.ok ? "" : r.error);
assert.equal(r.student.feeGroupId, "fg_c2_promote", "a matching group is still applied");

// 4. Remap off → untouched.
seed();
r = upgradeStudentClass({ studentId: "stu_1", toClassId: c2.id, toSectionId: "sec_2", remapFeeGroup: false, resetCurriculum: false, masters });
assert.ok(r.ok, r.ok ? "" : r.error);
assert.equal(r.student.feeGroupId, "fg_c1_promote", "remap off keeps the group");

// 5. An explicit override (incl. an explicit null) is still honoured.
seed();
r = upgradeStudentClass({ studentId: "stu_1", toClassId: c3.id, toSectionId: "sec_3", feeGroupId: null, resetCurriculum: false, masters });
assert.ok(r.ok, r.ok ? "" : r.error);
assert.equal(r.student.feeGroupId, null, "an explicit override still decides");

console.log("classUpgradeFeeGroup selftest: ok");
process.exit(0);
