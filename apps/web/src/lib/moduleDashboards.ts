/**
 * Per-module dashboard snapshots for ModuleDashboardView.
 * Demo data from localStorage loaders — client-only.
 */

import type { ModuleDashboardModel } from "@/components/dashboard/ModuleDashboard";
import {
  ADMISSION_STAGES,
  followUpCounts,
  funnelCounts,
  loadAdmissions,
  sourceCounts,
  sourceLabel,
  type AdmissionStage,
} from "@/lib/admissions";
import {
  bankBalancePaise,
  dashboardSnapshot,
  listUnifiedPayables,
  loadAccounts,
  totalBankBalancePaise,
} from "@/lib/accounts";
import { loadAttendance, summarizeMarks } from "@/lib/attendance";
import { loadCertificates } from "@/lib/certificates";
import { loadExams } from "@/lib/exams";
import { buildFeesDashboardModel } from "@/lib/feeDashboard";
import { computeFeeKpis } from "@/lib/feeFinance";
import { buildDayBook, formatInr, loadFees } from "@/lib/fees";
import { loadOfflineQueue } from "@/lib/fieldSurvey";
import { loadHomework } from "@/lib/homework";
import {
  currentAcademicYearCode,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import {
  isModuleEnabled,
  loadModuleRegistry,
  REGISTRY_MODULES,
} from "@/lib/moduleRegistry";
import { loadPayroll } from "@/lib/payroll";
import { loadPtm } from "@/lib/ptm";
import { loadPurchase } from "@/lib/purchase";
import { loadReportsCenterRecent } from "@/lib/reportsCenter";
import { loadSis } from "@/lib/sis";
import { loadStaffAttendance, summarizeStaffMarks } from "@/lib/staffAttendance";
import { loadStaffHr } from "@/lib/staffHr";
import {
  listActiveStoreItems,
  listLowStockItems,
  loadStore,
} from "@/lib/store";
import { loadStudentLeave } from "@/lib/studentLeave";
import { loadTransport } from "@/lib/transport";
import { loadTrust } from "@/lib/trust";
import { loadVault, VAULT_DOC_TYPES } from "@/lib/vault";
import { TENANT } from "@/lib/types";

export type DashboardModuleId =
  | "masters"
  | "admissions"
  | "students"
  | "staff"
  | "store"
  | "transport"
  | "accounts"
  | "trust"
  | "fees"
  | "attendance"
  | "homework"
  | "ptm"
  | "vault"
  | "modules"
  | "payroll"
  | "exams"
  | "certificates"
  | "reports"
  | "field"
  | "student_leave"
  | "purchase";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function inAcademicYear(
  row: { academicYearCode?: string | null },
  academicYearCode?: string,
): boolean {
  return !academicYearCode || row.academicYearCode === academicYearCode;
}

function emptyModel(title: string, subtitle: string): ModuleDashboardModel {
  return {
    title,
    subtitle,
    kpis: [
      {
        id: "empty",
        label: "Ready",
        value: "0",
        hint: "Add records to populate this dashboard",
        tone: "slate",
      },
    ],
    chartTitle: "Activity",
    chartSeries: [{ label: "—", value: 0 }],
    tableTitle: "Recent",
    tableColumns: [
      { key: "name", label: "Item" },
      { key: "value", label: "Value", align: "right" },
    ],
    tableRows: [],
  };
}

function runNetPaise(lines: { netPay: number }[]): number {
  return Math.round(lines.reduce((s, l) => s + (l.netPay || 0), 0) * 100);
}

function mastersDash(
  masters: MastersState,
  academicYearCode?: string,
): ModuleDashboardModel {
  const ay = academicYearCode || currentAcademicYearCode(masters);
  const classes = masters.classes.filter((c) => c.isActive !== false);
  const sections = masters.sections.filter((s) => s.isActive !== false);
  const staff = masters.staff ?? [];
  const activeStaff = staff.filter((s) => s.status === "active").length;
  const feeHeads = masters.feeHeads?.filter((f) => f.isActive).length ?? 0;
  const chart = classes.slice(0, 10).map((c) => ({
    label: c.name,
    value: sections.filter((s) => s.classId === c.id).length,
  }));
  return {
    title: "Masters",
    subtitle: `Foundation setup for ${ay} — classes, staff, fee heads, and school structure.`,
    kpis: [
      {
        id: "classes",
        label: "Classes",
        value: String(classes.length),
        hint: `${sections.length} sections`,
        tone: "navy",
        tab: "classes",
        detailTitle: "Active classes",
        detailColumns: [
          { key: "name", label: "Class" },
          { key: "sections", label: "Sections", align: "right" },
        ],
        detailRows: classes.slice(0, 40).map((c) => ({
          id: c.id,
          name: c.name,
          sections: sections.filter((s) => s.classId === c.id).length,
        })),
      },
      {
        id: "staff",
        label: "Staff",
        value: String(activeStaff),
        hint: `${staff.length} total records`,
        tone: "teal",
        tab: "staff",
      },
      {
        id: "feeheads",
        label: "Fee heads",
        value: String(feeHeads),
        tone: "gold",
        tab: "fee-heads",
      },
      {
        id: "campuses",
        label: "Campuses",
        value: String(masters.campuses?.length ?? 0),
        tone: "sky",
        tab: "campuses",
      },
    ],
    chartTitle: "Sections by class",
    chartSeries: chart.length ? chart : [{ label: "—", value: 0 }],
    tableTitle: "Class structure",
    tableColumns: [
      { key: "name", label: "Class" },
      { key: "sections", label: "Sections", align: "right" },
    ],
    tableRows: classes.slice(0, 30).map((c) => ({
      id: c.id,
      name: c.name,
      sections: sections.filter((s) => s.classId === c.id).length,
    })),
    quickLinks: [
      { label: "School profile", tab: "school" },
      { label: "Fee structure", tab: "fee-structure" },
      { label: "Roles", tab: "roles" },
    ],
  };
}

function admissionsDash(academicYearCode?: string): ModuleDashboardModel {
  const loaded = loadAdmissions();
  const state = {
    ...loaded,
    leads: loaded.leads.filter((l) => inAcademicYear(l, academicYearCode)),
  };
  const funnel = funnelCounts(state);
  const sources = sourceCounts(state);
  const fu = followUpCounts(state);
  const total = state.leads.length;
  const open = total - (funnel.enrolled || 0) - (funnel.lost || 0);
  const chart = ADMISSION_STAGES.map((s) => ({
    label: s.label,
    value: funnel[s.value as AdmissionStage] || 0,
  }));
  const sourceRows = Object.entries(sources)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({
      id: k,
      name: sourceLabel(k as Parameters<typeof sourceLabel>[0]),
      count: n,
    }));
  return {
    title: "Admissions",
    subtitle: `Session ${academicYearCode || "all"} · enquiry funnel, follow-ups, and conversion.`,
    kpis: [
      {
        id: "leads",
        label: "Total leads",
        value: String(total),
        hint: `${open} still in pipeline`,
        tone: "navy",
        tab: "leads",
        detailTitle: "Funnel stages",
        detailColumns: [
          { key: "stage", label: "Stage" },
          { key: "count", label: "Count", align: "right" },
        ],
        detailRows: ADMISSION_STAGES.map((s) => ({
          id: s.value,
          stage: s.label,
          count: funnel[s.value as AdmissionStage] || 0,
        })),
      },
      {
        id: "enquiry",
        label: "Enquiries",
        value: String(funnel.enquiry || 0),
        tone: "sky",
        tab: "enquiry",
      },
      {
        id: "enrolled",
        label: "Enrolled",
        value: String(funnel.enrolled || 0),
        tone: "green",
        tab: "registration",
      },
      {
        id: "followups",
        label: "Due follow-ups",
        value: String(fu.overdue + fu.dueToday),
        hint: `${fu.overdue} overdue · ${fu.dueToday} today`,
        tone: "coral",
        tab: "leads",
      },
    ],
    chartTitle: "Admission funnel",
    chartSeries: chart,
    tableTitle: "Leads by source",
    tableColumns: [
      { key: "name", label: "Source" },
      { key: "count", label: "Leads", align: "right" },
    ],
    tableRows: sourceRows,
    quickLinks: [
      { label: "New enquiry", tab: "enquiry" },
      { label: "Field survey", tab: "survey" },
      { label: "CRM chat", tab: "crm_chat" },
      { label: "Reports", tab: "reports" },
    ],
  };
}

function studentsDash(academicYearCode?: string): ModuleDashboardModel {
  const sis = loadSis();
  const masters = loadMasters();
  const ay = academicYearCode || currentAcademicYearCode(masters);
  const normalizeAy = (code: string) => {
    const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
    const full = t.match(/^(20\d{2})-(20\d{2})$/);
    if (full) return `${full[1]}-${full[2]!.slice(2)}`;
    return t || ay;
  };
  const sessionAy = normalizeAy(ay);
  const inSession = (s: (typeof sis.students)[number]) =>
    normalizeAy(s.academicYearCode || ay) === sessionAy;
  const sessionStudents = sis.students.filter(inSession);
  const active = sessionStudents.filter((s) => s.status === "active");
  const inactive = sessionStudents.filter((s) => s.status === "inactive");
  const earlierAdmissions = new Set(
    sis.students
      .filter((s) => normalizeAy(s.academicYearCode || "") < sessionAy)
      .map((s) => s.admissionNo.trim().toUpperCase()),
  );
  const continuing = active.filter((s) =>
    earlierAdmissions.has(s.admissionNo.trim().toUpperCase()),
  ).length;
  const fresh = active.length - continuing;
  const byClass = new Map<string, { label: string; count: number }>();
  for (const s of active) {
    const cls = masters.classes.find((c) => c.id === s.classId);
    const label = cls?.name || "Unassigned";
    const cur = byClass.get(s.classId || "none") ?? { label, count: 0 };
    cur.count += 1;
    byClass.set(s.classId || "none", cur);
  }
  const classRows = [...byClass.entries()]
    .map(([id, v]) => ({ id, name: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);
  const male = active.filter((s) => s.gender === "M").length;
  const female = active.filter((s) => s.gender === "F").length;

  /**
   * Session-wise ADMISSION: count each student once in the year first admitted
   * (earliest enrollment) so promoted students are not repeated per session.
   */
  const firstSessionByAdm = new Map<string, string>();
  for (const s of sis.students) {
    const adm = s.admissionNo.trim().toUpperCase();
    if (!adm) continue;
    const code = normalizeAy(s.academicYearCode || ay);
    const prev = firstSessionByAdm.get(adm);
    if (!prev || code < prev) firstSessionByAdm.set(adm, code);
  }
  const admissionMap = new Map<string, number>();
  for (const code of firstSessionByAdm.values()) {
    admissionMap.set(code, (admissionMap.get(code) ?? 0) + 1);
  }
  const admissionRows = [...admissionMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([code, count]) => ({ id: code, session: code, admissions: count }));
  /** Oldest → newest for trend / pie / bar readability. */
  const admissionChartSeries = [...admissionMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, count]) => ({ label: code, value: count }));
  return {
    title: "Students",
    subtitle: `Session ${sessionAy} · this year only (not combined).`,
    kpis: [
      {
        id: "active",
        label: "Active students",
        value: String(active.length),
        hint: `${inactive.length} inactive · ${continuing} continuing · ${fresh} new`,
        tone: "navy",
        tab: "roster",
        detailTitle: "By class",
        detailColumns: [
          { key: "name", label: "Class" },
          { key: "count", label: "Students", align: "right" },
        ],
        detailRows: classRows.slice(0, 40),
      },
      {
        id: "male",
        label: "Boys",
        value: String(male),
        tone: "sky",
        tab: "roster",
      },
      {
        id: "female",
        label: "Girls",
        value: String(female),
        tone: "rose",
        tab: "roster",
      },
      {
        id: "hh",
        label: "Households",
        value: String(sis.households?.length ?? 0),
        tone: "teal",
        tab: "siblings",
      },
    ],
    chartTitle: "Students by class",
    chartSeries: classRows.slice(0, 12).map((r) => ({
      label: r.name,
      value: Number(r.count),
    })),
    chartDefaultView: "bar",
    extraCharts: [
      {
        title: "Admission trend (session wise)",
        series: admissionChartSeries.length
          ? admissionChartSeries
          : [{ label: "—", value: 0 }],
        defaultView: "trend",
      },
    ],
    tableTitle: "Students by class",
    tableColumns: [
      { key: "name", label: "Class" },
      { key: "count", label: "Students", align: "right" },
    ],
    tableRows: classRows.slice(0, 40),
    extraTables: [
      {
        title: "Session wise admission",
        columns: [
          { key: "session", label: "Session" },
          { key: "admissions", label: "Admissions", align: "right" },
        ],
        rows: admissionRows,
      },
    ],
    quickLinks: [
      { label: "Roster", tab: "roster" },
      { label: "UDISE", tab: "udise" },
      { label: "Import", tab: "import" },
      { label: "Upgrade", tab: "upgrade" },
    ],
  };
}

function staffDash(academicYearCode?: string): ModuleDashboardModel {
  const masters = loadMasters();
  const hr = loadStaffHr();
  const staff = masters.staff ?? [];
  const active = staff.filter((s) => s.status === "active");
  const teaching = active.filter((s) => s.stream === "teaching").length;
  const nonTeaching = active.filter((s) => s.stream === "non_teaching").length;
  const leaveOpen = (hr.leaveRequests ?? []).filter(
    (r) =>
      inAcademicYear(r, academicYearCode) &&
      (r.status === "pending" || r.status === "pending_l2"),
  ).length;
  const byDept = new Map<string, number>();
  for (const s of active) {
    const dep = masters.departments.find((d) => d.id === s.departmentId);
    const label = dep?.name ?? "Unassigned";
    byDept.set(label, (byDept.get(label) ?? 0) + 1);
  }
  const deptRows = [...byDept.entries()]
    .map(([name, count]) => ({ id: name, name, count }))
    .sort((a, b) => b.count - a.count);
  return {
    title: "Staff",
    subtitle: `Session ${academicYearCode || "all"} · workforce strength, departments, and HR queues.`,
    kpis: [
      {
        id: "active",
        label: "Active staff",
        value: String(active.length),
        hint: `${staff.length - active.length} inactive`,
        tone: "navy",
        tab: "roster",
        detailTitle: "By department",
        detailColumns: [
          { key: "name", label: "Department" },
          { key: "count", label: "Count", align: "right" },
        ],
        detailRows: deptRows,
      },
      {
        id: "teaching",
        label: "Teaching",
        value: String(teaching),
        tone: "teal",
        tab: "roster",
      },
      {
        id: "non",
        label: "Non-teaching",
        value: String(nonTeaching),
        tone: "sky",
        tab: "roster",
      },
      {
        id: "leave",
        label: "Leave queue",
        value: String(leaveOpen),
        tone: "coral",
        tab: "leave",
      },
    ],
    chartTitle: "Headcount by department",
    chartSeries: deptRows.slice(0, 10).map((r) => ({
      label: r.name,
      value: Number(r.count),
    })),
    tableTitle: "Department roster",
    tableColumns: [
      { key: "name", label: "Department" },
      { key: "count", label: "Staff", align: "right" },
    ],
    tableRows: deptRows,
    quickLinks: [
      { label: "Roster", tab: "roster" },
      { label: "Leave", tab: "leave" },
      { label: "Appraisal", tab: "appraisal" },
      { label: "Payslips", tab: "payslips" },
    ],
  };
}

function storeDash(academicYearCode?: string): ModuleDashboardModel {
  const store = loadStore();
  const items = listActiveStoreItems(store);
  const low = listLowStockItems(store);
  const issues = store.issues.filter(
    (i) => !i.voidedAt && inAcademicYear(i, academicYearCode),
  );
  const days = lastNDays(7);
  const trend = days.map((d) => ({
    label: dayLabel(d),
    value: issues.filter((i) => i.issuedOn === d).length,
  }));
  const salesPaise = issues
    .filter((i) => i.paymentMode === "cash" || i.paymentMode === "credit")
    .reduce((n, i) => n + (i.totalPaise || 0), 0);
  const byCat = new Map<string, number>();
  for (const it of items) {
    const cat = store.categories.find((c) => c.id === it.categoryId);
    const label = cat?.name || "General";
    byCat.set(label, (byCat.get(label) ?? 0) + 1);
  }
  const catRows = [...byCat.entries()]
    .map(([name, count]) => ({ id: name, name, count }))
    .sort((a, b) => b.count - a.count);
  return {
    title: "Store",
    subtitle: "Stock health, issues, and sales pulse for the school store.",
    kpis: [
      {
        id: "items",
        label: "Active items",
        value: String(items.length),
        tone: "navy",
        tab: "master",
        detailTitle: "By category",
        detailColumns: [
          { key: "name", label: "Category" },
          { key: "count", label: "Items", align: "right" },
        ],
        detailRows: catRows,
      },
      {
        id: "low",
        label: "Low stock",
        value: String(low.length),
        hint: "Below reorder level",
        tone: "coral",
        tab: "inv_report",
        detailTitle: "Low stock items",
        detailColumns: [
          { key: "name", label: "Item" },
          { key: "qty", label: "Qty", align: "right" },
        ],
        detailRows: low.slice(0, 40).map((i) => ({
          id: i.id,
          name: i.name,
          qty: i.stockOnHand ?? 0,
        })),
      },
      {
        id: "issues",
        label: "Issues",
        value: String(issues.length),
        tone: "teal",
        tab: "issue",
      },
      {
        id: "sales",
        label: "Sales value",
        value: formatInr(salesPaise),
        tone: "gold",
        tab: "acct_report",
      },
    ],
    chartTitle: "Issues — last 7 days",
    chartSeries: trend,
    tableTitle: "Low stock watchlist",
    tableColumns: [
      { key: "name", label: "Item" },
      { key: "sku", label: "SKU" },
      { key: "qty", label: "On hand", align: "right" },
    ],
    tableRows: low.slice(0, 30).map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku || "—",
      qty: i.stockOnHand ?? 0,
    })),
    quickLinks: [
      { label: "Stock master", tab: "master" },
      { label: "Purchase", tab: "purchase" },
      { label: "Sell / Issue", tab: "issue" },
      { label: "Accounts", tab: "acct_report" },
    ],
  };
}

function transportDash(academicYearCode?: string): ModuleDashboardModel {
  const t = loadTransport();
  const routes = t.routes.filter((r) => r.isActive !== false);
  const vehicles = t.vehicles.filter((v) => v.status === "active");
  const riders = (t.assignments ?? []).filter((a) =>
    inAcademicYear(a, academicYearCode),
  );
  const stopCount = routes.reduce((n, r) => n + (r.stops?.length ?? 0), 0);
  const byRoute = routes.map((r) => ({
    id: r.id,
    name: r.name || r.code,
    riders: riders.filter((a) => a.routeId === r.id).length,
    vehicle:
      vehicles.find((v) => v.id === r.vehicleId)?.registrationNo ||
      r.vehicleReg ||
      "—",
  }));
  return {
    title: "Transport",
    subtitle: `Session ${academicYearCode || "all"} · fleet, routes, and rider load.`,
    kpis: [
      {
        id: "routes",
        label: "Routes",
        value: String(routes.length),
        tone: "navy",
        tab: "routes",
        detailTitle: "Route load",
        detailColumns: [
          { key: "name", label: "Route" },
          { key: "riders", label: "Riders", align: "right" },
        ],
        detailRows: byRoute.map((r) => ({
          id: r.id,
          name: r.name,
          riders: r.riders,
        })),
      },
      {
        id: "vehicles",
        label: "Vehicles",
        value: String(vehicles.length),
        tone: "sky",
        tab: "fleet",
      },
      {
        id: "riders",
        label: "Riders",
        value: String(riders.length),
        tone: "teal",
        tab: "riders",
      },
      {
        id: "stops",
        label: "Stops",
        value: String(stopCount),
        tone: "gold",
        tab: "routes",
      },
    ],
    chartTitle: "Riders by route",
    chartSeries: byRoute.slice(0, 10).map((r) => ({
      label: r.name,
      value: r.riders,
    })),
    tableTitle: "Route board",
    tableColumns: [
      { key: "name", label: "Route" },
      { key: "vehicle", label: "Vehicle" },
      { key: "riders", label: "Riders", align: "right" },
    ],
    tableRows: byRoute,
    quickLinks: [
      { label: "Riders", tab: "riders" },
      { label: "Routes", tab: "routes" },
      { label: "Fleet", tab: "fleet" },
      { label: "Fuel", tab: "fuel" },
    ],
  };
}

function accountsDash(): ModuleDashboardModel {
  const state = loadAccounts();
  const snap = dashboardSnapshot(state);
  const todayBook = buildDayBook(todayIso());
  const bankTotal = totalBankBalancePaise(state);
  const openAp = listUnifiedPayables(state).filter((p) => p.status === "open");
  const vendorName = (vendorId: string) =>
    state.vendors.find((v) => v.id === vendorId)?.name || vendorId || "Payable";
  const days = lastNDays(7);
  const trend = days.map((d) => {
    const book = buildDayBook(d);
    return { label: dayLabel(d), value: Math.round(book.totalPaise / 100) };
  });
  return {
    title: "Accounts",
    subtitle: "Cash, banks, payables, and today’s books — finance command centre.",
    kpis: [
      {
        id: "today",
        label: "Today collection",
        value: formatInr(todayBook.totalPaise),
        hint: `${todayBook.receiptCount} receipt(s)`,
        tone: "green",
        tab: "daybook",
      },
      {
        id: "cash",
        label: "Cash in hand",
        value: formatInr(snap.cashInHandPaise),
        tone: "navy",
        tab: "cash",
      },
      {
        id: "bank",
        label: "Bank total",
        value: formatInr(bankTotal),
        tone: "sky",
        tab: "banks",
      },
      {
        id: "ap",
        label: "Open payables",
        value: formatInr(snap.openApPaise),
        hint: `${openAp.length} bill(s)`,
        tone: "coral",
        tab: "payables",
        detailTitle: "Open payables",
        detailColumns: [
          { key: "name", label: "Vendor" },
          { key: "amount", label: "Due", align: "right" },
        ],
        detailRows: openAp.slice(0, 40).map((p) => ({
          id: p.id,
          name: vendorName(p.vendorId),
          amount: formatInr(Math.max(0, p.amountPaise - p.paidPaise)),
        })),
      },
    ],
    chartTitle: "Collections — last 7 days (₹)",
    chartSeries: trend,
    tableTitle: "Bank accounts",
    tableColumns: [
      { key: "name", label: "Account" },
      { key: "bank", label: "Bank" },
      { key: "balance", label: "Balance", align: "right" },
    ],
    tableRows: state.bankAccounts
      .filter((b) => b.isActive)
      .map((b) => ({
        id: b.id,
        name: b.name,
        bank: b.bankName || "—",
        balance: formatInr(bankBalancePaise(b.id, state)),
      })),
    quickLinks: [
      { label: "Day book", tab: "daybook" },
      { label: "Cash", tab: "cash" },
      { label: "Banks", tab: "banks" },
      { label: "Reports", tab: "reports" },
      { label: "Fee Take", href: "/fees" },
    ],
  };
}

function trustDash(): ModuleDashboardModel {
  const trust = loadTrust();
  const projects = trust.projects ?? [];
  const works = trust.workItems ?? [];
  const materials = trust.materials ?? [];
  const labour = trust.labourEntries ?? [];
  const chart = projects.slice(0, 10).map((p) => ({
    label: p.name || p.code || "Project",
    value: works.filter((w) => w.projectId === p.id).length,
  }));
  return {
    title: "Trust",
    subtitle: "Capital works, materials, and labour for trust projects.",
    kpis: [
      {
        id: "projects",
        label: "Projects",
        value: String(projects.length),
        tone: "navy",
        tab: "projects",
      },
      {
        id: "works",
        label: "Works",
        value: String(works.length),
        tone: "teal",
        tab: "works",
      },
      {
        id: "materials",
        label: "Materials",
        value: String(materials.length),
        tone: "gold",
        tab: "materials",
      },
      {
        id: "labour",
        label: "Labour entries",
        value: String(labour.length),
        tone: "sky",
        tab: "labour",
      },
    ],
    chartTitle: "Works by project",
    chartSeries: chart.length ? chart : [{ label: "—", value: 0 }],
    tableTitle: "Projects",
    tableColumns: [
      { key: "name", label: "Project" },
      { key: "status", label: "Status" },
      { key: "works", label: "Works", align: "right" },
    ],
    tableRows: projects.slice(0, 40).map((p) => ({
      id: p.id,
      name: p.name || p.code,
      status: p.status || "—",
      works: works.filter((w) => w.projectId === p.id).length,
    })),
    quickLinks: [
      { label: "Projects", tab: "projects" },
      { label: "Works", tab: "works" },
      { label: "Materials", tab: "materials" },
    ],
  };
}

function feesDash(academicYearCode?: string): ModuleDashboardModel {
  return buildFeesDashboardModel(academicYearCode);
}

function attendanceDash(academicYearCode?: string): ModuleDashboardModel {
  const att = loadAttendance();
  const masters = loadMasters();
  const registers = (att.registers ?? []).filter((r) =>
    inAcademicYear(r, academicYearCode),
  );
  const today = todayIso();
  const todayRegs = registers.filter((r) => r.date === today);

  let stuPresent = 0;
  let stuAbsent = 0;
  let stuLeave = 0;
  let stuLate = 0;
  for (const r of todayRegs) {
    const s = summarizeMarks(r.marks || []);
    stuPresent += s.present;
    stuAbsent += s.absent;
    stuLeave += s.leave;
    stuLate += s.late;
  }

  const staffAtt = loadStaffAttendance();
  const staffRegisters = (staffAtt.registers ?? []).filter((r) =>
    inAcademicYear(r, academicYearCode),
  );
  const staffTodayRegs = staffRegisters.filter(
    (m) => m.date === today,
  );
  let staffPresent = 0;
  let staffAbsent = 0;
  let staffLeave = 0;
  let staffHalf = 0;
  for (const r of staffTodayRegs) {
    const counts = summarizeStaffMarks(r.marks || []);
    staffPresent += counts.P ?? 0;
    staffAbsent += counts.A ?? 0;
    staffLeave += counts.LE ?? 0;
    staffHalf += counts.HD ?? 0;
  }

  const days = lastNDays(7);
  const trend = days.map((d) => {
    let students = 0;
    for (const r of registers.filter((x) => x.date === d)) {
      students += summarizeMarks(r.marks || []).present;
    }
    let staff = 0;
    for (const r of staffRegisters.filter((x) => x.date === d)) {
      staff += summarizeStaffMarks(r.marks || []).P ?? 0;
    }
    return { label: dayLabel(d), value: students + staff };
  });

  const todayMix = [
    { label: "Students present", value: stuPresent, color: "#15803d" },
    { label: "Students absent", value: stuAbsent, color: "#c2410c" },
    { label: "Staff present", value: staffPresent, color: "#0f766e" },
    { label: "Staff absent", value: staffAbsent, color: "#9d174d" },
  ];

  const classRows = todayRegs.slice(0, 40).map((r) => {
    const s = summarizeMarks(r.marks || []);
    const cls = masters.classes.find((c) => c.id === r.classId);
    const sec = masters.sections.find((x) => x.id === r.sectionId);
    return {
      id: r.id,
      class: `${cls?.name || "Class"}${sec ? ` · ${sec.name}` : ""}`,
      present: s.present,
      absent: s.absent,
      leave: s.leave,
    };
  });

  const staffRows = staffTodayRegs.flatMap((r) =>
    (r.marks || []).slice(0, 60).map((m, i) => {
      const st = (masters.staff ?? []).find((s) => s.id === m.staffId);
      return {
        id: `${r.id}-${m.staffId || i}`,
        name: st?.fullName || m.staffId || "Staff",
        code: st?.empCode || "—",
        status: m.status || "—",
      };
    }),
  );

  return {
    title: "Attendance",
    subtitle: `Session ${academicYearCode || "all"} · student and staff presence tracked separately.`,
    kpis: [],
    kpiSections: [
      {
        id: "students",
        title: "Student attendance",
        hint: "Today’s class registers",
        kpis: [
          {
            id: "stu-present",
            label: "Present",
            value: String(stuPresent),
            hint: `${todayRegs.length} class register(s)`,
            tone: "green",
            tab: "students",
            detailTitle: "Students present by class",
            detailColumns: [
              { key: "class", label: "Class" },
              { key: "present", label: "Present", align: "right" },
            ],
            detailRows: classRows.map((r) => ({
              id: r.id,
              class: r.class,
              present: r.present,
            })),
          },
          {
            id: "stu-absent",
            label: "Absent",
            value: String(stuAbsent),
            tone: "coral",
            tab: "students",
            detailTitle: "Students absent by class",
            detailColumns: [
              { key: "class", label: "Class" },
              { key: "absent", label: "Absent", align: "right" },
            ],
            detailRows: classRows.map((r) => ({
              id: r.id,
              class: r.class,
              absent: r.absent,
            })),
          },
          {
            id: "stu-leave",
            label: "On leave",
            value: String(stuLeave),
            tone: "gold",
            tab: "leave",
          },
          {
            id: "stu-late",
            label: "Late",
            value: String(stuLate),
            tone: "sky",
            tab: "students",
          },
        ],
      },
      {
        id: "staff",
        title: "Staff attendance",
        hint: "Today’s staff day register",
        kpis: [
          {
            id: "staff-present",
            label: "Present",
            value: String(staffPresent),
            hint: `${staffTodayRegs.length} day register(s)`,
            tone: "teal",
            tab: "staff",
            detailTitle: "Staff marks today",
            detailColumns: [
              { key: "name", label: "Name" },
              { key: "code", label: "Emp code" },
              { key: "status", label: "Status" },
            ],
            detailRows: staffRows.filter((r) => r.status === "P"),
          },
          {
            id: "staff-absent",
            label: "Absent",
            value: String(staffAbsent),
            tone: "rose",
            tab: "staff",
            detailTitle: "Staff absent today",
            detailColumns: [
              { key: "name", label: "Name" },
              { key: "code", label: "Emp code" },
              { key: "status", label: "Status" },
            ],
            detailRows: staffRows.filter((r) => r.status === "A"),
          },
          {
            id: "staff-leave",
            label: "On leave",
            value: String(staffLeave),
            tone: "gold",
            tab: "staff",
          },
          {
            id: "staff-half",
            label: "Half day",
            value: String(staffHalf),
            tone: "navy",
            tab: "staff",
          },
        ],
      },
    ],
    chartTitle: "Today — students vs staff",
    chartSeries:
      todayMix.some((x) => x.value > 0)
        ? todayMix
        : trend.some((t) => t.value > 0)
          ? trend
          : [{ label: "—", value: 0 }],
    tableTitle: "Student registers today",
    tableColumns: [
      { key: "class", label: "Class / section" },
      { key: "present", label: "Present", align: "right" },
      { key: "absent", label: "Absent", align: "right" },
      { key: "leave", label: "Leave", align: "right" },
    ],
    tableRows: classRows,
    extraTables: [
      {
        title: "Staff marks today",
        columns: [
          { key: "name", label: "Staff" },
          { key: "code", label: "Emp code" },
          { key: "status", label: "Status" },
        ],
        rows: staffRows.slice(0, 40),
      },
    ],
    quickLinks: [
      { label: "Student register", tab: "students" },
      { label: "Staff register", tab: "staff" },
      { label: "Student leave", tab: "leave" },
      { label: "Student reports", tab: "student-reports" },
      { label: "Staff reports", tab: "staff-reports" },
    ],
  };
}

function homeworkDash(academicYearCode?: string): ModuleDashboardModel {
  const hw = loadHomework();
  const masters = loadMasters();
  const posts = (hw.posts ?? []).filter((p) =>
    inAcademicYear(p, academicYearCode),
  );
  const postIds = new Set(posts.map((p) => p.id));
  const subs = (hw.submissions ?? []).filter((s) => postIds.has(s.postId));
  const diary = (hw.diary ?? []).filter((d) =>
    inAcademicYear(d, academicYearCode),
  );
  const days = lastNDays(7);
  const trend = days.map((d) => ({
    label: dayLabel(d),
    value: posts.filter((p) => p.date === d).length,
  }));
  return {
    title: "Homework",
    subtitle: `Session ${academicYearCode || "all"} · assignments, diary, and submissions.`,
    kpis: [
      {
        id: "posts",
        label: "Assignments",
        value: String(posts.length),
        tone: "navy",
        tab: "compose",
      },
      {
        id: "today",
        label: "Today’s posts",
        value: String(posts.filter((p) => p.date === todayIso()).length),
        tone: "teal",
        tab: "today",
      },
      {
        id: "subs",
        label: "Submissions",
        value: String(subs.length),
        tone: "sky",
        tab: "submissions",
      },
      {
        id: "diary",
        label: "Diary entries",
        value: String(diary.length),
        tone: "gold",
        tab: "diary",
      },
    ],
    chartTitle: "Assignments — last 7 days",
    chartSeries: trend,
    tableTitle: "Recent assignments",
    tableColumns: [
      { key: "title", label: "Title" },
      { key: "date", label: "Date" },
      { key: "class", label: "Class" },
    ],
    tableRows: [...posts]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30)
      .map((p) => {
        const cls = masters.classes.find((c) => c.id === p.classId);
        return {
          id: p.id,
          title: p.title || "Homework",
          date: p.date || "—",
          class: cls?.name || "—",
        };
      }),
    quickLinks: [
      { label: "Today", tab: "today" },
      { label: "Compose", tab: "compose" },
      { label: "Diary", tab: "diary" },
      { label: "Submissions", tab: "submissions" },
    ],
  };
}

function ptmDash(academicYearCode?: string): ModuleDashboardModel {
  const ptm = loadPtm();
  const events = (ptm.events ?? []).filter((e) =>
    inAcademicYear(e, academicYearCode),
  );
  const eventIds = new Set(events.map((e) => e.id));
  const slots = (ptm.slots ?? []).filter((s) => eventIds.has(s.eventId));
  const bookings = (ptm.bookings ?? []).filter((b) =>
    eventIds.has(b.eventId),
  );
  const bookingIds = new Set(bookings.map((b) => b.id));
  const feedback = (ptm.feedback ?? []).filter((f) =>
    bookingIds.has(f.bookingId),
  );
  const chart = events.slice(0, 10).map((e) => ({
    label: e.name || e.date || "Event",
    value: bookings.filter((b) => b.eventId === e.id).length,
  }));
  return {
    title: "PTM",
    subtitle: `Session ${academicYearCode || "all"} · meetings, slots, and feedback.`,
    kpis: [
      {
        id: "events",
        label: "Events",
        value: String(events.length),
        tone: "navy",
        tab: "events",
      },
      {
        id: "slots",
        label: "Slots",
        value: String(slots.length),
        tone: "teal",
        tab: "slots",
      },
      {
        id: "bookings",
        label: "Bookings",
        value: String(bookings.length),
        tone: "sky",
        tab: "bookings",
      },
      {
        id: "feedback",
        label: "Feedback",
        value: String(feedback.length),
        tone: "gold",
        tab: "feedback",
      },
    ],
    chartTitle: "Bookings by event",
    chartSeries: chart.length ? chart : [{ label: "—", value: 0 }],
    tableTitle: "Upcoming / recent events",
    tableColumns: [
      { key: "title", label: "Event" },
      { key: "date", label: "Date" },
      { key: "bookings", label: "Bookings", align: "right" },
    ],
    tableRows: events.slice(0, 30).map((e) => ({
      id: e.id,
      title: e.name || "PTM",
      date: e.date || "—",
      bookings: bookings.filter((b) => b.eventId === e.id).length,
    })),
    quickLinks: [
      { label: "Events", tab: "events" },
      { label: "Slots", tab: "slots" },
      { label: "Bookings", tab: "bookings" },
    ],
  };
}

function vaultDash(): ModuleDashboardModel {
  const vault = loadVault();
  const docs = vault.documents ?? [];
  const today = todayIso();
  const expiring = docs.filter((d) => {
    if (!d.expiresOn) return false;
    const rem = d.reminderDays ?? 30;
    const due = new Date(`${d.expiresOn}T12:00:00`);
    const start = new Date(`${today}T12:00:00`);
    const diff = Math.ceil((due.getTime() - start.getTime()) / 86400000);
    return diff <= rem;
  });
  const byType = new Map<string, number>();
  for (const d of docs) {
    const label =
      VAULT_DOC_TYPES.find((t) => t.id === d.docType)?.label || d.docType;
    byType.set(label, (byType.get(label) ?? 0) + 1);
  }
  const typeRows = [...byType.entries()]
    .map(([name, count]) => ({ id: name, name, count }))
    .sort((a, b) => b.count - a.count);
  return {
    title: "Vault",
    subtitle: "Compliance documents and expiry alerts.",
    kpis: [
      {
        id: "docs",
        label: "Documents",
        value: String(docs.length),
        tone: "navy",
        tab: "documents",
      },
      {
        id: "alerts",
        label: "Expiring soon",
        value: String(expiring.length),
        tone: "coral",
        tab: "alerts",
      },
      {
        id: "types",
        label: "Doc types",
        value: String(typeRows.length),
        tone: "teal",
        tab: "documents",
      },
      {
        id: "add",
        label: "Add new",
        value: "+",
        hint: "Upload or register",
        tone: "gold",
        tab: "add",
      },
    ],
    chartTitle: "Documents by type",
    chartSeries: typeRows.slice(0, 10).map((r) => ({
      label: r.name,
      value: Number(r.count),
    })),
    tableTitle: "Expiry watchlist",
    tableColumns: [
      { key: "title", label: "Document" },
      { key: "type", label: "Type" },
      { key: "due", label: "Expires" },
    ],
    tableRows: expiring.slice(0, 30).map((a) => ({
      id: a.id,
      title: a.title || "Document",
      type:
        VAULT_DOC_TYPES.find((t) => t.id === a.docType)?.label || a.docType,
      due: a.expiresOn || "—",
    })),
    quickLinks: [
      { label: "Alerts", tab: "alerts" },
      { label: "Documents", tab: "documents" },
      { label: "Add", tab: "add" },
      { label: "Reports", tab: "reports" },
    ],
  };
}

function modulesDash(): ModuleDashboardModel {
  loadModuleRegistry();
  const rows = REGISTRY_MODULES.map((m) => ({
    id: m.id,
    name: m.label,
    status: isModuleEnabled(m.id) ? "Enabled" : "Disabled",
    blurb: m.blurb,
  }));
  const enabled = rows.filter((r) => r.status === "Enabled").length;
  return {
    title: "Modules",
    subtitle: "Optional product modules for this tenant.",
    kpis: [
      {
        id: "catalog",
        label: "In catalog",
        value: String(rows.length),
        tone: "navy",
      },
      {
        id: "on",
        label: "Enabled",
        value: String(enabled),
        tone: "green",
      },
      {
        id: "off",
        label: "Disabled",
        value: String(rows.length - enabled),
        tone: "slate",
      },
      {
        id: "home",
        label: "Home hub",
        value: "→",
        hint: "Back to modules map",
        tone: "gold",
      },
    ],
    chartTitle: "Enablement",
    chartSeries: [
      { label: "Enabled", value: enabled },
      { label: "Disabled", value: Math.max(0, rows.length - enabled) },
    ],
    tableTitle: "Module registry",
    tableColumns: [
      { key: "name", label: "Module" },
      { key: "status", label: "Status" },
      { key: "blurb", label: "Notes" },
    ],
    tableRows: rows,
    quickLinks: [{ label: "Home", href: "/home" }],
  };
}

function payrollDash(academicYearCode?: string): ModuleDashboardModel {
  const pay = loadPayroll();
  const runs = (pay.runs ?? []).filter((r) =>
    inAcademicYear(r, academicYearCode),
  );
  const draft = runs.filter((r) => r.status === "draft").length;
  const approved = runs.filter(
    (r) => r.status === "approved" || r.status === "posted",
  ).length;
  const paid = runs.filter((r) => r.status === "paid").length;
  const chart = runs.slice(-10).map((r) => ({
    label: r.month || r.id.slice(-6),
    value: Math.round(runNetPaise(r.lines) / 100),
  }));
  return {
    title: "Payroll",
    subtitle: `Session ${academicYearCode || "all"} · salary runs, approvals, and net payouts.`,
    kpis: [
      {
        id: "runs",
        label: "Runs",
        value: String(runs.length),
        tone: "navy",
        tab: "runs",
      },
      {
        id: "draft",
        label: "Draft",
        value: String(draft),
        tone: "gold",
        tab: "runs",
      },
      {
        id: "approved",
        label: "Approved",
        value: String(approved),
        tone: "teal",
        tab: "approvals",
      },
      {
        id: "paid",
        label: "Paid",
        value: String(paid),
        tone: "green",
        tab: "runs",
      },
    ],
    chartTitle: "Net payout by run (₹)",
    chartSeries: chart.length ? chart : [{ label: "—", value: 0 }],
    tableTitle: "Recent runs",
    tableColumns: [
      { key: "period", label: "Period" },
      { key: "status", label: "Status" },
      { key: "net", label: "Net", align: "right" },
    ],
    tableRows: [...runs]
      .reverse()
      .slice(0, 30)
      .map((r) => ({
        id: r.id,
        period: r.month || r.id,
        status: r.status,
        net: formatInr(runNetPaise(r.lines)),
      })),
    quickLinks: [
      { label: "Runs", tab: "runs" },
      { label: "Approvals", tab: "approvals" },
      { label: "Holds", tab: "holds" },
      { label: "Reports", tab: "reports" },
    ],
  };
}

function examsDash(academicYearCode?: string): ModuleDashboardModel {
  const exams = loadExams();
  const terms = (exams.terms ?? []).filter(
    (t) => t.isActive !== false && inAcademicYear(t, academicYearCode),
  );
  const sheets = (exams.sheets ?? []).filter((s) =>
    inAcademicYear(s, academicYearCode),
  );
  const promotions = (exams.promotions ?? []).filter((p) =>
    inAcademicYear(p, academicYearCode),
  );
  const chart = terms.slice(0, 10).map((t) => ({
    label: t.label || t.code,
    value: sheets.filter((m) => m.examTermId === t.id).length,
  }));
  return {
    title: "Exams",
    subtitle: `Session ${academicYearCode || "all"} · terms, marks, and result publishing.`,
    kpis: [
      {
        id: "terms",
        label: "Terms",
        value: String(terms.length),
        tone: "navy",
        tab: "setup",
      },
      {
        id: "marks",
        label: "Mark sheets",
        value: String(sheets.length),
        tone: "teal",
        tab: "marks",
      },
      {
        id: "promotions",
        label: "Promotions",
        value: String(promotions.length),
        tone: "sky",
        tab: "results",
      },
      {
        id: "reports",
        label: "Report cards",
        value: "→",
        hint: "Print gated by holds",
        tone: "gold",
        tab: "reports",
      },
    ],
    chartTitle: "Mark sheets by term",
    chartSeries: chart.length ? chart : [{ label: "—", value: 0 }],
    tableTitle: "Exam terms",
    tableColumns: [
      { key: "label", label: "Term" },
      { key: "code", label: "Code" },
      { key: "max", label: "Max", align: "right" },
    ],
    tableRows: terms.slice(0, 30).map((t) => ({
      id: t.id,
      label: t.label,
      code: t.code,
      max: t.maxMarks,
    })),
    quickLinks: [
      { label: "Marks", tab: "marks" },
      { label: "Reports", tab: "reports" },
      { label: "Results", tab: "results" },
      { label: "Setup", tab: "setup" },
    ],
  };
}

function certificatesDash(academicYearCode?: string): ModuleDashboardModel {
  const certs = loadCertificates();
  const issues = (certs.issues ?? []).filter((i) =>
    inAcademicYear(i, academicYearCode),
  );
  const byType = new Map<string, number>();
  for (const c of issues) {
    const t = c.kind || "Certificate";
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const typeRows = [...byType.entries()]
    .map(([name, count]) => ({ id: name, name, count }))
    .sort((a, b) => b.count - a.count);
  return {
    title: "Certificates",
    subtitle: `Session ${academicYearCode || "all"} · issued certificates and template usage.`,
    kpis: [
      {
        id: "issued",
        label: "Issued",
        value: String(issues.length),
        tone: "navy",
      },
      {
        id: "types",
        label: "Types used",
        value: String(typeRows.length),
        tone: "teal",
      },
      {
        id: "today",
        label: "Today",
        value: String(issues.filter((c) => c.issuedOn === todayIso()).length),
        tone: "green",
      },
      {
        id: "issue",
        label: "Issue new",
        value: "+",
        hint: "Open certificate desk",
        tone: "gold",
      },
    ],
    chartTitle: "By certificate type",
    chartSeries: typeRows.slice(0, 10).map((r) => ({
      label: r.name,
      value: Number(r.count),
    })),
    tableTitle: "Recent issues",
    tableColumns: [
      { key: "student", label: "Student" },
      { key: "type", label: "Type" },
      { key: "date", label: "Date" },
    ],
    tableRows: [...issues]
      .reverse()
      .slice(0, 30)
      .map((c) => ({
        id: c.id,
        student: c.studentName || c.studentId || "—",
        type: c.kind || "—",
        date: c.issuedOn || "—",
      })),
  };
}

function reportsDash(): ModuleDashboardModel {
  const recent = loadReportsCenterRecent();
  const byModule = new Map<string, number>();
  for (const r of recent) {
    const m = r.moduleId || "Other";
    byModule.set(m, (byModule.get(m) ?? 0) + 1);
  }
  const modRows = [...byModule.entries()]
    .map(([name, count]) => ({ id: name, name, count }))
    .sort((a, b) => b.count - a.count);
  return {
    title: "Reports",
    subtitle: "Cross-module report centre — recent runs and hot modules.",
    kpis: [
      {
        id: "recent",
        label: "Recent runs",
        value: String(recent.length),
        tone: "navy",
        tab: "recent",
      },
      {
        id: "modules",
        label: "Modules touched",
        value: String(modRows.length),
        tone: "teal",
        tab: "catalog",
      },
      {
        id: "catalog",
        label: "Catalog",
        value: "→",
        hint: "Browse all reports",
        tone: "gold",
        tab: "catalog",
      },
      {
        id: "export",
        label: "With link",
        value: String(recent.filter((r) => r.href).length),
        tone: "sky",
        tab: "recent",
      },
    ],
    chartTitle: "Recent runs by module",
    chartSeries: modRows.slice(0, 10).map((r) => ({
      label: r.name,
      value: Number(r.count),
    })),
    tableTitle: "Recent report runs",
    tableColumns: [
      { key: "name", label: "Report" },
      { key: "module", label: "Module" },
      { key: "when", label: "When" },
    ],
    tableRows: recent.slice(0, 30).map((r) => ({
      id: r.key,
      name: r.label || r.reportId || "Report",
      module: r.moduleId || "—",
      when: (r.at || "").slice(0, 16).replace("T", " ") || "—",
    })),
    quickLinks: [
      { label: "Catalog", tab: "catalog" },
      { label: "Recent", tab: "recent" },
    ],
  };
}

function fieldDash(academicYearCode?: string): ModuleDashboardModel {
  const drafts = loadOfflineQueue();
  const loaded = loadAdmissions();
  const adm = {
    ...loaded,
    leads: loaded.leads.filter((l) => inAcademicYear(l, academicYearCode)),
  };
  const surveyLeads = adm.leads.filter((l) => l.source === "field_survey").length;
  const funnel = funnelCounts(adm);
  return {
    title: "Field",
    subtitle: `Session ${academicYearCode || "all"} · survey, capture, and admissions calling.`,
    kpis: [
      {
        id: "survey",
        label: "Survey leads",
        value: String(surveyLeads),
        tone: "navy",
        tab: undefined,
      },
      {
        id: "drafts",
        label: "Offline drafts",
        value: String(drafts.length),
        tone: "gold",
      },
      {
        id: "synced",
        label: "Pipeline open",
        value: String(
          (funnel.enquiry || 0) + (funnel.applied || 0) + (funnel.verified || 0),
        ),
        tone: "green",
      },
      {
        id: "enrolled",
        label: "Enrolled",
        value: String(funnel.enrolled || 0),
        tone: "teal",
      },
    ],
    chartTitle: "Funnel snapshot",
    chartSeries: ADMISSION_STAGES.map((s) => ({
      label: s.label,
      value: funnel[s.value as AdmissionStage] || 0,
    })),
    tableTitle: "Jump to field tools",
    tableColumns: [
      { key: "name", label: "Tool" },
      { key: "path", label: "Path" },
    ],
    tableRows: [
      { id: "1", name: "Survey", path: "/field/survey" },
      { id: "2", name: "Capture", path: "/field/capture" },
      { id: "3", name: "Calling", path: "/field/calling" },
      { id: "4", name: "Register", path: "/field/register" },
    ],
    quickLinks: [
      { label: "Survey app", href: "/field/survey" },
      { label: "Capture", href: "/field/capture" },
      { label: "Calling", href: "/field/calling" },
      { label: "Admissions", href: "/admissions" },
    ],
  };
}

function studentLeaveDash(academicYearCode?: string): ModuleDashboardModel {
  const leave = loadStudentLeave();
  const sis = loadSis();
  const reqs = (leave.requests ?? []).filter((r) =>
    inAcademicYear(r, academicYearCode),
  );
  const pending = reqs.filter((r) => r.status === "pending").length;
  const approved = reqs.filter((r) => r.status === "approved").length;
  const rejected = reqs.filter((r) => r.status === "rejected").length;
  const days = lastNDays(7);
  const trend = days.map((d) => ({
    label: dayLabel(d),
    value: reqs.filter((r) => (r.fromDate || r.createdAt || "").slice(0, 10) === d)
      .length,
  }));
  return {
    title: "Student leave",
    subtitle: `Session ${academicYearCode || "all"} · parent requests and approval queues.`,
    kpis: [
      {
        id: "all",
        label: "Requests",
        value: String(reqs.length),
        tone: "navy",
      },
      {
        id: "pending",
        label: "Pending",
        value: String(pending),
        tone: "coral",
      },
      {
        id: "approved",
        label: "Approved",
        value: String(approved),
        tone: "green",
      },
      {
        id: "rejected",
        label: "Rejected",
        value: String(rejected),
        tone: "slate",
      },
    ],
    chartTitle: "Requests — last 7 days",
    chartSeries: trend,
    tableTitle: "Recent requests",
    tableColumns: [
      { key: "student", label: "Student" },
      { key: "status", label: "Status" },
      { key: "from", label: "From" },
    ],
    tableRows: [...reqs]
      .reverse()
      .slice(0, 30)
      .map((r) => {
        const st = sis.students.find((s) => s.id === r.studentId);
        return {
          id: r.id,
          student: st?.fullName || r.studentId || "—",
          status: r.status,
          from: r.fromDate || "—",
        };
      }),
  };
}

function purchaseDash(academicYearCode?: string): ModuleDashboardModel {
  const purchase = loadPurchase();
  const pos = (purchase.orders ?? []).filter((o) =>
    inAcademicYear(o, academicYearCode),
  );
  const poIds = new Set(pos.map((o) => o.id));
  const grns = (purchase.grns ?? []).filter((g) => poIds.has(g.poId));
  const indents = (purchase.indents ?? []).filter((i) =>
    inAcademicYear(i, academicYearCode),
  );
  const chart = lastNDays(7).map((d) => ({
    label: dayLabel(d),
    value: grns.filter((g) => g.date === d).length,
  }));
  return {
    title: "Purchase",
    subtitle: `Session ${academicYearCode || "all"} · indents, POs, and GRN receipts.`,
    kpis: [
      {
        id: "indents",
        label: "Indents",
        value: String(indents.length),
        tone: "navy",
      },
      {
        id: "pos",
        label: "POs",
        value: String(pos.length),
        tone: "teal",
      },
      {
        id: "grns",
        label: "GRNs",
        value: String(grns.length),
        tone: "sky",
      },
      {
        id: "store",
        label: "Store",
        value: "→",
        hint: "Open store purchase",
        tone: "gold",
      },
    ],
    chartTitle: "GRNs — last 7 days",
    chartSeries: chart,
    tableTitle: "Recent GRNs",
    tableColumns: [
      { key: "no", label: "GRN" },
      { key: "po", label: "PO" },
      { key: "date", label: "Date" },
    ],
    tableRows: [...grns]
      .reverse()
      .slice(0, 30)
      .map((g) => ({
        id: g.id,
        no: g.grnNo || g.id,
        po: g.poId || "—",
        date: g.date || "—",
      })),
    quickLinks: [{ label: "Store purchase", href: "/store?tab=purchase" }],
  };
}

export function buildModuleDashboard(
  moduleId: DashboardModuleId,
  opts?: { academicYearCode?: string },
): ModuleDashboardModel {
  try {
    switch (moduleId) {
      case "masters":
        return mastersDash(loadMasters(), opts?.academicYearCode);
      case "admissions":
        return admissionsDash(opts?.academicYearCode);
      case "students":
        return studentsDash(opts?.academicYearCode);
      case "staff":
        return staffDash(opts?.academicYearCode);
      case "store":
        return storeDash(opts?.academicYearCode);
      case "transport":
        return transportDash(opts?.academicYearCode);
      case "accounts":
        return accountsDash();
      case "trust":
        return trustDash();
      case "fees":
        return feesDash(opts?.academicYearCode);
      case "attendance":
        return attendanceDash(opts?.academicYearCode);
      case "homework":
        return homeworkDash(opts?.academicYearCode);
      case "ptm":
        return ptmDash(opts?.academicYearCode);
      case "vault":
        return vaultDash();
      case "modules":
        return modulesDash();
      case "payroll":
        return payrollDash(opts?.academicYearCode);
      case "exams":
        return examsDash(opts?.academicYearCode);
      case "certificates":
        return certificatesDash(opts?.academicYearCode);
      case "reports":
        return reportsDash();
      case "field":
        return fieldDash(opts?.academicYearCode);
      case "student_leave":
        return studentLeaveDash(opts?.academicYearCode);
      case "purchase":
        return purchaseDash(opts?.academicYearCode);
      default:
        return emptyModel("Dashboard", "Module overview");
    }
  } catch {
    return emptyModel("Dashboard", "Could not load live KPIs — try refreshing.");
  }
}

function normalizeSessionAy(code: string, fallback: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t || fallback;
}

/** Cross-module school home dashboard — aggregates live demo data. */
export function buildSchoolDashboard(
  academicYearCode?: string,
): ModuleDashboardModel {
  try {
    const masters = loadMasters();
    const ay = academicYearCode || currentAcademicYearCode(masters);
    const sessionAy = normalizeSessionAy(ay, ay);

    const sis = loadSis();
    const inSession = (s: (typeof sis.students)[number]) =>
      normalizeSessionAy(s.academicYearCode || ay, sessionAy) === sessionAy;
    const sessionStudents = sis.students.filter(inSession);
    const activeStudents = sessionStudents.filter((s) => s.status === "active");
    const male = activeStudents.filter((s) => s.gender === "M").length;
    const female = activeStudents.filter((s) => s.gender === "F").length;

    const feeKpi = computeFeeKpis({ academicYearCode: ay });

    const admissionsLoaded = loadAdmissions();
    const admissionsState = {
      ...admissionsLoaded,
      leads: admissionsLoaded.leads.filter((l) => inAcademicYear(l, ay)),
    };
    const funnel = funnelCounts(admissionsState);
    const fu = followUpCounts(admissionsState);
    const pipeline =
      admissionsState.leads.length -
      (funnel.enrolled || 0) -
      (funnel.lost || 0);

    const att = loadAttendance();
    const today = todayIso();
    const todayRegs = (att.registers ?? []).filter(
      (r) => inAcademicYear(r, ay) && r.date === today,
    );
    let stuPresent = 0;
    let stuAbsent = 0;
    let stuLeave = 0;
    for (const r of todayRegs) {
      const s = summarizeMarks(r.marks || []);
      stuPresent += s.present;
      stuAbsent += s.absent;
      stuLeave += s.leave;
    }
    const stuMarked = stuPresent + stuAbsent + stuLeave;
    const attPct = stuMarked
      ? Math.round((stuPresent / stuMarked) * 100)
      : 0;

    const staffList = masters.staff ?? [];
    const activeStaff = staffList.filter((s) => s.status === "active").length;

    const bankBal = totalBankBalancePaise(loadAccounts());
    const lowStock = listLowStockItems(loadStore()).length;

    const funnelChart = ADMISSION_STAGES.map((s) => ({
      label: s.label,
      value: funnel[s.value as AdmissionStage] || 0,
    })).filter((p) => p.value > 0);

    const feeChart = [
      {
        label: "Collected",
        value: Math.round(feeKpi.collectedPaise / 100),
        color: "#15803d",
      },
      {
        label: "Open dues",
        value: Math.round(feeKpi.openPaise / 100),
        color: "#c2410c",
      },
      {
        label: "Arrears",
        value: Math.round(feeKpi.arrearsPaise / 100),
        color: "#c5a028",
      },
    ].filter((p) => p.value > 0);

    return {
      heroEyebrow: "School overview",
      title: TENANT.nameDisplay,
      subtitle: `Session ${sessionAy} · Tap a KPI to open the module. Charts default to rounded donuts.`,
      kpis: [],
      kpiSections: [
        {
          id: "people",
          title: "People & presence",
          hint: "Roster and today's student attendance",
          kpis: [
            {
              id: "students",
              label: "Active students",
              value: String(activeStudents.length),
              hint: `${male} boys · ${female} girls`,
              tone: "sky",
              href: "/students",
              detailTitle: "Gender split",
              detailColumns: [
                { key: "segment", label: "Segment" },
                { key: "count", label: "Count", align: "right" },
              ],
              detailRows: [
                { id: "m", segment: "Boys", count: male },
                { id: "f", segment: "Girls", count: female },
              ],
            },
            {
              id: "staff",
              label: "Active staff",
              value: String(activeStaff),
              tone: "slate",
              href: "/staff",
            },
            {
              id: "attendance",
              label: "Attendance today",
              value: stuMarked ? `${attPct}%` : "—",
              hint: stuMarked
                ? `${stuPresent} present · ${stuAbsent} absent · ${stuLeave} leave`
                : "No registers marked yet today",
              tone: "green",
              href: "/attendance",
            },
            {
              id: "households",
              label: "Households",
              value: String(sis.households?.length ?? 0),
              tone: "teal",
              href: "/students",
            },
          ],
        },
        {
          id: "growth",
          title: "Admissions & outreach",
          hint: "Pipeline health for this session",
          kpis: [
            {
              id: "pipeline",
              label: "Pipeline leads",
              value: String(Math.max(0, pipeline)),
              hint: `${funnel.enquiry || 0} enquiries · ${funnel.enrolled || 0} enrolled`,
              tone: "gold",
              href: "/admissions",
              detailTitle: "Funnel stages",
              detailColumns: [
                { key: "stage", label: "Stage" },
                { key: "count", label: "Count", align: "right" },
              ],
              detailRows: ADMISSION_STAGES.map((s) => ({
                id: s.value,
                stage: s.label,
                count: funnel[s.value as AdmissionStage] || 0,
              })),
            },
            {
              id: "followups",
              label: "Due follow-ups",
              value: String(fu.overdue + fu.dueToday),
              hint: `${fu.overdue} overdue · ${fu.dueToday} today`,
              tone: "coral",
              href: "/admissions",
            },
            {
              id: "enrolled",
              label: "Enrolled",
              value: String(funnel.enrolled || 0),
              tone: "green",
              href: "/admissions",
            },
            {
              id: "field",
              label: "Field queue",
              value: String(loadOfflineQueue().length),
              hint: "Pending offline survey sync",
              tone: "navy",
              href: "/field",
            },
          ],
        },
        {
          id: "finance",
          title: "Finance & store",
          hint: "Collections, dues, and cash position",
          kpis: [
            {
              id: "collected",
              label: "Fees collected",
              value: formatInr(feeKpi.collectedPaise),
              hint: `${feeKpi.collectionRatePct}% of demand`,
              tone: "green",
              href: "/fees",
            },
            {
              id: "dues",
              label: "Open dues",
              value: formatInr(feeKpi.openPaise),
              hint: `${feeKpi.studentsWithOpenDues} students`,
              tone: "coral",
              href: "/fees/defaulters",
            },
            {
              id: "today-fee",
              label: "Collected today",
              value: formatInr(feeKpi.todayCollectedPaise),
              tone: "navy",
              href: "/fees",
            },
            {
              id: "bank",
              label: "Bank balance",
              value: formatInr(bankBal),
              tone: "teal",
              href: "/accounts",
            },
            {
              id: "low-stock",
              label: "Low stock SKUs",
              value: String(lowStock),
              tone: "gold",
              href: "/store",
            },
          ],
        },
      ],
      chartTitle: "Fee position (₹)",
      chartSeries: feeChart.length
        ? feeChart
        : [{ label: "No dues data", value: 0 }],
      chartDefaultView: "pie",
      extraCharts: [
        {
          title: "Students by gender",
          series:
            male + female > 0
              ? [
                  { label: "Boys", value: male, color: "#0284c7" },
                  { label: "Girls", value: female, color: "#9d174d" },
                ]
              : [{ label: "—", value: 0 }],
          defaultView: "pie",
        },
        {
          title: "Admission funnel",
          series: funnelChart.length
            ? funnelChart
            : [{ label: "—", value: 0 }],
          defaultView: "pie",
        },
      ],
      tableTitle: "Today's class registers",
      tableColumns: [
        { key: "class", label: "Class" },
        { key: "present", label: "Present", align: "right" },
        { key: "absent", label: "Absent", align: "right" },
      ],
      tableRows: todayRegs.slice(0, 12).map((r) => {
        const s = summarizeMarks(r.marks || []);
        const cls = masters.classes.find((c) => c.id === r.classId);
        const sec = masters.sections.find((x) => x.id === r.sectionId);
        return {
          id: r.id,
          class: `${cls?.name || "Class"}${sec ? ` · ${sec.name}` : ""}`,
          present: s.present,
          absent: s.absent,
        };
      }),
      quickLinks: [
        { label: "Fee Take", href: "/fees" },
        { label: "Students", href: "/students" },
        { label: "Admissions", href: "/admissions" },
        { label: "Accounts", href: "/accounts" },
        { label: "Reports", href: "/reports" },
      ],
    };
  } catch {
    return emptyModel(
      TENANT.nameDisplay,
      "Could not load school KPIs — try refreshing.",
    );
  }
}
