"use client";

import { useEffect, useMemo, useState } from "react";
import { formatInr, type FeeDueLine } from "@/lib/fees";
import {
  assignStudentToRoute,
  expectedMonthlyFeePaise,
  listActiveRoutes,
  type TransportAssignment,
  type TransportState,
} from "@/lib/transport";
import { planTransportAmendment } from "@/lib/transportAmend";
import { monthLabel } from "@/lib/transportStartMonth";

/**
 * Move a rider to a different stop, route or fee part-way through the session.
 *
 * The change lands on the first unpaid month; paid months keep the fee they
 * were collected at. That is done by splitting rather than editing — see
 * `transportAmend.ts` for why an in-place edit would silently re-price months
 * the family has already settled.
 */
export function TransportAmendDialog({
  assignment,
  studentName,
  academicYearCode,
  state,
  dues,
  onClose,
  onDone,
}: {
  assignment: TransportAssignment;
  studentName: string;
  academicYearCode: string;
  state: TransportState;
  /** The student's fee lines — the caller has the student and masters to build them. */
  dues: FeeDueLine[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [routeId, setRouteId] = useState(assignment.routeId);
  const [stopId, setStopId] = useState(assignment.stopId);
  const [feeRupees, setFeeRupees] = useState(
    assignment.monthlyFeePaise > 0
      ? String(Math.round(assignment.monthlyFeePaise / 100))
      : "",
  );
  const [reason, setReason] = useState("");
  const [requestedMonth, setRequestedMonth] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const check = useMemo(
    () =>
      planTransportAmendment({
        dues,
        requestedMonth: requestedMonth || undefined,
        currentEffectiveFrom: assignment.effectiveFrom,
        currentMonth,
      }),
    [dues, requestedMonth, assignment.effectiveFrom, currentMonth],
  );

  const routes = listActiveRoutes(state);
  const route = routes.find((r) => r.id === routeId);
  const stop = route?.stops.find((s) => s.id === stopId);
  const expected = route
    ? expectedMonthlyFeePaise(route, stop, state.feePolicy)
    : 0;
  const overridePaise = Math.round(Number(feeRupees || "0") * 100);
  const overrides = overridePaise > 0 && overridePaise !== expected;

  function apply() {
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (!routeId || !stopId) {
      setError("Pick a route and a stop");
      return;
    }
    if (overrides && !reason.trim()) {
      setError("Enter a reason when the fee differs from the route policy");
      return;
    }
    // assignStudentToRoute closes the open assignment the day before this
    // start date, which is exactly the split we planned.
    const result = assignStudentToRoute({
      studentId: assignment.studentId,
      householdId: assignment.householdId,
      routeId,
      stopId,
      effectiveFrom: check.plan.newEffectiveFrom,
      academicYearCode,
      monthlyFeePaise: overridePaise > 0 ? overridePaise : undefined,
      feeOverrideReason: reason.trim(),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(
      `${studentName} moves to ${route?.busNo || route?.code} · ${stop?.name} from ${monthLabel(check.plan.fromMonth)}`,
    );
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(15,23,42,0.55)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transport-amend-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] p-4 sm:p-5">
          <h2
            id="transport-amend-title"
            className="text-lg font-bold text-[var(--brand-deep)]"
          >
            Change stop, route or fee
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {studentName} · riding since {assignment.effectiveFrom}
          </p>
        </div>

        <div className="space-y-3 p-4 sm:p-5">
          {check.ok ? (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-soft)] px-3 py-2 text-[11px]">
              <p className="font-bold text-[var(--success)]">
                Applies from {monthLabel(check.plan.fromMonth)}
              </p>
              <p className="mt-0.5 text-[var(--ink)]">
                {check.plan.paidMonths.length > 0
                  ? `${check.plan.paidMonths.length} paid month${check.plan.paidMonths.length === 1 ? "" : "s"} (${monthLabel(check.plan.paidMonths[0])}–${monthLabel(check.plan.paidMonths[check.plan.paidMonths.length - 1])}) keep the fee they were collected at.`
                  : "Nothing is paid yet, so no month is protected."}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
              {check.error}
            </p>
          )}

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Route
            </span>
            <select
              className="field !py-1.5"
              value={routeId}
              onChange={(e) => {
                setRouteId(e.target.value);
                setStopId("");
              }}
            >
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.name} · {r.busNo}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Stop
            </span>
            <select
              className="field !py-1.5"
              value={stopId}
              onChange={(e) => setStopId(e.target.value)}
            >
              <option value="">Pick a stop…</option>
              {(route?.stops ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.distanceKm > 0 ? ` · ${s.distanceKm} km` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Monthly fee ₹
              </span>
              <input
                className="field !py-1.5"
                inputMode="decimal"
                value={feeRupees}
                placeholder={
                  expected ? `Policy ${formatInr(expected)}` : "Per route policy"
                }
                onChange={(e) => setFeeRupees(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Apply from (optional)
              </span>
              <input
                className="field !py-1.5"
                type="month"
                value={requestedMonth}
                onChange={(e) => setRequestedMonth(e.target.value)}
              />
              <span className="mt-1 block text-[10px] text-[var(--muted)]">
                Leave blank for the first unpaid month. Cannot be earlier.
              </span>
            </label>
          </div>

          {overrides ? (
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Reason for the fee difference
              </span>
              <input
                className="field !py-1.5"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Required — the fee differs from the route policy"
              />
            </label>
          ) : null}

          {error ? (
            <p className="text-[11px] font-semibold text-[var(--danger)]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!check.ok || !stopId}
            className="rounded-lg bg-[var(--primary)] px-4 py-1.5 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            Apply change
          </button>
        </div>
      </div>
    </div>
  );
}
