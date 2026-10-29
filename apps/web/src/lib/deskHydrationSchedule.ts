/**
 * Route-priority desk hydration with idle batches — keeps first paint responsive.
 */

import { yieldToMain } from "@/lib/runWhenIdle";
import {
  deskEverHydrated,
  resetDeskHydrated,
  withHydrationSlot,
} from "@/lib/deskHydrateGuard";
import { trackServerWork } from "@/lib/serverWork";

export type DeskHydrateId =
  | "rbac"
  | "masters"
  | "moduleRegistry"
  | "sis"
  | "admissions"
  | "fees"
  | "payments"
  | "feeRecoveryTasks"
  | "attendance"
  | "staffAttendance"
  | "exams"
  | "examPapers"
  | "certificates"
  | "staff"
  | "staffHr"
  | "staffAdvances"
  | "staffAgreements"
  | "transport"
  | "waTemplates"
  | "automation"
  | "salarySetup"
  | "moduleStates";

type DeskHydrateTask = {
  id: DeskHydrateId;
  run: () => Promise<unknown>;
};

const CORE_IDS: DeskHydrateId[] = [
  "rbac",
  "masters",
  "moduleRegistry",
  "sis",
];

/** Extra hydrators to run early when the user opens a module route. */
const ROUTE_IDS: Record<string, DeskHydrateId[]> = {
  // Heavy desks are not forced here (Phase 3): everyone lands on home, and a
  // teacher's home reads none of the fee book or the leads. The dashboards
  // that do read them load them on first read and redraw when they land.
  home: ["sis", "staff"],
  // transport is here because Fee Take BILLS transport dues — without it a
  // fresh login straight to the counter computed dues before the transport
  // assignments arrived, and the transport fee simply wasn't offered.
  fees: ["fees", "payments", "feeRecoveryTasks", "transport"],
  admissions: ["admissions"],
  // The staff register applies approved leave and files leave (staff HR).
  attendance: ["attendance", "staffAttendance", "staffHr", "staff"],
  // transport: fee holds on admit cards / results are decided from dues,
  // and a dues figure without the transport desk leaves out every bus month.
  exams: ["exams", "examPapers", "certificates", "attendance", "transport"],
  // Staff field apps (lead capture, calling, registration collect).
  field: ["admissions"],
  events: ["fees", "payments", "transport"],
  parent: ["fees", "payments"],
  // A TC is held on dues, and dues include the bus.
  certificates: ["certificates", "transport"],
  staff: ["staff", "staffHr", "staffAdvances", "staffAgreements", "staffAttendance", "salarySetup"],
  // Transport bills, links stops to fee lines and shows dues on the fleet.
  transport: ["transport", "fees", "payments"],
  // Masters edits leave setup (staff HR), staff records and the staff punch
  // settings: load them with the page, not in the idle sweep — an edit made
  // before its desk loads is refused (lib/deskLoadGuard). Roles &
  // permissions are a core desk, loaded first on every page.
  masters: ["salarySetup", "staffHr", "staff", "staffAttendance"],
  // The profile's fee card and fee tab bill transport too (15 Oct 2026).
  students: ["fees", "payments", "attendance", "transport"],
  comms: ["waTemplates", "automation"],
  payroll: ["staff", "staffHr", "staffAdvances", "salarySetup"],
  reports: ["fees", "payments", "attendance", "exams", "transport"],
  // Day close and fuel refills write the fee book and transport.
  accounts: ["fees", "payments", "transport"],
};

/**
 * module_local_state modules by route — hydrated in the priority tier when the
 * user is on that route (each is one small GET). Everything else picks them
 * up in the idle sweep below.
 */
const ROUTE_MODULE_STATES: Record<string, import("@/lib/moduleStateRegistry").ModuleStateKey[]> = {
  fees: ["fee_holds", "fee_adjustments"],
  payroll: ["salary_increment", "salary_hold", "salary_account", "tally_sync"],
  staff: ["duty_roster", "staff_attendance_rules"],
  attendance: ["staff_attendance_rules"],
  exams: ["exam_invigilation", "attendance_result_overrides", "fee_holds"],
  complaints: ["complaints"],
  discipline: ["discipline"],
  health: ["health"],
  visitors: ["visitors"],
  students: ["udise_compliance", "fee_holds", "birthday_settings", "compliance_facts"],
  admissions: ["wa_campaigns", "crm_parent_chat", "admissions_kb", "marketing_spend", "school_achievements", "referrals"],
  masters: ["wa_chatbot_flows", "staff_attendance_rules", "salary_increment"],
  "id-cards": ["id_card_template"],
  certificates: ["fee_holds"],
  accounts: ["tally_sync"],
  transport: ["fee_holds"],
};

/**
 * The heaviest desks (Phase 3, 10 Oct 2026) are never swept in idle: they
 * load on the routes that use them (ROUTE_IDS) and on first read
 * (deskLazyHydrate). The sweep fetched them on every page, so every phone
 * downloaded the fee book and every lead whatever it was showing.
 */
export const HEAVY_ON_DEMAND_IDS: ReadonlySet<DeskHydrateId> = new Set<DeskHydrateId>([
  "admissions",
  "fees",
  "payments",
  "attendance",
]);

const IDLE_BATCH_SIZE = 4;

let wipeApplied = false;
let backgroundStarted = false;
let backgroundPromise: Promise<void> | null = null;

function allDeskHydrateTasks(): DeskHydrateTask[] {
  return [
    {
      id: "masters",
      run: () =>
        import("@/lib/mastersPersistence").then((m) => m.ensureMastersHydrated()),
    },
    {
      id: "admissions",
      run: () =>
        import("@/lib/admissionsPersistence").then((m) =>
          m.ensureAdmissionsHydrated(),
        ),
    },
    {
      id: "sis",
      run: () => import("@/lib/sisPersistence").then((m) => m.ensureSisHydrated()),
    },
    {
      id: "fees",
      run: () => import("@/lib/feesPersistence").then((m) => m.ensureFeesHydrated()),
    },
    {
      id: "payments",
      run: () =>
        import("@/lib/paymentsPersistence").then((m) => m.ensurePaymentsHydrated()),
    },
    {
      id: "attendance",
      run: () =>
        import("@/lib/attendancePersistence").then((m) =>
          m.ensureAttendanceHydrated(),
        ),
    },
    {
      id: "staffAttendance",
      run: () =>
        import("@/lib/staffAttendancePersistence").then((m) =>
          m.ensureStaffAttendanceHydrated(),
        ),
    },
    {
      id: "exams",
      run: () => import("@/lib/examsPersistence").then((m) => m.ensureExamsHydrated()),
    },
    {
      id: "staff",
      run: () => import("@/lib/staffPersistence").then((m) => m.ensureStaffHydrated()),
    },
    {
      id: "transport",
      run: () =>
        import("@/lib/transportPersistence").then((m) =>
          m.ensureTransportHydrated(),
        ),
    },
    {
      id: "rbac",
      run: () => import("@/lib/rbacPersistence").then((m) => m.ensureRbacHydrated()),
    },
    {
      id: "certificates",
      run: () =>
        import("@/lib/certificatesPersistence").then((m) =>
          m.ensureCertificatesHydrated(),
        ),
    },
    {
      id: "examPapers",
      run: () =>
        import("@/lib/examPapersPersistence").then((m) =>
          m.ensureExamPapersHydrated(),
        ),
    },
    {
      id: "waTemplates",
      run: () =>
        import("@/lib/waTemplatesPersistence").then((m) =>
          m.ensureWaTemplatesHydrated(),
        ),
    },
    {
      id: "staffHr",
      run: () =>
        import("@/lib/staffHrPersistence").then((m) => m.ensureStaffHrHydrated()),
    },
    {
      id: "staffAdvances",
      run: () =>
        import("@/lib/staffAdvancesPersistence").then((m) =>
          m.ensureStaffAdvancesHydrated(),
        ),
    },
    {
      id: "staffAgreements",
      run: () =>
        import("@/lib/staffAgreementPersistence").then((m) =>
          m.ensureStaffAgreementsHydrated(),
        ),
    },
    {
      id: "moduleRegistry",
      run: () =>
        import("@/lib/moduleRegistryPersistence").then((m) =>
          m.ensureModuleRegistryHydrated(),
        ),
    },
    {
      id: "feeRecoveryTasks",
      run: () =>
        import("@/lib/feeRecoveryTasksPersistence").then((m) =>
          m.ensureFeeRecoveryTasksHydrated(),
        ),
    },
    {
      id: "automation",
      run: () =>
        import("@/lib/automationPersistence").then((m) =>
          m.ensureAutomationHydrated(),
        ),
    },
    {
      id: "salarySetup",
      run: () =>
        import("@/lib/salarySetupPersistence").then((m) =>
          m.ensureSalarySetupHydrated(),
        ),
    },
    {
      // All module_local_state modules — idle sweep so every desk has the
      // server copy shortly after login even off its own route.
      id: "moduleStates",
      run: () =>
        import("@/lib/localModulesPersistence").then((m) =>
          m.ensureAllModuleStatesHydrated(),
        ),
    },
  ];
}

export function deskHydrateRouteKey(pathname: string): string {
  const seg = pathname.replace(/^\/+/, "").split("/")[0];
  return seg || "home";
}

export function priorityDeskHydrateIds(pathname: string): Set<DeskHydrateId> {
  const routeKey = deskHydrateRouteKey(pathname);
  const routeIds = ROUTE_IDS[routeKey] ?? [];
  return new Set<DeskHydrateId>([...CORE_IDS, ...routeIds]);
}

async function ensureTenantWipeApplied(): Promise<void> {
  if (wipeApplied) return;
  wipeApplied = true;
  const { applyTenantDataWipeSignalIfNeeded } = await import(
    "@/lib/tenantDataWipe"
  );
  await applyTenantDataWipeSignalIfNeeded();
}

function dispatchAdmissionsHydrated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("bhb-admissions-hydrated"));
}

async function runDeskTasks(tasks: DeskHydrateTask[]): Promise<void> {
  // Each task's actual network work is gated through withHydrationSlot, so
  // even the "priority" tier (up to 9 tasks for the home route) can't fire
  // more than a handful of concurrent DB round trips at once — Promise.all
  // here just waits for all of them, it no longer controls concurrency.
  await Promise.allSettled(
    tasks.map(async (task) => {
      await withHydrationSlot(() => task.run());
      if (task.id === "admissions") dispatchAdmissionsHydrated();
    }),
  );
}

async function runDeskTasksInIdleBatches(tasks: DeskHydrateTask[]): Promise<void> {
  for (let i = 0; i < tasks.length; i += IDLE_BATCH_SIZE) {
    await yieldToMain();
    const batch = tasks.slice(i, i + IDLE_BATCH_SIZE);
    await runDeskTasks(batch);
  }
}

/** Core + current-route hydrators — safe to call on every navigation. */
export async function ensureDeskHydratedPriority(
  pathname: string,
): Promise<void> {
  await ensureTenantWipeApplied();

  const priorityIds = priorityDeskHydrateIds(pathname);
  const tasks = allDeskHydrateTasks().filter((t) => priorityIds.has(t.id));
  const routeStates = ROUTE_MODULE_STATES[deskHydrateRouteKey(pathname)] ?? [];
  await Promise.allSettled([
    runDeskTasks(tasks),
    routeStates.length > 0
      ? import("@/lib/localModulesPersistence").then((m) =>
          m.ensureModuleStatesHydrated(routeStates),
        )
      : Promise.resolve(),
  ]);
}

async function runBackgroundHydration(initialPathname: string): Promise<void> {
  const priorityIds = priorityDeskHydrateIds(initialPathname);
  await ensureDeskHydratedPriority(initialPathname);

  const idleTasks = allDeskHydrateTasks().filter(
    (t) => !priorityIds.has(t.id) && !HEAVY_ON_DEMAND_IDS.has(t.id),
  );
  await runDeskTasksInIdleBatches(idleTasks);

  const { ensureDeskCutoverClient } = await import(
    "@/lib/ensureDeskCutoverClient"
  );
  void trackServerWork(ensureDeskCutoverClient());
}

/**
 * Priority tier immediately, remaining modules in idle batches.
 * Idempotent per tab — subsequent calls only bump route priority.
 */
export function startDeskHydrationBackground(pathname: string): void {
  if (!backgroundStarted) {
    backgroundStarted = true;
    backgroundPromise = runBackgroundHydration(pathname);
    return;
  }
  void trackServerWork(ensureDeskHydratedPriority(pathname));
}

export function deskHydrationBackgroundDone(): Promise<void> | null {
  return backgroundPromise;
}

/**
 * The hydrate-guard key each desk marks itself with (markDeskHydrated /
 * resetDeskHydrated) → its task above. The two vocabularies differ
 * ("staff_hr" vs "staffHr"); desks with no task here (ptm, trust, accounts,
 * library, vault, rte, payroll, statutory, module states, …) are reloaded by
 * their own screen's next ensure call once their guard entry is reset.
 */
const DESK_HYDRATE_ID_BY_MODULE: Readonly<Record<string, DeskHydrateId>> = {
  rbac: "rbac",
  masters: "masters",
  module_registry: "moduleRegistry",
  sis: "sis",
  admissions: "admissions",
  fees: "fees",
  payments: "payments",
  fee_recovery_tasks: "feeRecoveryTasks",
  attendance: "attendance",
  staff_attendance: "staffAttendance",
  exams: "exams",
  exam_papers: "examPapers",
  certificates: "certificates",
  staff: "staff",
  staff_hr: "staffHr",
  staff_advances: "staffAdvances",
  staff_agreements: "staffAgreements",
  transport: "transport",
  wa_templates: "waTemplates",
  automation: "automation",
  salary_setup: "salarySetup",
};

export function deskHydrateIdForModule(module: string): DeskHydrateId | null {
  return Object.prototype.hasOwnProperty.call(DESK_HYDRATE_ID_BY_MODULE, module)
    ? DESK_HYDRATE_ID_BY_MODULE[module]
    : null;
}

/**
 * Run only the named desks' hydrators (through the same slot cap). A
 * conflict on one desk reloads that desk — not every desk, which is what
 * ensureAllDeskHydrated did (data-layer 0.5a).
 */
export async function ensureDesksHydrated(ids: readonly DeskHydrateId[]): Promise<void> {
  const want = new Set(ids);
  if (want.size === 0) return;
  await runDeskTasks(allDeskHydrateTasks().filter((t) => want.has(t.id)));
}

/**
 * Some rows of a save on `module` were refused (changed elsewhere first):
 * forget that desk's load and reload it alone.
 */
export async function reloadDeskAfterConflict(module: string): Promise<void> {
  resetDeskHydrated(module);
  const id = deskHydrateIdForModule(module);
  if (id) await ensureDesksHydrated([id]);
}

/**
 * After a student merge: ids moved on the server, so every desk copy this
 * page holds is stale — but only those. Forget every desk's load (each
 * screen re-reads on its next ensure call) and re-pull now only the desks
 * this page has loaded; a heavy desk the page never opened stays unloaded.
 */
export async function reloadLoadedDesks(): Promise<void> {
  const ids = Object.entries(DESK_HYDRATE_ID_BY_MODULE)
    .filter(([module]) => deskEverHydrated(module))
    .map(([, id]) => id);
  resetDeskHydrated();
  await ensureDesksHydrated(ids);
}

/** Await every desk hydrator (tests / explicit full sync). */
export async function ensureAllDeskHydrated(): Promise<void> {
  await ensureTenantWipeApplied();
  await runDeskTasks(allDeskHydrateTasks());
  const { ensureDeskCutoverClient } = await import(
    "@/lib/ensureDeskCutoverClient"
  );
  void trackServerWork(ensureDeskCutoverClient());
}
