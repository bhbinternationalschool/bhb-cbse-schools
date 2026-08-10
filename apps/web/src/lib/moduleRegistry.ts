import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

/**
 * Tenant feature / module registry (§24.0).
 * Demo store: localStorage `bhb_module_registry_v1`.
 * Home hub + universal search hide modules when disabled.
 */

const STORAGE_KEY = "bhb_module_registry_v1";

export type RegistryModuleId =
  | "home"
  | "masters"
  | "admissions"
  | "field"
  | "students"
  | "staff"
  | "store"
  | "library"
  | "purchase"
  | "transport"
  | "accounts"
  | "trust"
  | "fees"
  | "defaulters"
  | "attendance"
  | "homework"
  | "timetable"
  | "ptm"
  | "student_leave"
  | "vault"
  | "modules"
  | "payroll"
  | "exams"
  | "certificates"
  | "comms"
  | "reports"
  | "rte_ews"
  | "documents";

export type RegistryModuleGroup =
  | "setup"
  | "growth"
  | "people"
  | "academics"
  | "finance"
  | "campus"
  | "insights"
  | "optional";

export type RegistryModuleDef = {
  id: RegistryModuleId;
  label: string;
  blurb: string;
  href: string;
  group: RegistryModuleGroup;
  /** Product default when never configured */
  defaultEnabled: boolean;
  /** Cannot be turned off (control plane) */
  alwaysOn?: boolean;
};

export const REGISTRY_GROUPS: {
  id: RegistryModuleGroup;
  label: string;
}[] = [
  { id: "setup", label: "Setup & control" },
  { id: "growth", label: "Admissions & outreach" },
  { id: "people", label: "People" },
  { id: "academics", label: "Academics & parent touch" },
  { id: "finance", label: "Fees, store & finance" },
  { id: "campus", label: "Campus operations" },
  { id: "insights", label: "Insights" },
  { id: "optional", label: "Optional add-ons" },
];

export const REGISTRY_MODULES: RegistryModuleDef[] = [
  {
    id: "home",
    label: "Home hub",
    blurb: "School operations landing — always available",
    href: "/home",
    group: "setup",
    defaultEnabled: true,
    alwaysOn: true,
  },
  {
    id: "masters",
    label: "Masters",
    blurb: "Sessions, classes, fee heads, roles and school timings",
    href: "/masters",
    group: "setup",
    defaultEnabled: true,
  },
  {
    id: "modules",
    label: "Modules",
    blurb: "Enable / disable product modules for this tenant",
    href: "/modules",
    group: "setup",
    defaultEnabled: true,
    alwaysOn: true,
  },
  {
    id: "vault",
    label: "Document vault",
    blurb: "NOC, affiliation and expiry alerts",
    href: "/vault",
    group: "setup",
    defaultEnabled: true,
  },
  {
    id: "admissions",
    label: "Admissions",
    blurb: "Enquiry CRM, registration and admission reports",
    href: "/admissions",
    group: "growth",
    defaultEnabled: true,
  },
  {
    id: "field",
    label: "Field app",
    blurb: "Lead capture, UPI collect, calling and survey",
    href: "/field",
    group: "growth",
    defaultEnabled: true,
  },
  {
    id: "rte_ews",
    label: "RTE / EWS / scholarship",
    blurb: "25% quota seats · applications · fee waivers (§21c)",
    href: "/admissions?tab=rte",
    group: "optional",
    defaultEnabled: false,
  },
  {
    id: "students",
    label: "Students",
    blurb: "SIS roster, UDISE, upgrades and student reports",
    href: "/students",
    group: "people",
    defaultEnabled: true,
  },
  {
    id: "staff",
    label: "Staff",
    blurb: "HR roster, leave, appraisal and payslips",
    href: "/staff",
    group: "people",
    defaultEnabled: true,
  },
  {
    id: "attendance",
    label: "Attendance",
    blurb: "Student / staff registers and presence reports",
    href: "/attendance",
    group: "academics",
    defaultEnabled: true,
  },
  {
    id: "student_leave",
    label: "Student leave",
    blurb: "Parent leave requests and approvals",
    href: "/student-leave",
    group: "academics",
    defaultEnabled: true,
  },
  {
    id: "homework",
    label: "Homework",
    blurb: "Class diary and parent portal feed",
    href: "/homework",
    group: "academics",
    defaultEnabled: true,
  },
  {
    id: "timetable",
    label: "Timetable",
    blurb: "Weekly grids and AI auto-assign from subject loads",
    href: "/timetable",
    group: "academics",
    defaultEnabled: true,
  },
  {
    id: "ptm",
    label: "PTM",
    blurb: "Parent–teacher meeting slots and feedback",
    href: "/ptm",
    group: "academics",
    defaultEnabled: true,
  },
  {
    id: "exams",
    label: "Exams",
    blurb: "Marks entry, results and promotion",
    href: "/exams",
    group: "academics",
    defaultEnabled: true,
  },
  {
    id: "certificates",
    label: "Certificates",
    blurb: "TC, bonafide, fee and character certificates",
    href: "/certificates",
    group: "academics",
    defaultEnabled: true,
  },
  {
    id: "documents",
    label: "Document maker",
    blurb: "AI letters & govt submissions EN/HI",
    href: "/documents",
    group: "optional",
    defaultEnabled: true,
  },
  {
    id: "library",
    label: "Library",
    blurb: "Book lending, issue/return and overdue fines",
    href: "/library",
    group: "finance",
    defaultEnabled: true,
  },
  {
    id: "fees",
    label: "Fee Take",
    blurb: "Counter collect, receipts, pay links and day close",
    href: "/fees",
    group: "finance",
    defaultEnabled: true,
  },
  {
    id: "defaulters",
    label: "Defaulters",
    blurb: "Overdue recovery playbook and WhatsApp nudges",
    href: "/fees/defaulters",
    group: "finance",
    defaultEnabled: true,
  },
  {
    id: "store",
    label: "Store",
    blurb: "Stock master, sell/issue, returns and store accounts",
    href: "/store",
    group: "finance",
    defaultEnabled: true,
  },
  {
    id: "purchase",
    label: "Purchase",
    blurb: "Indents, POs and GRN (also under Store)",
    href: "/store?tab=purchase",
    group: "finance",
    defaultEnabled: true,
  },
  {
    id: "accounts",
    label: "Accounts",
    blurb: "Cashbook, ledgers, trial balance, P&L and balance sheet",
    href: "/accounts",
    group: "finance",
    defaultEnabled: true,
  },
  {
    id: "payroll",
    label: "Payroll",
    blurb: "Salary runs, advances, bank file and statutory remit",
    href: "/payroll",
    group: "finance",
    defaultEnabled: true,
  },
  {
    id: "comms",
    label: "Communications",
    blurb: "Notices, news and photo gallery",
    href: "/comms",
    group: "academics",
    defaultEnabled: true,
  },
  {
    id: "transport",
    label: "Transport",
    blurb: "Routes, fleet, riders and transport dues",
    href: "/transport",
    group: "campus",
    defaultEnabled: true,
  },
  {
    id: "trust",
    label: "Trust · Construction",
    blurb: "Projects, BOQ, vendor bills and CWIP",
    href: "/trust",
    group: "campus",
    defaultEnabled: true,
  },
  {
    id: "reports",
    label: "Reports Center",
    blurb: "Cross-module Excel / PDF exports",
    href: "/reports",
    group: "insights",
    defaultEnabled: true,
  },
];

export type ModuleRegistryState = {
  version: 1;
  /** Explicit overrides; missing key → use catalog defaultEnabled */
  enabled: Partial<Record<RegistryModuleId, boolean>>;
};

function emptyState(): ModuleRegistryState {
  return { version: 1, enabled: {} };
}

/**
 * Until this is set (after AppShell mount), ignore localStorage and use catalog
 * defaults — otherwise SSR HTML vs client first paint diverge (hydration error).
 */
let registryClientReady = false;

export function markModuleRegistryClientReady(): void {
  registryClientReady = true;
}

export function isModuleRegistryClientReady(): boolean {
  return registryClientReady;
}

export function loadModuleRegistry(): ModuleRegistryState {
  if (typeof window === "undefined" || !registryClientReady) return emptyState();
  return readModuleRegistryStorage();
}

/** Always read storage (for cloud hydrate / sync). Ignores SSR gate. */
export function readModuleRegistryStorage(): ModuleRegistryState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<ModuleRegistryState>;
    return {
      version: 1,
      enabled:
        parsed.enabled && typeof parsed.enabled === "object"
          ? (parsed.enabled as Partial<Record<RegistryModuleId, boolean>>)
          : {},
    };
  } catch {
    return emptyState();
  }
}

export function saveModuleRegistry(state: ModuleRegistryState): void {
  if (!assertModulePermission("settings", "edit", "saveModuleRegistry")) return;
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/moduleRegistryPersistence").then(
    ({ scheduleModuleRegistrySync }) => {
      scheduleModuleRegistrySync(state);
    },
  );
}

export function writeModuleRegistryLocalRaw(state: ModuleRegistryState): void {
  if (typeof window === "undefined") return;
  registryClientReady = true;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
}

export function moduleRegistryStateIsEmpty(
  state: ModuleRegistryState,
): boolean {
  return Object.keys(state.enabled || {}).length === 0;
}

export function getRegistryModule(
  id: RegistryModuleId,
): RegistryModuleDef | undefined {
  return REGISTRY_MODULES.find((m) => m.id === id);
}

export function isModuleEnabled(id: RegistryModuleId): boolean {
  const def = getRegistryModule(id);
  if (!def) return false;
  if (def.alwaysOn) return true;
  if (typeof window === "undefined" || !registryClientReady) {
    return def.defaultEnabled;
  }
  const state = loadModuleRegistry();
  if (typeof state.enabled[id] === "boolean") return !!state.enabled[id];
  return def.defaultEnabled;
}

export function setModuleEnabled(
  id: RegistryModuleId,
  enabled: boolean,
): ModuleRegistryState {
  const def = getRegistryModule(id);
  if (def?.alwaysOn) {
    return loadModuleRegistry();
  }
  // Writes must see real localStorage even if UI not marked ready yet (Modules page)
  if (typeof window !== "undefined" && !registryClientReady) {
    registryClientReady = true;
  }
  const state = loadModuleRegistry();
  const next: ModuleRegistryState = {
    ...state,
    enabled: { ...state.enabled, [id]: enabled },
  };
  saveModuleRegistry(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("bhb-module-registry", { detail: { id, enabled } }),
    );
  }
  return next;
}

export function setAllModulesEnabled(
  enabled: boolean,
): ModuleRegistryState {
  if (typeof window !== "undefined" && !registryClientReady) {
    registryClientReady = true;
  }
  const state = loadModuleRegistry();
  const nextEnabled: Partial<Record<RegistryModuleId, boolean>> = {
    ...state.enabled,
  };
  for (const m of REGISTRY_MODULES) {
    if (m.alwaysOn) continue;
    nextEnabled[m.id] = enabled;
  }
  const next: ModuleRegistryState = { ...state, enabled: nextEnabled };
  saveModuleRegistry(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bhb-module-registry"));
  }
  return next;
}

/** Map a primary nav / hub href to a registry module (if gated). */
export function registryModuleForHref(href: string): RegistryModuleId | null {
  const path = (href.split("?")[0] || "").replace(/\/$/, "") || "/";
  const qs = href.includes("?") ? href.split("?")[1] : "";
  const tab = new URLSearchParams(qs).get("tab");

  if (path === "/home" || path === "/") return "home";
  if (path === "/modules") return "modules";
  if (path === "/masters") return "masters";
  if (path === "/vault") return "vault";
  if (path === "/field" || path.startsWith("/field/")) return "field";
  if (path === "/students" || path.startsWith("/students/")) return "students";
  if (path === "/staff" || path.startsWith("/staff/")) return "staff";
  if (path === "/transport" || path.startsWith("/transport/")) return "transport";
  if (path === "/accounts" || path.startsWith("/accounts/") || path.startsWith("/expenses"))
    return "accounts";
  if (path === "/trust" || path.startsWith("/trust/") || path.startsWith("/construction"))
    return "trust";
  if (path === "/fees/defaulters") return "defaulters";
  if (path === "/fees" || path.startsWith("/fees/")) return "fees";
  if (path === "/attendance" || path.startsWith("/attendance/")) {
    if (tab === "leave" || tab === "student-leave" || tab === "student_leave") {
      return "student_leave";
    }
    return "attendance";
  }
  if (path === "/student-leave" || path.startsWith("/student-leave/"))
    return "student_leave";
  if (path === "/homework" || path.startsWith("/homework/")) return "homework";
  if (path === "/timetable" || path.startsWith("/timetable/")) return "timetable";
  if (path === "/ptm" || path.startsWith("/ptm/")) return "ptm";
  if (path === "/exams" || path.startsWith("/exams/")) return "exams";
  if (path === "/certificates" || path.startsWith("/certificates/"))
    return "certificates";
  if (path === "/documents" || path.startsWith("/documents/")) return "documents";
  if (
    path === "/comms" ||
    path.startsWith("/comms/") ||
    path === "/notices" ||
    path === "/news" ||
    path === "/gallery"
  ) {
    return "comms";
  }
  if (path === "/payroll" || path.startsWith("/payroll/")) return "payroll";
  if (path === "/reports" || path.startsWith("/reports/")) return "reports";
  if (path === "/purchase" || path.startsWith("/purchase/")) return "purchase";
  if (path === "/library" || path.startsWith("/library/")) return "library";
  if (path === "/store" || path.startsWith("/store/")) {
    if (tab === "purchase" || tab === "indent" || tab === "po" || tab === "grn") {
      return "purchase";
    }
    return "store";
  }
  if (path === "/rte" || path.startsWith("/rte/")) return "rte_ews";
  if (path === "/admissions" || path.startsWith("/admissions/")) {
    if (tab === "rte") return "rte_ews";
    return "admissions";
  }
  return null;
}

export function canAccessModuleHref(href: string): boolean {
  const id = registryModuleForHref(href);
  if (!id) return true;
  return isModuleEnabled(id);
}
