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
import { AnomalyGrid, type AnomalyItem } from "@/components/dashboard/AnomalyGrid";
import {
  loadStatutoryRemit,
  statutoryDuesFromBatches,
} from "@/lib/statutoryRemit";
import { loadMasters } from "@/lib/masters";
import { normalizeStatutoryConfig } from "@/lib/foundationMasters";
import { listOverdueStatutoryAlerts } from "@/lib/statutoryCompliance";
import { listLiveDefaulters } from "@/lib/playbook";
import { countAtRiskDefaulters } from "@/lib/collectionsAi";
import type { OwnerAnomalies } from "@/lib/ownerAnomalies.server";
import { runFeeReport } from "@/lib/feeReportCatalog";
import { Button } from "@/components/ui/button";
import { BroadcastModal } from "@/components/dashboard/BroadcastModal";
import { MessageCircle, Receipt } from "lucide-react";

export function SchoolHomeDashboard() {
  const session = useDemoSession();
  const searchParams = useSearchParams();
  const [tick, setTick] = useState(1);
  const forceFull = searchParams.get("view") === "full";
  const [anomalies, setAnomalies] = useState<OwnerAnomalies>({});
  const [atRiskCount, setAtRiskCount] = useState<number | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [ledgerNotice, setLedgerNotice] = useState<string | null>(null);

  function generateFeeLedger() {
    const result = runFeeReport("fee_reconciliation_pack", {
      academicYearCode: session.academicYearCode,
      format: "excel",
    });
    setLedgerNotice(result.ok ? result.message : result.error);
    window.setTimeout(() => setLedgerNotice(null), 4000);
  }

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

  useEffect(() => {
    if (!isSuperAdminSession(session)) return;
    let cancelled = false;
    fetch(
      `/api/v1/owner/anomalies?academicYearCode=${encodeURIComponent(session.academicYearCode)}&_t=${Date.now()}`,
      { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
    )
      .then((res) => res.json())
      .then((body: { ok?: boolean; data?: OwnerAnomalies }) => {
        if (!cancelled && body.ok && body.data) setAnomalies(body.data);
      })
      .catch(() => {
        /* omit the anomaly signals on fetch failure, never fabricate zeros */
      });
    try {
      const defaulters = listLiveDefaulters({
        academicYearCode: session.academicYearCode,
      });
      if (!cancelled) setAtRiskCount(countAtRiskDefaulters(defaulters));
    } catch {
      if (!cancelled) setAtRiskCount(null);
    }
    return () => {
      cancelled = true;
    };
  }, [session, tick]);

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

    const anomalyItems: AnomalyItem[] = [];
    if (anomalies.attendance && anomalies.attendance.pending > 0) {
      anomalyItems.push({
        id: "attendance-pending",
        tone: "warning",
        title: `${anomalies.attendance.pending} attendance register${anomalies.attendance.pending === 1 ? "" : "s"} not marked`,
        detail: "Today's sections still awaiting a class attendance mark",
        href: "/attendance?tab=students",
      });
    }
    if (anomalies.waFailures && anomalies.waFailures.count > 0) {
      anomalyItems.push({
        id: "wa-failures",
        tone: "danger",
        title: `${anomalies.waFailures.count} WhatsApp message${anomalies.waFailures.count === 1 ? "" : "s"} failed to deliver`,
        detail: "In the last 24 hours",
        href: "/comms",
      });
    }
    if (atRiskCount && atRiskCount > 0) {
      anomalyItems.push({
        id: "fee-at-risk",
        tone: "danger",
        title: `${atRiskCount} fee payment${atRiskCount === 1 ? "" : "s"} at risk`,
        detail: "High-risk defaulters flagged by the collections score",
        href: "/fees/defaulters",
      });
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setBroadcastOpen(true)}
          >
            <MessageCircle className="h-3.5 w-3.5" /> Broadcast WhatsApp
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={generateFeeLedger}>
            <Receipt className="h-3.5 w-3.5" /> Generate fee ledger
          </Button>
          {ledgerNotice ? (
            <span className="text-xs text-[var(--muted)]">{ledgerNotice}</span>
          ) : null}
        </div>
        <BroadcastModal open={broadcastOpen} onOpenChange={setBroadcastOpen} />
        <AlertBannerList
          alerts={statutoryAlerts.map((a) => ({ text: a.text, href: a.href }))}
        />
        <AnomalyGrid items={anomalyItems} />
        <ModuleDashboardView model={model} variant="school" />
      </div>
    );
  }

  return <ModuleDashboardView model={model} variant="school" />;
}
