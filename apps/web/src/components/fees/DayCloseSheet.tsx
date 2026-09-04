"use client";

/* ratchet-allow: raw_table — printed document: ErpTableShell brings a card shadow, rounded border, hover
 * tint and theme-aware colours, all of which are wrong on paper — a sheet that
 * followed dark mode would print white ink on white stock. */

/**
 * The day's counter handover, on paper.
 *
 * A day close is signed by two people — the cashier who counted and the
 * officer who received — and the school keeps the sheet. On screen that
 * evidence lived only in the browser, so the counter had nothing to sign and
 * nothing to file. This is the same numbers, laid out to be signed: what the
 * system says came in, by mode; what was physically counted, by denomination;
 * the variance between them; and the receipts that make up the total.
 */

import { formatInr, type CollectionVoucher, type DayCloseModeTotal } from "@/lib/fees";
import { tenderModeLabel } from "@/lib/fees";
import type { DayCloseDenomLine } from "@/lib/fees";
import {
  schoolAddressLine,
  schoolContactLine,
  schoolCrestUrl,
  schoolLogoUrl,
  schoolPrintName,
  schoolStatutoryLine,
} from "@/lib/schoolIdentity";

/** Print just this sheet, the same isolation the receipts use. */
export function printDayClose() {
  const sheet = document.querySelector(".day-close-sheet");
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-day-close");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-day-close");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function DayCloseSheet({
  closeDate,
  cashierName,
  receiverName,
  cashierRemarks,
  receiverRemarks,
  status,
  vouchers,
  modeTotals,
  denoms,
  totalPaise,
  systemCashPaise,
  physicalCashPaise,
  print,
}: {
  closeDate: string;
  cashierName: string;
  receiverName: string;
  cashierRemarks: string;
  receiverRemarks: string;
  status: string;
  vouchers: CollectionVoucher[];
  modeTotals: DayCloseModeTotal[];
  denoms: DayCloseDenomLine[];
  totalPaise: number;
  systemCashPaise: number;
  physicalCashPaise: number;
  print?: boolean;
}) {
  const variance = physicalCashPaise - systemCashPaise;
  const counted = denoms.filter((d) => d.qty > 0);

  return (
    <div
      className={`day-close-sheet${print ? " print-target" : ""} mx-auto w-full max-w-[820px] bg-white p-5 text-[#203050]`}
    >
      <header className="flex items-center gap-3 border-b-2 border-[#203050] pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={schoolLogoUrl()} alt="" width={46} height={46} className="h-[46px] w-[46px] object-contain" />
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[15px] font-bold uppercase leading-tight tracking-wide">
            {schoolPrintName()}
          </p>
          <p className="text-[8px] leading-snug text-[#5a6a8a]">{schoolAddressLine()}</p>
          {schoolStatutoryLine() ? (
            <p className="text-[8px] leading-snug text-[#5a6a8a]">{schoolStatutoryLine()}</p>
          ) : null}
          <p className="text-[8px] leading-snug text-[#5a6a8a]">{schoolContactLine()}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={schoolCrestUrl()} alt="" width={38} height={38} className="h-[38px] w-[38px] object-contain opacity-90" />
      </header>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-[rgba(32,48,80,0.25)] pb-1.5">
        <p className="text-sm font-bold uppercase tracking-[0.14em]">
          Counter day close
        </p>
        <p className="text-xs">
          Date <strong>{fmtDate(closeDate)}</strong> · Status{" "}
          <strong className="uppercase">{status || "draft"}</strong>
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#5a6a8a]">
            System — collected by mode
          </h3>
          <table className="mt-1 w-full border-collapse text-xs">
            <tbody>
              {modeTotals.length === 0 ? (
                <tr>
                  <td className="py-1 text-[#5a6a8a]">Nothing collected</td>
                </tr>
              ) : (
                modeTotals.map((m) => (
                  <tr key={m.mode} className="border-b border-[rgba(32,48,80,0.12)]">
                    <td className="py-1">{tenderModeLabel(m.mode)}</td>
                    <td className="py-1 text-right text-[#5a6a8a]">
                      {m.tenderCount}
                    </td>
                    <td className="py-1 text-right font-semibold">
                      {formatInr(m.paise)}
                    </td>
                  </tr>
                ))
              )}
              <tr>
                <td className="py-1 font-bold">Total</td>
                <td />
                <td className="py-1 text-right font-bold">{formatInr(totalPaise)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#5a6a8a]">
            Cash counted
          </h3>
          <table className="mt-1 w-full border-collapse text-xs">
            <tbody>
              {counted.length === 0 ? (
                <tr>
                  <td className="py-1 text-[#5a6a8a]">Not counted</td>
                </tr>
              ) : (
                counted.map((d) => (
                  <tr key={d.denomPaise} className="border-b border-[rgba(32,48,80,0.12)]">
                    <td className="py-1">{formatInr(d.denomPaise)}</td>
                    <td className="py-1 text-right text-[#5a6a8a]">× {d.qty}</td>
                    <td className="py-1 text-right font-semibold">
                      {formatInr(d.denomPaise * d.qty)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <dl className="mt-1.5 space-y-0.5 text-xs">
            <div className="flex justify-between">
              <dt>System cash</dt>
              <dd className="font-semibold">{formatInr(systemCashPaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Physically counted</dt>
              <dd className="font-semibold">{formatInr(physicalCashPaise)}</dd>
            </div>
            <div className="flex justify-between border-t border-[#203050] pt-0.5">
              <dt className="font-bold">
                {variance === 0 ? "Variance" : variance > 0 ? "Excess" : "Short"}
              </dt>
              <dd className="font-bold">{formatInr(Math.abs(variance))}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="mt-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#5a6a8a]">
          Receipts ({vouchers.length})
        </h3>
        <table className="mt-1 w-full border-collapse text-[10px]">
          <thead>
            <tr className="border-b border-[#203050] text-left">
              <th className="py-1">Receipt</th>
              <th className="py-1">Book</th>
              <th className="py-1">Paid by</th>
              <th className="py-1">Mode</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.map((v) => (
              <tr key={v.id} className="border-b border-[rgba(32,48,80,0.12)]">
                <td className="py-0.5 font-mono">{v.receiptNo}</td>
                <td className="py-0.5">{v.schoolReceiptNo || "—"}</td>
                <td className="py-0.5">
                  {[...new Set(v.lines.map((l) => l.studentName))].join(", ") ||
                    "—"}
                </td>
                <td className="py-0.5">
                  {[...new Set(v.tenders.map((t) => tenderModeLabel(t.mode)))].join(
                    ", ",
                  )}
                </td>
                <td className="py-0.5 text-right font-semibold">
                  {v.voidedAt ? "VOID" : formatInr(v.totalPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {cashierRemarks || receiverRemarks ? (
        <section className="mt-2 text-[10px] leading-snug">
          {cashierRemarks ? (
            <p>
              <strong>Cashier:</strong> {cashierRemarks}
            </p>
          ) : null}
          {receiverRemarks ? (
            <p>
              <strong>Receiver:</strong> {receiverRemarks}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* The reason this sheet exists: somewhere to sign. */}
      <section className="mt-8 grid grid-cols-3 gap-6 text-[10px]">
        {[
          ["Counted &amp; handed over", cashierName],
          ["Received by", receiverName],
          ["Verified by", ""],
        ].map(([label, name]) => (
          <div key={label} className="border-t border-[#203050] pt-1 text-center">
            <p className="font-semibold">{name || " "}</p>
            <p
              className="text-[#5a6a8a]"
              dangerouslySetInnerHTML={{ __html: label }}
            />
          </div>
        ))}
      </section>

      <p className="mt-3 text-center text-[8px] text-[#5a6a8a]">
        System-generated day close · printed {fmtDate(new Date().toISOString().slice(0, 10))}
      </p>
    </div>
  );
}
