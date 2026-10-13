/**
 * Reports Center — unified index of every module report catalog.
 * Export logic stays in each *ReportCatalog; this only discovers + deep-links.
 */

import { ADMISSION_REPORTS } from "@/lib/admissionReportCatalog";
import { ACCOUNTS_REPORTS } from "@/lib/accountsReportCatalog";
import { FEE_REPORTS } from "@/lib/feeReportCatalog";
import { PAYROLL_REPORTS } from "@/lib/payrollReportCatalog";
import { SIS_REPORTS } from "@/lib/sisReportCatalog";
import {
  attendanceReportDefs,
  leaveReportDefs,
} from "@/lib/staffLeaveReportCatalog";
import { STUDENT_ATT_REPORTS } from "@/lib/studentAttendanceReportCatalog";
import { TRANSPORT_REPORTS } from "@/lib/transportReportCatalog";
import { TRUST_REPORTS } from "@/lib/trustReportCatalog";
import { HOMEWORK_REPORTS } from "@/lib/homework";
import { PTM_REPORTS } from "@/lib/ptm";
import { STUDENT_LEAVE_REPORTS } from "@/lib/studentLeave";
import { VAULT_REPORTS } from "@/lib/vault";
import { RTE_REPORTS } from "@/lib/rteEws";
import { TIMETABLE_REPORTS } from "@/lib/timetableReportCatalog";
import { EXAM_REPORTS } from "@/lib/examReportCatalog";
import { LIBRARY_REPORTS } from "@/lib/library";
import { CERTIFICATES_REPORTS } from "@/lib/certificatesReportCatalog";
import { COMMS_REPORTS } from "@/lib/commsReportCatalog";
import { isModuleEnabled } from "@/lib/moduleRegistry";
import type { RbacModule } from "@/lib/rbac";

export type ReportsCenterModuleId =
  | "fees"
  | "students"
  | "admissions"
  | "staff"
  | "attendance"
  | "homework"
  | "ptm"
  | "events"
  | "student_leave"
  | "vault"
  | "rte"
  | "payroll"
  | "store"
  | "purchase"
  | "transport"
  | "accounts"
  | "trust"
  | "timetable"
  | "exams"
  | "library"
  | "certificates"
  | "comms"
  | "visitors"
  | "health"
  | "discipline"
  | "online_classes";

export type ReportsCenterEntry = {
  /** Stable id: module:reportId */
  key: string;
  moduleId: ReportsCenterModuleId;
  /** Underlying RBAC module for access checks */
  rbacModule: RbacModule;
  reportId: string;
  label: string;
  category: string;
  hint?: string;
  /** Open module Reports tab */
  href: string;
  /**
   * true = the Reports Center's own panel for this module runs it ("Run
   * here"); false = it lives on its module's screen and is listed so it can
   * be found ("Open").
   */
  runHere: boolean;
};

export type ReportsCenterModuleDef = {
  id: ReportsCenterModuleId;
  label: string;
  blurb: string;
  rbacModule: RbacModule;
  href: string;
  /** Workspace supports embedded runner panel in Reports Center */
  embeddable: boolean;
};

export const REPORTS_CENTER_MODULES: ReportsCenterModuleDef[] = [
  {
    id: "fees",
    label: "Fees",
    blurb: "Collection · dues · student ledgers",
    rbacModule: "fees",
    href: "/fees?tab=reports",
    embeddable: true,
  },
  {
    id: "students",
    label: "Students",
    blurb: "Registers · RTE · strength",
    rbacModule: "students",
    href: "/students?tab=reports",
    embeddable: true,
  },
  {
    id: "admissions",
    label: "Admissions",
    blurb: "Leads · funnel · survey · registration",
    rbacModule: "admissions",
    href: "/admissions?tab=reports",
    embeddable: true,
  },
  {
    id: "staff",
    label: "Staff leave",
    blurb: "Balances · leave registers",
    rbacModule: "staff",
    href: "/staff?tab=reports",
    embeddable: true,
  },
  {
    id: "attendance",
    label: "Attendance",
    blurb: "Student & staff attendance",
    rbacModule: "attendance",
    href: "/attendance?tab=student-reports",
    embeddable: true,
  },
  {
    id: "homework",
    label: "Homework",
    blurb: "Posts · seen % · submissions",
    rbacModule: "homework",
    href: "/homework?tab=reports",
    embeddable: true,
  },
  {
    id: "ptm",
    label: "PTM",
    blurb: "Bookings · slot fill · feedback",
    rbacModule: "ptm",
    href: "/ptm?tab=reports",
    embeddable: true,
  },
  {
    id: "student_leave",
    label: "Student leave",
    blurb: "Register · medical · chronic",
    rbacModule: "student_leave",
    href: "/attendance?tab=leave",
    embeddable: true,
  },
  {
    id: "vault",
    label: "Vault",
    blurb: "Inventory · expiry calendar",
    rbacModule: "vault",
    href: "/vault?tab=reports",
    embeddable: true,
  },
  {
    id: "rte",
    label: "RTE / EWS",
    blurb: "Quota · applications · enrolled",
    rbacModule: "rte",
    href: "/admissions?tab=rte",
    embeddable: true,
  },
  {
    id: "payroll",
    label: "Payroll",
    blurb: "Salary · statutory · advances",
    rbacModule: "payroll",
    href: "/payroll?tab=reports",
    embeddable: true,
  },
  {
    id: "store",
    label: "Store",
    blurb: "Stock · margin · day book · purchases · stock vs books",
    rbacModule: "store",
    href: "/inventory?tab=reports",
    embeddable: true,
  },
  {
    id: "transport",
    label: "Transport",
    blurb: "Riders · fleet · TCO",
    rbacModule: "transport",
    href: "/transport?tab=reports",
    embeddable: true,
  },
  {
    id: "accounts",
    label: "Accounts",
    // No longer "P&L · balance sheet": the financial statements moved to
    // Accounts → Book reports, which builds them from the server book
    // (2026-09-06). What is left here are the desk's own registers.
    blurb: "Day book · cash register · expenses · payables · book reports",
    rbacModule: "accounts",
    // The desk registers run only here; the module's report tab is the
    // server book (TB, I&E, balance sheet…), listed below as "Open".
    href: "/accounts?tab=bookreports",
    embeddable: true,
  },
  {
    id: "trust",
    label: "Trust",
    blurb: "Cost sheet · CWIP · allotments",
    rbacModule: "trust",
    href: "/trust?tab=reports",
    embeddable: true,
  },
  {
    id: "timetable",
    label: "Timetable",
    blurb: "Teacher load · free periods · substitutions",
    rbacModule: "timetable",
    href: "/timetable?tab=reports",
    embeddable: true,
  },
  {
    id: "exams",
    label: "Exams",
    blurb: "Result analysis · toppers · CBSE summary",
    rbacModule: "exams",
    href: "/exams?tab=result_reports",
    embeddable: true,
  },
  {
    id: "library",
    label: "Library",
    blurb: "Circulation · overdue · borrower ledgers",
    // Library has no dedicated RBAC module — it's gated under "store"
    // (see lib/library.ts's assertModulePermission calls).
    rbacModule: "store",
    href: "/library?tab=lib_reports",
    embeddable: true,
  },
  {
    id: "certificates",
    label: "Certificates",
    blurb: "Issue register · TC register",
    rbacModule: "certificates",
    href: "/certificates?tab=reports",
    embeddable: true,
  },
  {
    id: "comms",
    label: "Comms",
    blurb: "Notices · news publish registers",
    // Comms has no single RBAC module — notices/news/gallery are gated
    // separately (see lib/schoolComms.ts's canEditComms). "notices" is
    // the broadest, used here to gate the module tab itself.
    rbacModule: "notices",
    href: "/comms?tab=reports",
    embeddable: true,
  },
  // Modules whose registers are exported on their own screens: listed so
  // they can be found, each opening its module.
  {
    id: "visitors",
    label: "Visitors",
    blurb: "Visitor log · gate passes",
    rbacModule: "visitors",
    href: "/visitors",
    embeddable: false,
  },
  {
    id: "health",
    label: "Health",
    blurb: "Medical visits · medication · vaccinations",
    rbacModule: "health",
    href: "/health",
    embeddable: false,
  },
  {
    id: "discipline",
    label: "Discipline",
    blurb: "Incident register",
    rbacModule: "discipline",
    href: "/discipline",
    embeddable: false,
  },
  {
    id: "online_classes",
    label: "Online classes",
    blurb: "Classes held by teacher and section",
    rbacModule: "online_classes",
    href: "/online-classes",
    embeddable: false,
  },
];

function entry(
  moduleId: ReportsCenterModuleId,
  rbacModule: RbacModule,
  href: string,
  reportId: string,
  label: string,
  category: string,
  hint?: string,
): ReportsCenterEntry {
  return {
    key: `${moduleId}:${reportId}`,
    moduleId,
    rbacModule,
    reportId,
    label,
    category,
    hint,
    href,
    runHere: true,
  };
}

/** A report that lives on its module's own screen ("Open", not "Run here"). */
function linked(
  moduleId: ReportsCenterModuleId,
  rbacModule: RbacModule,
  href: string,
  reportId: string,
  label: string,
  category: string,
  hint?: string,
): ReportsCenterEntry {
  return { ...entry(moduleId, rbacModule, href, reportId, label, category, hint), runHere: false };
}

/** Flat catalog of all operational reports (exams report-cards stay in Exams). */
export function listReportsCenterEntries(): ReportsCenterEntry[] {
  const out: ReportsCenterEntry[] = [];

  for (const r of FEE_REPORTS) {
    out.push(
      entry(
        "fees",
        "fees",
        "/fees?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of SIS_REPORTS) {
    out.push(
      entry(
        "students",
        "students",
        "/students?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of ADMISSION_REPORTS) {
    out.push(
      entry(
        "admissions",
        "admissions",
        "/admissions?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of leaveReportDefs()) {
    out.push(
      entry(
        "staff",
        "staff",
        "/staff?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of STUDENT_ATT_REPORTS) {
    out.push(
      entry(
        "attendance",
        "attendance",
        "/attendance?tab=student-reports",
        r.id,
        r.label,
        "student",
        r.hint,
      ),
    );
  }
  for (const r of attendanceReportDefs()) {
    out.push(
      entry(
        "attendance",
        "attendance",
        "/attendance?tab=staff-reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of HOMEWORK_REPORTS) {
    out.push(
      entry(
        "homework",
        "homework",
        "/homework?tab=reports",
        r.id,
        r.label,
        "engagement",
        r.hint,
      ),
    );
  }
  for (const r of PTM_REPORTS) {
    out.push(
      entry(
        "ptm",
        "ptm",
        "/ptm?tab=reports",
        r.id,
        r.label,
        "ptm",
        r.hint,
      ),
    );
  }
  for (const r of STUDENT_LEAVE_REPORTS) {
    out.push(
      entry(
        "student_leave",
        "student_leave",
        "/attendance?tab=leave",
        r.id,
        r.label,
        "leave",
        r.hint,
      ),
    );
  }
  for (const r of VAULT_REPORTS) {
    out.push(
      entry(
        "vault",
        "vault",
        "/vault?tab=reports",
        r.id,
        r.label,
        "compliance",
        r.hint,
      ),
    );
  }
  if (isModuleEnabled("rte_ews")) {
    for (const r of RTE_REPORTS) {
      out.push(
        entry(
          "rte",
          "rte",
          "/admissions?tab=rte",
          r.id,
          r.label,
          "compliance",
          r.hint,
        ),
      );
    }
  }
  for (const r of PAYROLL_REPORTS) {
    out.push(
      entry(
        "payroll",
        "payroll",
        "/payroll?tab=reports",
        r.id,
        r.title,
        r.category,
        r.description,
      ),
    );
  }
  // Store and purchase reports live in the module itself now, where they are
  // run against the server ledger. Listed here as four real reports rather
  // than the long menu the old browser-held register advertised.
  // Ids are the store Reports tab's own (components/inventory/ReportsTab),
  // so "Run here" opens the right one.
  for (const r of [
    { id: "dashboard", label: "Store overview", hint: "Today's sales, stock value, open bills" },
    { id: "stock", label: "Stock register", hint: "On hand and value per item" },
    { id: "margin", label: "Item margin", hint: "Sold, revenue, cost and margin" },
    { id: "daybook", label: "Sales day book", hint: "Counter sales with tender split" },
    { id: "purchases", label: "Purchases by vendor", hint: "Bought, returned and outstanding" },
    { id: "parity", label: "Stock vs books", hint: "Ledger stock against the books" },
    { id: "repeats", label: "Bought twice", hint: "The same item bought again soon after" },
  ]) {
    out.push(
      entry(
        "store",
        "store",
        "/inventory?tab=reports",
        r.id,
        r.label,
        "store",
        r.hint,
      ),
    );
  }
  for (const r of TRANSPORT_REPORTS) {
    out.push(
      entry(
        "transport",
        "transport",
        "/transport?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of ACCOUNTS_REPORTS) {
    out.push(
      entry(
        "accounts",
        "accounts",
        // These desk registers have no screen in Accounts any more; they
        // run in the Reports Center.
        `/reports?module=accounts&report=${r.id}`,
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of TRUST_REPORTS) {
    out.push(
      entry(
        "trust",
        "trust",
        "/trust?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of TIMETABLE_REPORTS) {
    out.push(
      entry(
        "timetable",
        "timetable",
        "/timetable?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of EXAM_REPORTS) {
    out.push(
      entry(
        "exams",
        "exams",
        "/exams?tab=result_reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of LIBRARY_REPORTS) {
    out.push(
      entry(
        "library",
        "store",
        "/library?tab=lib_reports",
        r.id,
        r.label,
        "library",
        r.hint,
      ),
    );
  }
  for (const r of CERTIFICATES_REPORTS) {
    out.push(
      entry(
        "certificates",
        "certificates",
        "/certificates?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of COMMS_REPORTS) {
    out.push(
      entry(
        "comms",
        r.id === "news_register" ? "news" : "notices",
        "/comms?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  // The old ERP's "Parent Mobile Usage Report" lives on its own Comms tab
  // (it has an invite action), so this entry opens that tab.
  out.push(
    entry(
      "comms",
      "notices",
      "/comms?tab=onapp",
      "parent_app_usage",
      "Parent app usage",
      "registers",
      "Families signed in · active 7/30 days · notifications · never signed in, by class",
    ),
  );

  out.push(...linkedReports());

  return out;
}

/**
 * Reports that exist on their own module screens (found by the 13 Oct 2026
 * audit), listed so the Reports Center is the one place to find a report.
 * Every href is a tab its page opens from the URL.
 */
function linkedReports(): ReportsCenterEntry[] {
  return [
    // Accounts — the server book (Ledger v2), the school's real statements.
    linked("accounts", "accounts", "/accounts?tab=bookreports", "trial_balance", "Trial balance", "statements", "Server book · as on a date"),
    linked("accounts", "accounts", "/accounts?tab=bookreports", "income_expenditure", "Income & expenditure", "statements", "Server book · for a period"),
    linked("accounts", "accounts", "/accounts?tab=bookreports", "balance_sheet", "Balance sheet", "statements", "Server book · as on a date"),
    linked("accounts", "accounts", "/accounts?tab=bookreports", "receipts_payments_book", "Receipts & payments (book)", "statements", "Server book · for a period"),
    linked("accounts", "accounts", "/accounts?tab=bookreports", "account_statement", "Account statement", "statements", "Server book · one account, running balance"),
    linked("accounts", "accounts", "/accounts?tab=bookreports", "ca_year_end_pack", "CA year-end pack", "statements", "TB, schedules and registers for the auditor"),
    linked("accounts", "accounts", "/accounts?tab=recon", "bank_recon", "Bank reconciliation", "statements", "Book against the bank statement"),
    // Fees
    linked("fees", "fees", "/fees/defaulters", "defaulters_playbook", "Defaulters (by class, with ageing)", "dues", "Who owes, for how long, follow-up"),
    linked("fees", "masters", "/masters?tab=concessions", "concession_grants", "Concession grants register", "student", "Every concession granted, by student"),
    linked("fees", "accounts", "/accounts?tab=cheques", "cheque_register", "Cheques (incl. bounced)", "collection", "Post-dated and bounced cheques"),
    // Payroll
    linked("payroll", "payroll", "/payroll?tab=runs", "salary_register", "Salary register", "salary", "Open a run → Salary register (every head per staff, with totals)"),
    linked("payroll", "payroll", "/payroll?tab=govt", "pf_esic_ecr", "PF ECR / ESIC file", "statutory", "Monthly return files"),
    linked("payroll", "payroll", "/payroll?tab=bank", "bank_file", "Salary bank file", "salary", "Bank transfer file for a run"),
    // Students
    linked("students", "students", "/students?tab=udise", "udise_exports", "UDISE+ working sheets", "compliance", "Open gaps, on/not on portal, Aadhaar, APAAR"),
    linked("students", "students", "/students?tab=birthdays", "birthdays", "Birthdays", "registers", "Today and the next two weeks"),
    // Attendance
    linked("attendance", "attendance", "/attendance?tab=month", "month_register", "Month register (days grid)", "student", "Class × days, holiday-aware"),
    // Transport
    linked("transport", "transport", "/transport?tab=register", "bus_register", "Bus register (boarding, km & fuel)", "operations", "Monthly boarding per child, vehicle km and fuel"),
    linked("transport", "transport", "/transport?tab=fleetDashboard", "fleet_edge", "Fleet Edge report", "operations", "GPS trips, over-speed, idle"),
    // Staff
    linked("staff", "staff", "/staff?tab=roster", "staff_register", "Staff register", "registers", "Every staff member with details"),
    linked("staff", "staff", "/staff?tab=appraisal", "appraisals", "Appraisals", "registers", "Appraisal records"),
    // Modules with their own registers
    linked("visitors", "visitors", "/visitors", "visitor_log", "Visitor log & gate passes", "registers", "Export from the visitors screen"),
    linked("health", "health", "/health", "health_register", "Medical visits, medication, vaccinations", "registers", "Export from the health screen"),
    linked("discipline", "discipline", "/discipline", "incident_register", "Incident register", "registers", "Export from the discipline screen"),
    linked("online_classes", "online_classes", "/online-classes", "classes_held", "Online classes held", "registers", "Past classes by teacher and section"),
  ];
}

/**
 * The permission modules the person's entries may be gated by: each visible
 * tab's own, plus any other module an entry of that tab is gated by and the
 * person can open (the news register is gated by "news" under Comms — the
 * set held only the tabs' modules, so it never showed).
 */
export function allowedEntryRbac(
  mods: readonly ReportsCenterModuleDef[],
  entries: readonly ReportsCenterEntry[],
  canOpen: (m: RbacModule) => boolean,
): Set<RbacModule> {
  const set = new Set<RbacModule>(mods.map((m) => m.rbacModule));
  for (const e of entries) {
    if (set.has(e.rbacModule)) continue;
    if (mods.some((m) => m.id === e.moduleId) && canOpen(e.rbacModule)) set.add(e.rbacModule);
  }
  return set;
}

export function filterReportsCenterEntries(
  entries: ReportsCenterEntry[],
  opts: {
    query?: string;
    moduleId?: ReportsCenterModuleId | "all";
    allowedRbac?: Set<RbacModule>;
  },
): ReportsCenterEntry[] {
  const q = (opts.query || "").trim().toLowerCase();
  return entries.filter((e) => {
    if (opts.allowedRbac && !opts.allowedRbac.has(e.rbacModule)) return false;
    if (opts.moduleId && opts.moduleId !== "all" && e.moduleId !== opts.moduleId) {
      return false;
    }
    if (!q) return true;
    const hay = `${e.label} ${e.hint || ""} ${e.category} ${e.moduleId} ${e.reportId}`.toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Reports about the staff themselves — leave, and staff attendance (which
 * sits under the attendance module). A teacher holds "staff.view" and
 * "attendance.view" for their own work, and until 2026-09-29 that listed
 * every colleague's leave and punches here. Teacher mode drops these.
 */
export function isStaffRecordsEntry(e: {
  moduleId: string;
  href: string;
}): boolean {
  return e.moduleId === "staff" || e.href.includes("tab=staff-reports");
}

export function moduleLabel(id: ReportsCenterModuleId): string {
  return REPORTS_CENTER_MODULES.find((m) => m.id === id)?.label ?? id;
}
