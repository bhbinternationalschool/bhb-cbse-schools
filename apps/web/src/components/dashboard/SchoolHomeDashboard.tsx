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
  return <ModuleDashboardView model={model} variant="school" />;
}
