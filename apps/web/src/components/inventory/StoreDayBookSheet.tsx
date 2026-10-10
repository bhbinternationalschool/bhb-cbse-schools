"use client";

/* ratchet-allow: raw_table — printed document: ErpTableShell brings a card shadow, rounded border, hover
 * tint and theme-aware colours, all of which are wrong on paper — a sheet that
 * followed dark mode would print white ink on white stock. */

/**
 * The store's day book, on paper.
 *
 * Same numbers as the on-screen report, laid out to be signed and filed: the
 * range it covers, which tender it was filtered to (so a cash-only sheet
 * cannot be mistaken for the whole day), every sale, and somewhere for the
 * storekeeper and the officer receiving the money to sign.
 */

import {
  formatPaise,
  type InvDaybookRowData,
} from "@/lib/inventory/types";
import {
  schoolAddressLine,
  schoolContactLine,
  schoolLogoUrl,
  schoolPrintName,
} from "@/lib/schoolIdentity";

/** Print just this sheet — same isolation the receipts and day close use. */
export function printStoreDayBook() {
  const sheet = document.querySelector(".store-daybook-sheet");
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-store-daybook");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-store-daybook");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

export function StoreDayBookSheet({
  from,
  to,
  tender,
  rows,
  billedPaise,
  collectedPaise,
}: {
  from: string;
  to: string;
  tender: string;
  rows: InvDaybookRowData[];
  billedPaise: number;
  collectedPaise: number;
}) {
  return (
    <div className="hidden print:block">
      <div className="store-daybook-sheet mx-auto w-full bg-white p-4 text-[#203050]">
        <header className="flex items-center gap-3 border-b-2 border-[#203050] pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={schoolLogoUrl()}
            alt=""
            width={42}
            height={42}
            className="h-[42px] w-[42px] object-contain"
          />
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[14px] font-bold uppercase leading-tight tracking-wide">
              {schoolPrintName()}
            </p>
            <p className="text-[8px] leading-snug text-[#5a6a8a]">
              {schoolAddressLine()}
            </p>
            <p className="text-[8px] leading-snug text-[#5a6a8a]">
              {schoolContactLine()}
            </p>
          </div>
        </header>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-[rgba(32,48,80,0.25)] pb-1.5">
          <p className="text-sm font-bold uppercase tracking-[0.14em]">
            Store sales day book
          </p>
          <p className="text-xs">
            {from} to {to}
            {/* Naming the filter matters: an unlabelled cash-only sheet reads
                as the whole day's takings. */}
            {tender ? (
              <>
                {" "}
                · <strong>{tender} only</strong>
              </>
            ) : (
              " · all payment modes"
            )}
          </p>
        </div>

        <table className="mt-2 w-full border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-[#203050] text-left">
              <th className="py-1">Sale no.</th>
              <th className="py-1">Date</th>
              <th className="py-1">Buyer</th>
              <th className="py-1 text-right">Items</th>
              <th className="py-1">Paid by</th>
              <th className="py-1 text-right">Total</th>
              <th className="py-1 text-right">Paid</th>
              <th className="py-1 text-right">Owing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr
                key={x.saleId}
                className="border-b border-[rgba(32,48,80,0.12)]"
              >
                <td className="py-0.5 font-mono">{x.saleNo}</td>
                <td className="py-0.5">{x.saleDate}</td>
                <td className="py-0.5">{x.buyerName}</td>
                <td className="py-0.5 text-right">{x.itemCount}</td>
                <td className="py-0.5">{x.tenders}</td>
                <td className="py-0.5 text-right">
                  {x.status === "void" ? "VOID" : formatPaise(x.totalPaise)}
                </td>
                <td className="py-0.5 text-right">
                  {formatPaise(x.paidPaise)}
                </td>
                <td className="py-0.5 text-right">
                  {formatPaise(x.balancePaise)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#203050] font-bold">
              <td className="py-1" colSpan={5}>
                {rows.length} sale{rows.length === 1 ? "" : "s"}
              </td>
              <td className="py-1 text-right">{formatPaise(billedPaise)}</td>
              <td className="py-1 text-right">{formatPaise(collectedPaise)}</td>
              <td className="py-1 text-right">
                {formatPaise(billedPaise - collectedPaise)}
              </td>
            </tr>
          </tbody>
        </table>

        <section className="mt-10 grid grid-cols-3 gap-6 text-[10px]">
          {["Storekeeper", "Money received by", "Verified by"].map((label) => (
            <div
              key={label}
              className="border-t border-[#203050] pt-1 text-center text-[#5a6a8a]"
            >
              {label}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
