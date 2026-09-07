"use client";

import { useEffect, useState } from "react";
import {
  ModuleDashboardView,
  type DashboardRowAction,
  type DashboardTableRow,
  type ModuleDashboardModel,
} from "@/components/dashboard/ModuleDashboard";
import {
  buildModuleDashboard,
  type DashboardModuleId,
} from "@/lib/moduleDashboards";
import { useDemoSessionOptional } from "@/components/shell/SessionContext";
import { openWaMe } from "@/lib/waMe";

export function ModuleDashboardHost({
  moduleId,
  onNavigateTab,
  onTableRowClick,
  refreshKey = 0,
}: {
  moduleId: DashboardModuleId;
  onNavigateTab?: (tab: string) => void;
  onTableRowClick?: (row: DashboardTableRow) => void;
  refreshKey?: number;
}) {
  const session = useDemoSessionOptional();
  const [model, setModel] = useState<ModuleDashboardModel | null>(null);
  const [mastersTick, setMastersTick] = useState(0);

  useEffect(() => {
    const onDataUpdated = () => setMastersTick((t) => t + 1);
    window.addEventListener("bhb-masters-updated", onDataUpdated);
    window.addEventListener("bhb-sis-updated", onDataUpdated);
    return () => {
      window.removeEventListener("bhb-masters-updated", onDataUpdated);
      window.removeEventListener("bhb-sis-updated", onDataUpdated);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      let did = false;
      const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
      if (moduleId === "admissions") {
        const { ensureAdmissionsHydrated } = await import("@/lib/admissionsPersistence");
        did = await withHydrationSlot(() => ensureAdmissionsHydrated());
      } else if (moduleId === "students") {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        did = await withHydrationSlot(() => ensureSisHydrated());
      } else if (moduleId === "fees") {
        const { ensureFeesHydrated } = await import("@/lib/feesPersistence");
        did = await withHydrationSlot(() => ensureFeesHydrated());
      } else if (moduleId === "staff") {
        const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
        did = await withHydrationSlot(() => ensureStaffHydrated());
      } else if (moduleId === "attendance") {
        const { ensureAttendanceHydrated } = await import("@/lib/attendancePersistence");
        did = await withHydrationSlot(() => ensureAttendanceHydrated());
      } else if (moduleId === "exams") {
        const { ensureExamsHydrated } = await import("@/lib/examsPersistence");
        did = await withHydrationSlot(() => ensureExamsHydrated());
      }
      if (did) setMastersTick((t) => t + 1);
    })();
    const built = buildModuleDashboard(moduleId, {
      academicYearCode: session?.academicYearCode,
    });
    setModel(built);
    // Accounts KPIs read the server book — the browser-book figures render
    // first (instant), then the authoritative cockpit replaces them. Store
    // sales and everything else the ledger carries show up this way.
    if (moduleId === "accounts" && built) {
      let stale = false;
      void import("@/lib/accountsServerKpis").then(
        ({ patchAccountsDashWithServerBook }) =>
          patchAccountsDashWithServerBook(built).then((patched) => {
            if (patched && !stale) setModel(patched);
          }),
      );
      return () => {
        stale = true;
      };
    }
  }, [moduleId, refreshKey, mastersTick, session?.academicYearCode]);

  if (!model) {
    return (
      <p className="mt-6 text-base text-[var(--muted)]">Loading dashboard…</p>
    );
  }

  return (
    <ModuleDashboardView
      model={model}
      onNavigateTab={onNavigateTab}
      onTableRowClick={onTableRowClick}
      onTableRowAction={runRowAction}
    />
  );
}

/**
 * Perform a dashboard row action.
 *
 * The models are built in plain libs that must not open windows, so they name
 * the intent and carry what it needs on the row; the work happens here. Same
 * message the Defaulters page sends, so a family does not get two differently
 * worded reminders depending on which screen the office was looking at.
 */
async function runRowAction(
  kind: DashboardRowAction["kind"],
  row: DashboardTableRow,
): Promise<void> {
  if (kind !== "whatsapp-defaulter") return;
  const [{ composeWhatsAppDefaulterReminder }, { TENANT }] =
    await Promise.all([
      import("@/lib/playbook"),
      import("@/lib/types"),
    ]);
  const message = composeWhatsAppDefaulterReminder({
    schoolName: TENANT.nameDisplay,
    studentName: String(row.name ?? ""),
    classLabel: String(row.class ?? ""),
    amountPaise: Number(row.amountPaise ?? 0),
    overdueDays: Number(row.daysOverdue ?? 0),
    stageLabel: "Reminder",
  });
  const mobile = String(row.mobile ?? "").replace(/\D/g, "");
  if (mobile.length < 10) {
    // No number on the household. Copying beats a dead link, and the office
    // can paste it wherever they do reach this family.
    try {
      await navigator.clipboard.writeText(message);
      window.alert(
        "No WhatsApp number on this household — the reminder is copied to your clipboard.",
      );
    } catch {
      window.alert("No WhatsApp number on this household.");
    }
    return;
  }
  openWaMe(mobile, message, undefined, { module: "fees" });
}
