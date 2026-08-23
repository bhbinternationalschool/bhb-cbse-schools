"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  listAccountsPostingFailures,
  retryAccountsPostingFailures,
  type AccountsPostingFailure,
} from "@/lib/accountsPostingFailures";

function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Entries the desk recorded that never reached the books.
 *
 * Fee receipts, store issues and day closes post to accounts from a floating
 * promise so a books problem cannot block the counter. When that posting is
 * refused — a role without `accounts:edit`, no bank master for a UPI tender,
 * a closed fiscal year — it lands in the retry queue. Without this banner the
 * only trace was a console line, which is how the books drifted from the fee
 * desk unnoticed (audit 2026-08-23).
 */
export function UnpostedEntriesBanner({
  onRefresh,
}: {
  onRefresh?: () => void;
}) {
  const [rows, setRows] = useState<AccountsPostingFailure[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const reload = useCallback(() => {
    setRows(listAccountsPostingFailures());
  }, []);

  useEffect(() => {
    reload();
    if (typeof window === "undefined") return;
    const onFailed = () => reload();
    window.addEventListener("bhb-accounts-posting-failed", onFailed);
    return () =>
      window.removeEventListener("bhb-accounts-posting-failed", onFailed);
  }, [reload]);

  if (rows.length === 0) return null;

  const totalPaise = rows.reduce((n, r) => n + r.amountPaise, 0);

  async function retryAll() {
    setBusy(true);
    setResult(null);
    try {
      const res = await retryAccountsPostingFailures();
      setResult(
        res.stillFailing === 0
          ? `All ${res.resolved} entries posted.`
          : `${res.resolved} posted · ${res.stillFailing} still failing.`,
      );
      reload();
      onRefresh?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700/60 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              {rows.length} {rows.length === 1 ? "entry" : "entries"} did not
              reach the books ({formatInr(totalPaise)})
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
              These were recorded on the desk but not posted to the ledger. Fix
              the reason below, then retry — posting again is safe, nothing is
              counted twice.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void retryAll()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/70"
        >
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
          {busy ? "Posting…" : "Retry all"}
        </button>
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-amber-200 pt-3 dark:border-amber-800">
        {rows.slice(0, 6).map((row) => (
          <li key={row.id} className="text-amber-900 dark:text-amber-200">
            <span className="font-medium">{row.label || row.sourceId}</span>
            {row.amountPaise > 0 ? (
              <span className="tabular-nums"> · {formatInr(row.amountPaise)}</span>
            ) : null}
            <span className="block text-xs text-amber-700 dark:text-amber-400">
              {row.reason}
            </span>
          </li>
        ))}
        {rows.length > 6 ? (
          <li className="text-xs text-amber-700 dark:text-amber-400">
            …and {rows.length - 6} more.
          </li>
        ) : null}
      </ul>

      {result ? (
        <p className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-200">
          {result}
        </p>
      ) : null}
    </div>
  );
}
