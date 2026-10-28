"use client";

import { useMemo } from "react";
import { computeStudentDues, loadFees } from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";
import { transportPeriodLabel } from "@/lib/transport";
import { paidMonthsCoveredByNewStart } from "@/lib/transportPaidMonths";

/**
 * A new assignment backdated over months the family has already paid.
 *
 * Nothing is blocked and nothing is rewritten: the dues engine matches
 * transport money to the child and the month, so the payment carries over to
 * the new stop by itself. This says so before the clerk saves, instead of the
 * office finding out from a parent (Anvi Yadav, 14 Sep 2026).
 */
export function PaidMonthsCarryOverNote({
  student,
  masters,
  effectiveFrom,
  feesWithheld = false,
}: {
  student: SisStudent | null | undefined;
  masters: MastersState | null | undefined;
  effectiveFrom: string;
  /**
   * Teaching-scope Masters (no Masters grant): the fee lists are withheld, so
   * which months are paid is unknown — say so instead of saying nothing,
   * which reads as "no month is paid".
   */
  feesWithheld?: boolean;
}) {
  const months = useMemo(() => {
    if (feesWithheld || !student || !masters || !effectiveFrom) return [];
    try {
      const dues = computeStudentDues(student, masters, loadFees(), {
        includeFuture: true,
        includePaid: true,
        includeInactive: true,
      });
      return paidMonthsCoveredByNewStart(
        dues
          .filter((d) => d.kind === "transport")
          .map((d) => ({
            periodKey: d.transport?.periodKey || d.dueOn.slice(0, 7),
            paidPaise: d.paidPaise,
          })),
        effectiveFrom,
      );
    } catch {
      return [];
    }
  }, [student, masters, effectiveFrom, feesWithheld]);

  if (feesWithheld && student) {
    return (
      <p
        role="status"
        data-testid="transport-paid-unknown"
        className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--ink)]"
      >
        Paid months are not shown for your role — check with the office before
        backdating a start over months the family may already have paid.
      </p>
    );
  }
  if (months.length === 0) return null;
  const names = months.map(transportPeriodLabel);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <p
      role="status"
      data-testid="transport-paid-carry-over"
      className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--ink)]"
    >
      <strong>
        {list} {names.length === 1 ? "is" : "are"} already paid
      </strong>{" "}
      — the payment{names.length === 1 ? "" : "s"} will carry over to the new
      stop. Nothing on the receipts changes; only the balance above what was
      paid (if the new fee is higher) will show as owing.
    </p>
  );
}
