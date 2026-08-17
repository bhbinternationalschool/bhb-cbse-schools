"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import {
  AllotmentsPanel,
  BillsPanel,
  LabourPanel,
  MaterialsPanel,
  ProjectsPanel,
  ReportsPanel,
  WorksPanel,
} from "@/components/trust/TrustPanels";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { loadTrust, seedTrustIfEmpty, type TrustState } from "@/lib/trust";

type TrustTab =
  | "dashboard"
  | "projects"
  | "works"
  | "materials"
  | "labour"
  | "allotments"
  | "bills"
  | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "projects", label: "Projects", tone: "navy" },
  { id: "works", label: "Works", tone: "teal" },
  { id: "materials", label: "Materials", tone: "amber" },
  { id: "labour", label: "Labour", tone: "green" },
  { id: "allotments", label: "Allotments", tone: "violet" },
  { id: "bills", label: "Bills & CWIP", tone: "coral" },
  { id: "reports", label: "Reports", tone: "slate" },
];

export function TrustWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<TrustTab>("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: TrustTab[] = [
      "dashboard",
      "projects",
      "works",
      "materials",
      "labour",
      "allotments",
      "bills",
      "reports",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as TrustTab);
  }, []);
  const [state, setState] = useState<TrustState | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return seedTrustIfEmpty();
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const actorName = session.fullName || "Trust user";

  function flash(message: string) {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    try {
      const trust = seedTrustIfEmpty();
      setState(trust);
      if (!selectedProjectId && trust.projects[0]) {
        setSelectedProjectId(trust.projects[0].id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load trust data";
      setError(msg);
      setState((prev) => prev ?? loadTrust());
    }
  }

  useEffect(() => {
    refresh();
    void (async () => {
      const [{ ensureTrustHydrated }, { withHydrationSlot }] = await Promise.all([
        import("@/lib/trustPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      await withHydrationSlot(() => ensureTrustHydrated());
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--muted)]">
        Loading trust construction…
      </div>
    );
  }

  const panelProps = {
    state,
    selectedProjectId,
    onSelectProject: setSelectedProjectId,
    onRefresh: refresh,
    onFlash: flash,
    onError: (message: string) => {
      setError(message);
      setNotice(null);
    },
    actorName,
  };

  return (
    <ErpWorkspaceShell
      title="Infrastructure & Construction"
      subtitle="Trust projects · BOQ · site materials · CWIP (§6j)"
      icon={<Building2 className="size-6" aria-hidden />}
      error={error}
      notice={notice}
    >
      <ModuleTabs items={TABS} value={tab} onChange={(id) => setTab(id as TrustTab)} />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="trust"
          onNavigateTab={(t) => setTab(t as TrustTab)}
        />
      ) : null}
      {tab === "projects" ? <ProjectsPanel {...panelProps} /> : null}
      {tab === "works" ? <WorksPanel {...panelProps} /> : null}
      {tab === "materials" ? <MaterialsPanel {...panelProps} /> : null}
      {tab === "labour" ? <LabourPanel {...panelProps} /> : null}
      {tab === "allotments" ? <AllotmentsPanel {...panelProps} /> : null}
      {tab === "bills" ? <BillsPanel {...panelProps} /> : null}
      {tab === "reports" ? <ReportsPanel {...panelProps} /> : null}
    </ErpWorkspaceShell>
  );
}
