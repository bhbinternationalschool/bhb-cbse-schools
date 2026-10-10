"use client";

/**
 * Fee refund links (Cashgram) — the owner's side: who must approve a link
 * before it reaches the parent (the school decides, director 10 Oct 2026), and
 * the links waiting now. Shown with the Payouts switch, since refunds are paid
 * from the same wallet.
 */

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cashgramStatusSentence } from "@/lib/cashgram";
import { cashgramAction, inr, type CashgramRefundView } from "@/lib/cashgramClient";
import type { PayoutState } from "@/lib/payoutsClient";

const BTN =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50";

export function CashgramRefundApprovals({ state, onChanged }: { state: PayoutState; onChanged: () => void }) {
  const [rule, setRule] = useState(state.refundApproval);
  const [above, setAbove] = useState(state.refundApprovalAbovePaise ? String(state.refundApprovalAbovePaise / 100) : "");
  const [pending, setPending] = useState<CashgramRefundView[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  async function loadPending() {
    const j = (await fetch("/api/fees/cashgram-refund?pending=1", { credentials: "same-origin" })
      .then((r) => r.json())
      .catch(() => null)) as { ok?: boolean; refunds?: CashgramRefundView[]; canApprove?: boolean } | null;
    if (j?.ok) {
      setPending(j.refunds ?? []);
      setCanApprove(!!j.canApprove);
    }
  }
  useEffect(() => {
    void loadPending();
  }, []);
  useEffect(() => {
    setRule(state.refundApproval);
    setAbove(state.refundApprovalAbovePaise ? String(state.refundApprovalAbovePaise / 100) : "");
  }, [state.refundApproval, state.refundApprovalAbovePaise]);

  async function saveRule() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/payouts/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refundApproval: rule, refundApprovalAbovePaise: Math.round(Number(above || 0) * 100) }),
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
      const r = await cashgramAction({ action, cashgramId: id, note });
      setMsg({ text: r.ok ? r.message || "Done." : r.error || "Failed", bad: !r.ok });
      await loadPending();
    } finally {
      setBusy(false);
    }
  }

  const ruleSentence =
    state.refundApproval === "none"
      ? "Refund links go straight to the parent."
      : state.refundApproval === "above"
        ? `Refund links above ${inr(state.refundApprovalAbovePaise)} wait for the owner; smaller ones go straight out.`
        : "Every refund link waits for the owner's approval.";

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
      <h4 className="text-sm font-bold">Fee refund links (Cashgram)</h4>
      <p className="text-[12px] text-[var(--muted)]">{ruleSentence} The money leaves the wallet only when the parent collects it.</p>

      {state.canToggle ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-semibold text-[var(--muted)]">
            Who approves
            <select className="field mt-1 !py-2" value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}>
              <option value="owner">Owner approves every link</option>
              <option value="above">Owner approves above an amount</option>
              <option value="none">No approval — fee desk sends</option>
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
            <li key={p.cashgramId} className="rounded-xl border border-[var(--border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {inr(p.amountPaise)} to {p.payeeName} · {p.payeePhone}
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {p.feeEffect === "void" ? `cancels receipt ${p.receiptNo}` : "returns extra paid"} · by {p.requestedBy}
                </span>
              </div>
              <p className="mt-1 text-[12px]">{p.reason}</p>
              {p.lastError ? <p className="mt-1 text-[12px] font-semibold text-amber-800">{p.lastError}</p> : null}
              <p className="mt-1 text-[11px] text-[var(--muted)]">{cashgramStatusSentence(p.status)}</p>
              {canApprove || p.approvedAt ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className={BTN} disabled={busy} onClick={() => void decide(p.cashgramId, "approve")}>
                    <Check className="h-3.5 w-3.5" /> {p.approvedAt ? "Send again" : "Approve & send"}
                  </button>
                  {canApprove ? (
                    <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void decide(p.cashgramId, "reject")}>
                      <X className="h-3.5 w-3.5" /> Turn down
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-[var(--muted)]">No refund links waiting.</p>
      )}
      {msg ? <p className={`text-sm font-semibold ${msg.bad ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p> : null}
    </div>
  );
}
