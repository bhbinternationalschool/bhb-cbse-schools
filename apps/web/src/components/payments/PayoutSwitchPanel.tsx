"use client";

/**
 * Cashfree Payouts — the owner's switch (director, 7 Oct 2026: "make this also
 * with toggle off/on for when we want we can use because sometime wallet may
 * be low").
 *
 *   status      configured? switched on? wallet balance (live)
 *   ₹1 test     a real ₹1 transfer to the owner's own UPI ID; the switch
 *               cannot be turned on until one has come back SUCCESS
 *   switch      owner / director only; everyone else sees the status
 *
 * With the switch off — or the wallet short of an amount — the screens offer
 * Pay by UPI only, and say why.
 */

import { useEffect, useState } from "react";
import { RefreshCw, Send, Wallet } from "lucide-react";
import { isVpa } from "@/lib/upiPay";
import { loadPayoutState, type PayoutState } from "@/lib/payoutsClient";
import { CashgramRefundApprovals } from "@/components/payments/CashgramRefundApprovals";

const CARD = "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const BTN =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50";

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function PayoutSwitchPanel() {
  const [state, setState] = useState<PayoutState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [vpa, setVpa] = useState("");
  const [name, setName] = useState("");

  async function refresh() {
    setLoading(true);
    setState(await loadPayoutState(true));
    setLoading(false);
  }
  useEffect(() => {
    void refresh();
  }, []);

  if (loading && !state) return <div className={CARD + " text-sm text-[var(--muted)]"}>Reading Cashfree Payouts…</div>;
  if (!state) return null;

  async function toggle(enabled: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/payouts/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      setMsg(j?.ok ? { text: enabled ? "Switched on." : "Switched off.", bad: false } : { text: j?.error || `HTTP ${r.status}`, bad: true });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/payouts/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vpa: vpa.trim().toLowerCase(), name: name.trim() }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; transferId?: string } | null;
      if (!j?.ok || !j.transferId) {
        setMsg({ text: j?.error || `HTTP ${r.status}`, bad: true });
        return;
      }
      setMsg({ text: "₹1 sent — waiting for Cashfree to confirm…", bad: false });
      for (let i = 0; i < 20; i += 1) {
        await new Promise((res) => setTimeout(res, 3000));
        const s = await fetch(`/api/payouts/test?transferId=${encodeURIComponent(j.transferId)}`, { credentials: "same-origin" })
          .then((x) => x.json())
          .catch(() => null);
        const status = String(s?.status || "");
        if (status === "SUCCESS") {
          setMsg({ text: "Test passed ✓ — ₹1 reached your UPI. You can switch Payouts on now.", bad: false });
          await refresh();
          return;
        }
        if (["FAILED", "REJECTED", "REVERSED"].includes(status)) {
          setMsg({ text: `Test ${status}. ${String(s?.message || s?.error || "")}`.trim(), bad: true });
          return;
        }
      }
      setMsg({ text: "Still processing at Cashfree. Press Refresh in a minute.", bad: false });
    } finally {
      setBusy(false);
    }
  }

  const balance =
    state.balancePaise === null ? (state.configured ? `unreadable (${state.balanceError || "no reply"})` : "—") : inr(state.balancePaise);

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Wallet className="h-4 w-4" /> Cashfree Payouts — pay staff from the wallet
        </h3>
        <button type="button" className={BTN_OUTLINE} onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <dt className="text-[var(--muted)]">Status</dt>
        <dd className={state.enabled ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>
          {state.enabled ? "ON — Pay via Cashfree is offered on salary lines and advances" : `OFF — ${state.why || "Pay by UPI only"}`}
        </dd>
        <dt className="text-[var(--muted)]">Wallet balance</dt>
        <dd className="font-semibold">{balance}</dd>
        <dt className="text-[var(--muted)]">₹1 test</dt>
        <dd>{state.testPassedAt ? `passed ${new Date(state.testPassedAt).toLocaleString("en-IN")}` : "not done yet"}</dd>
        {state.updatedBy ? (
          <>
            <dt className="text-[var(--muted)]">Last changed</dt>
            <dd>
              {state.updatedBy}
              {state.updatedAt ? ` · ${new Date(state.updatedAt).toLocaleString("en-IN")}` : ""}
            </dd>
          </>
        ) : null}
      </dl>

      {state.canToggle && state.configured ? (
        <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
          {!state.testPassedAt ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] font-semibold text-[var(--muted)]">
                Your own UPI ID
                <input className="field mt-1 !py-2" value={vpa} onChange={(e) => setVpa(e.target.value.trim())} placeholder="name@okaxis" />
              </label>
              <label className="text-[11px] font-semibold text-[var(--muted)]">
                Name on it
                <input className="field mt-1 !py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="As in your bank" />
              </label>
              <button type="button" className={BTN} disabled={busy || !isVpa(vpa) || !name.trim()} onClick={() => void runTest()}>
                <Send className="h-3.5 w-3.5" /> Send ₹1 test to myself
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {state.switchOn ? (
              <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void toggle(false)}>
                Switch OFF
              </button>
            ) : (
              <button type="button" className={BTN} disabled={busy || !state.testPassedAt} onClick={() => void toggle(true)}>
                Switch ON
              </button>
            )}
            <span className="text-[11px] text-[var(--muted)]">
              Off, or wallet short of an amount → screens offer Pay by UPI instead. Top up in the Cashfree Payouts dashboard.
            </span>
          </div>
        </div>
      ) : !state.configured ? (
        <p className="mt-3 text-[11px] text-[var(--muted)]">Payouts keys are not set on the server.</p>
      ) : (
        <p className="mt-3 text-[11px] text-[var(--muted)]">Only the owner / director can switch this.</p>
      )}
      {msg ? <p className={`mt-2 text-sm font-semibold ${msg.bad ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p> : null}
      {state.configured ? <CashgramRefundApprovals state={state} onChanged={() => void refresh()} /> : null}
    </div>
  );
}
