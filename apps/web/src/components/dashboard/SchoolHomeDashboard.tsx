"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ModuleDashboardView } from "@/components/dashboard/ModuleDashboard";
import {
  shouldShowTeacherHome,
  TeacherHome,
} from "@/components/dashboard/TeacherHome";
import {
  PrincipalCockpit,
  shouldShowPrincipalCockpit,
} from "@/components/dashboard/PrincipalCockpit";
import { buildSchoolDashboard } from "@/lib/moduleDashboards";
import { useDemoSession } from "@/components/shell/SessionContext";
import { isSuperAdminSession } from "@/lib/superAdmin";
import { AlertBannerList } from "@/components/dashboard/AlertBannerList";
import {
  loadStatutoryRemit,
  statutoryDuesFromBatches,
} from "@/lib/statutoryRemit";
import { loadMasters } from "@/lib/masters";
import { normalizeStatutoryConfig } from "@/lib/foundationMasters";
import { listOverdueStatutoryAlerts } from "@/lib/statutoryCompliance";

export function SchoolHomeDashboard() {
  const session = useDemoSession();
  const searchParams = useSearchParams();
  const [tick, setTick] = useState(1);
  const forceFull = searchParams.get("view") === "full";

  useEffect(() => {
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

  if (!forceFull && shouldShowPrincipalCockpit(session)) {
    return <PrincipalCockpit />;
  }

  if (!forceFull && shouldShowTeacherHome(session, true)) {
    return (
      <TeacherHome
        onOpenFullDashboard={() => {
          window.location.href = "/home?view=full";
        }}
      />
    );
  }

  const model = buildSchoolDashboard(session.academicYearCode);

  // Statutory (EPF/ESIC) overdue alerts — owner/super-admin only, never principal.
  if (isSuperAdminSession(session)) {
    const config = normalizeStatutoryConfig(loadMasters().statutoryConfig);
    const dues = statutoryDuesFromBatches(loadStatutoryRemit().batches);
    const statutoryAlerts = listOverdueStatutoryAlerts(dues, config);
    if (statutoryAlerts.length > 0) {
      const estimatedTotal = statutoryAlerts.reduce(
        (s, a) => s + a.estimatedPenalty,
        0,
      );
      const kpi = {
        id: "statutory-overdue",
        label: "Statutory dues overdue",
        value: String(statutoryAlerts.length),
        hint: `Est. penalty ₹${estimatedTotal.toLocaleString("en-IN")} · submit ASAP`,
        tone: "rose" as const,
        href: "/payroll?tab=govt",
      };
      const financeSection = model.kpiSections?.find((s) => s.id === "finance");
      if (financeSection) {
        financeSection.kpis = [kpi, ...financeSection.kpis];
      } else {
        model.kpiSections = [
          ...(model.kpiSections || []),
          { id: "statutory", title: "Statutory compliance", kpis: [kpi] },
        ];
      }
    }
    return (
      <div className="space-y-4">
        <AlertBannerList
          alerts={statutoryAlerts.map((a) => ({ text: a.text, href: a.href }))}
        />
        <ModuleDashboardView model={model} variant="school" />
      </div>
    );
  }

  return <ModuleDashboardView model={model} variant="school" />;
}
