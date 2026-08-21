"use client";

import { useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import { formatRouteCrew, staffAssignedToRoute } from "@/lib/staffResolve";
import type { TransportState } from "@/lib/transport";
import {
  buildFleetRosters,
  buildStudentTransportProfiles,
  findMisroutedRiders,
  type FleetRosterRow,
} from "@/lib/transportPlanner";
import { TransportBusBadge } from "@/components/transport/TransportBusBadge";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

/**
 * Who is on each bus — the list that did not exist.
 *
 * `ridersOnRoute` returned a count, so nobody could see the roster, which is
 * also why riders billed nothing stayed invisible. Printable, because the
 * driver and conductor need it on paper in the vehicle.
 */
export function FleetRosterPanel({
  state,
  masters,
  sis,
  academicYearCode,
}: {
  state: TransportState;
  masters: MastersState | null;
  sis: SisState | null;
  academicYearCode: string;
}) {
  const [openRoute, setOpenRoute] = useState<string | null>(null);

  const { rosters, misrouted } = useMemo(() => {
    if (!sis || !masters) return { rosters: [], misrouted: [] };
    const profiles = buildStudentTransportProfiles(sis, masters, state, academicYearCode);
    const fathers = new Map(
      sis.students.map((s) => [s.id, s.fatherName || ""]),
    );
    const crew = new Map(
      state.routes.map((r) => [
        r.id,
        formatRouteCrew(staffAssignedToRoute(masters, r.id)),
      ]),
    );
    return {
      rosters: buildFleetRosters(state, profiles, fathers, crew),
      misrouted: findMisroutedRiders(profiles, state),
    };
  }, [state, masters, sis, academicYearCode]);

  const totalRiders = rosters.reduce((n, r) => n + r.riders.length, 0);
  const totalUnbilled = rosters.reduce((n, r) => n + r.unbilledRiders, 0);
  const monthlyTotal = rosters.reduce((n, r) => n + r.monthlyTotalPaise, 0);

  if (!sis || !masters) {
    return (
      <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
        Loading students…
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Riders by bus
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {rosters.length} active route{rosters.length === 1 ? "" : "s"} ·{" "}
              {totalRiders} rider{totalRiders === 1 ? "" : "s"} ·{" "}
              {formatInr(monthlyTotal)} billed per month
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)] print:hidden"
            onClick={() => window.print()}
          >
            Print rosters
          </button>
        </div>

        {totalUnbilled > 0 ? (
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
            {totalUnbilled} rider{totalUnbilled === 1 ? " is" : "s are"} on a bus
            with no monthly fee — on board, billed nothing.
          </p>
        ) : null}
      </section>

      {misrouted.length > 0 ? (
        <section className="rounded-xl border border-[color-mix(in_srgb,var(--brand-mid)_45%,transparent)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Not on their nearest bus
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {misrouted.length} rider{misrouted.length === 1 ? "" : "s"} live
            closer to a stop on another route. Check before moving anyone —
            families choose a bus for reasons the system cannot see.
          </p>
          <ul className="mt-2 space-y-1">
            {misrouted.slice(0, 12).map((m) => (
              <li
                key={m.studentId}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px]"
              >
                <span className="font-semibold text-[var(--brand-deep)]">
                  {m.fullName}
                </span>{" "}
                <span className="text-[var(--muted)]">({m.classLabel})</span>
                <div className="text-[var(--muted)]">
                  on {m.currentRouteLabel} · {m.currentStopName} (
                  {m.currentStopKm} km from home) → {m.betterRouteLabel} ·{" "}
                  {m.betterStopName} ({m.betterStopKm} km) ·{" "}
                  <strong className="text-[var(--ink)]">
                    {m.savingKm} km closer
                  </strong>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rosters.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
          No active routes yet.
        </p>
      ) : null}

      {rosters.map((roster) => (
        <RosterCard
          key={roster.routeId}
          roster={roster}
          open={openRoute === roster.routeId || rosters.length === 1}
          onToggle={() =>
            setOpenRoute((cur) => (cur === roster.routeId ? null : roster.routeId))
          }
        />
      ))}
    </div>
  );
}

function RosterCard({
  roster,
  open,
  onToggle,
}: {
  roster: FleetRosterRow;
  open: boolean;
  onToggle: () => void;
}) {
  const seatsLeft = Math.max(0, roster.seatCapacity - roster.riders.length);
  const over = roster.riders.length > roster.seatCapacity;

  // Default order is the stop sequence the list already arrives in — that is
  // how the conductor reads it. Sorting is opt-in per column from there.
  const sort = useTableSort(
    roster.riders,
    {
      name: (r) => r.fullName,
      classLabel: (r) => r.classLabel,
      father: (r) => r.fatherName || null,
      stop: (r) => r.stopName,
      // Sort by the number behind the cell, never the rendered "4 km" string,
      // and let an unmeasured stop stay unknown rather than becoming 0.
      km: (r) => (r.distanceKm > 0 ? r.distanceKm : null),
      fee: (r) => r.monthlyFeePaise,
      from: (r) => r.effectiveFrom,
    },
    "stop",
  );

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] print:break-inside-avoid">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <TransportBusBadge busNo={roster.busNo} routeCode={roster.routeCode} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-[var(--brand-deep)]">
            {roster.busNo || roster.routeCode}
            {roster.vehicleReg ? (
              <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">
                {roster.vehicleReg}
              </span>
            ) : null}
          </h3>
          <p className="text-[11px] text-[var(--muted)]">
            {roster.routeCode} · {roster.routeName}
            {roster.crewLabel ? ` · ${roster.crewLabel}` : ""}
          </p>
          <p className="mt-1 text-[11px]">
            <span
              className={
                over
                  ? "font-bold text-[var(--danger)]"
                  : "font-semibold text-[var(--ink)]"
              }
            >
              {roster.riders.length}/{roster.seatCapacity} seats
            </span>
            <span className="text-[var(--muted)]">
              {over
                ? " — over capacity"
                : ` · ${seatsLeft} free · ${formatInr(roster.monthlyTotalPaise)}/month`}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)] print:hidden"
          onClick={onToggle}
        >
          {open ? "Hide riders" : "Show riders"}
        </button>
      </div>

      <div className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted)]">
        {roster.stops.length === 0
          ? "No stops on this route"
          : roster.stops
              .map(
                (s) =>
                  `${s.name}${s.distanceKm > 0 ? ` (${s.distanceKm} km)` : ""}${s.pinned ? "" : " ⚑"}`,
              )
              .join(" → ")}
        {roster.stops.some((s) => !s.pinned) ? (
          <span className="ml-2 text-[var(--danger)]">⚑ not pinned on the map</span>
        ) : null}
      </div>

      {open ? (
        <div className="overflow-x-auto border-t border-[var(--border)]">
          {roster.riders.length === 0 ? (
            <p className="px-4 py-4 text-sm text-[var(--muted)]">
              Nobody assigned to this bus yet.
            </p>
          ) : (
            <ErpTable minWidth="min-w-[46rem]">
              <ErpTableHead>
                <tr>
                  <ErpSortTh sort={sort} field="name">Student</ErpSortTh>
                  <ErpSortTh sort={sort} field="classLabel">Class</ErpSortTh>
                  <ErpSortTh sort={sort} field="father">Father</ErpSortTh>
                  <ErpSortTh sort={sort} field="stop">Stop</ErpSortTh>
                  <ErpSortTh sort={sort} field="km" align="right">Km</ErpSortTh>
                  <ErpSortTh sort={sort} field="fee" align="right">
                    Per month
                  </ErpSortTh>
                  <ErpSortTh sort={sort} field="from">From</ErpSortTh>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {sort.rows.map((r) => (
                  <tr
                    key={r.studentId}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-1.5 font-semibold text-[var(--brand-deep)]">
                      {r.fullName}
                      {r.siblingOnBoard ? (
                        <span
                          title="Sibling also rides this bus"
                          className="ml-1 text-[var(--muted)]"
                        >
                          ⧉
                        </span>
                      ) : null}
                      {r.boardingSuspended ? (
                        <span className="ml-1 font-bold text-[var(--danger)]">
                          suspended
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--muted)]">
                      {r.classLabel}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--muted)]">
                      {r.fatherName || "—"}
                    </td>
                    <td className="px-3 py-1.5">{r.stopName}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.distanceKm > 0 ? r.distanceKm : "—"}
                      {r.distanceSource === "manual" ? (
                        <span title="Typed, not measured" className="text-[var(--muted)]">
                          *
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                        r.monthlyFeePaise <= 0 ? "text-[var(--danger)]" : ""
                      }`}
                    >
                      {r.monthlyFeePaise > 0 ? formatInr(r.monthlyFeePaise) : "nil"}
                      {r.feeOverridden ? (
                        <span title="Overrides the policy fee" className="text-[var(--muted)]">
                          †
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--muted)]">
                      {r.effectiveFrom}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          )}
        </div>
      ) : null}
    </section>
  );
}
