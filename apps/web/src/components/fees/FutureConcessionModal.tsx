"use client";

import { formatInr } from "@/lib/masters";
import type { FutureConcessionCandidate } from "@/lib/counterConcession";

export function FutureConcessionModal({
  candidates,
  selectedKeys,
  onToggle,
  onCancel,
  onConfirm,
}: {
  candidates: FutureConcessionCandidate[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const selectedCount = candidates.filter((c) => selectedKeys.has(c.key)).length;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(15,23,42,0.55)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="future-concession-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.14)] bg-white shadow-2xl">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-4 sm:px-5">
          <h2
            id="future-concession-title"
            className="text-lg font-bold text-[var(--brand-deep)]"
          >
            Apply discount on future payments?
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            This fee head repeats across the session. You can add a standing
            concession in Masters so future months get the same discount
            automatically.
          </p>
        </div>

        <ul className="max-h-[50vh] space-y-2 overflow-y-auto px-4 py-3 sm:px-5">
          {candidates.map((c) => {
            const checked = selectedKeys.has(c.key);
            return (
              <li key={c.key}>
                <label className="flex cursor-pointer gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.02)] p-3 hover:bg-[rgba(32,48,80,0.04)]">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={checked}
                    onChange={() => onToggle(c.key)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[var(--brand-deep)]">
                      {c.feeHeadName} · {formatInr(c.discountPaise)} off
                    </div>
                    <div className="mt-0.5 text-sm text-[var(--muted)]">
                      {c.studentName} · {c.installmentCount} installments in
                      structure
                    </div>
                    <div className="mt-1 text-sm text-[var(--brand-mid)]">
                      Future concession from {c.futureEffectiveFrom} · listed
                      under Masters → Concessions
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-2 border-t border-[rgba(32,48,80,0.08)] px-4 py-4 sm:px-5">
          <button
            type="button"
            className="flex-1 rounded-xl border border-[rgba(32,48,80,0.2)] px-4 py-3 text-sm font-bold text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
            onClick={onCancel}
          >
            This month only
          </button>
          <button
            type="button"
            className="flex-1 rounded-xl bg-[var(--brand-deep)] px-4 py-3 text-sm font-bold text-white hover:opacity-95"
            onClick={onConfirm}
          >
            {selectedCount > 0
              ? `Save ${selectedCount} future concession${selectedCount === 1 ? "" : "s"} & collect`
              : "Continue collect"}
          </button>
        </div>
      </div>
    </div>
  );
}
