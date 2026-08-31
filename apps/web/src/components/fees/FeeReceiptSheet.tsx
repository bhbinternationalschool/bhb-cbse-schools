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
  type VoucherLine,
} from "@/lib/fees";
import { type MastersState } from "@/lib/masters";
import { type SisState } from "@/lib/sis";
import { referralCodeFor } from "@/lib/referrals";
import { TENANT } from "@/lib/types";
import {
  schoolAddressLine,
  schoolContactLine,
  schoolPrintName,
  schoolStatutoryLine,
} from "@/lib/schoolIdentity";

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

function inrCell(paise: number) {
  return formatInr(paise).replace(/^₹\s?/, "");
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

const KIND_ORDER = [
  "arrears",
  "academic",
  "transport",
  "special",
  "voucher",
  "store",
  "plan",
] as const;

type FeeKind = (typeof KIND_ORDER)[number];

function sectionTitle(kind: FeeKind) {
  switch (kind) {
    case "arrears":
      return "Arrears";
    case "academic":
      return "A — Academic";
    case "transport":
      return "B — Transport";
    case "special":
      return "C — Special / misc";
    case "voucher":
      return "V — Charge vouchers";
    case "store":
      return "D — Store / books";
    case "plan":
      return "E — Installment plan";
    default:
      return kind;
  }
}

type StudentFeeGroup = {
  student: ReceiptStudentRow;
  lines: VoucherLine[];
  subtotalPaise: number;
};

function groupVoucherLinesByStudent(
  voucher: CollectionVoucher,
  studentRows: ReceiptStudentRow[],
): StudentFeeGroup[] {
  const ids: string[] = [];
  for (const row of studentRows) {
    if (!ids.includes(row.studentId)) ids.push(row.studentId);
  }
  for (const line of voucher.lines) {
    if (!ids.includes(line.studentId)) ids.push(line.studentId);
  }

  return ids.map((studentId) => {
    const student =
      studentRows.find((s) => s.studentId === studentId) ??
      ({
        studentId,
        admissionNo: "—",
        fullName:
          voucher.lines.find((l) => l.studentId === studentId)?.studentName ??
          "—",
        fatherName: "—",
        classSection: "—",
      } satisfies ReceiptStudentRow);
    const lines = voucher.lines.filter((l) => l.studentId === studentId);
    return {
      student,
      lines,
      subtotalPaise: lines.reduce((s, l) => s + l.amountPaise, 0),
    };
  });
}

/**
 * One row per fee head, with its months gathered into a single cell.
 *
 * A term's tuition used to be three rows — "Tuition Fee · May", "· June",
 * "· July" — each repeating the head and each carrying its own discount. A
 * sibling pair on a quarter therefore filled most of the sheet with the
 * words "Tuition Fee". Collapsed to one row per head, the same receipt says
 * more in a quarter of the space, which is what buys the larger type.
 *
 * Labels are `Head · Period`; anything without a separator is a head with no
 * period and keeps its own row. Grouping is by head AND kind, so a head that
 * somehow appears under two sections is never silently merged across them.
 *
 * Store and transport lines keep their own detail — the item breakup and the
 * route — because that detail is the point of those lines. They are grouped
 * too, but the details of every line in the group are still rendered.
 */
export type FeeHeadGroup = {
  key: string;
  kind: string;
  head: string;
  periods: string[];
  amountPaise: number;
  concessionPaise: number;
  billedPaise: number;
  lines: VoucherLine[];
};

/**
 * Session order: April first, March last.
 *
 * Lines arrive in whatever order the due keys sorted into, which put a
 * term's tuition on the receipt as "June, July, May". A parent reading that
 * cannot tell whether it is a list or a mistake. The school year runs
 * April–March, so that is the order the months are printed in — not
 * January-first, which would put March before April.
 *
 * A span is ranked by the month it STARTS in, so a transport period of
 * "Apr · Jun" sits with April, where a reader expects it. Anything with no
 * month at all — "Full year", a one-off label — keeps the order it arrived
 * in and follows the months, rather than being placed on a guess.
 */
const SESSION_MONTHS = [
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
  "jan",
  "feb",
  "mar",
];

function monthRank(period: string): number {
  const key = period.trim().slice(0, 3).toLowerCase();
  const i = SESSION_MONTHS.indexOf(key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Chronological where it can be known, stable where it cannot. */
export function orderPeriods(periods: readonly string[]): string[] {
  return periods
    .map((p, i) => ({ p, i, rank: monthRank(p) }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.i - b.i))
    .map((x) => x.p);
}

export function groupLinesByHead(lines: VoucherLine[]): FeeHeadGroup[] {
  const out: FeeHeadGroup[] = [];
  const byKey = new Map<string, FeeHeadGroup>();

  for (const line of lines) {
    // Split on the first separator only: a period may itself contain one.
    const sep = line.label.indexOf(" · ");
    const head =
      sep === -1 ? line.label.trim() : line.label.slice(0, sep).trim();
    const period = sep === -1 ? "" : line.label.slice(sep + 3).trim();
    const key = `${line.kind}||${head}`;

    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        kind: line.kind,
        head: head || "Fee",
        periods: [],
        amountPaise: 0,
        concessionPaise: 0,
        billedPaise: 0,
        lines: [],
      };
      byKey.set(key, group);
      // Insertion order, so the sheet keeps the order collect built.
      out.push(group);
    }
    if (period && !group.periods.includes(period)) group.periods.push(period);
    group.amountPaise += line.amountPaise;
    group.concessionPaise += line.concessionPaise ?? 0;
    group.billedPaise += line.billedPaise ?? line.amountPaise;
    group.lines.push(line);
  }

  for (const group of out) group.periods = orderPeriods(group.periods);
  return out;
}

function FeeLineParticulars({ line }: { line: VoucherLine }) {
  const issueRef =
    line.kind === "store"
      ? line.storeIssueNo || (line.label.match(/ISS\/[^\s·]+/)?.[0] ?? "")
      : "";

  const headLabel =
    line.kind === "store"
      ? `Store${issueRef ? ` · ${issueRef}` : ""}`
      : line.kind === "transport"
        ? `Transport${line.transport ? ` · ${line.transport.periodLabel}` : ""}`
        : line.label;

  return (
    <div>
      <span className="font-semibold">{headLabel}</span>
      {line.kind === "store" &&
      line.storeItems &&
      line.storeItems.length > 0 ? (
        <ul className="mt-0.5 space-y-0.5 text-[9px] leading-snug text-[var(--brand-deep)]">
          {line.storeItems.map((it, idx) => (
            <li
              key={`${line.dueKey}-it-${idx}`}
              className="flex justify-between gap-2"
            >
              <span>
                <span className="text-[var(--muted)]">{it.sku}</span>
                {" · "}
                {it.name}
                {it.sizeLabel ? ` (${it.sizeLabel})` : ""}
                {" ×"}
                {it.qty} @ {inrCell(it.unitPricePaise)}
              </span>
              <span className="shrink-0 tabular-nums font-semibold">
                {inrCell(it.linePaise)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {line.kind === "transport" && line.transport ? (
        <div className="mt-0.5 text-[9px] leading-snug text-[var(--muted)]">
          {line.transport.routeCode} · {line.transport.routeName} ·{" "}
          {line.transport.busNo}
          {line.transport.vehicleReg ? ` (${line.transport.vehicleReg})` : ""}
          {" · Stop "}
          {line.transport.stopName}
        </div>
      ) : null}
      {line.concessionPaise && line.concessionPaise > 0 ? (
        <div className="mt-0.5 space-y-0.5 text-[9px] leading-snug text-[var(--muted)]">
          {line.billedPaise ? (
            <div>
              Billed {inrCell(line.billedPaise)} · discount{" "}
              {inrCell(line.concessionPaise)}
            </div>
          ) : (
            <div>Discount {inrCell(line.concessionPaise)}</div>
          )}
          {line.concessionDetails?.map((c) => (
            <div key={`${line.dueKey}-${c.grantId}`}>
              · {formatConcessionDetailLine(c)}
              {c.code ? ` (${c.code})` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One grouped row: head · periods · discount · amount. */
/**
 * What a line adds beyond its head name: the bus and stop, the items issued.
 *
 * Split out of `FeeLineParticulars` so a grouped row can show the detail
 * without repeating the head it is already printed under.
 */
function FeeLineDetail({ line }: { line: VoucherLine }) {
  if (line.kind === "store" && line.storeItems && line.storeItems.length > 0) {
    return (
      <ul className="space-y-0.5 text-[9px] leading-snug text-[var(--brand-deep)]">
        {line.storeItems.map((it, idx) => (
          <li
            key={`${line.dueKey}-it-${idx}`}
            className="flex justify-between gap-2"
          >
            <span>
              <span className="text-[var(--muted)]">{it.sku}</span>
              {" · "}
              {it.name}
              {it.sizeLabel ? ` (${it.sizeLabel})` : ""}
              {" ×"}
              {it.qty} @ {inrCell(it.unitPricePaise)}
            </span>
            <span className="shrink-0 tabular-nums font-semibold">
              {inrCell(it.linePaise)}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (line.kind === "transport" && line.transport) {
    return (
      <div className="text-[9px] leading-snug text-[var(--muted)]">
        {line.transport.routeCode} · {line.transport.routeName} ·{" "}
        {line.transport.busNo}
        {line.transport.vehicleReg ? ` (${line.transport.vehicleReg})` : ""}
        {" · Stop "}
        {line.transport.stopName}
      </div>
    );
  }
  return null;
}

function FeeHeadRow({
  group,
  rowKey,
}: {
  group: FeeHeadGroup;
  rowKey: string;
}) {
  // Only the kinds whose detail carries information the head row cannot.
  const detailLines = group.lines.filter(
    (l) =>
      (l.kind === "store" && (l.storeItems?.length ?? 0) > 0) ||
      (l.kind === "transport" && !!l.transport),
  );

  return (
    <tr key={rowKey} className="border-b border-[rgba(32,48,80,0.1)]">
      <td className="px-1.5 py-0.5 align-top font-semibold text-[var(--brand-deep)]">
        {group.head}
        {detailLines.length > 0 ? (
          <div className="mt-0.5 font-normal">
            {detailLines.map((l, i) => (
              // The DETAIL only — the route, the item list. Rendering the
              // whole particulars here printed the head twice: "Transport"
              // as the row's own name, then "Transport · Apr" again beneath
              // it, which read as two charges for one bus.
              <FeeLineDetail key={`${rowKey}-d-${i}`} line={l} />
            ))}
          </div>
        ) : null}
      </td>
      <td className="px-1.5 py-0.5 align-top leading-snug text-[var(--muted)]">
        {group.periods.join(", ") || "—"}
      </td>
      <td className="w-14 px-1.5 py-0.5 text-right align-top tabular-nums text-[var(--success)]">
        {group.concessionPaise > 0 ? `−${inrCell(group.concessionPaise)}` : "—"}
      </td>
      <td className="w-16 px-1.5 py-0.5 text-right align-top font-semibold tabular-nums text-[var(--brand-deep)]">
        {inrCell(group.amountPaise)}
      </td>
    </tr>
  );
}

function renderStudentFeeRows(
  lines: VoucherLine[],
  keyPrefix: string,
): ReactNode[] {
  const rows: ReactNode[] = [];
  const known = new Set<string>(KIND_ORDER);

  const section = (kind: string, chunk: VoucherLine[]) => {
    if (chunk.length === 0) return;
    rows.push(
      <tr key={`${keyPrefix}-sec-${kind}`} className="bg-[rgba(32,48,80,0.06)]">
        <td
          colSpan={4}
          className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--brand-deep)]"
        >
          {sectionTitle(kind as FeeKind)}
        </td>
      </tr>,
    );
    for (const group of groupLinesByHead(chunk)) {
      rows.push(
        <FeeHeadRow
          key={`${keyPrefix}-${group.key}`}
          rowKey={`${keyPrefix}-${group.key}`}
          group={group}
        />,
      );
    }
  };

  for (const kind of KIND_ORDER) {
    section(
      kind,
      lines.filter((l) => l.kind === kind),
    );
  }

  // Anything with a kind the section list does not know about still has to
  // appear — a receipt that quietly drops a paid line is the worst outcome.
  const rest = lines.filter((x) => !known.has(x.kind as FeeKind));
  for (const group of groupLinesByHead(rest)) {
    rows.push(
      <FeeHeadRow
        key={`${keyPrefix}-x-${group.key}`}
        rowKey={`${keyPrefix}-x-${group.key}`}
        group={group}
      />,
    );
  }

  return rows;
}

function FeeReceiptCopy({
  copyLabel,
  voucher,
  householdHint,
  studentRows,
  studentGroups,
  multiSibling,
  voided,
  stc,
  showRemainingPayQr,
  remainingPayQrDataUrl,
  remainingPayAmountPaise,
  remainingPayUrl,
  referralCode,
  referralUrl,
  referralQrDataUrl,
}: {
  copyLabel: "Parent copy" | "Office copy";
  voucher: CollectionVoucher;
  householdHint?: string;
  studentRows: ReceiptStudentRow[];
  studentGroups: StudentFeeGroup[];
  multiSibling: boolean;
  voided: boolean;
  stc: boolean;
  showRemainingPayQr: boolean;
  remainingPayQrDataUrl?: string | null;
  remainingPayAmountPaise?: number;
  remainingPayUrl?: string | null;
  referralCode?: string;
  referralUrl?: string;
  referralQrDataUrl?: string | null;
}) {
  const discountTotal = voucher.lines.reduce(
    (s, l) => s + (l.concessionPaise ?? 0),
    0,
  );

  return (
    <div className="fee-receipt-copy relative flex min-h-0 flex-1 flex-col">
      <div className="fee-receipt-inner relative flex min-h-0 flex-1 flex-col border-[2px] border-[var(--brand-deep)]">
        <div
          className="fee-receipt-watermark pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden"
          aria-hidden
        >
          <span
            className={`select-none text-[3rem] font-black uppercase tracking-[0.18em] ${
              voided
                ? "text-[rgba(180,35,24,0.12)]"
                : "text-[rgba(15,122,76,0.11)]"
            }`}
            style={{ transform: "rotate(-28deg)" }}
          >
            {voided ? "Void" : "Paid"}
          </span>
        </div>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col border border-[var(--brand-gold)] p-2 sm:p-2.5">
          <div className="mb-1 flex items-center justify-between gap-2 border-b border-[var(--brand-deep)] pb-1">
            <span className="rounded bg-[var(--brand-deep)] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-white">
              {copyLabel}
            </span>
            <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              {voucher.receiptNo}
            </span>
          </div>

          {/* Letterhead — the sheet must identify the school on its own, in
              a parent's file or an auditor's folder, without the app. */}
          <header className="flex items-center gap-2.5 border-b-2 border-[var(--brand-deep)] pb-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={TENANT.logoUrl}
              alt=""
              width={52}
              height={52}
              className="h-[52px] w-[52px] shrink-0 object-contain"
            />
            <div className="min-w-0 flex-1 text-center">
              <p className="font-brand-name text-[15px] font-bold leading-tight text-[var(--brand-deep)]">
                {schoolPrintName()}
              </p>
              <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-[var(--brand-gold)]">
                {TENANT.tagline}
              </p>
              <p className="mt-0.5 text-[7.5px] leading-snug text-[var(--muted)]">
                {schoolAddressLine()}
              </p>
              <p className="text-[7.5px] leading-snug text-[var(--muted)]">
                {TENANT.schoolStatus} · {schoolStatutoryLine()}
              </p>
              <p className="text-[7.5px] leading-snug text-[var(--muted)]">
                {schoolContactLine()}
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={TENANT.logoCrestUrl}
              alt=""
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 object-contain opacity-90"
            />
          </header>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[8px]">
            <span className="font-bold uppercase tracking-wide text-[var(--brand-deep)]">
              {receiptSeriesOf(voucher.receiptNo) === "R"
                ? "Registration receipt"
                : "Fee receipt"}
              {voided ? " · void" : ""}
            </span>
            <span>
              <span className="text-[var(--muted)]">Date </span>
              <span className="font-semibold">
                {formatDisplayDate(voucher.collectionDate)}
              </span>
              {" · "}
              <span className="text-[var(--muted)]">AY </span>
              <span className="font-semibold">{voucher.academicYearCode}</span>
            </span>
          </div>

          {stc ? (
            <div className="mt-1 border border-[var(--brand-gold)] bg-[rgba(197,160,40,0.1)] px-2 py-0.5 text-center text-[7px] font-bold uppercase text-[var(--brand-deep)]">
              Cheque subject to clearance
            </div>
          ) : null}

          <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[8px]">
            <div>
              <dt className="text-[var(--muted)]">Guardian</dt>
              <dd className="font-semibold">{householdHint || "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Received by</dt>
              <dd className="font-semibold">{voucher.cashierName}</dd>
            </div>
          </dl>

          <div className="mt-1.5">
            <p className="mb-0.5 text-[7px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              Student particulars
            </p>
            <table className="w-full border-collapse text-[8px]">
              <thead>
                <tr className="bg-[rgba(32,48,80,0.08)] text-left text-[var(--brand-deep)]">
                  <th className="w-4 border border-[rgba(32,48,80,0.12)] px-0.5 py-0.5 font-semibold">
                    #
                  </th>
                  <th className="border border-[rgba(32,48,80,0.12)] px-0.5 py-0.5 font-semibold">
                    Reg.
                  </th>
                  <th className="border border-[rgba(32,48,80,0.12)] px-0.5 py-0.5 font-semibold">
                    Name
                  </th>
                  <th className="border border-[rgba(32,48,80,0.12)] px-0.5 py-0.5 font-semibold">
                    Father
                  </th>
                  <th className="border border-[rgba(32,48,80,0.12)] px-0.5 py-0.5 font-semibold">
                    Class
                  </th>
                </tr>
              </thead>
              <tbody>
                {studentRows.map((row, i) => (
                  <tr key={row.studentId}>
                    <td className="border border-[rgba(32,48,80,0.1)] px-0.5 py-0.5 text-[var(--muted)]">
                      {i + 1}
                    </td>
                    <td className="border border-[rgba(32,48,80,0.1)] px-0.5 py-0.5 font-semibold tabular-nums">
                      {row.admissionNo}
                    </td>
                    <td className="border border-[rgba(32,48,80,0.1)] px-0.5 py-0.5 font-semibold">
                      {row.fullName}
                    </td>
                    <td className="border border-[rgba(32,48,80,0.1)] px-0.5 py-0.5">
                      {row.fatherName}
                    </td>
                    <td className="border border-[rgba(32,48,80,0.1)] px-0.5 py-0.5 font-semibold">
                      {row.classSection}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-1 min-h-0 flex-1 space-y-1">
            {studentGroups.map((group) => (
              <div key={`${copyLabel}-${group.student.studentId}`}>
                <p className="mb-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--brand-deep)]">
                  {multiSibling
                    ? `Fee particulars — ${group.student.fullName} (${group.student.classSection}) · Reg. ${group.student.admissionNo}`
                    : "Fee particulars"}
                </p>
                {/* Grouped one row per head, so the type can be bigger:
                    8px → 10px, which is the difference between a receipt a
                    parent squints at and one they can read. */}
                <table className="w-full border-collapse text-[10px]">
                  <thead>
                    <tr className="bg-[var(--brand-deep)] text-left text-white">
                      <th className="px-1.5 py-0.5 font-semibold">Fee head</th>
                      <th className="px-1.5 py-0.5 font-semibold">Period</th>
                      <th className="w-14 px-1.5 py-0.5 text-right font-semibold">
                        Discount
                      </th>
                      <th className="w-16 px-1.5 py-0.5 text-right font-semibold">
                        Amount ₹
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderStudentFeeRows(
                      group.lines,
                      `${copyLabel}-${group.student.studentId}`,
                    )}
                    {multiSibling ? (
                      <tr className="bg-[rgba(32,48,80,0.05)] font-bold">
                        <td colSpan={3} className="px-1.5 py-0.5 text-right">
                          {group.student.fullName} subtotal
                        </td>
                        <td className="px-1.5 py-0.5 text-right tabular-nums">
                          {inrCell(group.subtotalPaise)}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="mt-1 shrink-0">
            {discountTotal > 0 ? (
              <div className="flex justify-between text-[9px] font-semibold text-[var(--success)]">
                <span>Total discount</span>
                <span>−{formatInr(discountTotal)}</span>
              </div>
            ) : null}
            <div className="flex justify-between rounded bg-[rgba(197,160,40,0.15)] px-1.5 py-1 text-[11px] font-extrabold text-[var(--brand-deep)]">
              <span className="uppercase tracking-wide">
                {multiSibling ? "Grand total received" : "Total received"}
              </span>
              <span className="tabular-nums">
                {formatInr(voucher.totalPaise)}
              </span>
            </div>
            <p className="mt-0.5 text-[8px] leading-snug text-[var(--brand-deep)]">
              <span className="font-semibold text-[var(--muted)]">
                In words:{" "}
              </span>
              {amountInWordsPaise(voucher.totalPaise)}
            </p>
          </div>

          <div className="mt-1 shrink-0">
            <p className="mb-0.5 text-[7px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
              Mode of payment
            </p>
            <table className="w-full border-collapse text-[8px]">
              <tbody>
                {voucher.tenders.map((t, i) => (
                  <tr
                    key={`${copyLabel}-t-${t.mode}-${i}`}
                    className="border-b border-[rgba(32,48,80,0.08)]"
                  >
                    <td className="py-0.5 pr-1 font-semibold">
                      {tenderModeLabel(t.mode)}
                    </td>
                    <td className="py-0.5 pr-1 text-[var(--muted)]">
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
                    <td className="py-0.5 text-right font-semibold tabular-nums">
                      {formatInr(t.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The two parent-copy panels sit SIDE BY SIDE.
              Stacked, they were 37mm of a 285mm page, and a receipt for
              three children then ran onto a second sheet. Side by side they
              cost about half that and use the full width the page already
              has. The office copy carries neither, which is why only the
              parent copy ever overflowed. */}
          <div className="mt-1 grid shrink-0 grid-cols-2 gap-1.5">
            {showRemainingPayQr &&
            !voided &&
            remainingPayQrDataUrl &&
            (remainingPayAmountPaise || 0) > 0 ? (
              <div className="flex items-center gap-2 rounded border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.06)] px-1.5 py-0.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={remainingPayQrDataUrl}
                  alt="UPI QR for remaining dues"
                  className="h-14 w-14 shrink-0 rounded border border-white bg-white p-0.5"
                />
                <div className="min-w-0 text-[7px] leading-snug text-[var(--brand-deep)]">
                  <p className="font-bold uppercase text-[#0f766e]">
                    Pay remaining dues
                  </p>
                  <p className="font-semibold tabular-nums">
                    {formatInr(remainingPayAmountPaise || 0)}
                  </p>
                  {remainingPayUrl ? (
                    <p className="mt-0.5 break-all text-[6px] text-[#0f766e]">
                      {remainingPayUrl}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Refer a family — parent copy only, and never on a void. */}
            {copyLabel === "Parent copy" && !voided && referralCode ? (
              <div className="flex items-center gap-2 rounded border border-[rgba(197,160,40,0.5)] bg-[rgba(197,160,40,0.08)] px-1.5 py-0.5">
                {referralQrDataUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={referralQrDataUrl}
                    alt="Refer a family — registration QR"
                    className="h-16 w-16 shrink-0 rounded border border-white bg-white p-0.5"
                  />
                ) : null}
                <div className="min-w-0 text-[7px] leading-snug text-[var(--brand-deep)]">
                  <p className="text-[8px] font-bold uppercase tracking-wide text-[#8a6d12]">
                    Refer a family · earn a fee discount
                  </p>
                  <p className="mt-0.5">
                    Know a family looking for a school? Let them scan this code
                    to register. When a child you refer takes admission, a
                    discount is applied to your own ward&apos;s tuition fee — as
                    per the school&apos;s referral policy.
                  </p>
                  <p className="mt-0.5">
                    किसी परिचित परिवार को विद्यालय की तलाश है? उन्हें यह QR
                    स्कैन करके पंजीकरण कराने को कहें। आपके द्वारा भेजे गए बच्चे
                    का प्रवेश होने पर, विद्यालय की रेफ़रल नीति के अनुसार आपके
                    अपने बच्चे की ट्यूशन फ़ीस में छूट दी जाएगी।
                  </p>
                  <p className="mt-0.5 font-bold">
                    Your referral code:{" "}
                    <span className="font-mono">{referralCode}</span>
                  </p>
                  {referralUrl ? (
                    <p className="break-all text-[6px] text-[#8a6d12]">
                      {referralUrl}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-1 grid shrink-0 grid-cols-2 gap-3 text-[8px] text-[var(--brand-deep)]">
            <div className="border-t border-[rgba(32,48,80,0.35)] pt-0.5">
              Parent / payer
            </div>
            <div className="border-t border-[rgba(32,48,80,0.35)] pt-0.5 text-right">
              Authorised signatory
              <div className="text-[7px] text-[var(--muted)]">
                {voucher.cashierName}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
  referralQrDataUrl,
  referralCodeProp,
}: {
  voucher: CollectionVoucher;
  householdHint?: string;
  sis?: SisState | null;
  masters?: MastersState | null;
  students?: ReceiptStudentRow[];
  remainingPayQrDataUrl?: string | null;
  remainingPayAmountPaise?: number;
  remainingPayUrl?: string | null;
  /** QR of this household's referral link; rendered on the parent copy. */
  referralQrDataUrl?: string | null;
  /**
   * The household's referral code, when the caller already knows it.
   *
   * The shared copy — the one a parent actually keeps — is rendered by a
   * public page that has no SIS roster and must not be given one. Without
   * this the lookup below returned nothing, the code came back empty, and
   * the whole refer-a-family panel silently vanished from every receipt
   * sent over WhatsApp. The desk still derives it from the roster.
   */
  referralCodeProp?: string;
}) {
  const voided = !!voucher.voidedAt;
  const stc = voucherHasUnclearedCheque(voucher);
  const studentRows = studentsProp ?? receiptStudentRows(voucher, sis, masters);
  const studentGroups = groupVoucherLinesByStudent(voucher, studentRows);
  const multiSibling = studentGroups.length > 1;

  // The parent's own referral code and link, printed on their copy: the
  // receipt is the one piece of school paper every family keeps, so it is
  // where the refer-a-family offer belongs. The code identifies THIS
  // household, so an enquiry scanned from it is attributed to them.
  const household = sis?.households.find((h) => h.id === voucher.householdId);
  const referralCode =
    referralCodeProp || (household ? referralCodeFor(household) : "");
  const referralUrl = referralCode
    ? `https://${TENANT.publicPortal}/apply?ref=${encodeURIComponent(referralCode)}`
    : "";

  const copyProps = {
    voucher,
    householdHint,
    studentRows,
    studentGroups,
    multiSibling,
    voided,
    stc,
    remainingPayQrDataUrl,
    remainingPayAmountPaise,
    remainingPayUrl,
    referralCode,
    referralUrl,
    referralQrDataUrl,
  };

  return (
    <div
      id={`receipt-${voucher.id}`}
      data-voided={voided ? "true" : "false"}
      className={`fee-receipt-sheet fee-receipt-dual overflow-hidden rounded-xl border bg-white shadow-[0_8px_28px_rgba(32,48,80,0.08)] ${
        voided
          ? "border-[rgba(180,60,60,0.35)] opacity-80"
          : "border-[rgba(32,48,80,0.14)]"
      }`}
    >
      <div className="fee-receipt-dual-a4 flex flex-col p-2 sm:p-3">
        <FeeReceiptCopy
          copyLabel="Parent copy"
          showRemainingPayQr
          {...copyProps}
        />

        <div
          className="fee-receipt-perforation my-2 flex shrink-0 items-center justify-center gap-2 py-1"
          aria-hidden
        >
          <span className="text-[var(--muted)]">✂</span>
          <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            Tear along perforation
          </span>
          <span className="text-[var(--muted)]">✂</span>
        </div>

        <FeeReceiptCopy
          copyLabel="Office copy"
          showRemainingPayQr={false}
          {...copyProps}
        />
      </div>

      <p className="print-hide px-3 pb-3 text-center text-[9px] text-[var(--muted)]">
        Prints two pages — page 1 Parent copy, page 2 Office copy
        {multiSibling
          ? ` · ${studentGroups.length} students on this receipt`
          : ""}
      </p>
    </div>
  );
}
