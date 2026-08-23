"use client";

/**
 * Store & Purchase — one module.
 *
 * This replaces the two sidebar entries (Store, with its own Purchase tab,
 * and a separate Purchase module) that were the same domain built twice. One
 * catalogue, one vendor list, one set of stock numbers.
 *
 * Masters load once here and are passed down; the tabs never refetch them on
 * their own, and never read a client-side store.
 */

import { useEffect, useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { CatalogueTab } from "@/components/inventory/CatalogueTab";
import { InvAlert, InvSpinner } from "@/components/inventory/InvUi";
import { KitsTab } from "@/components/inventory/KitsTab";
import { MastersTab } from "@/components/inventory/MastersTab";
import { VendorsTab } from "@/components/inventory/VendorsTab";
import { useInvBootstrap } from "@/lib/inventory/client";
import { ensureMastersHydrated } from "@/lib/mastersPersistence";
import { loadMasters } from "@/lib/masters";
import { Button } from "@/components/ui/button";

type Tab = "catalogue" | "vendors" | "kits" | "masters";

const TABS: { id: Tab; label: string; tone: "navy" | "sky" | "teal" | "violet" }[] =
  [
    { id: "catalogue", label: "Catalogue", tone: "navy" },
    { id: "vendors", label: "Vendors", tone: "sky" },
    { id: "kits", label: "Kits by class", tone: "teal" },
    { id: "masters", label: "Setup", tone: "violet" },
  ];

export function InventoryWorkspace() {
  const [tab, setTab] = useState<Tab>("catalogue");
  const boot = useInvBootstrap();

  // Class names come from masters, which is still a localStorage-backed
  // module. Only the labels are used here — kit assignments store class ids.
  const [classes, setClasses] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    void ensureMastersHydrated()
      .catch(() => false)
      .then(() => {
        if (!alive) return;
        const m = loadMasters();
        setClasses(
          (m.classes ?? [])
            .filter((c) => c.isActive !== false)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((c) => ({ id: c.id, label: c.name })),
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  const tabItems = useMemo(
    () => TABS.map((t) => ({ id: t.id, label: t.label, tone: t.tone })),
    [],
  );

  return (
    <ErpWorkspaceShell
      title="Store & purchase"
      subtitle="Catalogue, vendors, pricing and stock — stored on the school server"
      icon={<Boxes className="size-5" />}
    >
      <ModuleTabs
        items={tabItems}
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        aria-label="Store sections"
      />

      {boot.loading ? (
        <InvSpinner label="Loading store" />
      ) : boot.error || !boot.data ? (
        <div className="space-y-3">
          <InvAlert error={boot.error || "Could not load the store"} />
          <Button size="sm" variant="outline" onClick={boot.reload}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="pt-1">
          {tab === "catalogue" ? (
            <CatalogueTab boot={boot.data} onChanged={boot.reload} />
          ) : null}
          {tab === "vendors" ? <VendorsTab onChanged={boot.reload} /> : null}
          {tab === "kits" ? (
            <KitsTab classes={classes} onChanged={boot.reload} />
          ) : null}
          {tab === "masters" ? (
            <MastersTab boot={boot.data} onChanged={boot.reload} />
          ) : null}
        </div>
      )}
    </ErpWorkspaceShell>
  );
}
