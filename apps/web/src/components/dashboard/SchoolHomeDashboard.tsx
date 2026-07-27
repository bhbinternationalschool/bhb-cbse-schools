"use client";

import { useEffect, useState } from "react";
import { ModuleDashboardView } from "@/components/dashboard/ModuleDashboard";
import { buildSchoolDashboard } from "@/lib/moduleDashboards";
import { useDemoSession } from "@/components/shell/SessionContext";

export function SchoolHomeDashboard() {
  const session = useDemoSession();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setTick((n) => n + 1);
    function refresh() {
      setTick((n) => n + 1);
    }
    window.addEventListener("bhb-module-registry", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("bhb-module-registry", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (tick === 0) {
    return (
      <p className="text-base text-[var(--muted)]">Loading school dashboard…</p>
    );
  }

  const model = buildSchoolDashboard(session.academicYearCode);
  return <ModuleDashboardView model={model} variant="school" />;
}
