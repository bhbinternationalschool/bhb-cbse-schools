"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { cashgramIsDead, cashgramPhoneProblem, cashgramStatusSentence } from "@/lib/cashgram";
import { inr, staffCashgramAction, type CashgramRefundView } from "@/lib/cashgramClient";
import { usePayoutState } from "@/lib/payoutsClient";

/**
 * "Pay link" on a posted salary line (director, 10 Oct 2026) — a Cashgram:
 * Cashfree texts the staff member a link, they verify by OTP and choose UPI or
 * bank. For staff with no UPI ID or bank account on file. Sits beside Pay UPI
 * and Pay via Cashfree, and replaces them while a link is open or collected —
 * one way of paying a salary at a time.
 *
 * The server takes the amount from the run and the phone from the staff
 * record; this only says which line.
 */
export function StaffCashgramButton({
  link,
  runId,
  staffId,
  name,
  phone,
  amountPaise,
  paid,
  onChanged,
}: {
  /** The line's link (useStaffCashgrams), if any. */
  link?: CashgramRefundView;
  runId: string;
  staffId: string;
  name: string;
  phone: string;
  amountPaise: number;
  /** Paid another way already — nothing to offer. */
  paid?: boolean;
  onChanged: () => void;
}) {
  const state = usePayoutState();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState("7");
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await staffCashgramAction(body);
      setMsg({ text: r.ok ? r.message || "Done." : r.error || "Failed", bad: !r.ok });
      onChanged();
      return r.ok;
    } finally {
      setBusy(false);
    }
  }

  // A live link (open or collected) always shows, switch or no switch.
  if (link && !cashgramIsDead(link.status)) {
    const collected = link.status === "REDEEMED";
    return (
      <span className="inline-flex flex-wrap items-center gap-1 text-[10px]">
        <span
          className={collected ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}
          title={[cashgramStatusSentence(link.status), link.lastError].filter(Boolean).join(" — ")}
        >
          {collected ? `Paid by link ✓${link.utr ? ` ${link.utr.slice(-4)}` : ""}` : "Pay link sent"}
        </span>
        {!collected || !link.appliedAt ? (
          <button
            type="button"
            className="font-semibold text-[var(--brand-deep)] disabled:opacity-50"
            disabled={busy}
            onClick={() => void act({ action: "refresh", cashgramId: link.cashgramId })}
          >
            Check
          </button>
        ) : null}
        {link.status === "ACTIVE" ? (
          <button
            type="button"
            className="font-semibold text-red-700 disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Cancel the pay link to ${name}? They will not be able to collect it.`)) {
                void act({ action: "cancel", cashgramId: link.cashgramId });
              }
            }}
          >
            Cancel
          </button>
        ) : null}
        {msg ? <span className={msg.bad ? "text-red-700" : "text-emerald-700"}>{msg.text}</span> : null}
      </span>
    );
  }

  if (paid || !state || !state.enabled || !(amountPaise >= 100)) return null;
  if (cashgramPhoneProblem(phone)) {
    return (
      <span className="text-[10px] text-[var(--muted)]" title="Only the phone on the link can collect it">
        No mobile for pay link
      </span>
    );
  }

  const wallet = state.balancePaise;
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Link2 className="h-3.5 w-3.5" /> Pay link
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          if (!next) setMsg(null);
          setOpen(next);
        }}
      >
        <DialogPopup size="md">
          <DialogHeader>
            <DialogTitle>
              Send a pay link for {inr(amountPaise)} to {name}
            </DialogTitle>
            <DialogDescription>
              Cashfree texts the link to {phone}. {name} verifies with an OTP and chooses UPI or bank. The money leaves the
              school&apos;s wallet only when they collect it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-[var(--muted)]">Wallet now:</span> {wallet === null ? "unreadable" : inr(wallet)}
              {link && cashgramIsDead(link.status) ? (
                <span className="ml-2 text-[11px] text-[var(--muted)]">Last link: {cashgramStatusSentence(link.status)}</span>
              ) : null}
            </p>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Link valid for (days)
              <input
                className="field mt-1 !py-2 w-24"
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <p className="text-[11px] text-amber-800">
              Only {phone} can collect it. While the link is open, this salary cannot be paid any other way.
            </p>
            {msg ? <p className={msg.bad ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{msg.text}</p> : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Close</DialogClose>
            <Button
              type="button"
              disabled={busy || msg?.bad === false}
              onClick={() =>
                void act({ action: "send", runId, staffId, amountPaise, expiryDays: Number(days || 7) }).then((ok) => {
                  if (ok) setOpen(false);
                })
              }
            >
              {busy ? "Sending…" : "Send pay link"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
