"use client";

/**
 * What this child still owes, on the child's own page.
 *
 * The profile answered every question about a student except the one the
 * office is asked at the gate: "kitna baaki hai?". Finding out meant leaving
 * the record, opening Fee Take, and searching the same child again — so the
 * clerk either did not bother or quoted a figure from memory.
 *
 * Only OPEN dues are listed. A paid line is history and belongs in the
 * ledger; this card is the amount somebody has to collect. Overdue is split
 * out from not-yet-due, because "₹18,400 outstanding" and "₹18,400 overdue"
 * are two very different conversations with a parent.
 *
 * Payments are on the card too. "Kitna baaki hai" is always followed by
 * "kab jama kiya tha" — and a parent who says they paid on the 5th is
 * answered from the record, not from memory. Voided receipts stay listed,
 * marked VOID and excluded from the total: a cancelled receipt the parent
 * still holds is exactly the one that gets argued about.
 *
 * Siblings are on the card too, because fees are paid by a FAMILY, not by a
 * child. A father at the counter for his younger son does not know — and is
 * not told — that his daughter in VIII is three months behind, so he pays
 * one bill and leaves. One receipt, one visit, both children: that only
 * happens if the person looking at the record can see the whole family.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IndianRupee, ReceiptText } from "lucide-react";
import { istDateString } from "@bhb/time";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  paidByDueKey,
  paperRefOf,
  tenderModeLabel,
  type CollectionVoucher,
  type FeeDueLine,
  type FeesState,
} from "@/lib/fees";
import { loadMasters, type MastersState } from "@/lib/masters";
import { classLabelForStudent } from "@/lib/parentPortal";
import {
  loadSis,
  normalizeStudent,
  siblingsOf,
  type SisStudent,
} from "@/lib/sis";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

type Load =
  | { kind: "loading" }
  | {
      kind: "ready";
      student: SisStudent;
      /** Same household, same session — see siblingsOf. */
      siblings: SisStudent[];
      fees: FeesState;
      masters: MastersState;
    }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** Receipts shown before the office has to ask for the rest. */
const PAYMENT_PREVIEW = 6;

export function StudentFeeDuesCard({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [showAllPayments, setShowAllPayments] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        const { ensureFeesHydrated } = await import("@/lib/feesPersistence");
        const { hydrateFeesStore } = await import("@/lib/fees");
        const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
        await Promise.all([
          withHydrationSlot(() => ensureSisHydrated()),
          withHydrationSlot(() => ensureFeesHydrated()),
        ]);
        await hydrateFeesStore();
        if (!alive) return;
        const sis = loadSis();
        const raw = sis.students.find((s) => s.id === studentId);
        if (!raw) {
          setLoad({ kind: "missing" });
          return;
        }
        const student = normalizeStudent(raw);
        setLoad({
          kind: "ready",
          student,
          siblings: siblingsOf(sis, student).map(normalizeStudent),
          fees: loadFees(),
          masters: loadMasters(),
        });
      } catch (e) {
        if (!alive) return;
        // A failed read is NOT "nothing owed". Say the figure is unknown
        // rather than print a zero somebody might quote to a parent.
        setLoad({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not read fee dues",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId]);

  const summary = useMemo(() => {
    if (load.kind !== "ready") return null;
    const today = istDateString();
    // Built once and shared: paidByDueKey scans the whole voucher history,
    // and a family of four would otherwise scan it four times.
    const paidMap = paidByDueKey(load.fees);
    const openDuesFor = (s: SisStudent) =>
      openFeeDues(
        computeStudentDues(s, load.masters, load.fees, {
          paidMap,
          includePaid: false,
          /*
            Up to the running month only.

            With the default (`includeFuture: true`) this card would add up
            every month the session will EVER bill — the same mistake that
            once put ₹1,38,525 on a payment QR for a ₹5,000 receipt. A clerk
            reads a figure off a profile and says it out loud to a parent,
            so it has to be what the family owes today, not what they will
            owe by March.
          */
          includeFuture: false,
          // A student who has left can still owe money, and this card is
          // exactly where that is noticed.
          includeInactive: true,
        }),
      );

    const open = openDuesFor(load.student);
    const overdue: FeeDueLine[] = [];
    const upcoming: FeeDueLine[] = [];
    for (const l of open) {
      if (l.dueOn && l.dueOn <= today) overdue.push(l);
      else upcoming.push(l);
    }
    const sum = (rows: FeeDueLine[]) =>
      rows.reduce((s, r) => s + r.balancePaise, 0);
    const byDue = (a: FeeDueLine, b: FeeDueLine) =>
      (a.dueOn || "9999-12-31").localeCompare(b.dueOn || "9999-12-31") ||
      a.dueKey.localeCompare(b.dueKey);
    // Every sibling, including the ones who owe nothing: "the others are
    // clear" is an answer the counter needs as much as a figure.
    const siblings = load.siblings
      .map((s) => {
        const rows = openDuesFor(s);
        const late = rows.filter((l) => l.dueOn && l.dueOn <= today);
        return {
          id: s.id,
          name: (s.fullName || "").trim() || "(unnamed)",
          classLabel: classLabelForStudent(s, load.masters),
          admissionNo: (s.admissionNo || "").trim(),
          totalPaise: sum(rows),
          overduePaise: sum(late),
        };
      })
      .sort(
        (a, b) =>
          b.totalPaise - a.totalPaise ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );

    const selfTotal = sum(open);
    return {
      rows: [...overdue.sort(byDue), ...upcoming.sort(byDue)],
      overdueKeys: new Set(overdue.map((l) => l.dueKey)),
      overduePaise: sum(overdue),
      upcomingPaise: sum(upcoming),
      totalPaise: selfTotal,
      oldest: overdue.sort(byDue)[0]?.dueOn || "",
      siblings,
      familyPaise:
        selfTotal + siblings.reduce((t, s) => t + s.totalPaise, 0),
      familyOverduePaise:
        sum(overdue) + siblings.reduce((t, s) => t + s.overduePaise, 0),
    };
  }, [load]);

  /**
   * Receipts that carry a line for THIS child.
   *
   * A household receipt often pays for three children at once, so the row
   * shows this student's share and names the receipt's own total beside it
   * — otherwise the profile shows ₹4,000 for a ₹12,000 receipt the parent
   * is holding, and the office is accused of losing money.
   */
  const payments = useMemo(() => {
    if (load.kind !== "ready") return null;
    const ay = (load.student.academicYearCode || "").trim();
    const rows = (load.fees.vouchers || [])
      .map((v: CollectionVoucher) => {
        const mine = (v.lines || []).filter(
          (l) => l.studentId === load.student.id,
        );
        if (!mine.length) return null;
        if (ay && (v.academicYearCode || "").trim() !== ay) return null;
        return {
          id: v.id,
          date: v.collectionDate || (v.collectedAt || "").slice(0, 10),
          receiptNo: paperRefOf(v) || v.receiptNo || "—",
          sharePaise: mine.reduce((t, l) => t + l.amountPaise, 0),
          totalPaise: v.totalPaise,
          heads: mine.map((l) => l.label).filter(Boolean),
          modes: [
            ...new Set((v.tenders || []).map((t) => tenderModeLabel(t.mode))),
          ],
          cashier: (v.cashierName || "").trim(),
          voided: !!v.voidedAt,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort(
        (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
      );
    return {
      rows,
      // Voided receipts are shown but never counted.
      paidPaise: rows
        .filter((r) => !r.voided)
        .reduce((t, r) => t + r.sharePaise, 0),
      sessionLabel: ay,
    };
  }, [load]);

  // Dues keep their billed order to start with — the order the counter reads
  // them in — and payments keep newest first. Both sort by the value behind
  // the cell: a balance by its paise, a date by its ISO string.
  const dueSort = useTableSort(
    summary?.rows ?? [],
    {
      head: (l) => l.label || l.feeHeadName,
      dueOn: (l) => l.dueOn || "",
      balance: (l) => l.balancePaise,
    },
    "dueOn",
    "asc",
  );
  const paymentSort = useTableSort(
    payments?.rows ?? [],
    {
      date: (r) => r.date || "",
      receipt: (r) => r.receiptNo,
      heads: (r) => r.heads.join(", "),
      amount: (r) => r.sharePaise,
    },
    "date",
    "desc",
  );

  if (load.kind === "missing") return null;

  const collectHref =
    load.kind === "ready"
      ? `/fees?q=${encodeURIComponent(load.student.admissionNo || load.student.fullName)}`
      : "/fees";

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <IndianRupee className="size-4 text-[var(--brand-deep)]" aria-hidden />
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Fees</h2>
        <Link
          href={collectHref}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
        >
          <ReceiptText className="size-3.5" aria-hidden />
          Collect fee
        </Link>
      </div>

      {load.kind === "loading" ? (
        <p className="px-3 py-3 text-xs text-[var(--muted)]">Reading dues…</p>
      ) : null}

      {load.kind === "error" ? (
        <p className="px-3 py-3 text-xs font-semibold text-[var(--danger)]">
          Dues could not be read — {load.message}. This is not a zero balance;
          check on the fee counter.
        </p>
      ) : null}

      {summary ? (
        <div className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
            Pending dues
          </p>
          <p className="text-[10px] text-[var(--muted)]">
            Billed up to this month
          </p>
        </div>
      ) : null}

      {summary && summary.totalPaise === 0 ? (
        <p className="px-3 py-3 text-xs font-bold text-[var(--success,#16794f)]">
          No pending dues up to this month for this student.
        </p>
      ) : null}

      {summary ? (
        summary.totalPaise === 0 ? null : (
          <>
            <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-b border-[var(--border)]">
              <Stat
                label="Outstanding"
                value={formatInr(summary.totalPaise)}
                strong
              />
              <Stat
                label="Overdue"
                value={formatInr(summary.overduePaise)}
                tone={summary.overduePaise > 0 ? "danger" : undefined}
                hint={
                  summary.oldest ? `oldest due ${summary.oldest}` : undefined
                }
              />
              <Stat
                label="Due later this month"
                value={formatInr(summary.upcomingPaise)}
              />
            </div>
            <p className="border-b border-[var(--border)] px-3 py-1 text-[10px] text-[var(--muted)]">
              Later months of the session are not counted here — the fee
              counter shows the full year.
            </p>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[var(--surface-sunken)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <ErpSortTh sort={dueSort} field="head">Head</ErpSortTh>
                    <ErpSortTh sort={dueSort} field="dueOn">Due on</ErpSortTh>
                    <ErpSortTh sort={dueSort} field="balance" align="right">Balance</ErpSortTh>
                  </tr>
                </thead>
                <tbody>
                  {dueSort.rows.map((l) => {
                    const late = summary.overdueKeys.has(l.dueKey);
                    return (
                      <tr
                        key={l.dueKey}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="px-3 py-1.5 text-[var(--brand-deep)]">
                          {l.label || l.feeHeadName}
                          {late ? (
                            <span className="ml-1.5 rounded bg-[var(--danger-soft)] px-1 py-0.5 text-[9px] font-bold uppercase text-[var(--danger)]">
                              overdue
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-[var(--muted)]">
                          {l.dueOn || "—"}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right font-bold tabular-nums ${
                            late ? "text-[var(--danger)]" : ""
                          }`}
                        >
                          {formatInr(l.balancePaise)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}

      {payments && payments.rows.length > 0 ? (
        <div className="border-t-2 border-[var(--border)]">
          <div className="flex flex-wrap items-baseline gap-x-2 bg-[var(--surface-sunken)] px-3 py-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
              Payment history
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              {payments.sessionLabel
                ? `Receipts for ${payments.sessionLabel}`
                : "Receipts on record"}
            </p>
            <p className="ml-auto text-[11px] font-bold tabular-nums text-[var(--success,#16794f)]">
              Paid {formatInr(payments.paidPaise)}
            </p>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[var(--surface-sunken)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <ErpSortTh sort={paymentSort} field="date">Date</ErpSortTh>
                  <ErpSortTh sort={paymentSort} field="receipt">Receipt</ErpSortTh>
                  <ErpSortTh sort={paymentSort} field="heads">Paid for</ErpSortTh>
                  <ErpSortTh sort={paymentSort} field="amount" align="right">Amount</ErpSortTh>
                </tr>
              </thead>
              <tbody>
                {/* Sorted before the preview is cut, so the first rows shown
                    are the first rows of the CHOSEN order, not of the old one. */}
                {(showAllPayments
                  ? paymentSort.rows
                  : paymentSort.rows.slice(0, PAYMENT_PREVIEW)
                ).map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)]">
                    <td className="px-3 py-1.5 tabular-nums text-[var(--muted)]">
                      {r.date || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--brand-deep)]">
                      {r.receiptNo}
                      {r.voided ? (
                        <span className="ml-1.5 rounded bg-[var(--danger-soft)] px-1 py-0.5 text-[9px] font-bold uppercase text-[var(--danger)]">
                          void
                        </span>
                      ) : null}
                      {r.modes.length ? (
                        <span className="ml-1.5 text-[10px] text-[var(--muted)]">
                          {r.modes.join(" + ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-[10px] text-[var(--muted)]">
                      {r.heads.join(", ") || "—"}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-bold tabular-nums ${
                        r.voided
                          ? "text-[var(--muted)] line-through"
                          : "text-[var(--brand-deep)]"
                      }`}
                    >
                      {formatInr(r.sharePaise)}
                      {r.sharePaise !== r.totalPaise ? (
                        <span className="block text-[9px] font-normal text-[var(--muted)]">
                          of {formatInr(r.totalPaise)} receipt
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {payments.rows.length > PAYMENT_PREVIEW ? (
            <button
              type="button"
              className="w-full border-t border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-[var(--brand-mid)] hover:bg-[var(--surface-sunken)]"
              onClick={() => setShowAllPayments((v) => !v)}
            >
              {showAllPayments
                ? "Show recent only"
                : `Show all ${payments.rows.length} receipts`}
            </button>
          ) : null}
        </div>
      ) : null}

      {summary && summary.siblings.length > 0 ? (
        <div className="border-t-2 border-[var(--border)]">
          <div className="flex flex-wrap items-baseline gap-x-2 bg-[var(--surface-sunken)] px-3 py-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
              Siblings in this family
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              Fees are paid per family — one receipt can clear all of them
            </p>
            <p className="ml-auto text-[11px] font-bold tabular-nums text-[var(--brand-deep)]">
              Family total {formatInr(summary.familyPaise)}
              {summary.familyOverduePaise > 0 ? (
                <span className="text-[var(--danger)]">
                  {" "}
                  · {formatInr(summary.familyOverduePaise)} overdue
                </span>
              ) : null}
            </p>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {summary.siblings.map((sib) => (
              <li
                key={sib.id}
                className="flex flex-wrap items-center gap-x-2 px-3 py-1.5 text-[11px]"
              >
                <Link
                  href={`/students/${sib.id}/edit`}
                  className="font-bold text-[var(--brand-deep)] hover:underline"
                >
                  {sib.name}
                </Link>
                {sib.classLabel ? (
                  <span className="rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                    {sib.classLabel}
                  </span>
                ) : null}
                {sib.admissionNo ? (
                  <span className="text-[10px] text-[var(--muted)]">
                    {sib.admissionNo}
                  </span>
                ) : null}
                {sib.totalPaise === 0 ? (
                  <span className="ml-auto font-bold text-[var(--success,#16794f)]">
                    Clear
                  </span>
                ) : (
                  <span className="ml-auto tabular-nums">
                    <span className="font-bold text-[var(--brand-deep)]">
                      {formatInr(sib.totalPaise)}
                    </span>
                    {sib.overduePaise > 0 ? (
                      <span className="ml-1.5 rounded bg-[var(--danger-soft)] px-1 py-0.5 text-[9px] font-bold uppercase text-[var(--danger)]">
                        {formatInr(sib.overduePaise)} overdue
                      </span>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger";
  strong?: boolean;
}) {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`tabular-nums ${strong ? "text-base font-extrabold" : "text-sm font-bold"} ${
          tone === "danger" ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"
        }`}
      >
        {value}
      </p>
      {hint ? (
        <p className="text-[10px] text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
