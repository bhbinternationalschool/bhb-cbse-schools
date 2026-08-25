"use client";

import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import {
  AccountsMastersPanel,
} from "@/components/accounts/AccountsMastersPanel";
import { UnpostedEntriesBanner } from "@/components/accounts/UnpostedEntriesBanner";
import { DeskSyncBanner } from "@/components/accounts/DeskSyncBanner";
import {
  BankReconPanel,
  LedgerBookPanel,
  LedgerReportsPanel,
} from "@/components/accounts/LedgerPanels";
import {
  ChequesPanel,
  LegacyBookNotice,
  VoucherEntryPanel,
} from "@/components/accounts/LedgerEntryPanels";
import {
  BillsPanel,
  DayCloseAccountsPanel,
  OwnerLoansPanel,
} from "@/components/accounts/AccountsPanels";
import { useDemoSession } from "@/components/shell/SessionContext";
import { hasPermission } from "@/lib/rbac";
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
  | "book"
  | "vouchers"
  | "bookreports"
  | "recon"
  | "masters"
  | "bills"
  | "owner"
  | "dayclose";

/**
 * Where a retired browser-book tab now lives in the server book. Deep links
 * and dashboard cards still point at the old ids; they land on the
 * replacement instead of a dead tab.
 */
const LEGACY_TAB_MAP: Record<string, AccountsTab> = {
  daybook: "vouchers",
  cash: "bookreports",
  banks: "bookreports",
  expenses: "vouchers",
  books: "bookreports",
  reports: "bookreports",
};

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "book", label: "Server book", tone: "green" },
  { id: "vouchers", label: "Vouchers", tone: "green" },
  { id: "bookreports", label: "Book reports", tone: "green" },
  { id: "recon", label: "Bank recon", tone: "green" },
  { id: "masters", label: "Masters", tone: "violet" },
  { id: "bills", label: "Bills & AP", tone: "violet" },
  { id: "owner", label: "Owner loans", tone: "coral" },
  { id: "dayclose", label: "Day close", tone: "rose" },
];

export function AccountsWorkspace() {
  const session = useDemoSession();
  // Running the projection is a bulk write to the book; the button only
  // renders for someone the API would let through anyway.
  const canApprove = hasPermission(session, null, "accounts", "approve");
  const [tab, setTab] = useState<AccountsTab>("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: AccountsTab[] = [
      "dashboard",
      "book",
      "vouchers",
      "bookreports",
      "recon",
      "masters",
      "bills",
      "owner",
      "dayclose",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as AccountsTab);
    else if (raw && LEGACY_TAB_MAP[raw]) setTab(LEGACY_TAB_MAP[raw]);
  }, []);
  const [state, setState] = useState<AccountsState | null>(() =>
    typeof window !== "undefined" ? seedAccountsIfEmpty() : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const actorName = session.fullName || "Accounts user";
  const [entryTick, setEntryTick] = useState(0);

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

      <DeskSyncBanner
        onRetry={async () => {
          const { retryAccountsDeskSync } = await import("@/lib/accountsNormalizedClient");
          const { loadAccounts: load } = await import("@/lib/accountsStore");
          const ok = await retryAccountsDeskSync(load());
          refresh();
          return ok;
        }}
      />

      <UnpostedEntriesBanner onRefresh={refresh} />

      {!state ? (
        <div className="mt-6">
          <SkeletonModulePage />
        </div>
      ) : tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="accounts"
          refreshKey={tick}
          // Dashboard cards still name retired tabs; land them on the
          // server-book replacement instead of a blank screen.
          onNavigateTab={(t) => setTab(LEGACY_TAB_MAP[t] ?? (t as AccountsTab))}
        />
      ) : tab === "book" ? (
        <LedgerBookPanel canApprove={canApprove} />
      ) : tab === "vouchers" ? (
        <div className="mt-4 space-y-4">
          <VoucherEntryPanel
            banks={(state.bankAccounts ?? [])
              .filter((b) => b.isActive !== false)
              .map((b) => ({ id: b.id, name: b.name }))}
            actor={actorName}
            onPosted={() => setEntryTick((n) => n + 1)}
          />
          <ChequesPanel
            banks={(state.bankAccounts ?? [])
              .filter((b) => b.isActive !== false)
              .map((b) => ({ id: b.id, name: b.name }))}
            actor={actorName}
            refreshKey={entryTick}
          />
        </div>
      ) : tab === "bookreports" ? (
        <LedgerReportsPanel />
      ) : tab === "recon" ? (
        <BankReconPanel
          banks={(state.bankAccounts ?? [])
            .filter((b) => b.isActive !== false)
            .map((b) => ({ id: b.id, name: b.name }))}
        />
      ) : tab === "masters" ? (
        <AccountsMastersPanel {...panelProps} />
      ) : tab === "bills" ? (
        <BillsPanel {...panelProps} />
      ) : tab === "owner" ? (
        <>
          <LegacyBookNotice tab="Owner loans — use the owner-loan presets in Vouchers" />
          <OwnerLoansPanel {...panelProps} />
        </>
      ) : tab === "dayclose" ? (
        <DayCloseAccountsPanel {...panelProps} />
      ) : null}
    </ErpWorkspaceShell>
  );
}
