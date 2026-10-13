/**
 * Which stores each report catalog reads — what lib/reportDataGuard waits
 * for before a report is made. Kept beside each other so a catalog that
 * starts reading another store is one line here.
 *
 * Per report where one report needs a heavy desk the rest do not (the fee
 * book for transport's unpaid riders and compliance calendar; accounts'
 * day book and the two registers that list fee receipts).
 */

import type { ReportDesk } from "@/lib/reportDataGuard";

export type ReportCatalog =
  | "fees"
  | "sis"
  | "admissions"
  | "staff_leave"
  | "student_attendance"
  | "homework"
  | "ptm"
  | "student_leave"
  | "vault"
  | "rte"
  | "payroll"
  | "transport"
  | "accounts"
  | "trust"
  | "timetable"
  | "exams"
  | "library"
  | "certificates"
  | "comms"
  | "teaching";

const BASE: Record<ReportCatalog, ReportDesk[]> = {
  fees: ["masters", "sis", "fees", "payments"],
  sis: ["masters", "sis"],
  admissions: ["masters", "admissions"],
  staff_leave: ["masters", "staff_hr", "staff_attendance"],
  student_attendance: ["masters", "sis", "attendance"],
  homework: ["masters", "sis", "homework"],
  ptm: ["masters", "sis", "ptm"],
  student_leave: ["masters", "sis", "student_leave"],
  vault: ["vault"],
  rte: ["masters", "sis", "rte"],
  payroll: [
    "masters",
    "payroll",
    "staff_advances",
    "salary_setup",
    "statutory",
    "module_state:salary_increment",
    "module_state:salary_hold",
    "module_state:salary_account",
  ],
  transport: ["masters", "sis", "transport"],
  accounts: ["accounts"],
  trust: ["trust"],
  timetable: ["masters", "timetable"],
  exams: ["masters", "sis", "exams"],
  library: ["library"],
  certificates: ["certificates"],
  comms: ["school_comms"],
  teaching: ["masters", "teaching"],
};

const EXTRA: Partial<Record<ReportCatalog, Record<string, ReportDesk[]>>> = {
  transport: {
    unpaid_riders: ["fees"],
    compliance_calendar: ["fees"],
  },
  accounts: {
    day_book: ["fees"],
    cancelled_receipts_payments: ["fees"],
    transaction_id_register: ["fees"],
  },
  admissions: {
    campaign_attribution: ["module_state:marketing_spend"],
  },
  sis: {
    udise_compliance: ["module_state:udise_compliance"],
  },
  teaching: {
    period_delivery: ["timetable"],
  },
};

/** Stores one report reads (omit `reportId` for every report in the catalog). */
export function reportDesksFor(catalog: ReportCatalog, reportId?: string): ReportDesk[] {
  const extra = EXTRA[catalog] ?? {};
  if (reportId) return [...BASE[catalog], ...(extra[reportId] ?? [])];
  return [...new Set([...BASE[catalog], ...Object.values(extra).flat()])];
}
