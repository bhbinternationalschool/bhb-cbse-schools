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
  studentId: string;
  admissionNo: string;
  studentName: string;
  /** On a discount list the office is checking a FAMILY, not a child. */
  fatherName: string;
  classLabel: string;
  status: string;
  effectiveFrom: string;
  reason: string;
  siblingNote: string;
  /** Which policy this row is for — the list can span several. */
  concessionCode: string;
  concessionName: string;
  /** Groups siblings; empty when the child has no household on file. */
  householdId: string;
};

/** A family and every discount its children hold. */
export type ConcessionFamilyGroup = {
  householdId: string;
  fatherName: string;
  rows: ConcessionStudentListRow[];
};

/**
 * Siblings together, so a discount can be justified at a glance.
 *
 * The question the office is actually answering is "why does this child get a
 * discount and that one not?", and that is a question about a family. A list
 * sorted by class puts brothers pages apart and makes it unanswerable.
 *
 * Children with no household on file are their own group rather than being
 * lumped into one nameless family — an absent id is not a shared one.
 */
export function groupConcessionRowsByFamily(
  rows: readonly ConcessionStudentListRow[],
): ConcessionFamilyGroup[] {
  const byHousehold = new Map<string, ConcessionFamilyGroup>();
  const out: ConcessionFamilyGroup[] = [];

  for (const row of rows) {
    const key = row.householdId || `__solo__${row.studentId || row.id}`;
    let group = byHousehold.get(key);
    if (!group) {
      group = {
        householdId: row.householdId,
        fatherName: row.fatherName,
        rows: [],
      };
      byHousehold.set(key, group);
      out.push(group);
    }
    if (!group.fatherName) group.fatherName = row.fatherName;
    group.rows.push(row);
  }

  // Families with more than one child first — those are the ones being
  // compared. Then by father, so a family is findable by name.
  return out.sort((a, b) => {
    if (a.rows.length !== b.rows.length) return b.rows.length - a.rows.length;
    return a.fatherName.localeCompare(b.fatherName);
  });
}

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
  rule: ConcessionRule,
): ConcessionStudentListRow {
  return {
    id: grant.id,
    studentId: grant.studentId,
    admissionNo: student?.admissionNo ?? grant.studentId,
    studentName: student?.fullName ?? "Unknown student",
    fatherName: student?.fatherName || "—",
    classLabel: student ? classLabelFor(state, student) : "—",
    status: grant.status,
    effectiveFrom: grant.effectiveFrom || "—",
    reason: grant.reason || "—",
    siblingNote: grant.siblingChildNo
      ? ordinalChildLabel(grant.siblingChildNo)
      : "—",
    concessionCode: rule.code,
    concessionName: rule.name,
    householdId: student?.householdId ?? "",
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
    rows.push(grantToRow(masters, grant, student, rule));
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
      studentId: student.id,
      admissionNo: student.admissionNo,
      studentName: student.fullName,
      fatherName: student.fatherName || "—",
      classLabel: classLabelFor(masters, student),
      status: "approved",
      effectiveFrom: seed.importedAt.slice(0, 10),
      reason: seedGrant.reason || "Excel import",
      siblingNote: seedGrant.siblingChildNo
        ? ordinalChildLabel(seedGrant.siblingChildNo)
        : "—",
      concessionCode: rule.code,
      concessionName: rule.name,
      householdId: student.householdId ?? "",
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

/**
 * The same list across EVERY discount policy.
 *
 * "Who is on a discount, and which one?" is a different question from "who is
 * on this policy", and the office asks it more often — at admission time, and
 * whenever a parent argues a sibling should get what their brother gets.
 * Building it from the per-rule list keeps one definition of what a row is.
 */
export function buildAllConcessionStudentLists(
  state: MastersState,
  sis: SisState,
  options?: { sessionAy?: string },
): ConcessionStudentListRow[] {
  const masters = mergeDiscountRulesFromSeed(state);

  // Rules are deduplicated BY CODE first. The counter mints a rule per
  // discount amount (`CTR-TUITION-15000`), and production holds several
  // sharing one code — 106 rules for what the office thinks of as a handful.
  // Each duplicate returns the same grants, so without this the same child
  // appeared 82 times on one list.
  const seenCode = new Set<string>();
  const rows: ConcessionStudentListRow[] = [];
  for (const rule of masters.concessions) {
    const code = rule.code.toUpperCase();
    if (seenCode.has(code)) continue;
    seenCode.add(code);
    rows.push(...buildConcessionStudentList(masters, rule, sis, options));
  }

  // A last guard on row identity: a student genuinely on two policies must
  // appear twice, but the SAME grant must never appear twice.
  const seenRow = new Set<string>();
  return rows.filter((r) => {
    if (seenRow.has(r.id)) return false;
    seenRow.add(r.id);
    return true;
  });
}

/**
 * True for a rule the counter generated for one transaction.
 *
 * These are real discounts a child holds, so they belong in "all discounts" —
 * but they are not policies anyone chooses from a list, and there are
 * hundreds. Keeping them out of the picker is what makes it usable.
 */
export function isCounterGeneratedConcession(code: string): boolean {
  return code.toUpperCase().startsWith("CTR-");
}

/** Free-text match over the fields the office actually searches by. */
export function concessionRowMatches(
  row: ConcessionStudentListRow,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Every word must match something — "ankit mishtri" should not match every
  // Ankit in the school.
  return q.split(/\s+/).every((word) =>
    [
      row.studentName,
      row.fatherName,
      row.admissionNo,
      row.classLabel,
      row.concessionName,
      row.concessionCode,
    ].some((field) => field.toLowerCase().includes(word)),
  );
}
