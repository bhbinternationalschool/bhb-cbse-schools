"use client";

/**
 * Sell store items from Fee Take.
 *
 * The counter clerk taking fees often gets asked for a notebook or a tie in
 * the same breath. This posts an ON-ACCOUNT store sale for the student (the
 * store's own module records it exactly as its counter would), and the new
 * due lands straight in this student's fee lines — so it can be ticked and
 * paid in the SAME receipt as the fees, and the store settles against that
 * receipt number like any other store due.
 *
 * Deliberately NOT a second checkout: no tenders here, no receipt of its own.
 * One payment, one receipt, one place where money is taken.
 */

import { useEffect, useMemo, useState } from "react";
import { invApi } from "@/lib/inventory/client";
import type { InvBootstrap, InvItemRow } from "@/lib/inventory/types";
import { formatInr } from "@/lib/masters";

type CartLine = {
  itemId: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  gstRate: number;
};

export function StoreSellInline({
  studentId,
  studentName,
  classId,
  sectionId,
  readOnly,
  onSold,
}: {
  studentId: string;
  studentName: string;
  classId: string;
  sectionId: string;
  readOnly?: boolean;
  onSold: (saleNo: string, totalPaise: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [boot, setBoot] = useState<InvBootstrap | null>(null);
  const [items, setItems] = useState<InvItemRow[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bought, setBought] = useState<
    { itemId: string; itemName: string; totalQty: number; lastSaleNo: string; lastSaleDate: string }[]
  >([]);

  const priceListId =
    boot?.settings.defaultPriceListId ||
    boot?.priceLists.find((l) => l.isDefault)?.id ||
    boot?.priceLists[0]?.id ||
    "";
  const locationId =
    boot?.settings.defaultLocationId || boot?.locations[0]?.id || "";

  useEffect(() => {
    if (!open || boot) return;
    void invApi
      .bootstrap()
      .then(setBoot)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Store unavailable"),
      );
  }, [open, boot]);

  useEffect(() => {
    if (!open || !priceListId) return;
    void invApi
      .listItems({ status: "active", pageSize: 300, sort: "name", priceListId })
      .then((page) => setItems(page.rows))
      .catch(() => setItems([]));
  }, [open, priceListId]);

  // What this child already took — the same courtesy warning the store gives.
  useEffect(() => {
    if (!open || !studentId) return;
    void invApi
      .studentPurchases(studentId)
      .then(setBought)
      .catch(() => setBought([]));
  }, [open, studentId]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.sku ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [items, search]);

  const total = cart.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);

  function addItem(item: InvItemRow) {
    const prior = bought.find((b) => b.itemId === item.id);
    const inCart = cart.some((l) => l.itemId === item.id);
    if (prior && !inCart) {
      const ok = window.confirm(
        `${studentName} already took ${prior.itemName} × ${prior.totalQty} this session` +
          (prior.lastSaleNo
            ? ` (last on ${prior.lastSaleDate}, receipt ${prior.lastSaleNo})`
            : "") +
          `.\n\nSell it again — a replacement or an extra copy?`,
      );
      if (!ok) return;
    }
    setCart((c) =>
      c.some((l) => l.itemId === item.id)
        ? c.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l))
        : [
            ...c,
            {
              itemId: item.id,
              name: item.name,
              qty: 1,
              unitPricePaise: item.salePaise ?? 0,
              gstRate: item.gstRate ?? 0,
            },
          ],
    );
    setSearch("");
  }

  async function postSale() {
    if (readOnly || busy || cart.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const sale = await invApi.postSale({
        buyerKind: "student",
        studentId,
        buyerName: studentName,
        classId,
        sectionId,
        locationId,
        priceListId,
        note: "Sold at Fee Take",
        lines: cart.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
          gstRate: l.gstRate,
        })),
        // On account: the due joins this student's fee lines and is paid in
        // the same receipt as the fees.
        payments: [],
      });
      setCart([]);
      setOpen(false);
      onSold(sale.saleNo, sale.totalPaise);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post the store sale");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
        onClick={() => setOpen(true)}
        disabled={readOnly}
      >
        + Sell store items
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[rgba(197,160,40,0.45)] bg-[var(--card)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--brand-deep)]">
          Store items for {studentName}
        </div>
        <button
          type="button"
          className="text-xs font-semibold text-[var(--muted)]"
          onClick={() => {
            setOpen(false);
            setCart([]);
          }}
        >
          Close
        </button>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg bg-[var(--danger-soft)] px-2.5 py-1.5 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <input
        className="field mt-2 w-full !py-1.5 !text-xs"
        placeholder="Search item name or SKU…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoComplete="off"
      />

      {matches.length > 0 ? (
        <ul className="mt-1.5 max-h-40 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]">
          {matches.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--surface-sunken)]"
                onClick={() => addItem(i)}
              >
                <span className="min-w-0">
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {i.name}
                  </span>
                  {bought.some((b) => b.itemId === i.id) ? (
                    <span className="ml-1.5 rounded bg-[var(--warning-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                      already taken
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-bold tabular-nums">
                  {formatInr(i.salePaise ?? 0)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {cart.length > 0 ? (
        <>
          <ul className="mt-2 space-y-1">
            {cart.map((l) => (
              <li
                key={l.itemId}
                className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-sunken)] px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 font-semibold text-[var(--brand-deep)]">
                  {l.name}
                </span>
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-1.5"
                    onClick={() =>
                      setCart((c) =>
                        c
                          .map((x) =>
                            x.itemId === l.itemId ? { ...x, qty: x.qty - 1 } : x,
                          )
                          .filter((x) => x.qty > 0),
                      )
                    }
                  >
                    −
                  </button>
                  <span className="w-5 text-center font-bold tabular-nums">
                    {l.qty}
                  </span>
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-1.5"
                    onClick={() =>
                      setCart((c) =>
                        c.map((x) =>
                          x.itemId === l.itemId ? { ...x, qty: x.qty + 1 } : x,
                        ),
                      )
                    }
                  >
                    +
                  </button>
                  <span className="w-16 text-right font-bold tabular-nums">
                    {formatInr(l.unitPricePaise * l.qty)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-[var(--brand-deep)]">
              Total {formatInr(total)}
            </span>
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
              disabled={busy || readOnly}
              onClick={() => void postSale()}
            >
              {busy ? "Adding…" : "Add to this bill"}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            The store records the sale and its due appears in the fee lines
            below — tick it to collect everything on one receipt.
          </p>
        </>
      ) : null}
    </div>
  );
}
