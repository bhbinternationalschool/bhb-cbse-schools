"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import {
  clearDeskSyncStatus,
  deskSyncState,
  explainDeskSyncFailure,
  type DeskSyncState,
} from "@/lib/deskSyncStatus";

/**
 * "This has not been saved to the server."
 *
 * The desk writes to the browser first and pushes afterwards, so a refused
 * push leaves a screen that looks saved and a server that never heard about
 * it. Until now the only trace was a console line, which is how the school's
 * real bank details were entered and remained absent from production with
 * nothing anywhere saying so.
 *
 * Deliberately alarming in tone, because the state it describes is one where
 * the operator believes their work is safe and it is not.
 */
export function DeskSyncBanner({ onRetry }: { onRetry?: () => Promise<boolean> }) {
  const [state, setState] = useState<DeskSyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const reload = useCallback(() => {
    const s = deskSyncState("accounts");
    setState(s.consecutiveFailures > 0 ? s : null);
  }, []);

  useEffect(() => {
    reload();
    if (typeof window === "undefined") return;
    const onFailed = () => reload();
    window.addEventListener("bhb-desk-sync-failed", onFailed);
    return () => window.removeEventListener("bhb-desk-sync-failed", onFailed);
  }, [reload]);

  if (!state) return null;

  async function retry() {
    if (!onRetry) return;
    setBusy(true);
    setOutcome(null);
    try {
      const ok = await onRetry();
      if (ok) {
        clearDeskSyncStatus("accounts");
        setState(null);
        setOutcome(null);
      } else {
        setOutcome("Still not saved — the server refused it again.");
        reload();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="alert"
      className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800/70 dark:bg-red-950/30"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CloudOff
            className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden
          />
          <div>
            <p className="font-semibold text-red-900 dark:text-red-200">
              Your accounts changes are not saved on the server
            </p>
            <p className="mt-0.5 text-red-800 dark:text-red-300">
              {explainDeskSyncFailure(state)}
            </p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-400">
              {state.consecutiveFailures} failed{" "}
              {state.consecutiveFailures === 1 ? "attempt" : "attempts"}
              {state.lastSuccessAt
                ? ` · last successful save ${new Date(state.lastSuccessAt).toLocaleString("en-IN")}`
                : " · nothing from this browser has ever reached the server"}
            </p>
            <p className="mt-2 text-xs text-red-800 dark:text-red-300">
              Do not make the same edit in another browser — that one still holds
              the old figures and would overwrite this.
            </p>
            {state.lastError ? (
              <p className="mt-1 font-mono text-xs text-red-700 dark:text-red-400">
                {state.lastError}
              </p>
            ) : null}
          </div>
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-400 bg-white px-3 py-1.5 font-semibold text-red-900 hover:bg-red-100 disabled:opacity-60 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100 dark:hover:bg-red-900/70"
          >
            <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
            {busy ? "Saving…" : "Try saving again"}
          </button>
        ) : null}
      </div>
      {outcome ? (
        <p className="mt-2 text-xs font-medium text-red-900 dark:text-red-200">{outcome}</p>
      ) : null}
    </div>
  );
}
