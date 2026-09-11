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
import { useServerBookPosition } from "@/lib/accountsServerBook";
import { formatInr } from "@/lib/masters";
import { useDemoSession } from "@/components/shell/SessionContext";
import { isSuperAdminSession } from "@/lib/superAdmin";
import { AlertBannerList } from "@/components/dashboard/AlertBannerList";
import { WaNumberGapBanner } from "@/components/comms/WaNumberGapBanner";
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
  // The bank tile is built blank and filled from the server book here. It
  // used to read the accounts desk, whose bank ledger holds fee receipts only
  // — see lib/accountsServerBook.ts.
  const serverBook = useServerBookPosition();

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
    window.addEventListener("bhb-sis-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("bhb-module-registry", refresh);
      window.removeEventListener("bhb-sis-updated", refresh);
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

  // Never a desk figure as a stand-in: while the position is loading or if it
  // cannot be read, the tile keeps its placeholder rather than a wrong number.
  // The tile lives in the "Finance & store" section, not in model.kpis.
  const bankKpi =
    model.kpis?.find((k) => k.id === "bank") ??
    model.kpiSections
      ?.flatMap((s) => s.kpis)
      .find((k) => k.id === "bank");
  if (bankKpi) {
    if (serverBook.position) {
      bankKpi.value = formatInr(serverBook.position.bankPaise);
      bankKpi.hint = "server book";
    } else if (serverBook.status === "failed") {
      bankKpi.value = "—";
      bankKpi.hint = "server book unavailable";
    }
  }

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
        {/* Families no WhatsApp message can reach. Top of the owner's own
            screen, with the number box in it: a dashboard that only counts a
            problem hands it back to somebody else. */}
        <WaNumberGapBanner />
        <AlertBannerList
          alerts={statutoryAlerts.map((a) => ({ text: a.text, href: a.href }))}
        />
        <AnomalyGrid items={anomalyItems} />
        <ModuleDashboardView model={model} variant="school" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WaNumberGapBanner />
      <ModuleDashboardView model={model} variant="school" />
    </div>
  );
}
