"use client";

/**
 * Refund a family by Cashgram link, from the fee desk (director, 10 Oct 2026).
 *
 * For money paid in cash or by UPI to the school — the school holds no bank
 * details for those families. Cashfree texts the parent a link; they verify the
 * phone by OTP and choose UPI or bank. Online payments are not refunded here:
 * they go back the way they came (Online refund on the receipt).
 *
 * The office chooses what the refund does to the fee record:
 *   Return extra paid   the household's "Refund Amount"; no receipt changes
 *   Cancel a receipt    the whole receipt, voided once the parent has the money
 *
 * Whether the owner approves first is the school's rule (Settings → Payouts).
 * Nothing in the fee book or the ledger changes until the parent collects.
 */

import { useState } from "react";
import { Copy, Link2, RefreshCw, X } from "lucide-react";
import { cashgramIsOpen, cashgramNeedsApproval, cashgramPhoneProblem, cashgramStatusSentence } from "@/lib/cashgram";
import {
  cashgramAction,
  inr,
  type CashgramRefundView,
  type HouseholdRefundableView,
} from "@/lib/cashgramClient";

const BTN =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50";

type Loaded = {
  position: HouseholdRefundableView;
  refunds: CashgramRefundView[];
  approval: { rule: "owner" | "above" | "none"; abovePaise: number };
  payouts: { ok: boolean; why: string };
  canApprove: boolean;
};

export function CashgramRefundPanel({ householdId, readOnly }: { householdId: string; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  const [effect, setEffect] = useState<"excess" | "void">("excess");
  const [voucherId, setVoucherId] = useState("");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");

  async function load() {
    setLoading(true);
    try {
      const j = (await fetch(`/api/fees/cashgram-refund?householdId=${encodeURIComponent(householdId)}`, {
        credentials: "same-origin",
      })
        .then((r) => r.json())
        .catch(() => null)) as (Loaded & { ok?: boolean; error?: string }) | null;
      if (!j?.ok) {
        setMsg({ text: j?.error || "Could not load refunds", bad: true });
        return;
      }
      setData(j);
      setName((n) => n || j.position.guardianName);
      setPhone((p) => p || j.position.phone);
    } finally {
      setLoading(false);
    }
  }

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await cashgramAction(body);
      setMsg({ text: r.ok ? r.message || "Done." : r.error || "Failed", bad: !r.ok });
      await load();
      return r.ok;
    } finally {
      setBusy(false);
    }
  }

  if (!householdId) return null;
  if (!open) {
    return (
      <button
        type="button"
        className={BTN_OUTLINE + " mt-2"}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Link2 className="h-3.5 w-3.5" /> Refund by link (cash / UPI payments)
      </button>
    );
  }

  const pos = data?.position;
  const eligible = pos?.receipts.filter((r) => !r.problem) ?? [];
  const picked = pos?.receipts.find((r) => r.voucherId === voucherId);
  const amountPaise = effect === "void" ? picked?.totalPaise ?? 0 : Math.round(Number(amount || 0) * 100);
  const phoneProblem = phone ? cashgramPhoneProblem(phone) : "Enter the parent's mobile";
  const needsApproval =
    !!data && !data.canApprove && cashgramNeedsApproval(data.approval.rule, data.approval.abovePaise, amountPaise);
  const amountProblem =
    amountPaise < 100
      ? "Enter an amount"
      : effect === "excess" && pos && amountPaise > pos.excessRefundablePaise
        ? `Only ${inr(pos.excessRefundablePaise)} has been paid over the bill`
        : "";
  const canSubmit =
    !readOnly && !busy && !!data && !phoneProblem && !amountProblem && name.trim().length >= 2 && reason.trim().length >= 3 &&
    (effect === "excess" || !!picked);

  return (
    <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 font-bold">
          <Link2 className="h-4 w-4" /> Refund by link
        </h4>
        <div className="flex gap-2">
          <button type="button" className={BTN_OUTLINE} disabled={loading} onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={BTN_OUTLINE} onClick={() => setOpen(false)} aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        For cash or UPI payments. Cashfree texts the parent a link; they verify by OTP and choose UPI or bank. Online
        payments go back through Online refund on the receipt instead.
      </p>

      {loading && !data ? <p className="mt-2 text-[12px] text-[var(--muted)]">Loading…</p> : null}

      {data && !data.payouts.ok ? (
        <p className="mt-2 rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-[12px] font-semibold">
          Links cannot go out right now: {data.payouts.why}. You can still prepare one; it is sent once Payouts is on.
        </p>
      ) : null}

      {data && data.refunds.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {data.refunds.map((r) => (
            <li key={r.cashgramId} className="rounded-xl border border-[var(--border)] p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {inr(r.amountPaise)} · {r.feeEffect === "void" ? `cancels ${r.receiptNo}` : "extra paid"} · {r.payeePhone}
                </span>
                <span className="text-[11px] text-[var(--muted)]">{new Date(r.createdAt).toLocaleDateString("en-IN")}</span>
              </div>
              <p className="text-[12px]">{cashgramStatusSentence(r.status)}{r.utr ? ` · UTR ${r.utr}` : ""}</p>
              {r.lastError ? <p className="text-[12px] font-semibold text-amber-800">{r.lastError}</p> : null}
              {!readOnly && (cashgramIsOpen(r.status) || (r.status === "REDEEMED" && !r.appliedAt)) ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  {r.cashgramLink ? (
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      onClick={() => void navigator.clipboard?.writeText(r.cashgramLink).then(() => setMsg({ text: "Link copied.", bad: false }))}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy link
                    </button>
                  ) : null}
                  {r.status !== "PENDING_APPROVAL" ? (
                    <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void act({ action: "refresh", cashgramId: r.cashgramId })}>
                      Check status
                    </button>
                  ) : null}
                  {r.status === "PENDING_APPROVAL" && (data.canApprove || r.approvedAt) ? (
                    <button type="button" className={BTN} disabled={busy} onClick={() => void act({ action: "approve", cashgramId: r.cashgramId })}>
                      {r.approvedAt ? "Send again" : "Approve & send"}
                    </button>
                  ) : null}
                  {r.status === "PENDING_APPROVAL" || r.status === "ACTIVE" ? (
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Cancel this refund link? The parent will not be able to collect it.")) {
                          void act({ action: "cancel", cashgramId: r.cashgramId });
                        }
                      }}
                    >
                      Cancel link
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {data && pos && !readOnly ? (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap gap-3 text-[12px]">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={effect === "excess"} onChange={() => setEffect("excess")} />
              Return extra paid <span className="text-[var(--muted)]">(up to {inr(pos.excessRefundablePaise)})</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={effect === "void"} onChange={() => setEffect("void")} />
              Cancel a receipt <span className="text-[var(--muted)]">(withdrawal, double payment)</span>
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {effect === "void" ? (
              <label className="text-[11px] font-semibold text-[var(--muted)] sm:col-span-2">
                Receipt
                <select className="field mt-1 !py-2" value={voucherId} onChange={(e) => setVoucherId(e.target.value)}>
                  <option value="">Choose a receipt…</option>
                  {eligible.map((r) => (
                    <option key={r.voucherId} value={r.voucherId}>
                      {r.receiptNo} · {r.collectionDate} · {inr(r.totalPaise)} · {r.modes}
                    </option>
                  ))}
                </select>
                {pos.receipts.length > eligible.length ? (
                  <span className="mt-1 block font-normal">
                    {pos.receipts.length - eligible.length} receipt(s) not listed — paid online, an uncleared cheque, or a link already open.
                  </span>
                ) : null}
              </label>
            ) : (
              <label className="text-[11px] font-semibold text-[var(--muted)]">
                Amount (₹)
                <input className="field mt-1 !py-2" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
              </label>
            )}
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Link valid for (days)
              <input className="field mt-1 !py-2" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Parent&apos;s name
              <input className="field mt-1 !py-2" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)]">
              Parent&apos;s mobile (only this phone can collect)
              <input className="field mt-1 !py-2" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(-10))} />
            </label>
            <label className="text-[11px] font-semibold text-[var(--muted)] sm:col-span-2">
              Why (goes on the record)
              <input className="field mt-1 !py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. TC issued in October; paid November twice" />
            </label>
          </div>

          {phone && phoneProblem ? <p className="text-[12px] font-semibold text-amber-800">{phoneProblem}</p> : null}
          {amountPaise > 0 && amountProblem ? <p className="text-[12px] font-semibold text-amber-800">{amountProblem}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BTN}
              disabled={!canSubmit}
              onClick={() => {
                const what = effect === "void" ? `cancel receipt ${picked?.receiptNo}` : "return extra paid";
                if (!window.confirm(`${needsApproval ? "Prepare" : "Send"} a refund link for ${inr(amountPaise)} to ${phone} (${what})?`)) return;
                void act({
                  action: "prepare",
                  feeEffect: effect,
                  householdId,
                  voucherId: effect === "void" ? voucherId : "",
                  amountPaise,
                  payeeName: name,
                  payeePhone: phone,
                  payeeEmail: pos.email,
                  reason,
                  expiryDays: Number(days || 7),
                }).then((ok) => {
                  if (ok) {
                    setAmount("");
                    setReason("");
                    setVoucherId("");
                  }
                });
              }}
            >
              <Link2 className="h-3.5 w-3.5" /> {needsApproval ? "Prepare for approval" : "Send refund link"}
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              {needsApproval ? "The owner approves it before it reaches the parent. " : ""}
              Nothing changes in the fee record until the parent collects the money.
            </span>
          </div>
        </div>
      ) : null}

      {msg ? <p className={`mt-2 text-sm font-semibold ${msg.bad ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p> : null}
    </div>
  );
}
