import type { RbacFeatureDef, RbacWholeModuleTab } from "@/lib/rbacFeatureCatalog/types";

/**
 * Payroll and staff advances (split out of money.ts, 12 Oct 2026). The
 * money rule in money.ts holds here: payroll-desk, statutory-desk and the
 * salary books stay module-level for writes — a function works through a
 * dedicated route with its own server check, or reads.
 */
export const PAYROLL_FEATURES: RbacFeatureDef[] = [
  /* ── Payroll ─────────────────────────────────────────────────────── */
  {
    id: "payroll.payslips",
    module: "payroll",
    group: "Process salary",
    label: "Payroll runs & payslips (read only)",
    blurb: "See approved payslips, print them and read the payroll reports.",
    actions: ["view", "export"],
    // Owns both payroll-desk keys so its reader gets the whole desk; it is
    // view-only, and the desk POST stays module-level. The Runs and Run
    // detail tabs generate and edit runs, so they are not opened here.
    slices: ["runs", "audit"],
    tabs: ["payslips", "print", "reports"],
  },
  {
    id: "payroll.audit",
    module: "payroll",
    group: "Reports",
    label: "Payroll audit log (read only)",
    blurb: "Who created, approved, published, recalled or paid each payroll run. Changes nothing.",
    actions: ["view"],
    // The payroll-desk GET serves a function reader only the whole desk
    // (both keys), never part of it; the POST stays module-level.
    slices: ["runs", "audit"],
    tabs: ["audit"],
  },
];

/** Tabs of these modules that only the whole-module grant opens, and why. */
export const PAYROLL_WHOLE_MODULE_TABS: RbacWholeModuleTab[] = [
  {
    module: "payroll",
    tab: "dashboard",
    reason: "Aggregates payroll runs with EPF/ESIC remittances; the statutory desk is read module-level, so a function would see wrong zeros.",
  },
  {
    module: "payroll",
    tab: "runs",
    reason: "Generates the month's pay run and saves it to the payroll desk, whose writes stay module-level (money rule); no function-scoped route.",
  },
  {
    module: "payroll",
    tab: "detail",
    reason: "Edits staff pay lines and submits the run through the payroll desk save, module-level by the money rule; no function-scoped route.",
  },
  {
    module: "payroll",
    tab: "approvals",
    reason: "Approves pay runs and increment batches inside the payroll desk and salary_increment book with no server check of its own.",
  },
  {
    module: "payroll",
    tab: "holds",
    reason: "June holds and their release live in the salary_hold book, saved whole with no server check; a book-level function would be the module.",
  },
  {
    module: "payroll",
    tab: "govt",
    reason: "EPF/ESIC remittances (mark paid, challan uploads) are saved to the statutory desk, which stays module-level for reads and writes.",
  },
  {
    module: "payroll",
    tab: "increment",
    reason: "Increments and their approval/applied state live in the salary_increment book, saved whole with no server check (money rule).",
  },
  {
    module: "payroll",
    tab: "bank",
    reason: "Needs every staff bank account (salary_account book) and holds the Cashfree payout switch that sends salary — module-level only.",
  },
  {
    module: "payroll",
    tab: "tally",
    reason: "Reads the salary account book and writes the accounts module's Tally sync book when a month is marked synced; no function route.",
  },
  {
    module: "staff_advances",
    tab: "advances",
    reason: "Staff advances are one desk-slice key saved whole; a function would be the whole module, and staff_advances is already that grant.",
  },
  {
    module: "payroll",
    tab: "mine",
    reason: "The person's own payslips — open to every staff member by canAccessHref and scoped to their own staff id, not a grantable function.",
  },
  {
    module: "payroll",
    tab: "myAdvances",
    reason: "The person's own advances and recoveries — open to every staff member by canAccessHref and filtered to their own staff id.",
  },
];
