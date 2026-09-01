"use client";

import { useMemo, useState } from "react";
import { Check, Wrench, X } from "lucide-react";

import {
  computeHouseholdDues,
  formatInr,
  loadFees,
  openFeeDues,
  type CollectionVoucher,
} from "@/lib/fees";
import { checkReceiptRepair, type RepairAllocation } from "@/lib/receiptRepair";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";

const FIELD =
  "w-full rounded-lg border border-[rgba(32,48,80,0.18)] px-2 py-1 text-xs";

/**
 * Say again which dues a receipt paid.
 *
 * Used when a receipt's lines were lost: the money is recorded, but nothing
 * says which student, head and month it settled, so every month it paid reads
 * unpaid. The counter has the paper counterfoil; this is where that goes back
 * in.
 *
 * The one rule is arithmetic — what is attached must equal what the receipt
 * collected. Saving is refused until it does, because a repair that does not
 * tie has invented money or lost some, and either is worse than the blank.
 */
export function ReceiptRepairDialog({
  voucher,
  sis,
  masters,
  onClose,
  onRepaired,
}: {
  voucher: CollectionVoucher;
  sis: SisState | null;
  masters: MastersState | null;
  onClose: () => void;
  onRepaired: (message: string) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * What this family still owes, which is what the lost money most likely
   * went to. Scoped to the running session so an older student record of the
   * same child is not offered as a separate person.
   */
  const dues = useMemo(() => {
    if (!sis || !masters || !voucher.householdId) return [];
    const rows = computeHouseholdDues(voucher.householdId, sis, masters, loadFees(), {
      includeFuture: true,
      academicYearCode: currentAcademicYearCode(masters),
    });
    return openFeeDues(rows.flatMap((r) => r.dues)).filter((d) => d.balancePaise > 0);
  }, [sis, masters, voucher.householdId]);

  const nameOf = (studentId: string) =>
    sis?.students.find((s) => s.id === studentId)?.fullName ?? studentId;

  const allocations: RepairAllocation[] = useMemo(
    () =>
      dues
        .filter((d) => (picked[d.dueKey] ?? "").trim() !== "")
        .map((d) => ({
          dueKey: d.dueKey,
          studentId: d.studentId,
          kind: d.kind,
          label: d.label,
          amountPaise: Math.round((Number(picked[d.dueKey]) || 0) * 100),
          outstandingPaise: d.balancePaise,
        })),
    [dues, picked],
  );

  const check = checkReceiptRepair({
    receiptTotalPaise: voucher.totalPaise,
    allocations,
  });

  /** Fill the boxes with the obvious answer: oldest dues first, up to the total. */
  const autoFill = () => {
    let left = voucher.totalPaise;
    const next: Record<string, string> = {};
    for (const d of [...dues].sort((a, b) => a.dueOn.localeCompare(b.dueOn))) {
      if (left <= 0) break;
      const take = Math.min(left, d.balancePaise);
      next[d.dueKey] = (take / 100).toFixed(2);
      left -= take;
    }
    setPicked(next);
  };

  const save = async () => {
    if (!check.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fees/repair-receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voucherId: voucher.id, allocations }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        linesWritten?: number;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "The repair was refused");
        return;
      }
      onRepaired(
        `${voucher.receiptNo} re-attached to ${json.linesWritten} due(s) — reload the fee desk to see it everywhere.`,
      );
      onClose();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-[var(--card)] p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--brand-deep)]">
              <Wrench className="size-4" aria-hidden /> Re-attach {voucher.receiptNo}
            </h3>
            <p className="text-[11px] text-[var(--muted)]">
              This receipt collected {formatInr(voucher.totalPaise)} but does
              not say which dues it paid. Tick the months and heads it settled —
              the counterfoil will say. It cannot be saved until the amounts add
              up to exactly what was collected.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--muted)]"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <button type="button" className="rounded-lg bg-[var(--surface-sunken)] px-2 py-1 font-semibold" onClick={autoFill}>
            Fill oldest dues first
          </button>
          <button type="button" className="rounded-lg bg-[var(--surface-sunken)] px-2 py-1 font-semibold" onClick={() => setPicked({})}>
            Clear
          </button>
          <span className="ml-auto font-bold text-[var(--brand-deep)]">
            Attached {formatInr(check.allocatedPaise)} of{" "}
            {formatInr(check.receiptTotalPaise)}
          </span>
          <span
            className={`font-bold ${
              check.remainingPaise === 0 ? "text-[var(--success)]" : "text-[var(--warning)]"
            }`}
          >
            {check.remainingPaise === 0
              ? "ties exactly"
              : `${formatInr(Math.abs(check.remainingPaise))} ${check.remainingPaise > 0 ? "left" : "over"}`}
          </span>
        </div>

        <div className="mt-2 max-h-[45vh] overflow-y-auto rounded-xl border border-[var(--border)]">
          {dues.length === 0 ? (
            <p className="p-4 text-center text-xs text-[var(--muted)]">
              This family has no open dues left, so there is nothing to attach
              this receipt to. It may already have been settled by another
              receipt.
            </p>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[var(--surface-sunken)]">
                <tr>
                  <th className="px-2 py-1.5">Student</th>
                  <th className="px-2 py-1.5">Head / month</th>
                  <th className="px-2 py-1.5 text-right">Outstanding</th>
                  <th className="px-2 py-1.5 text-right">Attach ₹</th>
                </tr>
              </thead>
              <tbody>
                {dues.map((d) => (
                  <tr key={d.dueKey} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1">{nameOf(d.studentId)}</td>
                    <td className="px-2 py-1">{d.label}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[var(--muted)]">
                      {formatInr(d.balancePaise)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        className={`${FIELD} max-w-[6.5rem] text-right`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={picked[d.dueKey] ?? ""}
                        onChange={(e) =>
                          setPicked((p) => ({ ...p, [d.dueKey]: e.target.value }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {check.problems.length > 0 ? (
          <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--warning)]">
            {check.problems.slice(0, 4).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted)]" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            disabled={!check.ok || busy}
            onClick={() => void save()}
          >
            <Check className="size-3.5" aria-hidden />
            {busy ? "Saving…" : "Re-attach"}
          </button>
        </div>
      </div>
    </div>
  );
}
