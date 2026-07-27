"use client";

import { type ReactNode } from "react";
import {
  amountInWordsPaise,
  formatConcessionDetailLine,
  formatInr,
  receiptSeriesOf,
  tenderModeLabel,
  voucherHasUnclearedCheque,
  type CollectionVoucher,
} from "@/lib/fees";
import { type MastersState } from "@/lib/masters";
import { type SisState } from "@/lib/sis";
import { TENANT } from "@/lib/types";

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

export type ReceiptStudentRow = {
  studentId: string;
  admissionNo: string;
  fullName: string;
  fatherName: string;
  classSection: string;
};

export function receiptStudentRows(
  voucher: CollectionVoucher,
  sis?: SisState | null,
  masters?: MastersState | null,
): ReceiptStudentRow[] {
  const seen = new Set<string>();
  const rows: ReceiptStudentRow[] = [];
  for (const line of voucher.lines) {
    if (seen.has(line.studentId)) continue;
    seen.add(line.studentId);
    const student = sis?.students.find((s) => s.id === line.studentId);
    const className =
      masters?.classes.find((c) => c.id === student?.classId)?.name ?? "—";
    const sectionName =
      masters?.sections.find((s) => s.id === student?.sectionId)?.name ?? "";
    rows.push({
      studentId: line.studentId,
      admissionNo: student?.admissionNo || "—",
      fullName: student?.fullName || line.studentName,
      fatherName: student?.fatherName || "—",
      classSection: sectionName ? `${className}-${sectionName}` : className,
    });
  }
  return rows;
}

export function printFeeReceipt(receiptId: string) {
  const sheet = document.getElementById(`receipt-${receiptId}`);
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-fee-receipt");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-fee-receipt");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

export function FeeReceiptSheet({
  voucher,
  householdHint,
  sis,
  masters,
  students: studentsProp,
  remainingPayQrDataUrl,
  remainingPayAmountPaise,
  remainingPayUrl,
}: {
  voucher: CollectionVoucher;
  householdHint?: string;
  sis?: SisState | null;
  masters?: MastersState | null;
  /** When set (e.g. shared digital receipt), skip SIS/masters lookup */
  students?: ReceiptStudentRow[];
  /** Optional UPI QR for balance still due (current / future) */
  remainingPayQrDataUrl?: string | null;
  remainingPayAmountPaise?: number;
  remainingPayUrl?: string | null;
}) {
  const voided = !!voucher.voidedAt;
  const stc = voucherHasUnclearedCheque(voucher);
  const studentRows =
    studentsProp ?? receiptStudentRows(voucher, sis, masters);

  return (
    <div
      id={`receipt-${voucher.id}`}
      data-voided={voided ? "true" : "false"}
      className={`fee-receipt-sheet overflow-hidden rounded-xl border bg-white shadow-[0_8px_28px_rgba(32,48,80,0.08)] ${
        voided
          ? "border-[rgba(180,60,60,0.35)] opacity-80"
          : "border-[rgba(32,48,80,0.14)]"
      }`}
    >
      <div className="fee-receipt-inner relative m-3 border-[3px] border-[var(--brand-deep)] sm:m-4">
        <div
          className="fee-receipt-watermark pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden"
          aria-hidden
        >
          <span
            className={`select-none text-[4.5rem] font-black uppercase tracking-[0.2em] sm:text-[5.5rem] ${
              voided
                ? "text-[rgba(180,35,24,0.14)]"
                : "text-[rgba(15,122,76,0.13)]"
            }`}
            style={{ transform: "rotate(-28deg)" }}
          >
            {voided ? "Void" : "Paid"}
          </span>
        </div>
        <div className="relative z-10 m-1 border border-[var(--brand-gold)] p-4 sm:p-5">
          <header className="flex items-start gap-3 border-b-2 border-[var(--brand-deep)] pb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={TENANT.logoUrl}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 object-contain"
            />
            <div className="min-w-0 flex-1 text-center">
              <p className="font-brand-name text-[15px] leading-tight text-[var(--brand-deep)] sm:text-lg">
                {TENANT.nameDisplay}
              </p>
              <p className="mt-0.5 font-tagline text-xs text-[var(--brand-gold)]">
                {TENANT.tagline}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-[var(--muted)] sm:text-[11px]">
                {TENANT.city}, {TENANT.state} · Affiliated to CBSE
              </p>
            </div>
            <div className="w-14 shrink-0" aria-hidden />
          </header>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(32,48,80,0.15)] pb-2">
            <div className="rounded bg-[var(--brand-deep)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white">
              {receiptSeriesOf(voucher.receiptNo) === "R"
                ? "Registration receipt"
                : "Fee receipt"}
              {voided ? " · void" : ""}
              {voucher.source === "manual_book" ? " · manual book" : ""}
              {voucher.source === "payment_link" ? " · UPI link" : ""}
            </div>
            <div className="text-right text-xs">
              <div>
                <span className="text-[var(--muted)]">Receipt no. </span>
                <span className="font-bold text-[var(--brand-deep)]">
                  {voucher.receiptNo}
                </span>
              </div>
              {voucher.schoolReceiptNo ? (
                <div>
                  <span className="text-[var(--muted)]">School book no. </span>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {voucher.schoolReceiptNo}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {stc ? (
            <div className="mt-3 border border-[var(--brand-gold)] bg-[rgba(197,160,40,0.12)] px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
              Cheque realisation subject to clearance
            </div>
          ) : null}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4 sm:text-xs">
            <div>
              <dt className="text-[var(--muted)]">Collection date</dt>
              <dd className="font-semibold text-[var(--brand-deep)]">
                {formatDisplayDate(voucher.collectionDate)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Academic year</dt>
              <dd className="font-semibold text-[var(--brand-deep)]">
                {voucher.academicYearCode}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Guardian / household</dt>
              <dd className="font-semibold text-[var(--brand-deep)]">
                {householdHint || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Received by</dt>
              <dd className="font-semibold text-[var(--brand-deep)]">
                {voucher.cashierName}
              </dd>
            </div>
          </dl>

          <div className="mt-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              Student particulars
            </p>
            <table className="w-full border-collapse text-[11px] sm:text-xs">
              <thead>
                <tr className="bg-[rgba(32,48,80,0.08)] text-left text-[var(--brand-deep)]">
                  <th className="w-7 border border-[rgba(32,48,80,0.15)] px-1.5 py-1.5 font-semibold">
                    #
                  </th>
                  <th className="border border-[rgba(32,48,80,0.15)] px-1.5 py-1.5 font-semibold">
                    Reg. no.
                  </th>
                  <th className="border border-[rgba(32,48,80,0.15)] px-1.5 py-1.5 font-semibold">
                    Student name
                  </th>
                  <th className="border border-[rgba(32,48,80,0.15)] px-1.5 py-1.5 font-semibold">
                    Father&apos;s name
                  </th>
                  <th className="border border-[rgba(32,48,80,0.15)] px-1.5 py-1.5 font-semibold">
                    Class / sec.
                  </th>
                </tr>
              </thead>
              <tbody>
                {studentRows.map((row, i) => (
                  <tr key={row.studentId}>
                    <td className="border border-[rgba(32,48,80,0.12)] px-1.5 py-1.5 text-[var(--muted)]">
                      {i + 1}
                    </td>
                    <td className="border border-[rgba(32,48,80,0.12)] px-1.5 py-1.5 font-semibold tabular-nums text-[var(--brand-deep)]">
                      {row.admissionNo}
                    </td>
                    <td className="border border-[rgba(32,48,80,0.12)] px-1.5 py-1.5 font-semibold text-[var(--brand-deep)]">
                      {row.fullName}
                    </td>
                    <td className="border border-[rgba(32,48,80,0.12)] px-1.5 py-1.5 text-[var(--brand-deep)]">
                      {row.fatherName}
                    </td>
                    <td className="border border-[rgba(32,48,80,0.12)] px-1.5 py-1.5 font-semibold text-[var(--brand-deep)]">
                      {row.classSection}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <table className="mt-3 w-full border-collapse text-[11px] sm:text-xs">
            <thead>
              <tr className="bg-[var(--brand-deep)] text-left text-white">
                <th className="w-8 px-2 py-1.5 font-semibold">#</th>
                <th className="px-2 py-1.5 font-semibold">Particulars</th>
                <th className="w-28 px-2 py-1.5 text-right font-semibold">
                  Amount (₹)
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const order: Array<
                  | "academic"
                  | "transport"
                  | "special"
                  | "store"
                  | "voucher"
                  | "arrears"
                  | "plan"
                > = [
                  "arrears",
                  "academic",
                  "transport",
                  "special",
                  "voucher",
                  "store",
                  "plan",
                ];
                const sectionTitle = (k: (typeof order)[number]) =>
                  k === "arrears"
                    ? "Arrears"
                    : k === "academic"
                      ? "A — Academic"
                      : k === "transport"
                        ? "B — Transport"
                        : k === "special"
                          ? "C — Special / misc"
                          : k === "voucher"
                            ? "V — Charge vouchers"
                            : k === "store"
                              ? "D — Store / books"
                              : "E — Installment plan";
                const rows: ReactNode[] = [];
                let n = 0;
                for (const kind of order) {
                  const chunk = voucher.lines.filter((l) => l.kind === kind);
                  if (chunk.length === 0) continue;
                  rows.push(
                    <tr key={`sec-${kind}`} className="bg-[rgba(32,48,80,0.06)]">
                      <td
                        colSpan={3}
                        className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--brand-deep)]"
                      >
                        {sectionTitle(kind)}
                      </td>
                    </tr>,
                  );
                  for (const l of chunk) {
                    n += 1;
                    const issueRef =
                      l.kind === "store"
                        ? l.storeIssueNo ||
                          (l.label.match(/ISS\/[^\s·]+/)?.[0] ?? "")
                        : "";
                    rows.push(
                      <tr
                        key={`${l.dueKey}-${n}`}
                        className="border-b border-[rgba(32,48,80,0.12)]"
                      >
                        <td className="px-2 py-1.5 align-top text-[var(--muted)]">
                          {n}
                        </td>
                        <td className="px-2 py-1.5 text-[var(--brand-deep)]">
                          <div>
                            <span className="font-semibold">{l.studentName}</span>
                            {l.kind === "store" ? (
                              <span className="text-[var(--muted)]">
                                {" "}
                                — Store
                                {issueRef ? ` · ${issueRef}` : ""}
                              </span>
                            ) : l.kind === "transport" ? (
                              <span className="text-[var(--muted)]">
                                {" "}
                                — Transport
                                {l.transport
                                  ? ` · ${l.transport.periodLabel}`
                                  : ""}
                              </span>
                            ) : (
                              <span className="text-[var(--muted)]">
                                {" "}
                                — {l.label}
                              </span>
                            )}
                          </div>
                          {l.kind === "store" &&
                          l.storeItems &&
                          l.storeItems.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 text-[10px] leading-snug text-[var(--brand-deep)] sm:text-[11px]">
                              {l.storeItems.map((it, idx) => (
                                <li
                                  key={`${l.dueKey}-it-${idx}`}
                                  className="flex justify-between gap-2"
                                >
                                  <span>
                                    <span className="text-[var(--muted)]">
                                      {it.sku}
                                    </span>
                                    {" · "}
                                    {it.name}
                                    {it.sizeLabel ? ` (${it.sizeLabel})` : ""}
                                    {" ×"}
                                    {it.qty} @{" "}
                                    {formatInr(it.unitPricePaise).replace(
                                      /^₹\s?/,
                                      "",
                                    )}
                                  </span>
                                  <span className="shrink-0 tabular-nums font-semibold">
                                    {formatInr(it.linePaise).replace(
                                      /^₹\s?/,
                                      "",
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {l.kind === "transport" && l.transport ? (
                            <div className="mt-1 text-[10px] leading-snug text-[var(--muted)] sm:text-[11px]">
                              {l.transport.routeCode} · {l.transport.routeName} ·{" "}
                              {l.transport.busNo}
                              {l.transport.vehicleReg
                                ? ` (${l.transport.vehicleReg})`
                                : ""}
                              {" · Stop "}
                              {l.transport.stopName}
                            </div>
                          ) : null}
                          {l.concessionPaise && l.concessionPaise > 0 ? (
                            <div className="mt-1 space-y-0.5 text-[10px] leading-snug text-[var(--muted)] sm:text-[11px]">
                              {l.billedPaise ? (
                                <div>
                                  Billed{" "}
                                  {formatInr(l.billedPaise).replace(/^₹\s?/, "")}
                                  {" · discount "}
                                  {formatInr(l.concessionPaise).replace(
                                    /^₹\s?/,
                                    "",
                                  )}
                                </div>
                              ) : (
                                <div>
                                  Discount{" "}
                                  {formatInr(l.concessionPaise).replace(
                                    /^₹\s?/,
                                    "",
                                  )}
                                </div>
                              )}
                              {l.concessionDetails?.map((c) => (
                                <div key={`${l.dueKey}-${c.grantId}`}>
                                  · {formatConcessionDetailLine(c)}
                                  {c.code ? ` (${c.code})` : ""}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 align-top text-right font-semibold tabular-nums text-[var(--brand-deep)]">
                          {formatInr(l.amountPaise).replace(/^₹\s?/, "")}
                        </td>
                      </tr>,
                    );
                  }
                }
                // Legacy lines without kind / unknown
                const known = new Set(order);
                voucher.lines
                  .filter((l) => !known.has(l.kind as (typeof order)[number]))
                  .forEach((l) => {
                    n += 1;
                    rows.push(
                      <tr
                        key={`${l.dueKey}-x-${n}`}
                        className="border-b border-[rgba(32,48,80,0.12)]"
                      >
                        <td className="px-2 py-1.5 text-[var(--muted)]">{n}</td>
                        <td className="px-2 py-1.5 text-[var(--brand-deep)]">
                          <span className="font-semibold">{l.studentName}</span>
                          <span className="text-[var(--muted)]"> — {l.label}</span>
                          {l.concessionPaise && l.concessionPaise > 0 ? (
                            <div className="mt-1 space-y-0.5 text-[10px] leading-snug text-[var(--muted)]">
                              {l.billedPaise ? (
                                <div>
                                  Billed{" "}
                                  {formatInr(l.billedPaise).replace(/^₹\s?/, "")}
                                  {" · discount "}
                                  {formatInr(l.concessionPaise).replace(
                                    /^₹\s?/,
                                    "",
                                  )}
                                </div>
                              ) : null}
                              {l.concessionDetails?.map((c) => (
                                <div key={`${l.dueKey}-x-${c.grantId}`}>
                                  · {formatConcessionDetailLine(c)}
                                  {c.code ? ` (${c.code})` : ""}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[var(--brand-deep)]">
                          {formatInr(l.amountPaise).replace(/^₹\s?/, "")}
                        </td>
                      </tr>,
                    );
                  });
                return rows;
              })()}
            </tbody>
            <tfoot>
              {(() => {
                const discountTotal = voucher.lines.reduce(
                  (s, l) => s + (l.concessionPaise ?? 0),
                  0,
                );
                return (
                  <>
                    {discountTotal > 0 ? (
                      <tr className="bg-[rgba(15,122,76,0.08)]">
                        <td
                          colSpan={2}
                          className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-[#0f7a4c]"
                        >
                          Total discount applied
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs font-bold tabular-nums text-[#0f7a4c]">
                          −{formatInr(discountTotal)}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="bg-[rgba(197,160,40,0.15)]">
                      <td
                        colSpan={2}
                        className="px-2 py-2 text-right text-xs font-bold uppercase tracking-wide text-[var(--brand-deep)]"
                      >
                        Total received
                      </td>
                      <td className="px-2 py-2 text-right text-sm font-extrabold tabular-nums text-[var(--brand-deep)]">
                        {formatInr(voucher.totalPaise)}
                      </td>
                    </tr>
                  </>
                );
              })()}
            </tfoot>
          </table>

          <p className="mt-3 rounded border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] px-3 py-2 text-[11px] leading-snug text-[var(--brand-deep)] sm:text-xs">
            <span className="font-semibold text-[var(--muted)]">
              Amount in words:{" "}
            </span>
            {amountInWordsPaise(voucher.totalPaise)}
          </p>

          <div className="mt-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              Mode of payment
            </p>
            <table className="w-full border-collapse text-[11px] sm:text-xs">
              <thead>
                <tr className="border-b-2 border-[var(--brand-deep)] text-left">
                  <th className="py-1 pr-2 font-semibold text-[var(--brand-deep)]">
                    Mode
                  </th>
                  <th className="py-1 pr-2 font-semibold text-[var(--brand-deep)]">
                    Details
                  </th>
                  <th className="py-1 text-right font-semibold text-[var(--brand-deep)]">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {voucher.tenders.map((t, i) => (
                  <tr
                    key={`${t.mode}-${i}`}
                    className="border-b border-[rgba(32,48,80,0.1)]"
                  >
                    <td className="py-1.5 pr-2 font-semibold text-[var(--brand-deep)]">
                      {tenderModeLabel(t.mode)}
                    </td>
                    <td className="py-1.5 pr-2 text-[var(--muted)]">
                      {[
                        t.ref,
                        t.instrumentDate
                          ? formatDisplayDate(t.instrumentDate)
                          : "",
                        t.bankName,
                        t.realisation === "subject_to_clearance"
                          ? "Subject to realisation"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-[var(--brand-deep)]">
                      {formatInr(t.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {voucher.note ? (
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              <span className="font-semibold">Note:</span> {voucher.note}
            </p>
          ) : null}

          {!voided &&
          remainingPayQrDataUrl &&
          (remainingPayAmountPaise || 0) > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-4 rounded border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.06)] px-3 py-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={remainingPayQrDataUrl}
                alt="UPI QR for remaining dues"
                className="h-24 w-24 rounded border border-white bg-white p-0.5"
              />
              <div className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--brand-deep)]">
                <p className="font-bold uppercase tracking-wide text-[#0f766e]">
                  Pay remaining / next dues
                </p>
                <p className="mt-1 tabular-nums font-semibold">
                  {formatInr(remainingPayAmountPaise || 0)}
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  Scan UPI QR after this payment, or open the school pay link.
                </p>
                {remainingPayUrl ? (
                  <p className="mt-1 break-all text-[10px] text-[#0f766e]">
                    {remainingPayUrl}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-8 grid grid-cols-2 gap-6 text-[11px] text-[var(--brand-deep)]">
            <div className="border-t border-[rgba(32,48,80,0.35)] pt-1.5">
              Parent / payer
            </div>
            <div className="border-t border-[rgba(32,48,80,0.35)] pt-1.5 text-right">
              Authorised signatory
              <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                {voucher.cashierName}
              </div>
            </div>
          </div>

          <p className="mt-4 text-center text-[9px] leading-snug text-[var(--muted)]">
            Computer-generated fee receipt · This is a valid proof of payment for
            the heads listed above
            {voucher.lines.some((l) => (l.concessionPaise ?? 0) > 0)
              ? " · Discounts shown are as approved on the student ledger"
              : ""}{" "}
            · {TENANT.shortName}
          </p>
        </div>
      </div>
    </div>
  );
}
