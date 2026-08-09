"use client";

import { useEffect, useState } from "react";
import {
  ModuleDashboardView,
  type DashboardTableRow,
  type ModuleDashboardModel,
} from "@/components/dashboard/ModuleDashboard";
import {
  buildModuleDashboard,
  type DashboardModuleId,
} from "@/lib/moduleDashboards";
import { useDemoSessionOptional } from "@/components/shell/SessionContext";

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
    const onMastersUpdated = () => setMastersTick((t) => t + 1);
    window.addEventListener("bhb-masters-updated", onMastersUpdated);
    return () =>
      window.removeEventListener("bhb-masters-updated", onMastersUpdated);
  }, []);

  useEffect(() => {
    void (async () => {
      let did = false;
      if (moduleId === "admissions") {
        const { ensureAdmissionsHydrated } = await import("@/lib/admissionsPersistence");
        did = await ensureAdmissionsHydrated();
      } else if (moduleId === "students") {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        did = await ensureSisHydrated();
      } else if (moduleId === "fees") {
        const { ensureFeesHydrated } = await import("@/lib/feesPersistence");
        did = await ensureFeesHydrated();
      } else if (moduleId === "staff") {
        const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
        did = await ensureStaffHydrated();
      } else if (moduleId === "attendance") {
        const { ensureAttendanceHydrated } = await import("@/lib/attendancePersistence");
        did = await ensureAttendanceHydrated();
      } else if (moduleId === "exams") {
        const { ensureExamsHydrated } = await import("@/lib/examsPersistence");
        did = await ensureExamsHydrated();
      }
      if (did) setMastersTick((t) => t + 1);
    })();
    setModel(
      buildModuleDashboard(moduleId, {
        academicYearCode: session?.academicYearCode,
      }),
    );
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
    />
  );
}
