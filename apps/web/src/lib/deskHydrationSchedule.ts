/**
 * Route-priority desk hydration with idle batches — keeps first paint responsive.
 */

import { yieldToMain } from "@/lib/runWhenIdle";
import { withHydrationSlot } from "@/lib/deskHydrateGuard";

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
  | "erpChat"
  | "staffChat"
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
  home: ["sis", "admissions", "fees", "payments", "staff", "attendance"],
  // transport is here because Fee Take BILLS transport dues — without it a
  // fresh login straight to the counter computed dues before the transport
  // assignments arrived, and the transport fee simply wasn't offered.
  fees: ["fees", "payments", "feeRecoveryTasks", "transport"],
  admissions: ["admissions"],
  attendance: ["attendance", "staffAttendance"],
  exams: ["exams", "examPapers", "certificates"],
  certificates: ["certificates"],
  staff: ["staff", "staffHr", "staffAdvances", "staffAgreements", "staffAttendance", "salarySetup"],
  transport: ["transport"],
  masters: ["salarySetup"],
  students: ["fees", "payments"],
  comms: ["waTemplates", "erpChat", "staffChat", "automation"],
  payroll: ["staff", "staffHr", "staffAdvances", "salarySetup"],
  reports: ["fees", "payments", "attendance", "exams"],
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
  exams: ["exam_invigilation"],
  complaints: ["complaints"],
  discipline: ["discipline"],
  health: ["health"],
  visitors: ["visitors"],
  students: ["udise_compliance", "fee_holds"],
  admissions: ["wa_campaigns", "crm_parent_chat"],
  masters: ["wa_chatbot_flows"],
  "id-cards": ["id_card_template"],
  certificates: ["fee_holds"],
  accounts: ["tally_sync"],
};

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
      id: "erpChat",
      run: () =>
        import("@/lib/erpChatPersistence").then((m) => m.ensureErpChatHydrated()),
    },
    {
      id: "staffChat",
      run: () =>
        import("@/lib/staffChatPersistence").then((m) =>
          m.ensureStaffChatHydrated(),
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

  const idleTasks = allDeskHydrateTasks().filter((t) => !priorityIds.has(t.id));
  await runDeskTasksInIdleBatches(idleTasks);

  const { ensureDeskCutoverClient } = await import(
    "@/lib/ensureDeskCutoverClient"
  );
  void ensureDeskCutoverClient();
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
  void ensureDeskHydratedPriority(pathname);
}

export function deskHydrationBackgroundDone(): Promise<void> | null {
  return backgroundPromise;
}

/** Await every desk hydrator (tests / explicit full sync). */
export async function ensureAllDeskHydrated(): Promise<void> {
  await ensureTenantWipeApplied();
  await runDeskTasks(allDeskHydrateTasks());
  const { ensureDeskCutoverClient } = await import(
    "@/lib/ensureDeskCutoverClient"
  );
  void ensureDeskCutoverClient();
}
