/**
 * Run: npx tsx src/lib/certificatesUdiseMastersAsData.selftest.ts
 *
 * data-layer 2.3b-3: the certificates, UDISE+ and legacy-admission readers
 * take Masters as DATA. Handed none, they refuse — they never fall back to
 * `loadMasters()`, whose answer before the tab's copy loaded was an empty
 * book: every child "not on UDISE+" with no class, a class label of "—", a
 * certificate number from no series, and — for the TC / no-dues gate's
 * second opinion — ₹0 open dues computed from no fee structure.
 *
 * Fail-on-old: every "refuses" case below answered on origin/main.
 */
import assert from "node:assert/strict";
import { defaultMasters, type MastersState } from "./masters";
import { emptySisState, type SisState, type SisStudent } from "./sis";
import {
  classLabelForStudent,
  resolveCertificateDues,
  studentOpenBalance,
  suggestNextCertificateNumber,
} from "./certificates";
import {
  listUdiseComplianceRows,
  listUdisePortalSearchRows,
  listUdiseRegisteredStudents,
  listUdiseUnregisteredStudents,
} from "./udiseCompliance";
import { findUdiseMatchCandidates, previewUdiseStudentDetailsSync, type UdiseStudentRow } from "./udiseStudentDetails";
import { verifyAllPendingSystemAdmissions, verifyAndAssignSystemAdmission } from "./studentLegacyAdmission";

console.log("certificatesUdiseMastersAsData.selftest.ts");

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The reader refused with DataNotLoadedError — not some other failure. */
function refuses(fn: () => unknown, label: string) {
  let thrown: unknown = null;
  let answer: unknown;
  try {
    answer = fn();
  } catch (e) {
    thrown = e;
  }
  assert.ok(
    thrown instanceof Error && thrown.name === "DataNotLoadedError",
    `${label}: expected a refusal (DataNotLoadedError), got ${
      thrown ? `${(thrown as Error).name}: ${(thrown as Error).message}` : `an answer: ${JSON.stringify(answer)?.slice(0, 160)}`
    }`,
  );
}

const AY = "2026-27";
const base = defaultMasters();
const vi = base.classes.find((c) => c.name === "VI")!;
const section = base.sections.find((s) => s.classId === vi.id) ?? { id: "sec-vi-a", classId: vi.id, name: "A", isActive: true };
const masters = {
  ...base,
  sections: base.sections.some((s) => s.id === section.id) ? base.sections : [...base.sections, section],
} as MastersState;
const kid = {
  id: "stu-vi-1",
  fullName: "Asha Kumari",
  admissionNo: "1",
  rollNo: "1",
  classId: vi.id,
  sectionId: section.id,
  status: "active",
  academicYearCode: AY,
  joinedOn: "2024-04-01",
  householdId: "hh1",
  campusId: "",
} as unknown as SisStudent;
const sis: SisState = { ...emptySisState(), students: [kid] };
const row = { classHint: "VI", sectionHint: "A", fullName: "Asha Kumari", gender: "F", dob: "2014-05-01" } as unknown as UdiseStudentRow;

// ── With the data in hand ────────────────────────────────────────────────
check("given Masters, the class label is VI-<section>", () => {
  assert.equal(classLabelForStudent(kid, masters), `VI-${section.name}`);
});
check("given the full book, the dues gate's second opinion is computed from it", () => {
  const r = resolveCertificateDues(kid, {
    server: { state: "known", openBalancePaise: 0, openDueCount: 0 },
    bookIsFull: true,
    book: masters,
  });
  assert.equal(r.known, true);
});

// ── Not loaded yet: refuse, never an empty answer ───────────────────────
check("classLabelForStudent without Masters refuses (old: '—')", () =>
  refuses(() => classLabelForStudent(kid, undefined as never), "classLabelForStudent"));
check("suggestNextCertificateNumber without Masters refuses (old: a number from no series)", () =>
  refuses(() => suggestNextCertificateNumber("bonafide", AY, undefined as never), "suggestNextCertificateNumber"));
check("studentOpenBalance without Masters refuses (old: ₹0 from no fee structure)", () =>
  refuses(() => studentOpenBalance(kid, undefined as never), "studentOpenBalance"));
check("TC / no-dues gate: a 'full book' claimed but not passed refuses (old: second opinion from the tab's copy)", () =>
  refuses(
    () => resolveCertificateDues(kid, { server: { state: "known", openBalancePaise: 0, openDueCount: 0 }, bookIsFull: true }),
    "resolveCertificateDues",
  ));
check("listUdiseComplianceRows without Masters refuses", () =>
  refuses(() => listUdiseComplianceRows(sis, undefined as never, undefined, AY), "listUdiseComplianceRows"));
check("listUdiseUnregisteredStudents without Masters refuses", () =>
  refuses(() => listUdiseUnregisteredStudents(sis, undefined as never, AY), "listUdiseUnregisteredStudents"));
check("listUdiseRegisteredStudents without Masters refuses", () =>
  refuses(() => listUdiseRegisteredStudents(sis, undefined as never, AY), "listUdiseRegisteredStudents"));
check("listUdisePortalSearchRows without Masters refuses", () =>
  refuses(() => listUdisePortalSearchRows(sis, undefined as never, AY), "listUdisePortalSearchRows"));
check("findUdiseMatchCandidates without Masters refuses", () =>
  refuses(() => findUdiseMatchCandidates(row, sis, undefined as never), "findUdiseMatchCandidates"));
check("previewUdiseStudentDetailsSync without Masters refuses", () =>
  refuses(() => previewUdiseStudentDetailsSync([["Student Name"], ["Asha Kumari"]], sis, undefined as never), "previewUdiseStudentDetailsSync"));
check("verifyAndAssignSystemAdmission without Masters refuses", () =>
  refuses(() => verifyAndAssignSystemAdmission(kid.id, undefined as never), "verifyAndAssignSystemAdmission"));
check("verifyAllPendingSystemAdmissions without Masters refuses", () =>
  refuses(() => verifyAllPendingSystemAdmissions(undefined as never), "verifyAllPendingSystemAdmissions"));

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("OK — certificatesUdiseMastersAsData.selftest.ts");
