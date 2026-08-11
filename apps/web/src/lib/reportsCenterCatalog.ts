/**
 * Reports Center — unified index of every module report catalog.
 * Export logic stays in each *ReportCatalog; this only discovers + deep-links.
 */

import { ADMISSION_REPORTS } from "@/lib/admissionReportCatalog";
import { ACCOUNTS_REPORTS } from "@/lib/accountsReportCatalog";
import { FEE_REPORTS } from "@/lib/feeReportCatalog";
import { PAYROLL_REPORTS } from "@/lib/payrollReportCatalog";
import { SIS_REPORTS } from "@/lib/sisReportCatalog";
import { STORE_REPORTS } from "@/lib/storeReportCatalog";
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
import { PURCHASE_REPORTS } from "@/lib/purchase";
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
  | "comms";

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
    blurb: "Stock · sales · coverage",
    rbacModule: "store",
    href: "/store?tab=reports",
    embeddable: true,
  },
  {
    id: "purchase",
    label: "Purchase",
    blurb: "Indents · open POs · GRNs",
    rbacModule: "purchase",
    href: "/store?tab=purchase",
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
    blurb: "Day book · P&L · balance sheet",
    rbacModule: "accounts",
    href: "/accounts?tab=reports",
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
    href: "/library?tab=reports",
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
  };
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
  for (const r of STORE_REPORTS) {
    out.push(
      entry(
        "store",
        "store",
        "/store?tab=reports",
        r.id,
        r.label,
        r.category,
        r.hint,
      ),
    );
  }
  for (const r of PURCHASE_REPORTS) {
    out.push(
      entry(
        "purchase",
        "purchase",
        "/store?tab=purchase",
        r.id,
        r.label,
        "procurement",
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
        "/accounts?tab=reports",
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
        "/library?tab=reports",
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

  return out;
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

export function moduleLabel(id: ReportsCenterModuleId): string {
  return REPORTS_CENTER_MODULES.find((m) => m.id === id)?.label ?? id;
}
