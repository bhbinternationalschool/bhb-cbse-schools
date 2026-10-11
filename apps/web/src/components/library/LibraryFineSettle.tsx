"use client";

import { useEffect, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import { formatInr } from "@/lib/masters";
import { LIBRARY_FINE_MODES } from "@/lib/libraryCounter";
import { libraryApi } from "@/lib/libraryCounterClient";

/**
 * Collect or waive one loan's fine. Collect books a receipt in the accounts
 * (Dr Cash/Bank, Cr Other Income) for the amount the server stored at
 * return; waive needs a reason (and the store Approve grant).
 */
export function LibraryFineSettle({
  issueId,
  finePaise,
  readOnly,
  collecting = false,
  onDone,
  onError,
}: {
  issueId: string;
  finePaise: number;
  readOnly: boolean;
  /** A Collect started and did not finish: it can only be finished, not waived. */
  collecting?: boolean;
  onDone: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<string>("cash");
  const [ref, setRef] = useState("");
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [banks, setBanks] = useState<{ code: string; name: string }[] | null>(null);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [bankCode, setBankCode] = useState("");

  // UPI / bank money lands in one of the school's real bank accounts — the
  // clerk picks which (preselected only when there is exactly one).
  useEffect(() => {
    if (mode === "cash" || banks || banksError) return;
    void libraryApi.fineBanks().then((r) => {
      if (!r.ok) return setBanksError(r.error);
      setBanks(r.banks);
      if (r.banks.length === 1) setBankCode(r.banks[0]!.code);
    });
  }, [mode, banks, banksError]);

  if (readOnly) return <span className="text-xs text-[var(--muted)]">{formatInr(finePaise)} owed</span>;

  async function collect() {
    setBusy(true);
    const r = await libraryApi.collectFine({ issueId, mode, bankCode: mode === "cash" ? undefined : bankCode, ref: ref.trim() });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    await onDone(`Fine ${formatInr(r.finePaise)} collected · receipt ${r.voucherNo}`);
  }

  async function waive() {
    setBusy(true);
    const r = await libraryApi.waiveFine({ issueId, reason: reason.trim() });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    setWaiving(false);
    await onDone(`Fine ${formatInr(r.finePaise)} waived`);
  }

  if (waiving) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${field} h-8 max-w-[14rem] text-xs`}
          placeholder="Why is it waived?"
          aria-label="Reason for waiving the fine"
        />
        <button type="button" className={btn} disabled={busy || reason.trim().length < 3} onClick={() => void waive()}>
          Waive {formatInr(finePaise)}
        </button>
        <button type="button" className={btnOutline} onClick={() => setWaiving(false)}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        className={`${field} h-8 w-auto text-xs`}
        aria-label="How the fine was paid"
      >
        {LIBRARY_FINE_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {mode !== "cash" ? (
        banksError ? (
          <span className="text-xs text-[var(--danger)]">Could not load bank accounts: {banksError}</span>
        ) : !banks ? (
          <span className="text-xs text-[var(--muted)]">Loading banks…</span>
        ) : banks.length === 0 ? (
          <span className="text-xs text-[var(--danger)]">No bank account in Accounts — take cash</span>
        ) : (
          <select
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            className={`${field} h-8 w-auto text-xs`}
            aria-label="Bank account that received it"
          >
            <option value="">Which bank?</option>
            {banks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
        )
      ) : null}
      {mode !== "cash" ? (
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          className={`${field} h-8 max-w-[10rem] text-xs`}
          placeholder="UTR / reference"
          aria-label="Payment reference"
        />
      ) : null}
      <button type="button" className={btn} disabled={busy || (mode !== "cash" && !bankCode)} onClick={() => void collect()}>
        {collecting ? "Finish collecting" : "Collect"} {formatInr(finePaise)}
      </button>
      {collecting ? (
        <span className="text-xs text-[var(--muted)]">A collection was started — finish it; it will not book twice.</span>
      ) : (
        <button type="button" className={btnOutline} disabled={busy} onClick={() => setWaiving(true)}>
          Waive…
        </button>
      )}
    </div>
  );
}
