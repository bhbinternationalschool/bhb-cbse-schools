"use client";

import { useEffect, useState } from "react";
import { formatInr } from "@/lib/masters";
import {
  createPurchaseReturn,
  loadPurchase,
  purchaseReturnedQtyByGrnLine,
  seedPurchaseIfEmpty,
  type Grn,
  type PurchaseReturn,
} from "@/lib/purchase";
import { useDemoSession } from "@/components/shell/SessionContext";

const field =
  "rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1.5 text-sm text-[var(--brand-deep)]";
const card = "rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4";
const btn =
  "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function PurchaseReturnPanel() {
  const session = useDemoSession();
  const [grns, setGrns] = useState<Grn[]>([]);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [grnId, setGrnId] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayIso);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    seedPurchaseIfEmpty();
    const p = loadPurchase();
    setGrns(p.grns);
    setReturns(p.returns ?? []);
  }

  useEffect(() => {
    refresh();
  }, []);

  const grn = grns.find((g) => g.id === grnId);
  const already = grn
    ? purchaseReturnedQtyByGrnLine(grn.id)
    : new Map<string, number>();

  function onSave() {
    if (!grn) {
      setError("Pick a GRN");
      return;
    }
    const lines = grn.lines
      .map((l) => ({
        grnLineId: l.id,
        qty: Math.floor(Number(qty[l.id] || "0") || 0),
      }))
      .filter((l) => l.qty > 0);
    const r = createPurchaseReturn({
      grnId: grn.id,
      date,
      note,
      createdBy: session.fullName,
      lines,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setQty({});
    setNote("");
    setError(null);
    setNotice(
      `Return ${r.purchaseReturn.returnNo} · ${formatInr(r.purchaseReturn.amountPaise)} credited to vendor bill`,
    );
    window.setTimeout(() => setNotice(null), 2800);
    refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}
      <div className={card}>
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Return goods to vendor
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Stock out · vendor bill amount &amp; due auto-reduced.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              GRN
            </span>
            <select
              className={`${field} min-w-[240px]`}
              value={grnId}
              onChange={(e) => {
                setGrnId(e.target.value);
                setQty({});
              }}
            >
              <option value="">Pick GRN</option>
              {grns
                .filter((g) => g.vendorBillId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.grnNo} · {g.date}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Date
            </span>
            <input
              type="date"
              className={field}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Note
            </span>
            <input
              className={`${field} min-w-[160px]`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={btn}
            disabled={!grnId}
            onClick={onSave}
          >
            Post return
          </button>
        </div>
        {grn ? (
          <ul className="mt-4 divide-y text-sm">
            {grn.lines.map((l) => {
              const left = l.qtyReceived - (already.get(l.id) ?? 0);
              return (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    {l.description} · recv {l.qtyReceived} · left {left}
                  </span>
                  <input
                    className={`${field} w-20`}
                    type="number"
                    min={0}
                    max={left}
                    disabled={left <= 0}
                    value={qty[l.id] ?? ""}
                    onChange={(e) =>
                      setQty((q) => ({ ...q, [l.id]: e.target.value }))
                    }
                    placeholder="Qty"
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div className={card}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Recent purchase returns
        </h3>
        <ul className="mt-2 divide-y text-sm">
          {returns.slice(0, 20).map((r) => (
            <li key={r.id} className="flex justify-between py-2">
              <span>
                {r.returnNo} · {r.date}
              </span>
              <span className="font-semibold text-[#c2410c]">
                −{formatInr(r.amountPaise)}
              </span>
            </li>
          ))}
          {!returns.length ? (
            <li className="py-3 text-[var(--muted)]">No returns yet.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
