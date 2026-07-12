"use client";

import { useMemo, useState } from "react";
import {
  bounceCheque,
  chequeStats,
  chequeStatusLabel,
  clearCheque,
  depositCheque,
  formatInr,
  listCheques,
  type ChequeInstrument,
  type ChequeStatus,
} from "@/lib/fees";
import type { SisState } from "@/lib/sis";

type Filter = "open" | ChequeStatus | "all";

export function ChequesPanel({
  tick,
  sis,
  onChanged,
  onOpenReceipt,
}: {
  tick: number;
  sis: SisState | null;
  onChanged: () => void;
  onOpenReceipt: (voucherId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const [slipById, setSlipById] = useState<Record<string, string>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const cheques = useMemo(() => {
    void tick;
    return listCheques(undefined, filter === "all" ? "all" : filter);
  }, [tick, filter]);

  const stats = useMemo(() => {
    void tick;
    return chequeStats();
  }, [tick]);

  const guardianOf = (householdId: string) =>
    sis?.households.find((h) => h.id === householdId)?.guardianName;

  function runDeposit(c: ChequeInstrument) {
    const result = depositCheque(c.id, {
      depositSlipNo: slipById[c.id] ?? "",
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSlipById((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });
    onChanged();
  }

  function runClear(c: ChequeInstrument) {
    if (
      !window.confirm(
        `Mark cheque ${c.chequeNo || "—"} as cleared by bank?`,
      )
    ) {
      return;
    }
    const result = clearCheque(c.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onChanged();
  }

  function runBounce(c: ChequeInstrument) {
    const reason = (reasonById[c.id] ?? "").trim();
    if (
      !window.confirm(
        `Bounce cheque ${c.chequeNo || "—"}?\nThis voids receipt ${c.receiptNo} and reopens dues.`,
      )
    ) {
      return;
    }
    const result = bounceCheque(c.id, { reason });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setReasonById((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });
    onChanged();
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatChip
          label="In hand"
          count={stats.receivedCount}
          amount={stats.receivedPaise}
          active={filter === "received"}
          onClick={() => setFilter("received")}
        />
        <StatChip
          label="Deposited"
          count={stats.depositedCount}
          amount={stats.depositedPaise}
          active={filter === "deposited"}
          onClick={() => setFilter("deposited")}
        />
        <StatChip
          label="Cleared"
          count={stats.clearedCount}
          amount={stats.clearedPaise}
          active={filter === "cleared"}
          onClick={() => setFilter("cleared")}
        />
        <StatChip
          label="Bounced"
          count={stats.bouncedCount}
          amount={stats.bouncedPaise}
          active={filter === "bounced"}
          tone="danger"
          onClick={() => setFilter("bounced")}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterBtn active={filter === "open"} onClick={() => setFilter("open")}>
          Open (in hand + deposited)
        </FilterBtn>
        <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>
          All cheques
        </FilterBtn>
      </div>

      {error ? (
        <p className="rounded-lg bg-[rgba(180,60,60,0.1)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Cheque register
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Received → deposited → cleared / bounced · bounce voids the linked
            receipt
          </p>
        </div>

        {cheques.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--muted)]">
            No cheques in this view. Collect with cheque mode on the Collect tab.
          </p>
        ) : (
          <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
            {cheques.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[var(--brand-deep)]">
                        Chq {c.chequeNo || "—"}
                      </span>
                      <StatusPill status={c.status} />
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-[var(--brand-mid)] hover:underline"
                        onClick={() => onOpenReceipt(c.voucherId)}
                      >
                        {c.receiptNo}
                      </button>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {c.chequeDate || "—"} · {c.bankName || "Bank —"}
                      {guardianOf(c.householdId)
                        ? ` · ${guardianOf(c.householdId)}`
                        : ""}
                      {c.depositSlipNo
                        ? ` · Slip ${c.depositSlipNo}`
                        : ""}
                      {c.bounceReason ? ` · ${c.bounceReason}` : ""}
                    </p>
                  </div>
                  <div className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
                    {formatInr(c.amountPaise)}
                  </div>
                </div>

                {c.status === "received" ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block text-xs">
                      <span className="mb-0.5 block text-[var(--muted)]">
                        Deposit slip no.
                      </span>
                      <input
                        className="field !py-1.5 !text-xs"
                        value={slipById[c.id] ?? ""}
                        onChange={(e) =>
                          setSlipById((prev) => ({
                            ...prev,
                            [c.id]: e.target.value,
                          }))
                        }
                        placeholder="Pay-in slip"
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                      onClick={() => runDeposit(c)}
                    >
                      Mark deposited
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--ok)] px-3 py-1.5 text-xs font-bold text-white"
                      onClick={() => runClear(c)}
                    >
                      Cleared
                    </button>
                    <BounceRow
                      value={reasonById[c.id] ?? ""}
                      onChange={(v) =>
                        setReasonById((prev) => ({ ...prev, [c.id]: v }))
                      }
                      onBounce={() => runBounce(c)}
                    />
                  </div>
                ) : null}

                {c.status === "deposited" ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--ok)] px-3 py-1.5 text-xs font-bold text-white"
                      onClick={() => runClear(c)}
                    >
                      Mark cleared
                    </button>
                    <BounceRow
                      value={reasonById[c.id] ?? ""}
                      onChange={(v) =>
                        setReasonById((prev) => ({ ...prev, [c.id]: v }))
                      }
                      onBounce={() => runBounce(c)}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BounceRow({
  value,
  onChange,
  onBounce,
}: {
  value: string;
  onChange: (v: string) => void;
  onBounce: () => void;
}) {
  return (
    <>
      <label className="block text-xs">
        <span className="mb-0.5 block text-[var(--muted)]">Bounce reason</span>
        <input
          className="field !py-1.5 !text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Insufficient funds / signature…"
        />
      </label>
      <button
        type="button"
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--danger)]"
        onClick={onBounce}
      >
        Bounce &amp; void receipt
      </button>
    </>
  );
}

function StatusPill({ status }: { status: ChequeStatus }) {
  const styles: Record<ChequeStatus, string> = {
    received: "bg-[rgba(197,160,40,0.18)] text-[var(--brand-deep)]",
    deposited: "bg-[rgba(56,72,112,0.12)] text-[var(--brand-mid)]",
    cleared: "bg-[rgba(15,122,76,0.12)] text-[var(--ok)]",
    bounced: "bg-[rgba(180,60,60,0.12)] text-[var(--danger)]",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[status]}`}
    >
      {chequeStatusLabel(status)}
    </span>
  );
}

function StatChip({
  label,
  count,
  amount,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  amount: number;
  active: boolean;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition ${
        active
          ? "border-[var(--brand-deep)] bg-[rgba(32,48,80,0.06)]"
          : "border-[rgba(32,48,80,0.12)] bg-white hover:border-[rgba(197,160,40,0.4)]"
      }`}
    >
      <div
        className={`text-[11px] font-bold uppercase tracking-wide ${
          tone === "danger" ? "text-[var(--danger)]" : "text-[var(--muted)]"
        }`}
      >
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold text-[var(--brand-deep)]">
        {count} · {formatInr(amount)}
      </div>
    </button>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
        active
          ? "bg-[var(--brand-deep)] text-white"
          : "border border-[rgba(32,48,80,0.15)] text-[var(--brand-deep)]"
      }`}
    >
      {children}
    </button>
  );
}
