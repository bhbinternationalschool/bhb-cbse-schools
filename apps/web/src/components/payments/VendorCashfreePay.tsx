"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { requestStatusSentence } from "@/lib/payoutRequests";
import { inr, payoutRequestAction, type PayoutRequestView } from "@/lib/payoutRequestsClient";
import { usePayoutState } from "@/lib/payoutsClient";

/**
 * "Pay from Cashfree" on an open store vendor bill (director, 10 Oct 2026).
 * By bank transfer to the vendor's account on file; by pay link to the
 * vendor's phone when there is no account. The server checks the bill's
 * balance and reads the vendor's details itself — this only says which bill
 * and how much. Nothing is booked until Cashfree confirms; then the bill is
 * settled from the wallet (1110), not from a bank.
 */
export function VendorCashfreePay({
  billId,
  billNo,
  balancePaise,
  request,
  onChanged,
}: {
  billId: string;
  billNo: string;
  balancePaise: number;
  /** The bill's request (useBillRequests), if any. */
  request?: PayoutRequestView;
  onChanged: () => void;
}) {
  const state = usePayoutState();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((balancePaise / 100).toFixed(2));
  const [channel, setChannel] = useState<"" | "transfer" | "link">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await payoutRequestAction(body);
      setMsg({ text: r.ok ? r.message || "Done." : r.error || "Failed", bad: !r.ok });
      if (r.ok) setOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const inFlight = request && (request.status === "PENDING_APPROVAL" || request.status === "SENT");
  if (inFlight) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1 text-[11px]">
        <span className="font-semibold text-amber-800" title={request.lastError || ""}>
          Cashfree: {requestStatusSentence(request.status, request.channel)} ({inr(request.amountPaise)})
        </span>
        {request.status === "SENT" ? (
          <button type="button" className="font-semibold text-[var(--brand-deep)]" disabled={busy} onClick={() => void act({ action: "refresh", id: request.id })}>
            Check
          </button>
        ) : null}
        {request.status === "PENDING_APPROVAL" && request.approvedAt ? (
          <button type="button" className="font-semibold text-[var(--brand-deep)]" disabled={busy} onClick={() => void act({ action: "approve", id: request.id })}>
            Send again
          </button>
        ) : null}
        {request.status === "PENDING_APPROVAL" || request.channel === "link" ? (
          <button
            type="button"
            className="font-semibold text-red-700"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Cancel this Cashfree payment for ${billNo}?`)) void act({ action: "cancel", id: request.id });
            }}
          >
            Cancel
          </button>
        ) : null}
        {request.lastError ? <span className="text-amber-800">{request.lastError}</span> : null}
        {msg ? <span className={msg.bad ? "text-red-700" : "text-emerald-700"}>{msg.text}</span> : null}
      </span>
    );
  }
  if (!state || !state.enabled || balancePaise < 100) {
    return msg ? <span className={`text-[11px] ${msg.bad ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</span> : null;
  }

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold"
        onClick={() => {
          setAmount((balancePaise / 100).toFixed(2));
          setOpen(true);
        }}
      >
        <Send className="h-3.5 w-3.5" /> Pay from Cashfree
      </button>
    );
  }

  const paise = Math.round(Number(amount || 0) * 100);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] p-2 text-[11px]">
      <label className="font-semibold text-[var(--muted)]">
        Amount (₹)
        <input className="field mt-1 !py-1.5 w-28" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
      </label>
      <label className="font-semibold text-[var(--muted)]">
        How
        <select className="field mt-1 !py-1.5" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
          <option value="">Bank account on file, else link to phone</option>
          <option value="transfer">Bank transfer</option>
          <option value="link">Pay link to vendor&apos;s phone</option>
        </select>
      </label>
      <span className="text-[var(--muted)]">Wallet now: {state.balancePaise === null ? "unreadable" : inr(state.balancePaise)}</span>
      <button
        type="button"
        className="rounded-xl bg-[var(--primary)] px-3 py-1.5 font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        disabled={busy || paise < 100 || paise > balancePaise}
        onClick={() => {
          if (window.confirm(`Pay ${inr(paise)} against ${billNo} from the Cashfree wallet? Money sent cannot be pulled back.`)) {
            void act({ action: "vendor", billId, amountPaise: paise, channel, reason: `Bill ${billNo}` });
          }
        }}
      >
        {busy ? "Sending…" : `Pay ${inr(paise)}`}
      </button>
      <button type="button" className="font-semibold" disabled={busy} onClick={() => setOpen(false)}>
        Close
      </button>
      {paise > balancePaise ? <span className="text-red-700">More than the {inr(balancePaise)} due</span> : null}
      {msg ? <span className={msg.bad ? "text-red-700" : "text-emerald-700"}>{msg.text}</span> : null}
    </div>
  );
}
