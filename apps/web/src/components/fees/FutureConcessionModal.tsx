"use client";

import { useEffect } from "react";
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
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

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
            Only heads that repeat across the session are offered here — a
            one-time charge is discounted on this receipt alone. Ticking a
            head adds a standing concession in Masters so future months get
            the discount automatically.
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

                    {c.existing.length > 0 ? (
                      <div className="mt-2 rounded-lg border border-[#f59e0b]/45 bg-[var(--warning-soft)] px-3 py-2 text-[13px] text-[#92400e]">
                        <div className="font-bold">
                          This student already has a concession on{" "}
                          {c.feeHeadName}
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {c.existing.map((e) => (
                            <li key={e.grantId}>
                              • {e.ruleName} ({e.rateLabel}) — taking off{" "}
                              {formatInr(e.currentAmountPaise)} this month
                            </li>
                          ))}
                        </ul>
                        <div className="mt-1.5 border-t border-[#f59e0b]/40 pt-1.5">
                          {(() => {
                            const existingTotal = c.existing.reduce(
                              (s, e) => s + e.currentAmountPaise,
                              0,
                            );
                            const after = existingTotal + c.discountPaise;
                            return (
                              <>
                                <div>
                                  <span className="font-bold">If you tick this:</span>{" "}
                                  the two <em>stack</em> — from{" "}
                                  {c.futureEffectiveFrom} this head is discounted{" "}
                                  <span className="font-bold">
                                    {formatInr(existingTotal)} +{" "}
                                    {formatInr(c.discountPaise)} ={" "}
                                    {formatInr(after)}
                                  </span>{" "}
                                  every month
                                  {c.billedPaise > 0 ? (
                                    <>
                                      , so ₹
                                      {Math.max(
                                        0,
                                        c.billedPaise - after,
                                      ) / 100}{" "}
                                      of {formatInr(c.billedPaise)} is billed
                                    </>
                                  ) : null}
                                  .
                                </div>
                                <div className="mt-1">
                                  <span className="font-bold">
                                    If you leave it unticked:
                                  </span>{" "}
                                  today&apos;s{" "}
                                  {formatInr(c.discountPaise)} applies to this
                                  receipt only, and the existing{" "}
                                  {formatInr(existingTotal)} continues
                                  unchanged.
                                </div>
                                <div className="mt-1 opacity-90">
                                  To change the amount instead of adding to it,
                                  edit the existing rule in Masters →
                                  Concessions.
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    ) : null}
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
