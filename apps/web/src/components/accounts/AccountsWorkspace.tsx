"use client";

import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import {
  AccountsMastersPanel,
} from "@/components/accounts/AccountsMastersPanel";
import {
  BanksPanel,
  BillsPanel,
  BooksPanel,
  CashBookPanel,
  DayBookPanel,
  DayCloseAccountsPanel,
  ExpensesPanel,
  OwnerLoansPanel,
  ReportsPanel,
} from "@/components/accounts/AccountsPanels";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { SkeletonModulePage } from "@/components/ui/skeleton";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import {
  loadAccounts,
  seedAccountsIfEmpty,
} from "@/lib/accountsStore";
import type { AccountsState } from "@/lib/accountsTypes";
import { dayCloseNeedsAttention } from "@/lib/fees";

type AccountsTab =
  | "dashboard"
  | "daybook"
  | "cash"
  | "banks"
  | "masters"
  | "expenses"
  | "bills"
  | "owner"
  | "books"
  | "dayclose"
  | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "daybook", label: "Day book", tone: "teal" },
  { id: "cash", label: "Cash", tone: "green" },
  { id: "banks", label: "Banks", tone: "sky" },
  { id: "masters", label: "Masters", tone: "violet" },
  { id: "expenses", label: "Expenses", tone: "amber" },
  { id: "bills", label: "Bills & AP", tone: "violet" },
  { id: "owner", label: "Owner loans", tone: "coral" },
  { id: "books", label: "Books", tone: "slate" },
  { id: "dayclose", label: "Day close", tone: "rose" },
  { id: "reports", label: "Reports", tone: "navy" },
];

export function AccountsWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<AccountsTab>("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: AccountsTab[] = [
      "dashboard",
      "daybook",
      "cash",
      "banks",
      "masters",
      "expenses",
      "bills",
      "owner",
      "books",
      "dayclose",
      "reports",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as AccountsTab);
  }, []);
  const [state, setState] = useState<AccountsState | null>(() =>
    typeof window !== "undefined" ? seedAccountsIfEmpty() : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const actorName = session.fullName || "Accounts user";

  function flash(message: string) {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    try {
      const accounts = seedAccountsIfEmpty();
      setState(accounts);
      setTick((t) => t + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load accounts";
      setError(msg);
      setState((prev) => prev ?? loadAccounts());
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
      const { ensureAccountsHydrated } = await import(
        "@/lib/accountsPersistence"
      );
      await withHydrationSlot(() => ensureAccountsHydrated());
      refresh();
    })();
  }, []);

  const panelProps = {
    state: state!,
    onRefresh: refresh,
    onFlash: flash,
    onError: (message: string) => {
      setError(message);
      setNotice(null);
    },
    actorName,
    tick,
  };

  const dayCloseBadge = dayCloseNeedsAttention() ? "!" : undefined;

  const tabsWithBadge = TABS.map((t) =>
    t.id === "dayclose" ? { ...t, badge: dayCloseBadge } : t,
  );

  return (
    <ErpWorkspaceShell
      title="Accounts"
      subtitle="Cash · bank · expenses · payables · owner loans · books · day close"
      icon={<Landmark className="size-6" aria-hidden />}
      error={error}
      notice={notice}
      actions={
        state ? (
          <div className="text-right text-xs text-[var(--muted)]">
            Signed in as{" "}
            <span className="font-semibold text-[var(--brand-deep)]">
              {actorName}
            </span>
          </div>
        ) : null
      }
    >
      <ModuleTabs
        items={tabsWithBadge}
        value={tab}
        onChange={(id) => setTab(id as AccountsTab)}
        aria-label="Accounts sections"
      />

      {!state ? (
        <div className="mt-6">
          <SkeletonModulePage />
        </div>
      ) : tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="accounts"
          refreshKey={tick}
          onNavigateTab={(t) => setTab(t as AccountsTab)}
        />
      ) : tab === "daybook" ? (
        <DayBookPanel {...panelProps} />
      ) : tab === "cash" ? (
        <CashBookPanel {...panelProps} />
      ) : tab === "banks" ? (
        <BanksPanel {...panelProps} />
      ) : tab === "masters" ? (
        <AccountsMastersPanel {...panelProps} />
      ) : tab === "expenses" ? (
        <ExpensesPanel {...panelProps} />
      ) : tab === "bills" ? (
        <BillsPanel {...panelProps} />
      ) : tab === "owner" ? (
        <OwnerLoansPanel {...panelProps} />
      ) : tab === "books" ? (
        <BooksPanel {...panelProps} />
      ) : tab === "dayclose" ? (
        <DayCloseAccountsPanel {...panelProps} />
      ) : tab === "reports" ? (
        <ReportsPanel {...panelProps} />
      ) : null}
    </ErpWorkspaceShell>
  );
}
