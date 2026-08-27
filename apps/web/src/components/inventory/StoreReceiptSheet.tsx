"use client";

/**
 * Store counter receipt — printable, one A5-ish slip per sale.
 *
 * Mirrors the fee receipt's print mechanics (hide the app, show the target,
 * `window.print()`), but its own sheet: a store sale is lines × rates with a
 * paid / partly-paid / due verdict, not a fee-head grid. Several sheets can sit
 * inside one print target — a family sale prints every child's receipt in one
 * go, one per page.
 */

import { amountInWordsPaise } from "@/lib/fees";
import { TENANT } from "@/lib/types";
import {
  formatPaise,
  saleStatusLabel,
  tenderLabel,
  type InvSale,
} from "@/lib/inventory/types";

function formatDisplayDate(isoDate: string) {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function printStoreReceipt(targetId: string) {
  const sheet = document.getElementById(targetId);
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-store-receipt");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-store-receipt");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

/** The paid / partly paid / due verdict, spelled out for the parent. */
function settlementLine(sale: InvSale): { label: string; tone: string } {
  if (sale.status === "void")
    return { label: "CANCELLED", tone: "#b43c3c" };
  if (sale.balancePaise <= 0)
    return { label: "PAID IN FULL", tone: "#0f766e" };
  if (sale.paidPaise > 0)
    return {
      label: `PARTLY PAID — ${formatPaise(sale.balancePaise)} DUE`,
      tone: "#b45309",
    };
  return {
    label: `ON ACCOUNT — ${formatPaise(sale.balancePaise)} DUE`,
    tone: "#b45309",
  };
}

export function StoreReceiptSheet({
  sale,
  classSection,
}: {
  sale: InvSale;
  /** "5-B" — resolved by the caller, which holds the masters labels. */
  classSection?: string;
}) {
  const verdict = settlementLine(sale);
  const voided = sale.status === "void";

  return (
    <div
      className="store-receipt-page mx-auto w-full max-w-[420px] rounded-lg border border-[rgba(32,48,80,0.2)] bg-white p-3 text-[#203050]"
      data-voided={voided ? "true" : "false"}
    >
      {/* Header */}
      <div className="border-b border-[rgba(32,48,80,0.3)] pb-1.5 text-center">
        <p className="text-sm font-bold uppercase tracking-wide">
          {TENANT.nameDisplay}
        </p>
        <p className="text-[9px] text-[#5a6a8a]">
          {TENANT.city}, {TENANT.state} · School store
        </p>
      </div>

      <div className="mt-1.5 flex justify-between text-[10px]">
        <div>
          <p className="font-mono font-semibold">{sale.saleNo}</p>
          {sale.manualReceiptNo ? (
            <p className="font-mono font-semibold">
              Book receipt {sale.manualReceiptNo}
            </p>
          ) : null}
          {sale.ledgerVoucherNo ? (
            <p className="font-mono text-[#5a6a8a]">
              Receipt {sale.ledgerVoucherNo}
            </p>
          ) : null}
          <p className="text-[#5a6a8a]">{formatDisplayDate(sale.saleDate)}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold">{sale.buyerName || "—"}</p>
          <p className="text-[#5a6a8a]">
            {sale.buyerKind === "student"
              ? [classSection, sale.buyerPhone].filter(Boolean).join(" · ") ||
                "Student"
              : sale.buyerKind === "walkin"
                ? ["Walk-in", sale.buyerPhone].filter(Boolean).join(" · ")
                : "Staff"}
          </p>
        </div>
      </div>

      {/* Lines */}
      <table className="mt-2 w-full text-[10px]">
        <thead>
          <tr className="border-y border-[rgba(32,48,80,0.25)] text-left text-[9px] uppercase text-[#5a6a8a]">
            <th className="py-0.5 pr-1 font-semibold">Item</th>
            <th className="py-0.5 pr-1 text-right font-semibold">Qty</th>
            <th className="py-0.5 pr-1 text-right font-semibold">Rate</th>
            <th className="py-0.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.id} className="align-top">
              <td className="py-0.5 pr-1">
                {l.itemName}
                {l.discountPaise > 0 ? (
                  <span className="text-[#5a6a8a]">
                    {" "}
                    · less {formatPaise(l.discountPaise)}
                  </span>
                ) : null}
                {l.qtyReturned ? (
                  <span className="text-[#b43c3c]">
                    {" "}
                    ({l.qtyReturned} returned)
                  </span>
                ) : null}
              </td>
              <td className="py-0.5 pr-1 text-right tabular-nums">{l.qty}</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">
                {formatPaise(l.unitPricePaise).replace(/^₹\s?/, "")}
              </td>
              <td className="py-0.5 text-right tabular-nums">
                {formatPaise(l.lineTotalPaise + l.taxPaise).replace(/^₹\s?/, "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-1.5 space-y-0.5 border-t border-[rgba(32,48,80,0.25)] pt-1 text-[10px]">
        <div className="flex justify-between text-[#5a6a8a]">
          <span>Items</span>
          <span className="tabular-nums">{formatPaise(sale.subtotalPaise)}</span>
        </div>
        {sale.discountPaise > 0 ? (
          <div className="flex justify-between text-[#5a6a8a]">
            <span>Discount</span>
            <span className="tabular-nums">
              − {formatPaise(sale.discountPaise)}
            </span>
          </div>
        ) : null}
        {sale.taxPaise > 0 ? (
          <div className="flex justify-between text-[#5a6a8a]">
            <span>GST</span>
            <span className="tabular-nums">{formatPaise(sale.taxPaise)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-[rgba(32,48,80,0.2)] pt-0.5 text-[11px] font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatPaise(sale.totalPaise)}</span>
        </div>
        <p className="text-[8px] italic text-[#5a6a8a]">
          {amountInWordsPaise(sale.totalPaise)}
        </p>
      </div>

      {/* Payments */}
      {sale.payments.length > 0 ? (
        <div className="mt-1.5 border-t border-dashed border-[rgba(32,48,80,0.25)] pt-1 text-[9px]">
          <p className="text-[8px] font-semibold uppercase text-[#5a6a8a]">
            Received
          </p>
          {sale.payments.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>
                {formatDisplayDate(p.paidOn)} · {tenderLabel(p.mode)}
                {p.reference ? ` · ${p.reference}` : ""}
              </span>
              <span className="tabular-nums">{formatPaise(p.amountPaise)}</span>
            </div>
          ))}
          <div className="mt-0.5 flex justify-between font-semibold">
            <span>Paid</span>
            <span className="tabular-nums">{formatPaise(sale.paidPaise)}</span>
          </div>
        </div>
      ) : null}

      {/* Verdict */}
      <div
        className="mt-2 rounded border px-2 py-1 text-center text-[10px] font-bold tracking-wide"
        style={{ color: verdict.tone, borderColor: verdict.tone }}
      >
        {verdict.label}
        {voided && sale.voidReason ? (
          <span className="block text-[8px] font-normal">
            {sale.voidReason}
          </span>
        ) : null}
      </div>
      {sale.balancePaise > 0 && !voided ? (
        <p className="mt-1 text-center text-[8px] text-[#5a6a8a]">
          The balance appears on the fee counter card and can be settled with a
          fee receipt.
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3 text-[8px] text-[#5a6a8a]">
        <div className="border-t border-[rgba(32,48,80,0.35)] pt-0.5">
          Parent / buyer
        </div>
        <div className="border-t border-[rgba(32,48,80,0.35)] pt-0.5 text-right">
          Store in-charge
          {sale.createdBy ? (
            <span className="block text-[7px]">{sale.createdBy}</span>
          ) : null}
        </div>
      </div>

      <p className="print-hide mt-2 text-center text-[9px] text-[#5a6a8a]">
        {saleStatusLabel(sale.status)} · computer-generated receipt
      </p>
    </div>
  );
}
