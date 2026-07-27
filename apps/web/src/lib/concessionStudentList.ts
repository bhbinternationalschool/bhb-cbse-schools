/**
 * Build printable student rows for a concession / discount policy.
 */

import {
  bundledFeeDiscountSeed,
  mergeDiscountRulesFromSeed,
  resolvedConcessionGrantsForStudent,
} from "@/lib/feeDiscountRuntime";
import { canonicalAdmissionNo } from "@/lib/feeDiscountExcelImport";
import {
  grantsForConcessionPolicy,
  normalizeAcademicYearCode,
  ordinalChildLabel,
  type ConcessionGrant,
  type ConcessionRule,
  type MastersState,
} from "@/lib/masters";
import type { SisState, SisStudent } from "@/lib/sis";

export type ConcessionStudentListRow = {
  id: string;
  admissionNo: string;
  studentName: string;
  classLabel: string;
  status: string;
  effectiveFrom: string;
  reason: string;
  siblingNote: string;
};

function classLabelFor(
  state: MastersState,
  student: SisStudent,
): string {
  const cls = state.classes.find((c) => c.id === student.classId)?.name ?? "—";
  const sec = state.sections.find((s) => s.id === student.sectionId)?.name ?? "";
  return sec ? `${cls}-${sec}` : cls;
}

function findStudent(
  sis: SisState,
  grant: ConcessionGrant,
): SisStudent | undefined {
  const byId = sis.students.find((s) => s.id === grant.studentId);
  if (byId) return byId;
  return undefined;
}

function grantToRow(
  state: MastersState,
  grant: ConcessionGrant,
  student: SisStudent | undefined,
): ConcessionStudentListRow {
  return {
    id: grant.id,
    admissionNo: student?.admissionNo ?? grant.studentId,
    studentName: student?.fullName ?? "Unknown student",
    classLabel: student ? classLabelFor(state, student) : "—",
    status: grant.status,
    effectiveFrom: grant.effectiveFrom || "—",
    reason: grant.reason || "—",
    siblingNote: grant.siblingChildNo
      ? ordinalChildLabel(grant.siblingChildNo)
      : "—",
  };
}

/**
 * Students on a discount policy — persisted grants plus Excel seed matches
 * not yet saved to masters.concessionGrants.
 */
export function buildConcessionStudentList(
  state: MastersState,
  rule: ConcessionRule,
  sis: SisState,
  options?: { sessionAy?: string },
): ConcessionStudentListRow[] {
  const masters = mergeDiscountRulesFromSeed(state);
  const sessionAy = options?.sessionAy;
  const persisted = grantsForConcessionPolicy(masters, rule).filter(
    (g) => g.status !== "rejected",
  );
  const seenStudentIds = new Set<string>();
  const rows: ConcessionStudentListRow[] = [];

  for (const grant of persisted) {
    const student = findStudent(sis, grant);
    if (student) seenStudentIds.add(student.id);
    rows.push(grantToRow(masters, grant, student));
  }

  const seed = bundledFeeDiscountSeed();
  const code = rule.code.toUpperCase();
  const seedRows = seed.grants.filter(
    (g) => g.concessionCode.toUpperCase() === code,
  );

  const activeStudents = sessionAy
    ? sis.students.filter(
        (s) =>
          s.status === "active" &&
          normalizeAcademicYearCode(s.academicYearCode) ===
            normalizeAcademicYearCode(sessionAy),
      )
    : sis.students.filter((s) => s.status === "active");

  for (const seedGrant of seedRows) {
    const adm = canonicalAdmissionNo(seedGrant.admissionNo);
    const student = activeStudents.find(
      (s) => canonicalAdmissionNo(s.admissionNo) === adm,
    );
    if (!student || seenStudentIds.has(student.id)) continue;

    const runtime = resolvedConcessionGrantsForStudent(
      masters,
      student,
      new Date().toISOString().slice(0, 10),
    );
    const matchesRule = runtime.some((g) => {
      const r = masters.concessions.find((c) => c.id === g.concessionId);
      return r?.code.toUpperCase() === code;
    });
    if (!matchesRule) continue;

    seenStudentIds.add(student.id);
    rows.push({
      id: `seed_${student.id}_${code}`,
      admissionNo: student.admissionNo,
      studentName: student.fullName,
      classLabel: classLabelFor(masters, student),
      status: "approved",
      effectiveFrom: seed.importedAt.slice(0, 10),
      reason: seedGrant.reason || "Excel import",
      siblingNote: seedGrant.siblingChildNo
        ? ordinalChildLabel(seedGrant.siblingChildNo)
        : "—",
    });
  }

  return rows.sort((a, b) => {
    const byClass = a.classLabel.localeCompare(b.classLabel, undefined, {
      numeric: true,
    });
    if (byClass !== 0) return byClass;
    return a.studentName.localeCompare(b.studentName);
  });
}
