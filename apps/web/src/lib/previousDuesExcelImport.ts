/**
 * Import "Student Wise Fee Details" Excel → carried-forward previous dues.
 */

import type { CarriedForwardDue, FeesState } from "@/lib/fees";
import { DEFAULT_AY } from "@/lib/masters";
import type { SisState, SisStudent } from "@/lib/sis";

export type PreviousDueExcelRow = {
  admissionNo: string;
  studentName: string;
  classSection: string;
  previousDueRupees: number;
  previousDiscountRupees: number;
  previousReceivedRupees: number;
  previousPendingRupees: number;
  /** e.g. "Previous Due-2025" from sheet sub-header */
  sourceLabel: string;
};

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "")
    .replace(/,/g, "")
    .replace(/₹/g, "")
    .trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normAdmissionNo(s: string): string {
  return s.trim().replace(/\s+/g, "").toUpperCase();
}

function inferFromAcademicYear(sourceLabel: string): string {
  const m = sourceLabel.match(/20(\d{2})/);
  if (m) {
    const start = Number(m[1]);
    const end = String(start + 1).padStart(2, "0");
    return `20${m[1]}-${end}`;
  }
  return "2025-26";
}

/**
 * Parse raw sheet rows (header:1) from "Student Wise Summary" workbook.
 */
export function parseStudentWiseFeeSummaryRows(
  raw: unknown[][],
): PreviousDueExcelRow[] {
  const headerIdx = raw.findIndex(
    (r) =>
      String(r[0] ?? "").trim() === "S.no." ||
      String(r[1] ?? "").trim() === "Admission No.",
  );
  if (headerIdx < 0) return [];

  const sub = raw[headerIdx + 1] ?? [];
  const sourceLabel =
    String(sub[5] ?? sub[9] ?? "Previous Due").trim() || "Previous Due";

  const out: PreviousDueExcelRow[] = [];
  for (const row of raw.slice(headerIdx + 2)) {
    const admissionNo = String(row[1] ?? "").trim();
    if (!admissionNo || admissionNo.toLowerCase() === "total") continue;

    const pending = num(row[9]) || num(row[8]);
    const due = num(row[5]);
    const discount = num(row[6]);
    const received = num(row[7]);

    out.push({
      admissionNo,
      studentName: String(row[2] ?? "").trim(),
      classSection: String(row[3] ?? "").trim(),
      previousDueRupees: due,
      previousDiscountRupees: discount,
      previousReceivedRupees: received,
      previousPendingRupees: pending,
      sourceLabel,
    });
  }
  return out;
}

function findStudentByAdmission(
  sis: SisState,
  admissionNo: string,
): SisStudent | undefined {
  const key = normAdmissionNo(admissionNo);
  return sis.students.find(
    (s) => normAdmissionNo(s.admissionNo) === key,
  );
}

function cfId() {
  return `cf_${Math.random().toString(36).slice(2, 10)}`;
}

export function applyPreviousDuesImport(input: {
  fees: FeesState;
  sis: SisState;
  rows: PreviousDueExcelRow[];
  fromAy?: string;
  toAy?: string;
  importedBy?: string;
}): {
  fees: FeesState;
  created: number;
  updated: number;
  cleared: number;
  skipped: number;
  errors: string[];
  matched: { admissionNo: string; studentName: string; pendingRupees: number }[];
} {
  const toAy = input.toAy || DEFAULT_AY;
  const sourceLabel =
    input.rows.find((r) => r.sourceLabel)?.sourceLabel || "Previous Due";
  const fromAy = input.fromAy || inferFromAcademicYear(sourceLabel);
  const importedBy = input.importedBy || "Excel import";
  const dueOn = `${toAy.slice(0, 4)}-04-01`;
  const now = new Date().toISOString();

  const carried = [...(input.fees.carriedForwardDues ?? [])];
  let created = 0;
  let updated = 0;
  const cleared = 0;
  let skipped = 0;
  const errors: string[] = [];
  const matched: {
    admissionNo: string;
    studentName: string;
    pendingRupees: number;
  }[] = [];

  for (const row of input.rows) {
    if (row.previousPendingRupees <= 0) {
      skipped += 1;
      continue;
    }

    const student = findStudentByAdmission(input.sis, row.admissionNo);
    if (!student) {
      errors.push(
        `No student for admission ${row.admissionNo} (${row.studentName})`,
      );
      continue;
    }

    const pendingPaise = Math.round(row.previousPendingRupees * 100);
    const label = sourceLabel.includes("Previous")
      ? sourceLabel
      : `Previous Due · ${fromAy}`;

    const idx = carried.findIndex(
      (cf) =>
        !cf.voidedAt &&
        cf.studentId === student.id &&
        cf.fromAcademicYearCode === fromAy &&
        cf.toAcademicYearCode === toAy,
    );

    const breakdown = [
      {
        dueKey: `excel:${normAdmissionNo(row.admissionNo)}`,
        label,
        amountPaise: pendingPaise,
      },
    ];

    if (idx >= 0) {
      const prev = carried[idx]!;
      if (prev.amountPaise === pendingPaise && prev.label === label) {
        skipped += 1;
      } else {
        carried[idx] = {
          ...prev,
          amountPaise: pendingPaise,
          label,
          sourceBreakdown: breakdown,
          transferredAt: now,
          transferredBy: importedBy,
        };
        updated += 1;
      }
    } else {
      const cf: CarriedForwardDue = {
        id: cfId(),
        studentId: student.id,
        fromAcademicYearCode: fromAy,
        toAcademicYearCode: toAy,
        amountPaise: pendingPaise,
        dueOn,
        label,
        sourceDueKeys: [],
        sourceBreakdown: breakdown,
        transferredAt: now,
        transferredBy: importedBy,
        voidedAt: null,
      };
      carried.push(cf);
      created += 1;
    }

    matched.push({
      admissionNo: row.admissionNo,
      studentName: student.fullName,
      pendingRupees: row.previousPendingRupees,
    });
  }

  return {
    fees: { ...input.fees, carriedForwardDues: carried },
    created,
    updated,
    cleared,
    skipped,
    errors,
    matched,
  };
}

export function summarizePreviousDueRows(rows: PreviousDueExcelRow[]): {
  totalRows: number;
  withPending: number;
  totalPendingRupees: number;
} {
  const withPending = rows.filter((r) => r.previousPendingRupees > 0);
  return {
    totalRows: rows.length,
    withPending: withPending.length,
    totalPendingRupees: withPending.reduce(
      (s, r) => s + r.previousPendingRupees,
      0,
    ),
  };
}
