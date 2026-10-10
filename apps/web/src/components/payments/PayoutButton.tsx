"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
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
import type { UpiPaid } from "@/components/payments/UpiPayButton";
import { isVpa } from "@/lib/upiPay";
import type { UpiTargetKind } from "@/lib/upiProofMatch";
import { payoutStatus, sendPayout, usePayoutState } from "@/lib/payoutsClient";

/**
 * "Pay via Cashfree" — sent from the school's Cashfree Payouts wallet, the UTR
 * recorded by itself when Cashfree confirms (director, 7 Oct 2026). Sits next
 * to Pay by UPI and is only offered when the owner's switch is on and the
 * wallet holds the amount; otherwise it says why and Pay by UPI is the way.
 *
 * targetId "draft:…" — the item is not saved yet (an advance before Issue, a
 * voucher before Post). Its screen records the UTR against the real id when
 * it saves, from `onPaid`, exactly as for Pay by UPI.
 */

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function todayIst(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

const POLL_MS = 3000;
const POLL_TRIES = 20;

export function PayoutButton({
  payee,
  amountPaise,
  note,
  target,
  subjectId,
  period,
  onPaid,
  paid,
}: {
  payee: { name: string; vpa?: string; accountNumber?: string; ifsc?: string; phone?: string };
  amountPaise: number;
  note: string;
  target: { kind: UpiTargetKind; id: string; label: string };
  /** Who is paid (staff id) — part of the transfer id. */
  subjectId: string;
  /** What distinguishes this payment from the next (salary month, date). */
  period: string;
  onPaid: (paid: UpiPaid) => void;
  /** Already paid — nothing to offer. */
  paid?: boolean;
}) {
  const state = usePayoutState();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  if (paid || !state || !state.enabled || !(amountPaise >= 100)) return null;

  const vpa = isVpa(payee.vpa || "") ? String(payee.vpa).toLowerCase() : "";
  const account = (payee.accountNumber || "").replace(/\s/g, "");
  const ifsc = (payee.ifsc || "").trim().toUpperCase();
  const byBank = Boolean(account && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc));
  if (!vpa && !byBank) {
    return <span className="text-[10px] text-[var(--muted)]" title="Add their UPI ID or bank account on the staff record">No UPI ID / bank for Cashfree</span>;
  }
  if (state.balancePaise === null) {
    return <span className="text-[10px] text-amber-800">Cashfree wallet unreadable — pay by UPI</span>;
  }
  if (state.balancePaise < amountPaise) {
    return <span className="text-[10px] font-semibold text-amber-800">Cashfree wallet low: {inr(state.balancePaise)} left — pay by UPI</span>;
  }

  // Not saved yet: the screen's own save (Issue advance) records it.
  const saveHint = target.id.startsWith("draft:") ? " — now save it on the screen (e.g. Issue advance)." : "";
  const how = vpa && !byBank ? `UPI ${vpa}` : `bank ••••${account.slice(-4)} (${ifsc})`;

  async function settle(transferId: string) {
    for (let i = 0; i < POLL_TRIES && live.current; i += 1) {
      const s = await payoutStatus(transferId);
      if (s?.status === "SUCCESS" && /^\d{12}$/.test(s.utr)) {
        onPaid({ utr: s.utr, paidOn: todayIst(), payeeVpa: vpa, fromScreenshot: false, viaPayout: true });
        setMsg({ text: `Paid ✓ UTR ${s.utr}${saveHint}`, bad: false });
        return;
      }
      if (s && ["FAILED", "REJECTED", "REVERSED"].includes(s.status)) {
        setMsg({ text: `Cashfree says ${s.status} — not paid. Use Pay by UPI.`, bad: true });
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    setMsg({
      text: "Sent — Cashfree is still processing. Press Pay via Cashfree again later to check; it will not pay twice.",
      bad: false,
    });
  }

  async function pay() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendPayout({
        targetKind: target.kind,
        targetId: target.id,
        targetLabel: target.label,
        subjectId,
        period,
        amountPaise,
        payee: byBank ? { name: payee.name, accountNumber: account, ifsc, phone: payee.phone } : { name: payee.name, vpa, phone: payee.phone },
        remarks: note,
      });
      if (!r.ok) {
        setMsg({ text: [r.error, r.warning].filter(Boolean).join(" "), bad: true });
        return;
      }
      if (r.status === "SUCCESS" && /^\d{12}$/.test(r.utr)) {
        onPaid({ utr: r.utr, paidOn: todayIst(), payeeVpa: vpa, fromScreenshot: false, viaPayout: true });
        setMsg({ text: `Paid ✓ UTR ${r.utr}${saveHint}`, bad: false });
        return;
      }
      setMsg({ text: "Sent — waiting for Cashfree to confirm…", bad: false });
      await settle(r.transferId);
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Send className="h-3.5 w-3.5" /> Pay via Cashfree
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
              Send {inr(amountPaise)} to {payee.name}
            </DialogTitle>
            <DialogDescription>
              From the school&apos;s Cashfree wallet, by {how}. The UTR is recorded by itself when Cashfree confirms.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-[var(--muted)]">For:</span> {target.label}
            </p>
            <p>
              <span className="text-[var(--muted)]">Wallet now:</span> {inr(state.balancePaise)}
            </p>
            <p className="text-[11px] text-amber-800">Money sent cannot be pulled back. Check the name and the amount.</p>
            {msg ? <p className={msg.bad ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{msg.text}</p> : null}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>Close</DialogClose>
            <Button type="button" disabled={busy || msg?.text.startsWith("Paid ✓")} onClick={() => void pay()}>
              {busy ? "Sending…" : `Send ${inr(amountPaise)}`}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
