"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ModuleDashboardView,
  type ModuleDashboardModel,
} from "@/components/dashboard/ModuleDashboard";
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
import { normalizeStatutoryConfig } from "@/lib/foundationMasters";
import { listOverdueStatutoryAlerts } from "@/lib/statutoryCompliance";
import { listLiveDefaulters } from "@/lib/playbook";
import { countAtRiskDefaulters } from "@/lib/collectionsAi";
import type { OwnerAnomalies } from "@/lib/ownerAnomalies.server";
import { runFeeReport } from "@/lib/feeReportCatalog";
import { Button } from "@/components/ui/button";
import { BroadcastModal } from "@/components/dashboard/BroadcastModal";
import { MessageCircle, Receipt } from "lucide-react";
import { useExpenseKpi } from "@/components/dashboard/expenseKpi";
import { hasPermission } from "@/lib/rbac";
import { useAccessData } from "@/components/shell/useAccessData";
import { useMasters } from "@/lib/data/client/hooks";
import { useScreenMasters } from "@/components/data/useScreenMasters";
import { QueryError } from "@/components/data/QueryError";

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
  // Who sees what on this page (the teacher's home, the expenses tile) is a
  // permission answer: it comes from the copies the sidebar and the module
  // gate decide with (data-layer 2.1f), and waits for them — never a guess
  // from a roster or roles that have not loaded.
  const access = useAccessData();
  // The school's book as data (data-layer 2.3b): the home tiles and the
  // at-risk count are built from it, never from the tab's page copy.
  const screen = useScreenMasters();
  const homeMasters = screen.masters;
  // Expenses tile — only for those who may see the school's money position
  // (the report behind it needs accounts_position on the server too).
  const expenseKpi = useExpenseKpi(
    access.ready &&
      !!access.masters &&
      hasPermission(session, access.masters, "accounts_position", "view", access.rbac ?? undefined) &&
      hasPermission(session, access.masters, "accounts", "view", access.rbac ?? undefined),
  );

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
    // Fees, admissions and attendance load when first read (Phase 3): the
    // tiles redraw when they land.
    window.addEventListener("bhb-desk-hydrated", refresh);
    return () => {
      window.removeEventListener("bhb-module-registry", refresh);
      window.removeEventListener("bhb-sis-updated", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("bhb-desk-hydrated", refresh);
    };
  }, []);

  // The anomaly scan is server work of several seconds: once per visit and
  // year, not on every tick — each desk landing (bhb-desk-hydrated) used to
  // start another scan (11 Oct 2026).
  const superAdmin = isSuperAdminSession(session);
  const ayCode = session.academicYearCode;
  useEffect(() => {
    if (!superAdmin) return;
    let cancelled = false;
    fetch(
      `/api/v1/owner/anomalies?academicYearCode=${encodeURIComponent(ayCode)}&_t=${Date.now()}`,
      { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
    )
      .then((res) => res.json())
      .then((body: { ok?: boolean; data?: OwnerAnomalies }) => {
        if (!cancelled && body.ok && body.data) setAnomalies(body.data);
      })
      .catch(() => {
        /* omit the anomaly signals on fetch failure, never fabricate zeros */
      });
    return () => {
      cancelled = true;
    };
  }, [superAdmin, ayCode]);

  useEffect(() => {
    if (!isSuperAdminSession(session)) return;
    if (!homeMasters) return;
    let cancelled = false;
    try {
      const defaulters = listLiveDefaulters({
        academicYearCode: session.academicYearCode,
        masters: homeMasters,
      });
      if (!cancelled) setAtRiskCount(countAtRiskDefaulters(defaulters));
    } catch {
      if (!cancelled) setAtRiskCount(null);
    }
    return () => {
      cancelled = true;
    };
  }, [session, tick, homeMasters]);

  if (!forceFull && shouldShowPrincipalCockpit(session)) {
    return <PrincipalCockpit />;
  }

  if (!access.ready) {
    if (access.status === "failed") {
      return (
        <div className="mx-auto max-w-lg p-8" role="alert">
          <h1 className="font-brand-name text-xl text-[var(--brand-deep)]">
            Couldn&apos;t check your access
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Your roles or the staff list did not load. Check the connection and
            try again.
          </p>
          <button
            type="button"
            onClick={access.retry}
            className="mt-5 inline-flex rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)]"
          >
            Try again
          </button>
        </div>
      );
    }
    return <p className="text-base text-[var(--muted)]">Loading school dashboard…</p>;
  }

  if (!forceFull && shouldShowTeacherHome(session, access.masters)) {
    return (
      <TeacherHome
        onOpenFullDashboard={() => {
          window.location.href = "/home?view=full";
        }}
      />
    );
  }

  if (!homeMasters) {
    if (screen.error) {
      return <QueryError what="the school's classes, subjects and staff" error={screen.error} retry={screen.retry} />;
    }
    return <p className="text-base text-[var(--muted)]">Loading school dashboard…</p>;
  }

  const model = buildSchoolDashboard(session.academicYearCode, homeMasters);

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

  // Expenses sit with the other money tiles in "Finance & store", right
  // after the bank balance, at the same size (director, 8 Oct 2026).
  if (expenseKpi) {
    const finance = model.kpiSections?.find((s) => s.id === "finance");
    if (finance) {
      const at = finance.kpis.findIndex((k) => k.id === "bank");
      finance.kpis.splice(at >= 0 ? at + 1 : finance.kpis.length, 0, expenseKpi);
    }
  }

  // Owner / super admin: the statutory alerts and the anomaly scan.
  if (isSuperAdminSession(session)) {
    return (
      <OwnerHome
        model={model}
        anomalies={anomalies}
        atRiskCount={atRiskCount}
        broadcastOpen={broadcastOpen}
        onBroadcastOpenChange={setBroadcastOpen}
        ledgerNotice={ledgerNotice}
        onGenerateFeeLedger={generateFeeLedger}
      />
    );
  }

  return (
    <div className="space-y-4">
      <WaNumberGapBanner />
      <ModuleDashboardView model={model} variant="school" />
    </div>
  );
}

/**
 * The owner's / super admin's home: statutory (EPF/ESIC) overdue alerts and
 * the anomaly grid above the school dashboard (never the principal's).
 *
 * The statutory setup is read from the server's Masters (useMasters — kept
 * fresh by the versions poll; data-layer 2.1f), not from this tab's copy, and
 * only here: no other home reads the book, so no other home pays for it. A
 * Masters read that failed is said on screen — never "nothing overdue".
 */
function OwnerHome({
  model,
  anomalies,
  atRiskCount,
  broadcastOpen,
  onBroadcastOpenChange,
  ledgerNotice,
  onGenerateFeeLedger,
}: {
  model: ModuleDashboardModel;
  anomalies: OwnerAnomalies;
  atRiskCount: number | null;
  broadcastOpen: boolean;
  onBroadcastOpenChange: (open: boolean) => void;
  ledgerNotice: string | null;
  onGenerateFeeLedger: () => void;
}) {
  const book = useMasters();
  // The full book only: a teaching answer withholds the statutory setup.
  const statutoryConfig =
    book.data?.scope === "full" ? book.data.masters.statutoryConfig : undefined;
  const statutoryUnknown = book.isError && book.data === undefined;

  // `model` is the parent's; this render may run again on its own (a Masters
  // answer), so the tiles are added to copies, never to `model` itself.
  const kpiSections = model.kpiSections?.map((sec) => ({ ...sec, kpis: [...sec.kpis] }));
  const statutoryAlerts =
    book.data?.scope === "full"
      ? listOverdueStatutoryAlerts(
          statutoryDuesFromBatches(loadStatutoryRemit().batches),
          normalizeStatutoryConfig(statutoryConfig),
        )
      : [];
  let sections = kpiSections;
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
    const financeSection = sections?.find((s) => s.id === "finance");
    if (financeSection) {
      financeSection.kpis = [kpi, ...financeSection.kpis];
    } else {
      sections = [
        ...(sections || []),
        { id: "statutory", title: "Statutory compliance", kpis: [kpi] },
      ];
    }
  }
  const shown: ModuleDashboardModel = { ...model, kpiSections: sections };

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
          onClick={() => onBroadcastOpenChange(true)}
        >
          <MessageCircle className="h-3.5 w-3.5" /> Broadcast WhatsApp
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onGenerateFeeLedger}>
          <Receipt className="h-3.5 w-3.5" /> Generate fee ledger
        </Button>
        {ledgerNotice ? (
          <span className="text-xs text-[var(--muted)]">{ledgerNotice}</span>
        ) : null}
      </div>
      <BroadcastModal open={broadcastOpen} onOpenChange={onBroadcastOpenChange} />
      {/* Families no WhatsApp message can reach. Top of the owner's own
          screen, with the number box in it: a dashboard that only counts a
          problem hands it back to somebody else. */}
      <WaNumberGapBanner />
      {statutoryUnknown ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--muted)]"
        >
          Statutory (EPF/ESIC) dues could not be checked: the school&apos;s Masters did not load.
          <button
            type="button"
            onClick={() => void book.refetch()}
            className="font-semibold text-[var(--brand-deep)] underline"
          >
            Try again
          </button>
        </p>
      ) : null}
      <AlertBannerList
        alerts={statutoryAlerts.map((a) => ({ text: a.text, href: a.href }))}
      />
      <AnomalyGrid items={anomalyItems} />
      <ModuleDashboardView model={shown} variant="school" />
    </div>
  );
}
