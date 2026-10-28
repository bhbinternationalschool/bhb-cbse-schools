/**
 * Every module screen's tab list, for the RBAC completeness self-test
 * (lib/rbacCatalogCompleteness.selftest.ts).
 *
 * Director, 12 Oct 2026: "proper RBAC — every function of every module
 * grantable, like the old ERP". A tab no function lists can only be opened
 * by the whole module, which is how App pop-ups and Parents on app ended up
 * out of the office's reach. Each entry here names the file and the type (or
 * const) its tabs are declared in; the self-test reads that declaration from
 * the source, so a tab added to the screen without a function — or without
 * an explicit whole-module exemption with a reason — fails CI.
 *
 * Pure data: no imports beyond types, safe for the role editor to read.
 */
import type { RbacModule } from "@/lib/rbac";

export type RbacScreenTabs = {
  /** The page path, for messages and the role editor. */
  screen: string;
  /** Path under apps/web/src. */
  file: string;
  /** A string-literal union type alias declaring the tab ids … */
  tabType?: string;
  /** … or a const array of `{ id: "…" }` items. */
  tabList?: string;
  /** The module a tab belongs to unless `tabModules` says otherwise. */
  module: RbacModule;
  /** Tabs of another module shown on this screen. */
  tabModules?: Record<string, RbacModule>;
  /**
   * Masters only: tabs resolve through moduleForMastersTab /
   * canAccessMastersTab rather than canSeeModuleTab.
   */
  masters?: boolean;
  /**
   * The file gates its tabs through visibleModuleTabs / canSeeModuleTab /
   * canWriteModuleTab / canAccessMastersTab. False only where the gate lives
   * in a parent file (named in `gatedBy`).
   */
  gatedBy?: string;
};

export const RBAC_SCREEN_TABS: RbacScreenTabs[] = [
  /* ── Money ── */
  { screen: "/fees", file: "components/fees/FeeTakeWorkspace.tsx", tabType: "Tab", module: "fees" },
  { screen: "/fees/defaulters", file: "components/fees/DefaultersTabs.tsx", tabType: "Tab", module: "fees" },
  { screen: "/fees/tools", file: "components/fees/FeeToolsTabs.tsx", tabType: "Tab", module: "fees" },
  { screen: "/accounts", file: "components/accounts/AccountsWorkspace.tsx", tabList: "TABS", module: "accounts" },
  { screen: "/trust", file: "components/trust/TrustWorkspace.tsx", tabList: "TABS", module: "trust" },
  {
    screen: "/payroll",
    file: "components/payroll/PayrollWorkspace.tsx",
    tabType: "PayTab",
    module: "payroll",
    tabModules: { advances: "staff_advances" },
  },
  { screen: "/store", file: "components/inventory/InventoryWorkspace.tsx", tabList: "TABS", module: "store" },
  { screen: "/library", file: "components/library/LibraryWorkspace.tsx", tabList: "TABS", module: "store" },
  { screen: "/vault", file: "components/vault/VaultWorkspace.tsx", tabList: "TABS", module: "vault" },

  /* ── People ── */
  {
    screen: "/students",
    file: "components/students/StudentsWorkspace.tsx",
    tabList: "STUDENT_TABS",
    module: "students",
    tabModules: { udise: "compliance" },
  },
  {
    screen: "/admissions",
    file: "components/admissions/AdmissionsWorkspace.tsx",
    tabList: "ADM_TABS",
    module: "admissions",
    tabModules: { rte: "rte" },
  },
  { screen: "/rte", file: "components/rte/RteWorkspace.tsx", tabList: "TABS", module: "rte" },
  { screen: "/staff", file: "components/staff/StaffWorkspace.tsx", tabList: "STAFF_TABS", module: "staff" },
  { screen: "/certificates", file: "components/certificates/CertificatesWorkspace.tsx", tabType: "Tab", module: "certificates" },
  { screen: "/id-cards", file: "components/idCards/IdCardsWorkspace.tsx", tabList: "TABS", module: "id_cards" },

  /* ── Academics ── */
  {
    screen: "/attendance",
    file: "components/attendance/AttendanceWorkspace.tsx",
    tabType: "AttTab",
    module: "attendance",
    tabModules: { leave: "student_leave" },
  },
  {
    screen: "/attendance?tab=leave",
    file: "components/studentLeave/StudentLeaveWorkspace.tsx",
    tabType: "LeaveTab",
    module: "student_leave",
  },
  { screen: "/exams", file: "components/exams/ExamsWorkspace.tsx", tabList: "EXAM_TABS", module: "exams" },
  { screen: "/homework", file: "components/homework/HomeworkWorkspace.tsx", tabList: "TABS", module: "homework" },
  { screen: "/timetable", file: "components/timetable/TimetableWorkspace.tsx", tabList: "TIMETABLE_TABS", module: "timetable" },
  { screen: "/ptm", file: "components/ptm/PtmWorkspace.tsx", tabList: "TAB_ITEMS", module: "ptm" },
  { screen: "/teaching", file: "components/teaching/TeachingWorkspace.tsx", tabType: "TeachTab", module: "teaching" },

  /* ── Comms ── */
  {
    screen: "/comms",
    file: "components/comms/CommsWorkspace.tsx",
    tabList: "TABS",
    module: "notices",
    tabModules: {
      news: "news",
      gallery: "gallery",
      whatsapp: "notifications",
      inbox: "notifications",
      answers: "wa_chatbot",
    },
  },
  {
    screen: "/comms?tab=whatsapp",
    file: "components/comms/WaWorkspacePanel.tsx",
    tabList: "TABS",
    module: "notices",
    tabModules: {
      send: "notifications",
      relay: "notifications",
      delivered: "wa_automation",
      numbers: "wa_automation",
      cost: "wa_automation",
    },
  },
  { screen: "/website", file: "components/website/WebsiteWorkspace.tsx", tabList: "TABS", module: "website" },
  { screen: "/events", file: "components/events/EventsWorkspace.tsx", tabList: "TAB_ITEMS", module: "events" },

  /* ── Campus, transport, masters ── */
  { screen: "/transport", file: "components/transport/TransportWorkspace.tsx", tabList: "TABS", module: "transport" },
  { screen: "/visitors", file: "components/visitors/VisitorsWorkspace.tsx", tabType: "Tab", module: "visitors" },
  { screen: "/complaints", file: "components/complaints/ComplaintsWorkspace.tsx", tabList: "TABS", module: "complaints" },
  { screen: "/discipline", file: "components/discipline/DisciplineWorkspace.tsx", tabList: "TABS", module: "discipline" },
  { screen: "/health", file: "components/health/HealthWorkspace.tsx", tabList: "TABS", module: "health" },
  { screen: "/masters", file: "components/masters/MastersWorkspace.tsx", tabType: "Tab", module: "masters", masters: true },
];
