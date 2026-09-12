"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { formatInr, type FeeDueLine } from "@/lib/fees";
import {
  assignStudentToRoute,
  describeRouteSeats,
  expectedMonthlyFeePaise,
  listActiveRoutes,
  seatsOnRoute,
  type TransportAssignment,
  type TransportState,
} from "@/lib/transport";
import { planTransportAmendment } from "@/lib/transportAmend";
import { RiderShiftPicker } from "@/components/transport/RiderShiftPicker";
import { NearestStopPicker } from "@/components/transport/NearestStopPicker";
import type { ClassGroupCode } from "@/lib/masters";
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
  classGroupCode,
  home,
  state,
  dues,
  onClose,
  onDone,
}: {
  assignment: TransportAssignment;
  studentName: string;
  academicYearCode: string;
  /**
   * The child's class group, which decides their run on the new route. null
   * when their class is not on the roster — the picker then says so instead
   * of resolving them onto a run by default.
   */
  classGroupCode: ClassGroupCode | null;
  /**
   * The child's household coordinates, when the school has geocoded them.
   *
   * null rather than a guess — the picker then offers a locality search
   * instead of ranking stops around a place nobody established.
   */
  home: { lat: number; lng: number } | null;
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
  const [overCapacityReason, setOverCapacityReason] = useState("");
  /**
   * Set once the move is saved. The dialog then shows the "tell the family"
   * step instead of closing.
   *
   * The move is already committed at this point and nothing here can undo it
   * — the message is an extra, and the step says so, so a clerk who closes
   * the dialog has not lost the change.
   */
  const [applied, setApplied] = useState<{
    routeId: string;
    stopId: string;
    routeLabel: string;
    stopName: string;
    effectiveFrom: string;
    fromMonth: string;
  } | null>(null);
  const [telling, setTelling] = useState(false);
  const [toldNote, setToldNote] = useState<string | null>(null);
  const [shifts, setShifts] = useState({
    pickupShiftId: assignment.pickupShiftId ?? "",
    dropShiftId: assignment.dropShiftId ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  /**
   * Leave the dialog by whichever exit the clerk took.
   *
   * Once the move is SAVED, every exit has to report it — Escape, the
   * backdrop, "Done, do not tell". `onClose` alone would dismiss the dialog as
   * if nothing had happened and leave the roster behind it showing the old
   * bus, because only `onDone` refreshes it.
   */
  const leave = useCallback(() => {
    if (applied) onDone(doneMessage(applied));
    else onClose();
    // doneMessage is a plain closure over props that do not change while the
    // dialog is open; `applied` is the part that must stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, onClose, onDone]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") leave();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

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

  // The child already holds a seat on the bus they are on, so they are left
  // out of the count — otherwise moving their stop within the same bus reports
  // it one fuller than it is.
  const seats = routeId
    ? seatsOnRoute(state, routeId, {
        exceptStudentId: assignment.studentId,
        academicYearCode,
      })
    : null;
  const seatsFull = seats?.known === true && seats.full;

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
    if (seatsFull && !overCapacityReason.trim()) {
      setError(
        `${route?.busNo || route?.code} is full. Enter a reason to seat one more.`,
      );
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
      pickupShiftId: shifts.pickupShiftId,
      dropShiftId: shifts.dropShiftId,
      overCapacityReason: overCapacityReason.trim(),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setApplied({
      routeId,
      stopId,
      routeLabel: route?.busNo || route?.code || "",
      stopName: stop?.name || "",
      effectiveFrom: check.plan.newEffectiveFrom,
      fromMonth: check.plan.fromMonth,
    });
    if (result.warning) setToldNote(result.warning);
  }

  function doneMessage(a: NonNullable<typeof applied>) {
    return `${studentName} moves to ${a.routeLabel} · ${a.stopName} from ${monthLabel(a.fromMonth)}`;
  }

  async function tellTheFamily() {
    if (!applied) return;
    setTelling(true);
    setToldNote(null);
    try {
      const res = await fetch("/api/transport/route-change-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: assignment.studentId,
          routeId: applied.routeId,
          stopId: applied.stopId,
          effectiveFrom: applied.effectiveFrom,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        to?: string | null;
        error?: string;
      };
      if (data.ok) {
        onDone(`${doneMessage(applied)} — family told on ${data.to ?? "WhatsApp"}`);
        return;
      }
      // The move stands either way. Saying which failed matters: "not sent"
      // and "not saved" are different problems and only one needs redoing.
      setToldNote(
        `The change is saved. The family was NOT told: ${data.error || "nothing sent"}`,
      );
    } catch (e) {
      setToldNote(
        `The change is saved. The family was NOT told: ${e instanceof Error ? e.message : "request failed"}`,
      );
    } finally {
      setTelling(false);
    }
  }

  return (
    // Base UI: focus trap, scroll lock, Escape. The hand-rolled overlay
    // had none of them, so Tab left the open card for the page behind it.
    <Dialog open onOpenChange={(next) => !next && leave()}>
      <DialogPopup aria-labelledby="transport-amend-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
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

        {applied ? (
          <>
            <div className="space-y-3 p-4 sm:p-5">
              <p className="rounded-lg border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-soft)] px-3 py-2 text-[11px]">
                <span className="font-bold text-[var(--success)]">Saved.</span>{" "}
                <span className="text-[var(--ink)]">
                  {doneMessage(applied)}.
                </span>
              </p>

              <p className="text-[11px] text-[var(--muted)]">
                The family has not been told. Sending uses the approved
                “Transport change” template — the bus, the stop and the date
                above, in their own language, with a button to ask for
                something different.
              </p>
              <p className="text-[10px] text-[var(--muted)]">
                Skip it when the move is bookkeeping the family already knows
                about — a stop corrected, or a change they asked for. Messaging
                every one teaches parents to ignore the ones that matter.
              </p>

              {toldNote ? (
                <p className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
                  {toldNote}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={leave}
                className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)]"
              >
                Done, do not tell
              </button>
              <button
                type="button"
                onClick={tellTheFamily}
                disabled={telling}
                className="rounded-lg bg-[var(--primary)] px-4 py-1.5 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {telling ? "Sending…" : "Tell the family"}
              </button>
            </div>
          </>
        ) : (
          <>
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

          {/*
            The same picker the new-assignment flow uses. It was missing here,
            which is backwards: a clerk creating an assignment is usually
            following a form, while a clerk MOVING a child is answering "this
            stop is wrong for where they live" — the question distance ranking
            exists to answer.
          */}
          <NearestStopPicker
            state={state}
            home={home}
            selectedStopId={stopId}
            exceptStudentId={assignment.studentId}
            academicYearCode={academicYearCode}
            onPick={({ routeId: r, stopId: st }) => {
              if (r !== routeId) {
                setShifts({ pickupShiftId: "", dropShiftId: "" });
                setOverCapacityReason("");
              }
              setRouteId(r);
              setStopId(st);
            }}
          />

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
                // The runs belong to the bus being left. Carrying an id across
                // would either be refused on save or, worse, match a run on the
                // new bus by coincidence.
                setShifts({ pickupShiftId: "", dropShiftId: "" });
                // The reason was about a different bus being full.
                setOverCapacityReason("");
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

          {seats ? (
            <p
              className={`rounded-lg px-3 py-2 text-[11px] ${
                seatsFull
                  ? "border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] font-semibold text-[var(--danger)]"
                  : "bg-[var(--surface-sunken)] text-[var(--muted)]"
              }`}
            >
              {route?.busNo || route?.code} · {describeRouteSeats(seats)}
              {!seats.known
                ? " — so nobody can say whether it is full. Set the seats in Fleet."
                : ""}
            </p>
          ) : null}

          {seatsFull ? (
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Reason for seating one more on a full bus
              </span>
              <input
                className="field !py-1.5"
                value={overCapacityReason}
                onChange={(e) => setOverCapacityReason(e.target.value)}
                placeholder="Required — this bus is already at its recorded capacity"
              />
            </label>
          ) : null}

          <RiderShiftPicker
            route={route}
            groupCode={classGroupCode}
            pickupShiftId={shifts.pickupShiftId}
            dropShiftId={shifts.dropShiftId}
            onChange={setShifts}
          />

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
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}
