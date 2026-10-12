"use client";

/**
 * Fees → Bulk & PDC (/fees/tools): three fee jobs the old SStudy ERP did —
 * post-dated cheques, bulk payments, concession templates.
 *
 * A page of its own, linked from the Fee Take toolbar, so it loads none of
 * the fee counter's desk data: every panel reads the server
 * (/api/fees/tools/*). The tab is kept in the URL (?tab=) with
 * history.replaceState, as Defaulters does, so the module guide can follow it.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { BulkPaymentPanel } from "@/components/fees/BulkPaymentPanel";
import { ConcessionTemplatesPanel } from "@/components/fees/ConcessionTemplatesPanel";
import { PdcPanel } from "@/components/fees/PdcPanel";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabButton } from "@/components/ui/ModuleTabs";
import { MODULE_TAB_CONTAINER_CLASS } from "@/components/ui/modern-tab-bar";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { canApproveConcession, canGrantConcession, canSeeModuleTab, canWriteModuleTab } from "@/lib/rbac";

type Tab = "pdc" | "bulk" | "templates";
const TAB_ORDER: Tab[] = ["pdc", "bulk", "templates"];

function tabFromUrl(): Tab {
  if (typeof window === "undefined") return "pdc";
  const t = new URL(window.location.href).searchParams.get("tab");
  return t === "bulk" || t === "templates" ? t : "pdc";
}

export function FeeToolsTabs() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [tab, setTab] = useState<Tab>("pdc");

  useEffect(() => {
    setTab(tabFromUrl());
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next !== "pdc") url.searchParams.set("tab", next);
    else url.searchParams.delete("tab");
    window.history.replaceState({}, "", url.toString());
  }

  // Each tab opens on the Fees grant or its own function (fees.pdc,
  // fees.bulk_payment, fees.concession_templates). The buttons follow the
  // server's rules; the server enforces them anyway.
  const shown = TAB_ORDER.filter((t) => canSeeModuleTab(session, null, "fees", t));
  const firstShown = shown[0] ?? null;
  useEffect(() => {
    if (firstShown && !shown.includes(tab)) setTab(firstShown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstShown, tab]);
  const canView = shown.includes(tab);
  const canCollect = !readOnly && canWriteModuleTab(session, null, "fees", tab, "create");
  const canClose = !readOnly && canWriteModuleTab(session, null, "fees", tab, "edit");
  const canGrant = !readOnly && canGrantConcession(session, null);
  const canApprove = canApproveConcession(session, null);

  return (
    <ErpWorkspaceShell
      title="Bulk & PDC"
      subtitle="Post-dated cheques · one payment for many children · reusable concession templates"
      icon={<Layers className="size-6" aria-hidden />}
      toolbar={
        <div className={MODULE_TAB_CONTAINER_CLASS}>
          {shown.includes("pdc") ? (
            <ModuleTabButton active={tab === "pdc"} onClick={() => choose("pdc")} tone="amber" size="md">
              Post-dated cheques
            </ModuleTabButton>
          ) : null}
          {shown.includes("bulk") ? (
            <ModuleTabButton active={tab === "bulk"} onClick={() => choose("bulk")} tone="green" size="md">
              Bulk payment
            </ModuleTabButton>
          ) : null}
          {shown.includes("templates") ? (
            <ModuleTabButton active={tab === "templates"} onClick={() => choose("templates")} tone="violet" size="md">
              Concession templates
            </ModuleTabButton>
          ) : null}
          <Link
            href="/fees"
            className="inline-flex items-center rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
          >
            ← Fee Take
          </Link>
        </div>
      }
    >
      <div className="mt-6">
        {!canView ? (
          <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
            You need access to Fees to use this screen.
          </p>
        ) : tab === "pdc" ? (
          <PdcPanel canCollect={canCollect} canClose={canClose} />
        ) : tab === "bulk" ? (
          <BulkPaymentPanel canCollect={canCollect} />
        ) : (
          <ConcessionTemplatesPanel canGrant={canGrant} canApprove={canApprove} />
        )}
      </div>
    </ErpWorkspaceShell>
  );
}
