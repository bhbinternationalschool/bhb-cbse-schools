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
import { useAccessData } from "@/components/shell/useAccessData";
import { ModuleTabButton } from "@/components/ui/ModuleTabs";
import { MODULE_TAB_CONTAINER_CLASS } from "@/components/ui/modern-tab-bar";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { canApproveConcession, canGrantConcession, hasPermission } from "@/lib/rbac";

type Tab = "pdc" | "bulk" | "templates";

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

  // The buttons follow the server's rules; the server enforces them anyway.
  // Decided from the loaded roles + roster (assignments count), never before.
  const access = useAccessData();
  const am = access.masters;
  const ar = access.rbac ?? undefined;
  const canView = access.ready && hasPermission(session, am, "fees", "view", ar);
  const canCollect = access.ready && !readOnly && hasPermission(session, am, "fees", "create", ar);
  const canClose = access.ready && !readOnly && hasPermission(session, am, "fees", "edit", ar);
  const canGrant = access.ready && !readOnly && canGrantConcession(session, am, ar);
  const canApprove = access.ready && canApproveConcession(session, am, ar);

  return (
    <ErpWorkspaceShell
      title="Bulk & PDC"
      subtitle="Post-dated cheques · one payment for many children · reusable concession templates"
      icon={<Layers className="size-6" aria-hidden />}
      toolbar={
        <div className={MODULE_TAB_CONTAINER_CLASS}>
          <ModuleTabButton active={tab === "pdc"} onClick={() => choose("pdc")} tone="amber" size="md">
            Post-dated cheques
          </ModuleTabButton>
          <ModuleTabButton active={tab === "bulk"} onClick={() => choose("bulk")} tone="green" size="md">
            Bulk payment
          </ModuleTabButton>
          <ModuleTabButton active={tab === "templates"} onClick={() => choose("templates")} tone="violet" size="md">
            Concession templates
          </ModuleTabButton>
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
        {!access.ready ? (
          <p className="text-sm text-[var(--muted)]">Checking access…</p>
        ) : !canView ? (
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
