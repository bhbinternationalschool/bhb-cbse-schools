"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { cashgramPhoneProblem } from "@/lib/cashgram";
import { inr, payoutRequestAction } from "@/lib/payoutRequestsClient";
import { usePayoutState } from "@/lib/payoutsClient";

/**
 * "Send pay link" on a payment voucher (director, 10 Oct 2026) — for a payee
 * the school holds no bank details for: an electrician, a guest examiner.
 * Cashfree texts them a link; they verify by OTP and choose UPI or bank.
 *
 * What the money is for (the debit heads on the form) is fixed now. The
 * voucher itself is NOT posted here: the server posts it — Dr those heads,
 * Cr 1110 Cashfree Payouts Wallet — when the payee collects. An expired or
 * cancelled link leaves nothing in the books.
 */
export function VoucherPayLink({
  payeeName,
  narration,
  debitLines,
  onSent,
}: {
  payeeName: string;
  narration: string;
  /** Expense / payable heads and amounts — no cash or bank lines. */
  debitLines: { accountCode: string; amountPaise: number; costCentreCode?: string }[];
  onSent: (message: string) => void;
}) {
  const state = usePayoutState();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  if (!state || !state.enabled) return null;
  const total = debitLines.reduce((n, l) => n + l.amountPaise, 0);
  if (total < 100) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] px-2.5 py-2 text-xs font-semibold"
        title="Cashfree texts the payee a link; the voucher posts when they collect"
        onClick={() => setOpen(true)}
      >
        <Link2 className="h-3.5 w-3.5" /> Send pay link
      </button>
    );
  }

  const phoneProblem = phone ? cashgramPhoneProblem(phone) : "Enter the payee's mobile";
  const missing = !payeeName.trim() ? "Fill in Party (who is paid)" : narration.trim().length < 3 ? "Fill in the narration" : "";

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] p-2 text-[11px]">
      <label className="font-semibold text-[var(--muted)]">
        Payee&apos;s mobile (only this phone can collect)
        <input className="field mt-1 !py-1.5 w-36" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(-10))} />
      </label>
      <span className="text-[var(--muted)]">
        {inr(total)} to {payeeName.trim() || "—"} · wallet {state.balancePaise === null ? "unreadable" : inr(state.balancePaise)}
      </span>
      <button
        type="button"
        className="rounded-xl bg-[var(--primary)] px-3 py-1.5 font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        disabled={busy || !!phoneProblem || !!missing}
        onClick={() => {
          if (!window.confirm(`Send a pay link for ${inr(total)} to ${payeeName.trim()} (${phone})? The voucher posts when they collect it.`)) return;
          setBusy(true);
          setMsg(null);
          void payoutRequestAction({
            action: "voucher",
            draft: { narration: narration.trim(), lines: debitLines },
            payeeName: payeeName.trim(),
            payeePhone: phone,
          })
            .then((r) => {
              if (r.ok) {
                setOpen(false);
                setPhone("");
                onSent(r.message || "Pay link prepared.");
              } else {
                setMsg({ text: r.error || "Failed", bad: true });
              }
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Sending…" : "Send link"}
      </button>
      <button type="button" className="font-semibold" disabled={busy} onClick={() => setOpen(false)}>
        Close
      </button>
      {phone && phoneProblem ? <span className="text-amber-800">{phoneProblem}</span> : null}
      {missing ? <span className="text-amber-800">{missing}</span> : null}
      {msg ? <span className={msg.bad ? "text-red-700" : "text-emerald-700"}>{msg.text}</span> : null}
    </div>
  );
}
