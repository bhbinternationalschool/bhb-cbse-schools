"use client";

/**
 * Every store purchase of this family, inside the fee record.
 *
 * The parent thinks of one account with the school, so the fee screen shows
 * the store history beside the fee receipts: what was taken, when, what it
 * cost, and — the part that gets asked at the counter — whether it is still
 * ISSUED (unpaid) or PAID. The status is read live from the store, so a slip
 * paid at the fee counter shows PAID here immediately, and returns to ISSUED
 * if that fee receipt is voided.
 */

import { useEffect, useState } from "react";
import { invApi } from "@/lib/inventory/client";
import type { InvSale } from "@/lib/inventory/types";
import { formatInr } from "@/lib/masters";
import { StoreReceiptDual, printStoreReceipt } from "@/components/inventory/StoreReceiptSheet";

function statusChip(sale: InvSale): { label: string; cls: string } {
  if (sale.status === "void") {
    return {
      label: "CANCELLED",
      cls: "bg-[rgba(32,48,80,0.1)] text-[var(--muted)] line-through",
    };
  }
  if (sale.balancePaise <= 0) {
    return { label: "PAID", cls: "bg-[var(--success-soft)] text-[var(--success)]" };
  }
  if (sale.paidPaise > 0) {
    return {
      label: `PART PAID · ${formatInr(sale.balancePaise)} due`,
      cls: "bg-[var(--warning-soft)] text-[var(--warning)]",
    };
  }
  return {
    label: `ISSUED · ${formatInr(sale.balancePaise)} due`,
    cls: "bg-[var(--warning-soft)] text-[var(--warning)]",
  };
}

export function StorePurchasesPanel({
  studentIds,
  nameById,
  tick,
}: {
  studentIds: string[];
  nameById: Map<string, string>;
  /** Bumped by the workspace after a collect / void so this re-reads. */
  tick: number;
}) {
  const [sales, setSales] = useState<InvSale[]>([]);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    if (studentIds.length === 0) {
      setSales([]);
      return;
    }
    let alive = true;
    void Promise.all(
      studentIds.map((id) =>
        invApi
          .listSales({ studentId: id, status: "all", pageSize: 50 })
          .then((p) => p.rows)
          .catch(() => {
            throw new Error("store");
          }),
      ),
    )
      .then((lists) => {
        if (!alive) return;
        setError("");
        setSales(
          lists
            .flat()
            .sort((a, b) => b.saleDate.localeCompare(a.saleDate)),
        );
      })
      .catch(() => {
        if (!alive) return;
        // Say it could not be read — an empty list would read as "never
        // bought anything from the store", which we do not know.
        setError("Store purchases could not be loaded");
        setSales([]);
      });
    return () => {
      alive = false;
    };
  }, [studentIds.join(","), tick]);

  if (error) {
    return (
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-xs text-[var(--warning)]">
        {error}
      </div>
    );
  }
  if (sales.length === 0) return null;

  const open = sales.find((s) => s.id === openId) ?? null;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-xs font-bold text-[var(--brand-deep)]">
          Store purchases
        </h2>
        <p className="text-[11px] text-[var(--muted)]">
          Issued vs paid · slips reprint with the current stamp
        </p>
      </div>

      <ul className="max-h-64 divide-y divide-[var(--border)] overflow-y-auto">
        {sales.map((s) => {
          const chip = statusChip(s);
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-[var(--brand-deep)]">
                    {s.saleNo}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chip.cls}`}
                  >
                    {chip.label}
                  </span>
                  {s.manualReceiptNo ? (
                    <span className="text-[11px] text-[var(--muted)]">
                      Book {s.manualReceiptNo}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                  {s.saleDate} · {nameById.get(s.studentId) ?? s.buyerName} ·{" "}
                  {s.lines
                    .map((l) => `${l.itemName}${l.qty > 1 ? ` ×${l.qty}` : ""}`)
                    .join(", ")}
                </p>
              </div>
              <div className="text-sm font-bold tabular-nums text-[var(--brand-deep)]">
                {formatInr(s.totalPaise)}
              </div>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                onClick={() => setOpenId(openId === s.id ? "" : s.id)}
              >
                {openId === s.id ? "Hide slip" : "Slip"}
              </button>
            </li>
          );
        })}
      </ul>

      {open ? (
        <div className="border-t border-[var(--border)] bg-[var(--surface-sunken)] p-3">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-bold text-white"
              onClick={() => printStoreReceipt("fee-store-slip-print")}
            >
              Print / save PDF
            </button>
          </div>
          <div id="fee-store-slip-print" className="store-receipt-sheet">
            <StoreReceiptDual sale={open} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
