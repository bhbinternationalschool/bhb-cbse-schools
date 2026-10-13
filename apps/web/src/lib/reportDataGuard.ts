/**
 * Never build a report from data this page has not loaded from the server
 * (14 Oct 2026).
 *
 * Every report catalog reads the module stores in page memory (loadFees(),
 * loadTransport(), …). Until a store has loaded, it hands out an empty
 * placeholder — so on a fresh page a report exported 0 rows or ₹0.00 as if
 * that were the school's figure: staff attendance, homework and the
 * timetable were never even loaded on /reports, the admissions panel read
 * its empty store once and kept it, transport's "unpaid riders" showed every
 * child owing the full fee because the fee book was not loaded.
 *
 * Two pieces, both keyed on the same "loaded from the server" mark the save
 * guards use (deskHydrateGuard.hasDeskLoaded; a failed read never sets it):
 *  - `refuseReportBeforeLoad(desks)` — synchronous, first line of every
 *    `run…Report`. Not loaded → start the load and refuse with a message;
 *    the report is not built. Every caller already shows `{ ok:false, error }`.
 *  - `loadReportData(desks)` — async, for screens that can wait: loads what
 *    is missing and says which desk could not be read.
 *
 * Browser only, and only with a database — self-tests, server code and the
 * offline build run reports from the data they are given, as before.
 */

import { hasDeskLoaded } from "@/lib/deskHydrateGuard";
import type { ModuleStateKey } from "@/lib/moduleStateRegistry";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export type ReportDesk =
  | "masters"
  | "sis"
  | "fees"
  | "payments"
  | "admissions"
  | "attendance"
  | "staff_attendance"
  | "staff_hr"
  | "staff_advances"
  | "exams"
  | "certificates"
  | "transport"
  | "homework"
  | "ptm"
  | "student_leave"
  | "vault"
  | "rte"
  | "timetable"
  | "trust"
  | "library"
  | "payroll"
  | "salary_setup"
  | "statutory"
  | "accounts"
  | "school_comms"
  | "teaching"
  | `module_state:${ModuleStateKey}`;

const LABEL: Record<string, string> = {
  masters: "school masters",
  sis: "student records",
  fees: "the fee book",
  payments: "payments",
  admissions: "admissions",
  attendance: "student attendance",
  staff_attendance: "the staff register",
  staff_hr: "staff leave",
  staff_advances: "staff advances",
  exams: "exams",
  certificates: "certificates",
  transport: "transport",
  homework: "homework",
  ptm: "PTM",
  student_leave: "student leave",
  vault: "the document vault",
  rte: "RTE",
  timetable: "the timetable",
  trust: "trust projects",
  library: "the library",
  payroll: "payroll",
  salary_setup: "salary setup",
  statutory: "PF / ESIC remittances",
  accounts: "accounts",
  school_comms: "notices",
  teaching: "lesson plans and syllabus",
};

function labelOf(desk: ReportDesk): string {
  if (desk.startsWith("module_state:")) return desk.slice("module_state:".length).replace(/_/g, " ");
  return LABEL[desk] ?? desk;
}

let loaderForTests: ((desk: ReportDesk) => Promise<unknown>) | null = null;

/** Tests only: replace every desk's loader. */
export function setReportDataLoaderForTests(fn: ((desk: ReportDesk) => Promise<unknown>) | null): void {
  loaderForTests = fn;
}

/** The loader for each desk — the same ensure…Hydrated the screens use. */
function loader(desk: ReportDesk): () => Promise<unknown> {
  if (loaderForTests) {
    const fn = loaderForTests;
    return () => fn(desk);
  }
  if (desk.startsWith("module_state:")) {
    const key = desk.slice("module_state:".length) as ModuleStateKey;
    return () => import("@/lib/localModulesPersistence").then((m) => m.ensureModuleStateHydrated(key));
  }
  switch (desk) {
    case "masters":
      return () => import("@/lib/mastersPersistence").then((m) => m.ensureMastersHydrated());
    case "sis":
      return () => import("@/lib/sisPersistence").then((m) => m.ensureSisHydrated());
    case "fees":
      return () => import("@/lib/feesPersistence").then((m) => m.ensureFeesHydrated());
    case "payments":
      return () => import("@/lib/paymentsPersistence").then((m) => m.ensurePaymentsHydrated());
    case "admissions":
      return () => import("@/lib/admissionsPersistence").then((m) => m.ensureAdmissionsHydrated());
    case "attendance":
      return () => import("@/lib/attendancePersistence").then((m) => m.ensureAttendanceHydrated());
    case "staff_attendance":
      return () => import("@/lib/staffAttendancePersistence").then((m) => m.ensureStaffAttendanceHydrated());
    case "staff_hr":
      return () => import("@/lib/staffHrPersistence").then((m) => m.ensureStaffHrHydrated());
    case "staff_advances":
      return () => import("@/lib/staffAdvancesPersistence").then((m) => m.ensureStaffAdvancesHydrated());
    case "exams":
      return () => import("@/lib/examsPersistence").then((m) => m.ensureExamsHydrated());
    case "certificates":
      return () => import("@/lib/certificatesPersistence").then((m) => m.ensureCertificatesHydrated());
    case "transport":
      return () => import("@/lib/transportPersistence").then((m) => m.ensureTransportHydrated());
    case "homework":
      return () => import("@/lib/homeworkPersistence").then((m) => m.ensureHomeworkHydrated());
    case "ptm":
      return () => import("@/lib/ptmPersistence").then((m) => m.ensurePtmHydrated());
    case "student_leave":
      return () => import("@/lib/studentLeavePersistence").then((m) => m.ensureStudentLeaveHydrated());
    case "vault":
      return () => import("@/lib/vaultPersistence").then((m) => m.ensureVaultHydrated());
    case "rte":
      return () => import("@/lib/rtePersistence").then((m) => m.ensureRteHydrated());
    case "timetable":
      return () => import("@/lib/timetablePersistence").then((m) => m.ensureTimetableHydrated());
    case "trust":
      return () => import("@/lib/trustPersistence").then((m) => m.ensureTrustHydrated());
    case "library":
      return () => import("@/lib/libraryPersistence").then((m) => m.ensureLibraryHydrated());
    case "payroll":
      return () => import("@/lib/payrollPersistence").then((m) => m.ensurePayrollHydrated());
    case "salary_setup":
      return () => import("@/lib/salarySetupPersistence").then((m) => m.ensureSalarySetupHydrated());
    case "statutory":
      return () => import("@/lib/statutoryPersistence").then((m) => m.ensureStatutoryHydrated());
    case "accounts":
      return () => import("@/lib/accountsPersistence").then((m) => m.ensureAccountsHydrated());
    case "school_comms":
      return () => import("@/lib/schoolCommsPersistence").then((m) => m.ensureSchoolCommsHydrated());
    case "teaching":
      return () => import("@/lib/teachingPersistence").then((m) => m.ensureTeachingHydrated());
  }
  return () => Promise.resolve();
}

function guardActive(): boolean {
  return typeof window !== "undefined" && isSupabaseConfigured();
}

/** Desks in `desks` this page does not hold a server copy of. */
export function missingReportDesks(desks: readonly ReportDesk[]): ReportDesk[] {
  if (!guardActive()) return [];
  return [...new Set(desks)].filter((d) => !hasDeskLoaded(d));
}

function listLabels(desks: readonly ReportDesk[]): string {
  const names = desks.map(labelOf);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * First line of a `run…Report`. null = go ahead. Otherwise the load is
 * started and the returned message says the report was NOT built.
 */
export function refuseReportBeforeLoad(desks: readonly ReportDesk[]): string | null {
  const missing = missingReportDesks(desks);
  if (missing.length === 0) return null;
  for (const d of missing) void loader(d)().catch(() => undefined);
  return `Still loading ${listLabels(missing)} from the server, so this report was NOT made — it would have shown empty or wrong figures. Try again in a moment.`;
}

const LOAD_TIMEOUT_MS = 30_000;

/**
 * Load every desk a screen's reports read. Resolves once each one is either
 * loaded or could not be read; `missing` lists the ones that could not.
 */
export async function loadReportData(
  desks: readonly ReportDesk[],
): Promise<{ ok: true } | { ok: false; missing: ReportDesk[]; error: string }> {
  const first = missingReportDesks(desks);
  if (first.length === 0) return { ok: true };
  await Promise.race([
    Promise.allSettled(first.map((d) => loader(d)())),
    new Promise((r) => setTimeout(r, LOAD_TIMEOUT_MS)),
  ]);
  const missing = missingReportDesks(desks);
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    missing,
    error: `Could not load ${listLabels(missing)} from the server. Reports are not made from a copy that has not loaded — check the connection and try again.`,
  };
}
