"use client";

/**
 * Hold a report panel until the stores its reports read have loaded from
 * the server (lib/reportDataGuard).
 *
 * The panels read their stores once, on mount — class lists, lead lists,
 * project pickers, previews. Mounted before the data arrived they kept the
 * empty placeholder: Reports Center → Admissions on a fresh page showed and
 * exported empty reports, staff attendance showed all zeros. Behind this
 * gate the panel mounts only once its data is real, and a store that could
 * not be read is said so, with a retry — never shown as empty.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { loadReportData, missingReportDesks, type ReportDesk } from "@/lib/reportDataGuard";
import { btnOutline } from "@/components/ui/erp-ui";

type GateState = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; error: string };

export function ReportDataGate({ desks, children }: { desks: readonly ReportDesk[]; children: ReactNode }) {
  const key = desks.join(",");
  // Decided in the effect, so the server render and the first browser
  // render agree; a desk already loaded resolves on the first effect.
  const [state, setState] = useState<GateState>({ kind: "loading" });

  const load = useCallback(() => {
    let live = true;
    if (missingReportDesks(desks).length === 0) {
      setState({ kind: "ready" });
      return () => undefined;
    }
    setState({ kind: "loading" });
    void loadReportData(desks).then((r) => {
      if (!live) return;
      setState(r.ok ? { kind: "ready" } : { kind: "failed", error: r.error });
    });
    return () => {
      live = false;
    };
    // `key` stands for `desks` (a fresh array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => load(), [load]);

  if (state.kind === "ready") return <>{children}</>;
  if (state.kind === "loading") {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]" role="status">
        Loading this module&apos;s records from the server…
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--danger-soft)] px-4 py-4 text-sm" role="alert">
      <p className="font-medium text-[var(--danger)]">{state.error}</p>
      <button type="button" className={`${btnOutline} mt-3`} onClick={() => load()}>
        Try again
      </button>
    </div>
  );
}
