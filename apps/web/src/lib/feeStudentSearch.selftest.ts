import assert from "node:assert/strict";
import { searchFeeStudents, emptyFeesState } from "./fees";
import { emptySisState, type SisState, type SisStudent, type Household } from "./sis";
import { emptyMastersShell, type MastersState } from "./masters";

console.log("feeStudentSearch.selftest.ts");

const AY = "2026-27";

const student = (p: Partial<SisStudent>): SisStudent =>
  ({
    id: "", fullName: "", admissionNo: "", householdId: "hh1", classId: "c4",
    sectionId: "s4b", status: "active", academicYearCode: AY, studentType: "new",
    fatherName: "", motherName: "", fatherMobile: "", motherMobile: "",
    feeGroupId: "fg1",
    ...p,
  }) as unknown as SisStudent;

const households: Household[] = [
  { id: "hh1", guardianName: "Rakesh Kumar", mobile: "9990001111", whatsappMobile: "9990001111" } as unknown as Household,
  { id: "hh2", guardianName: "Sunita Devi", mobile: "9880002222", whatsappMobile: "" } as unknown as Household,
];

const sis: SisState = {
  ...emptySisState(),
  students: [
    student({ id: "st1", fullName: "Anaya Kumari", admissionNo: "ADM-0879", householdId: "hh1", classId: "c4", sectionId: "s4b", fatherName: "Rakesh Kumar", motherName: "Pooja Devi", fatherMobile: "9990001111", motherMobile: "9771234567" }),
    student({ id: "st2", fullName: "Aarav Kumar", admissionNo: "ADM-0412", householdId: "hh1", classId: "c7", sectionId: "s7a", fatherName: "Rakesh Kumar", motherName: "Pooja Devi", fatherMobile: "9990001111", motherMobile: "9771234567" }),
    student({ id: "st3", fullName: "Rakhi Singh", admissionNo: "ADM-0912", householdId: "hh2", classId: "c4", sectionId: "s4a", fatherName: "Mohan Singh", motherName: "Sunita Devi", fatherMobile: "9880002222", motherMobile: "9660003333" }),
  ],
  households,
};

const masters: MastersState = {
  ...emptyMastersShell(),
  classes: [
    { id: "c4", name: "Class 4", isActive: true },
    { id: "c7", name: "Class 7", isActive: true },
  ],
  sections: [
    { id: "s4a", classId: "c4", name: "A", isActive: true },
    { id: "s4b", classId: "c4", name: "B", isActive: true },
    { id: "s7a", classId: "c7", name: "A", isActive: true },
  ],
  feeGroups: [{ id: "fg1", name: "General" }],
  academicYears: [{ code: AY, isCurrent: true }],
} as unknown as MastersState;

const fees = emptyFeesState();

const find = (q: string) =>
  searchFeeStudents(q, sis, masters, fees, { academicYearCode: AY }).map((h) => h.student.fullName);

// Every field is searchable, not just name / adm no / father.
assert.deepEqual(find("anaya"), ["Anaya Kumari"], "child name");
assert.deepEqual(find("ADM-0412"), ["Aarav Kumar"], "admission no");
assert.deepEqual(find("pooja"), ["Aarav Kumar", "Anaya Kumari"], "MOTHER's name — was not searchable before");
assert.deepEqual(find("9771234567"), ["Aarav Kumar", "Anaya Kumari"], "mother's own mobile");
assert.deepEqual(find("9660003333"), ["Rakhi Singh"], "mother's mobile on the other household");
assert.deepEqual(find("mohan"), ["Rakhi Singh"], "father's name");
assert.deepEqual(find("sunita"), ["Rakhi Singh"], "guardian name");
assert.deepEqual(find("9990001111"), ["Aarav Kumar", "Anaya Kumari"], "household mobile → both siblings");

// Class typed as text.
assert.deepEqual(find("class 4"), ["Anaya Kumari", "Rakhi Singh"], "class typed as words");
assert.deepEqual(find("4-b"), ["Anaya Kumari"], "class-section typed together");

// Multi-word narrows (AND across words), it does not widen.
assert.deepEqual(find("rakesh 4"), ["Anaya Kumari"], "father Rakesh AND class 4 — Aarav (class 7) excluded");
assert.deepEqual(find("singh"), ["Rakhi Singh"], "one word still ORs across fields — own name or father's");
assert.deepEqual(find("kumar"), ["Aarav Kumar", "Anaya Kumari"], "surname on child + father");
assert.deepEqual(find("rakesh mohan"), [], "no student matches both fathers");

// Why it matched, so the clerk can trust a non-obvious hit.
const hit = searchFeeStudents("rakesh 4", sis, masters, fees, { academicYearCode: AY })[0]!;
assert.deepEqual(hit.matchReasons, ["father: Rakesh Kumar", "class: Class 4-B"]);
const byName = searchFeeStudents("anaya", sis, masters, fees, { academicYearCode: AY })[0]!;
assert.deepEqual(byName.matchReasons, [], "matching the child's own name needs no explanation");
assert.equal(byName.classLabel, "Class 4-B");

// Class filter still applies alongside the text query.
assert.deepEqual(
  searchFeeStudents("kumar", sis, masters, fees, { academicYearCode: AY, classId: "c7" }).map((h) => h.student.fullName),
  ["Aarav Kumar"],
  "class dropdown still narrows the typed query",
);

// Empty query lists everyone in scope — the browse path must not break.
assert.equal(find("").length, 3, "empty query = browse all");

console.log("  ok — omni search: name, father, mother, all mobiles, adm no, class; AND across words; reasons");
