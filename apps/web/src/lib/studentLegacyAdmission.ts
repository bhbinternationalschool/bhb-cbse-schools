/**
 * Legacy ERP admission numbers — import-only mapping to unique system admission nos.
 * Manual student entry does not use these helpers.
 */

import {
  findNumberSeries,
  peekNextSeriesNumber,
  persistSeriesUse,
} from "@/lib/numberSeries";
import type { NumberSeries } from "@/lib/foundationMasters";
import { normalizeSessionCode } from "@/lib/studentImport";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  loadSis,
  normalizeStudent,
  saveSis,
  type SisState,
  type SisStudent,
} from "@/lib/sis";

const PENDING_PREFIX = "PND-";

export function isPendingSystemAdmission(admissionNo: string): boolean {
  return (admissionNo || "").trim().toUpperCase().startsWith(PENDING_PREFIX);
}

export function pendingSystemAdmissionNo(studentId: string): string {
  const tail = studentId.replace(/^stu_/, "").slice(0, 10).toUpperCase();
  return `${PENDING_PREFIX}${tail || "NEW"}`;
}

function normImportName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function importAdmissionPrefix(series: NumberSeries, session: string): string {
  const ay = session.trim();
  const base = series.prefix;
  if (base.endsWith("/")) return `${base}${ay}/`;
  if (base.endsWith("-")) return `${base}${ay}-`;
  return `${base}-${ay}-`;
}

function maxNumericTail(values: string[], prefix: string): number {
  let max = 0;
  for (const raw of values) {
    const val = (raw || "").trim();
    if (!val.startsWith(prefix) || isPendingSystemAdmission(val)) continue;
    const n = Number(val.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** Next unique system admission no for import (session in prefix). */
export function suggestSystemAdmissionForImport(
  masters: Pick<MastersState, "numberSeries">,
  roster: SisStudent[],
  session: string,
): string | null {
  const series = findNumberSeries(masters.numberSeries, "ADMISSION");
  if (!series) return null;
  const prefix = importAdmissionPrefix(series, session);
  const existing = roster
    .map((s) => s.admissionNo)
    .filter((n) => !isPendingSystemAdmission(n));
  const next = Math.max(
    peekNextSeriesNumber(series, session),
    maxNumericTail(existing, prefix) + 1,
  );
  return `${prefix}${String(next).padStart(series.padWidth, "0")}`;
}

export function findEarlierEnrollmentByLegacy(
  students: SisStudent[],
  legacyAdmissionNo: string,
  session: string,
): SisStudent | undefined {
  const leg = legacyAdmissionNo.trim().toUpperCase();
  const target = normalizeSessionCode(session);
  return students
    .filter((s) => {
      const sLeg = (s.legacyErpAdmissionNo || "").trim().toUpperCase();
      if (sLeg !== leg) return false;
      return normalizeSessionCode(s.academicYearCode) < target;
    })
    .sort((a, b) =>
      normalizeSessionCode(b.academicYearCode).localeCompare(
        normalizeSessionCode(a.academicYearCode),
      ),
    )[0];
}

/** Same normalized name in session (roster) or already seen in this import batch. */
export function isImportNameDuplicateSuspected(
  fullName: string,
  session: string,
  roster: SisStudent[],
  batchNameCounts: Map<string, number>,
): boolean {
  const norm = normImportName(fullName);
  if (!norm) return false;
  if ((batchNameCounts.get(norm) ?? 0) > 0) return true;
  const ay = normalizeSessionCode(session);
  return roster.some(
    (s) =>
      normalizeSessionCode(s.academicYearCode) === ay &&
      normImportName(s.fullName) === norm &&
      s.status === "active",
  );
}

export function touchImportNameCount(
  batchNameCounts: Map<string, number>,
  fullName: string,
): void {
  const norm = normImportName(fullName);
  if (!norm) return;
  batchNameCounts.set(norm, (batchNameCounts.get(norm) ?? 0) + 1);
}

export function listPendingSystemAdmissions(
  sis: SisState,
  academicYearCode?: string,
): SisStudent[] {
  const ay = academicYearCode
    ? normalizeSessionCode(academicYearCode)
    : "";
  return sis.students.filter((s) => {
    if (!s.systemAdmissionPending || !isPendingSystemAdmission(s.admissionNo)) {
      return false;
    }
    if (!ay) return true;
    return normalizeSessionCode(s.academicYearCode) === ay;
  });
}

export function verifyAndAssignSystemAdmission(
  studentId: string,
  masters?: MastersState,
): { ok: true; student: SisStudent; sis: SisState } | { ok: false; error: string } {
  const m = masters ?? loadMasters();
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === studentId);
  if (!student) return { ok: false, error: "Student not found" };
  if (!student.systemAdmissionPending) {
    return { ok: false, error: "System admission already assigned" };
  }
  if (!student.legacyErpAdmissionNo?.trim()) {
    return { ok: false, error: "Not a legacy ERP import row" };
  }

  const roster = sis.students.filter((s) => s.id !== studentId);
  const assigned = suggestSystemAdmissionForImport(
    m,
    roster,
    student.academicYearCode,
  );
  if (!assigned) {
    return { ok: false, error: "Admission numbering series not configured in Masters" };
  }
  if (
    roster.some(
      (s) =>
        s.admissionNo.trim().toUpperCase() === assigned.toUpperCase() &&
        normalizeSessionCode(s.academicYearCode) ===
          normalizeSessionCode(student.academicYearCode),
    )
  ) {
    return { ok: false, error: "Generated admission no already in use — retry" };
  }

  const updated = normalizeStudent({
    ...student,
    admissionNo: assigned,
    systemAdmissionPending: false,
    loginUsername: student.loginUsername || assigned,
  });

  const nextSis: SisState = {
    ...sis,
    students: sis.students.map((s) => (s.id === studentId ? updated : s)),
  };
  saveSis(nextSis);
  persistSeriesUse("ADMISSION", student.academicYearCode, assigned);

  return { ok: true, student: updated, sis: nextSis };
}

export function verifyAllPendingSystemAdmissions(
  masters?: MastersState,
): { assigned: number; errors: string[] } {
  const m = masters ?? loadMasters();
  let sis = loadSis();
  let assigned = 0;
  const errors: string[] = [];
  const pending = listPendingSystemAdmissions(sis);
  for (const p of pending) {
    const res = verifyAndAssignSystemAdmission(p.id, m);
    if (res.ok) {
      assigned += 1;
      sis = res.sis;
    } else {
      errors.push(`${p.fullName}: ${res.error}`);
    }
  }
  return { assigned, errors };
}
