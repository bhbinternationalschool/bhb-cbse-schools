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

  useEffect(() => {
    setModel(
      buildModuleDashboard(moduleId, {
        academicYearCode: session?.academicYearCode,
      }),
    );
  }, [moduleId, refreshKey, session?.academicYearCode]);

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
