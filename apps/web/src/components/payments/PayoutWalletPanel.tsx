"use client";

/**
 * The Cashfree Payouts wallet in the books (director, 10 Oct 2026):
 *
 *   top-ups    money moved from Union Bank into the wallet — Dr 1110 /
 *              Cr the bank; the bank statement shows it as a debit
 *   balance    what the books say the wallet holds (1110) beside what
 *              Cashfree says; a gap is a top-up or a payment not booked
 *   approvals  vendor bills and vouchers waiting for the owner, and the
 *              school's rule for them
 */

import { useEffect, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { requestStatusSentence } from "@/lib/payoutRequests";
import { inr, payoutRequestAction, type PayoutRequestView } from "@/lib/payoutRequestsClient";
import type { PayoutState } from "@/lib/payoutsClient";

const BTN =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50";

type TopupData = {
  topups: { id: string; amountPaise: number; topupDate: string; bankLedgerCode: string; reference: string; ledgerVoucherNo: string; createdBy: string }[];
  banks: { code: string; name: string; bankAccountId: string }[];
  bookPaise: number | null;
  cashfreePaise: number | null;
};

function todayIst(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function PayoutWalletPanel({ state, onChanged }: { state: PayoutState; onChanged: () => void }) {
  const [data, setData] = useState<TopupData | null>(null);
  const [pending, setPending] = useState<PayoutRequestView[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIst());
  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");

  const [rule, setRule] = useState(state.paymentApproval);
  const [above, setAbove] = useState(state.paymentApprovalAbovePaise ? String(state.paymentApprovalAbovePaise / 100) : "");

  async function load() {
    const [t, p] = await Promise.all([
      fetch("/api/payouts/topups", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null),
      fetch("/api/payouts/requests?pending=1", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null),
    ]);
    if (t?.ok) {
      setData(t as TopupData);
      // Union Bank first: the director's account for top-ups.
      setBank((b) => b || (t as TopupData).banks.find((x) => /union|ubi/i.test(x.name))?.code || (t as TopupData).banks[0]?.code || "");
    }
    if (p?.ok) {
      setPending(p.requests ?? []);
      setCanApprove(!!p.canApprove);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    setRule(state.paymentApproval);
    setAbove(state.paymentApprovalAbovePaise ? String(state.paymentApprovalAbovePaise / 100) : "");
  }, [state.paymentApproval, state.paymentApprovalAbovePaise]);

  async function recordTopup() {
    const paise = Math.round(Number(amount || 0) * 100);
    const bankName = data?.banks.find((b) => b.code === bank)?.name || bank;
    if (!window.confirm(`Record ${inr(paise)} moved from ${bankName} into the Cashfree wallet on ${date}?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/payouts/topups", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountPaise: paise, date, bankLedgerCode: bank, reference: ref.trim() }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; topup?: { ledgerVoucherNo: string } } | null;
      if (j?.ok) {
        setMsg({ text: `Recorded as ${j.topup?.ledgerVoucherNo || "a contra voucher"}: Dr Cashfree Payouts Wallet, Cr ${bankName}.`, bad: false });
        setAmount("");
        setRef("");
        await load();
      } else {
        setMsg({ text: j?.error || `HTTP ${r.status}`, bad: true });
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveRule() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/payouts/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentApproval: rule, paymentApprovalAbovePaise: Math.round(Number(above || 0) * 100) }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      setMsg(j?.ok ? { text: "Saved.", bad: false } : { text: j?.error || `HTTP ${r.status}`, bad: true });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, action: "approve" | "reject") {
    let note = "";
    if (action === "reject") {
      note = window.prompt("Why not? (goes on the record)") ?? "";
      if (!note.trim()) return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await payoutRequestAction({ action, id, note });
      setMsg({ text: r.ok ? r.message || "Done." : r.error || "Failed", bad: !r.ok });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const gap = data && data.bookPaise !== null && data.cashfreePaise !== null ? data.cashfreePaise - data.bookPaise : null;
  const paise = Math.round(Number(amount || 0) * 100);

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
      <h4 className="text-sm font-bold">Wallet in the books</h4>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <dt className="text-[var(--muted)]">Books (1110 Cashfree Payouts Wallet)</dt>
        <dd className="font-semibold">{data?.bookPaise === null || !data ? "—" : inr(data.bookPaise)}</dd>
        <dt className="text-[var(--muted)]">Cashfree says</dt>
        <dd className="font-semibold">{data?.cashfreePaise === null || !data ? "—" : inr(data.cashfreePaise)}</dd>
        {gap !== null && gap !== 0 ? (
          <>
            <dt className="text-[var(--muted)]">Difference</dt>
            <dd className="font-semibold text-amber-800">
              {inr(Math.abs(gap))} {gap > 0 ? "more at Cashfree — a top-up not recorded here?" : "less at Cashfree — a payment not yet booked?"}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          Top-up (₹)
          <input className="field mt-1 !py-2 w-28" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </label>
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          From bank
          <select className="field mt-1 !py-2" value={bank} onChange={(e) => setBank(e.target.value)}>
            {(data?.banks ?? []).map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} · {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          Date
          <input type="date" className="field mt-1 !py-2" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-[11px] font-semibold text-[var(--muted)]">
          Bank UTR / reference
          <input className="field mt-1 !py-2 w-40" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        <button type="button" className={BTN} disabled={busy || paise < 100 || !bank || ref.trim().length < 4} onClick={() => void recordTopup()}>
          <Plus className="h-3.5 w-3.5" /> Record top-up
        </button>
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Money moved from the bank into the wallet: the bank statement shows a debit; the books record Dr Cashfree Payouts
        Wallet / Cr that bank. Not an expense.
      </p>
      {data && data.topups.length > 0 ? (
        <ul className="text-[12px]">
          {data.topups.slice(0, 5).map((t) => (
            <li key={t.id}>
              {t.topupDate} · {inr(t.amountPaise)} from {t.bankLedgerCode} · ref {t.reference} · {t.ledgerVoucherNo}
            </li>
          ))}
        </ul>
      ) : null}

      <h4 className="pt-2 text-sm font-bold">Vendor and voucher payments</h4>
      <p className="text-[12px] text-[var(--muted)]">
        {state.paymentApproval === "none"
          ? "Paid straight away — no approval."
          : state.paymentApproval === "above"
            ? `Payments above ${inr(state.paymentApprovalAbovePaise)} wait for the owner.`
            : "Every vendor bill or voucher paid from the wallet waits for the owner's approval."}
      </p>
      {state.canToggle ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-semibold text-[var(--muted)]">
            Who approves
            <select className="field mt-1 !py-2" value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}>
              <option value="owner">Owner approves every payment</option>
              <option value="above">Owner approves above an amount</option>
              <option value="none">No approval</option>
            </select>
          </label>
          {rule === "above" ? (
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Above (₹)
              <input className="field mt-1 !py-2 w-28" inputMode="decimal" value={above} onChange={(e) => setAbove(e.target.value.replace(/[^\d.]/g, ""))} />
            </label>
          ) : null}
          <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void saveRule()}>
            Save rule
          </button>
        </div>
      ) : null}
      {pending.length > 0 ? (
        <ul className="space-y-2">
          {pending.map((p) => (
            <li key={p.id} className="rounded-xl border border-[var(--border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {inr(p.amountPaise)} to {p.payeeName} {p.channel === "link" ? `· link to ${p.payeePhone}` : "· bank transfer"}
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {p.kind === "vendor_bill" ? `vendor bill ${p.billNo}` : "voucher"} · by {p.requestedBy}
                </span>
              </div>
              <p className="mt-1 text-[12px]">{p.reason}</p>
              {p.lastError ? <p className="mt-1 text-[12px] font-semibold text-amber-800">{p.lastError}</p> : null}
              <p className="mt-1 text-[11px] text-[var(--muted)]">{requestStatusSentence(p.status, p.channel)}</p>
              {canApprove || p.approvedAt ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className={BTN} disabled={busy} onClick={() => void decide(p.id, "approve")}>
                    <Check className="h-3.5 w-3.5" /> {p.approvedAt ? "Send again" : "Approve & pay"}
                  </button>
                  {canApprove ? (
                    <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void decide(p.id, "reject")}>
                      <X className="h-3.5 w-3.5" /> Turn down
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-[var(--muted)]">No vendor or voucher payments waiting.</p>
      )}
      {msg ? <p className={`text-sm font-semibold ${msg.bad ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p> : null}
    </div>
  );
}
