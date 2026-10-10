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

/**
 * Create-or-update a CarriedForwardDue, matched by (studentId, fromAy, toAy)
 * — shared by the bulk Excel importer and the single-student manual form so
 * both paths dedupe identically and can't drift into different behavior.
 */
function upsertCarriedForwardDue(
  carried: CarriedForwardDue[],
  input: {
    studentId: string;
    fromAy: string;
    toAy: string;
    amountPaise: number;
    label: string;
    dueOn: string;
    sourceBreakdown: { dueKey: string; label: string; amountPaise: number }[];
    by: string;
  },
): { carried: CarriedForwardDue[]; created: boolean; updated: boolean } {
  const now = new Date().toISOString();
  const idx = carried.findIndex(
    (cf) =>
      !cf.voidedAt &&
      cf.studentId === input.studentId &&
      cf.fromAcademicYearCode === input.fromAy &&
      cf.toAcademicYearCode === input.toAy,
  );

  if (idx >= 0) {
    const prev = carried[idx]!;
    if (prev.amountPaise === input.amountPaise && prev.label === input.label) {
      return { carried, created: false, updated: false };
    }
    const next = [...carried];
    next[idx] = {
      ...prev,
      amountPaise: input.amountPaise,
      label: input.label,
      sourceBreakdown: input.sourceBreakdown,
      transferredAt: now,
      transferredBy: input.by,
    };
    return { carried: next, created: false, updated: true };
  }

  const cf: CarriedForwardDue = {
    id: cfId(),
    studentId: input.studentId,
    fromAcademicYearCode: input.fromAy,
    toAcademicYearCode: input.toAy,
    amountPaise: input.amountPaise,
    dueOn: input.dueOn,
    label: input.label,
    sourceDueKeys: [],
    sourceBreakdown: input.sourceBreakdown,
    transferredAt: now,
    transferredBy: input.by,
    voidedAt: null,
  };
  return { carried: [...carried, cf], created: true, updated: false };
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

  let carried = [...(input.fees.carriedForwardDues ?? [])];
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

    const result = upsertCarriedForwardDue(carried, {
      studentId: student.id,
      fromAy,
      toAy,
      amountPaise: pendingPaise,
      label,
      dueOn,
      sourceBreakdown: [
        {
          dueKey: `excel:${normAdmissionNo(row.admissionNo)}`,
          label,
          amountPaise: pendingPaise,
        },
      ],
      by: importedBy,
    });
    carried = result.carried;
    if (result.created) created += 1;
    else if (result.updated) updated += 1;
    else skipped += 1;

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

/**
 * Add (or update) one student's previous-year due directly — the
 * single-student counterpart to applyPreviousDuesImport's bulk Excel path,
 * for when there's no spreadsheet to prepare, just one student and one
 * amount to record.
 */
export function addManualPreviousDue(input: {
  fees: FeesState;
  studentId: string;
  fromAy: string;
  toAy?: string;
  amountPaise: number;
  label?: string;
  enteredBy?: string;
}): { fees: FeesState; created: boolean; updated: boolean } {
  const toAy = input.toAy || DEFAULT_AY;
  const label = input.label?.trim() || `Previous Due · ${input.fromAy}`;
  const dueOn = `${toAy.slice(0, 4)}-04-01`;
  const by = input.enteredBy || "Manual entry";

  const result = upsertCarriedForwardDue(input.fees.carriedForwardDues ?? [], {
    studentId: input.studentId,
    fromAy: input.fromAy,
    toAy,
    amountPaise: input.amountPaise,
    label,
    dueOn,
    sourceBreakdown: [
      { dueKey: `manual:${input.studentId}:${input.fromAy}`, label, amountPaise: input.amountPaise },
    ],
    by,
  });

  return {
    fees: { ...input.fees, carriedForwardDues: result.carried },
    created: result.created,
    updated: result.updated,
  };
}

/**
 * Save a whole class/section's previous-year dues in one go — the grid
 * counterpart to addManualPreviousDue(). Rows with amountPaise <= 0 are
 * skipped, never treated as "clear this student's entry" (voiding a
 * specific student's due stays addManualPreviousDue's/the panel's own Void
 * action, not an implicit side effect of leaving a row blank here).
 */
export function applyBulkPreviousDues(input: {
  fees: FeesState;
  rows: { studentId: string; amountPaise: number }[];
  fromAy: string;
  toAy?: string;
  label?: string;
  enteredBy?: string;
}): { fees: FeesState; created: number; updated: number; skipped: number } {
  const toAy = input.toAy || DEFAULT_AY;
  const label = input.label?.trim() || `Previous Due · ${input.fromAy}`;
  const dueOn = `${toAy.slice(0, 4)}-04-01`;
  const by = input.enteredBy || "Manual entry";

  let carried = [...(input.fees.carriedForwardDues ?? [])];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of input.rows) {
    if (row.amountPaise <= 0) {
      skipped += 1;
      continue;
    }
    const result = upsertCarriedForwardDue(carried, {
      studentId: row.studentId,
      fromAy: input.fromAy,
      toAy,
      amountPaise: row.amountPaise,
      label,
      dueOn,
      sourceBreakdown: [
        {
          dueKey: `manual:${row.studentId}:${input.fromAy}`,
          label,
          amountPaise: row.amountPaise,
        },
      ],
      by,
    });
    carried = result.carried;
    if (result.created) created += 1;
    else if (result.updated) updated += 1;
    else skipped += 1;
  }

  return {
    fees: { ...input.fees, carriedForwardDues: carried },
    created,
    updated,
    skipped,
  };
}

/** Void a previous-year due entered in error — the entry point this module
 * never had before: once created, a CarriedForwardDue could not be undone. */
export function voidCarriedForwardDue(
  fees: FeesState,
  id: string,
  by: string,
): FeesState {
  const now = new Date().toISOString();
  return {
    ...fees,
    carriedForwardDues: (fees.carriedForwardDues ?? []).map((cf) =>
      cf.id === id && !cf.voidedAt
        ? { ...cf, voidedAt: now, transferredBy: `${cf.transferredBy} · voided by ${by}` }
        : cf,
    ),
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
