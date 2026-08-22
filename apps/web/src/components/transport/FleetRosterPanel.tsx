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
  type FleetRiderRow,
  type FleetRosterRow,
} from "@/lib/transportPlanner";
import { TransportBusBadge } from "@/components/transport/TransportBusBadge";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import {
  planAfternoonWaves,
  suggestVehicleSharing,
} from "@/lib/transportAfternoonWaves";

/**
 * Who is on each bus — the list that did not exist.
 *
 * `ridersOnRoute` returned a count, so nobody could see the roster, which is
 * also why riders billed nothing stayed invisible. Printable, because the
 * driver and conductor need it on paper in the vehicle.
 */
/**
 * What the office can do to a rider straight from the roster.
 *
 * The roster is where problems are noticed — a wrong stop, a fee nobody set,
 * a child who has stopped riding. Noticing them here and having to go find
 * the student in another screen to act is what made this list a report
 * instead of a desk.
 */
export type RiderAction =
  | "amend"
  | "change-stop"
  | "service-mode"
  | "suspend"
  | "resume"
  | "end"
  | "open-student";

export function FleetRosterPanel({
  state,
  masters,
  sis,
  academicYearCode,
  onRepairStopLinks,
  onRiderAction,
}: {
  state: TransportState;
  masters: MastersState | null;
  sis: SisState | null;
  academicYearCode: string;
  onRepairStopLinks?: () => void;
  onRiderAction?: (
    action: RiderAction,
    rider: FleetRiderRow,
    routeId: string,
  ) => void;
}) {
  const [openRoute, setOpenRoute] = useState<string | null>(null);

  const { rosters, misrouted, plans, shares } = useMemo(() => {
    if (!sis || !masters)
      return { rosters: [], misrouted: [], plans: [], shares: [] };
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
    const plans = planAfternoonWaves(state, sis, masters, academicYearCode);
    return {
      rosters: buildFleetRosters(state, profiles, fathers, crew, {
        // The roster must quote the same discount the invoice charges, so it
        // is resolved from the same masters through the same rule engine.
        concessions: {
          masters,
          students: new Map(
            sis.students.map((st) => [
              st.id,
              {
                id: st.id,
                admissionNo: st.admissionNo,
                academicYearCode: st.academicYearCode,
              },
            ]),
          ),
          asOf: new Date().toISOString().slice(0, 10),
        },
      }),
      misrouted: findMisroutedRiders(profiles, state),
      plans,
      shares: suggestVehicleSharing(plans),
    };
  }, [state, masters, sis, academicYearCode]);

  const totalRiders = rosters.reduce((n, r) => n + r.riders.length, 0);
  const totalUnbilled = rosters.reduce((n, r) => n + r.unbilledRiders, 0);
  const monthlyTotal = rosters.reduce((n, r) => n + r.monthlyTotalPaise, 0);
  const totalShortfall = rosters.reduce((n, r) => n + r.shortfallTotalPaise, 0);
  const totalUnknown = rosters.reduce((n, r) => n + r.ridersUnknownShortfall, 0);
  const totalBrokenLinks = rosters.reduce((n, r) => n + r.ridersBrokenLink, 0);
  const totalConcession = rosters.reduce((n, r) => n + r.concessionTotalPaise, 0);
  const netTotal = rosters.reduce((n, r) => n + r.netTotalPaise, 0);
  const totalWithConcession = rosters.reduce(
    (n, r) => n + r.ridersWithConcession,
    0,
  );
  // A rider discounted to nothing rides free BY DECISION. One with no fee set
  // rides free by accident. Both pay zero, and the office needs to act on
  // only one of them — so they are never pooled into a single count.
  const fullyDiscounted = rosters.reduce(
    (n, r) =>
      n +
      r.riders.filter((x) => x.monthlyFeePaise > 0 && x.netFeePaise <= 0)
        .length,
    0,
  );

  // "0 riders" and "the roster has not loaded" look identical on screen and
  // mean opposite things — one says nobody rides this bus, the other says we
  // do not know yet. A cold browser used to render a confident zero against
  // buses that were fully assigned, so say which it is.
  const rosterUnknown = !sis || !masters || sis.students.length === 0;
  if (rosterUnknown) {
    return (
      <p className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--brand-mid)_45%,transparent)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
        <strong className="text-[var(--brand-deep)]">
          Student roster has not loaded yet.
        </strong>{" "}
        Rider counts cannot be shown until it does — they would read as zero,
        which is not the same as an empty bus. Give it a moment, or open
        Students once and come back.
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
              {totalConcession > 0 ? (
                <>
                  {formatInr(monthlyTotal)} gross −{" "}
                  {formatInr(totalConcession)} discount ={" "}
                  <strong className="text-[var(--ink)]">
                    {formatInr(netTotal)} collected per month
                  </strong>
                </>
              ) : (
                `${formatInr(monthlyTotal)} billed per month`
              )}
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

        {totalBrokenLinks > 0 ? (
          // Top of the screen, above the money: while this is true, every
          // number below it on the affected buses is unreliable, and the
          // shortfall figure in particular is an undercount.
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--ink)]">
            <strong>
              {totalBrokenLinks} rider{totalBrokenLinks === 1 ? "" : "s"} point
              at a stop that no longer exists.
            </strong>{" "}
            Their distance, fee benchmark and place on the driver&rsquo;s list
            are all unavailable until the link is restored, so the shortfall
            below is an undercount rather than a clean bill.{" "}
            {onRepairStopLinks ? (
              <button
                type="button"
                className="font-bold text-[var(--brand-mid)] underline print:hidden"
                onClick={onRepairStopLinks}
              >
                Repair stop links
              </button>
            ) : null}
          </p>
        ) : null}

        {totalShortfall > 0 ? (
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] text-[var(--danger)]">
            <strong>{formatInr(totalShortfall)} a month</strong> less than the
            distance rule (₹500 to 5 km, then ₹100 per started km) across{" "}
            {rosters.reduce((n, r) => n + r.ridersWithShortfall, 0)} riders.
            Some of that will be deliberate concessions — this is where to check.
            {totalUnknown > 0 ? (
              <>
                {" "}
                <strong>
                  A further {totalUnknown} rider
                  {totalUnknown === 1 ? "" : "s"} could not be assessed at all
                </strong>{" "}
                — unmeasured stops or broken links — so the real gap is larger
                than this.
              </>
            ) : null}
          </p>
        ) : null}

        {totalShortfall === 0 && totalUnknown > 0 ? (
          // The dangerous case: nothing to report, because nothing could be
          // worked out. Silence here previously read as "all buses square".
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--ink)]">
            No shortfall can be reported because{" "}
            <strong>
              {totalUnknown} of {totalRiders} riders cannot be assessed
            </strong>
            . That is not the same as every bus being correctly billed.
          </p>
        ) : null}

        {totalUnbilled > 0 ? (
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
            {totalUnbilled} rider{totalUnbilled === 1 ? " is" : "s are"} on a bus
            with no monthly fee — on board, billed nothing.
          </p>
        ) : null}

        {totalConcession > 0 ? (
          <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-[var(--muted)]">
            {totalWithConcession} rider
            {totalWithConcession === 1 ? " has" : "s have"} a transport
            concession worth {formatInr(totalConcession)} a month.
            {fullyDiscounted > 0 ? (
              <>
                {" "}
                <strong className="text-[var(--ink)]">
                  {fullyDiscounted} of them ride free by decision
                </strong>{" "}
                — a full discount, not a missing fee.
              </>
            ) : null}{" "}
            The shortfall figures above compare the distance rule against the
            fee before discount, so an approved concession never shows as a gap.
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

      {plans.some((p) => p.riders > 0) ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Afternoon dismissals
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Mornings are one wave — everyone starts together. The afternoon is
            where a vehicle is either used twice or bought twice.
          </p>
          <ul className="mt-2 space-y-1">
            {plans
              .filter((p) => p.riders > 0)
              .map((p) => (
                <li
                  key={p.routeId}
                  className={`rounded-lg border px-3 py-2 text-[11px] ${
                    p.verdict === "needs-second-vehicle"
                      ? "border-[color-mix(in_srgb,var(--danger)_40%,transparent)]"
                      : p.verdict === "unknown-round-trip"
                        ? "border-[color-mix(in_srgb,var(--brand-mid)_45%,transparent)]"
                        : "border-[var(--border)]"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold text-[var(--brand-deep)]">
                      {p.routeLabel}
                    </span>
                    <span
                      className={
                        p.verdict === "one-vehicle-two-trips"
                          ? "font-bold text-[var(--success)]"
                          : p.verdict === "needs-second-vehicle"
                            ? "font-bold text-[var(--danger)]"
                            : "text-[var(--muted)]"
                      }
                    >
                      {p.verdict === "one-vehicle-two-trips"
                        ? "One vehicle, two trips"
                        : p.verdict === "needs-second-vehicle"
                          ? "Second vehicle, or they wait"
                          : p.verdict === "unknown-round-trip"
                            ? "Round trip not measured"
                            : "One trip"}
                    </span>
                  </div>
                  <div className="text-[var(--muted)]">
                    {p.waves
                      .map(
                        (w) =>
                          `${w.endTime} — ${w.riders} rider${w.riders === 1 ? "" : "s"} (${w.groups.map((g) => g.label).join(", ")})`,
                      )
                      .join(" · ")}
                  </div>
                  <div className="mt-0.5 text-[var(--ink)]">{p.detail}</div>
                </li>
              ))}
          </ul>

          {shares.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-soft)] px-3 py-2">
              <p className="text-[11px] font-bold text-[var(--success)]">
                One vehicle could cover two routes
              </p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--ink)]">
                {shares.slice(0, 5).map((sh) => (
                  <li key={`${sh.earlyRouteId}:${sh.lateRouteId}`}>
                    {sh.detail}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Driving time only. It does not know about driver hours, the
                second vehicle&rsquo;s own morning run, or whether the two routes go
                in opposite directions.
              </p>
            </div>
          ) : null}
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
          onRepair={onRepairStopLinks}
          onRiderAction={onRiderAction}
        />
      ))}
    </div>
  );
}

function RosterCard({
  roster,
  open,
  onToggle,
  onRepair,
  onRiderAction,
}: {
  roster: FleetRosterRow;
  open: boolean;
  onToggle: () => void;
  onRepair?: () => void;
  onRiderAction?: (action: RiderAction, rider: FleetRiderRow, routeId: string) => void;
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
      // A broken link sorts as unknown, not as an empty name at the top.
      stop: (r) => (r.stopLinkBroken ? null : r.stopName),
      // Sort by the number behind the cell, never the rendered "4 km" string,
      // and let an unmeasured stop stay unknown rather than becoming 0.
      km: (r) => (r.distanceKm > 0 ? r.distanceKm : null),
      fee: (r) => r.monthlyFeePaise,
      // No discount is a real zero here — it is known, not unknown.
      concession: (r) => r.concessionPaise,
      // Unmeasured stops yield no benchmark, so they sort as unknown, not zero.
      shortfall: (r) => (r.shortfallKnown ? r.shortfallPaise : null),
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
                : ` · ${seatsLeft} free · ${
                    roster.concessionTotalPaise > 0
                      ? `${formatInr(roster.monthlyTotalPaise)} gross − ${formatInr(roster.concessionTotalPaise)} discount = ${formatInr(roster.netTotalPaise)}/month`
                      : `${formatInr(roster.monthlyTotalPaise)}/month`
                  }`}
            </span>
            {roster.shortfallTotalPaise > 0 ? (
              <span className="ml-2 font-bold text-[var(--danger)]">
                {formatInr(roster.shortfallTotalPaise)}/month under the distance
                rule across {roster.ridersWithShortfall} rider
                {roster.ridersWithShortfall === 1 ? "" : "s"}
              </span>
            ) : null}
            {roster.ridersUnknownShortfall > 0 ? (
              // Without this the bus above reads "nothing under the rule",
              // which is a claim. It is not one that can be made while any
              // rider on it has no distance to price against.
              <span className="ml-2 font-bold text-[var(--warning)]">
                {roster.ridersUnknownShortfall} rider
                {roster.ridersUnknownShortfall === 1 ? "" : "s"} cannot be
                assessed
              </span>
            ) : null}
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

      {roster.ridersBrokenLink > 0 ? (
        <div className="border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-4 py-2 text-[11px]">
          <strong className="text-[var(--ink)]">
            {roster.ridersBrokenLink} of {roster.riders.length} riders point at
            a stop that no longer exists.
          </strong>{" "}
          <span className="text-[var(--muted)]">
            Their fee, distance and the driver&rsquo;s list all fail together
            until the link is restored.
          </span>{" "}
          {onRepair ? (
            <button
              type="button"
              className="font-semibold text-[var(--brand-mid)] underline print:hidden"
              onClick={onRepair}
            >
              Repair stop links
            </button>
          ) : null}
        </div>
      ) : null}

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
                  <ErpSortTh sort={sort} field="concession" align="right">
                    Discount
                  </ErpSortTh>
                  <ErpSortTh sort={sort} field="shortfall" align="right">
                    Shortfall
                  </ErpSortTh>
                  <ErpSortTh sort={sort} field="from">From</ErpSortTh>
                  <th className="px-3 py-2 font-bold">Today</th>
                  <th className="px-3 py-2 font-bold print:hidden">Do</th>
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
                      {r.serviceMode !== "both" ? (
                        <span
                          className="ml-1 rounded bg-[var(--surface-sunken)] px-1 text-[9px] font-bold uppercase text-[var(--muted)]"
                          title="Half service, half fee"
                        >
                          {r.serviceMode === "pickup" ? "pick-up" : "drop"}
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
                    <td className="px-3 py-1.5">
                      {r.stopLinkBroken ? (
                        <span
                          className="font-semibold text-[var(--warning)]"
                          title="This rider's assignment points at a stop that no longer exists on the route"
                        >
                          ⚠ link broken
                        </span>
                      ) : (
                        r.stopName || "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.stopLinkBroken ? (
                        <span className="text-[var(--warning)]">?</span>
                      ) : r.distanceKm > 0 ? (
                        <>
                          {r.distanceKm}
                          {r.distanceSource === "manual" ? (
                            <span title="Typed, not measured" className="text-[var(--muted)]">
                              *
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span title="Stop has never been measured" className="text-[var(--muted)]">
                          —
                        </span>
                      )}
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
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.concessionPaise > 0 ? (
                        <span
                          className="font-semibold text-[var(--brand-mid)]"
                          title={`${r.concessionLabel} — billed ${formatInr(r.netFeePaise)}/month`}
                        >
                          −{formatInr(r.concessionPaise)}
                          <span className="ml-1 block text-[9px] font-normal text-[var(--muted)]">
                            net {formatInr(r.netFeePaise)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {!r.shortfallKnown ? (
                        <span
                          className="font-semibold text-[var(--warning)]"
                          title={
                            r.stopLinkBroken
                              ? "Cannot tell — this rider's stop link is broken, so there is no distance to price against"
                              : "Cannot tell — this stop has never been measured"
                          }
                        >
                          can&rsquo;t tell
                        </span>
                      ) : r.shortfallPaise > 0 ? (
                        <span
                          className="font-bold text-[var(--danger)]"
                          title={`Distance rule says ${formatInr(r.benchmarkPaise)} for ${r.distanceKm} km`}
                        >
                          {formatInr(r.shortfallPaise)}
                        </span>
                      ) : (
                        <span className="text-[var(--success)]">nil</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--muted)]">
                      {r.effectiveFrom}
                    </td>
                    <td className="px-3 py-1.5">
                      {r.todayBoarding ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={
                              r.todayBoarding.status === "boarded"
                                ? "font-semibold text-[var(--success)]"
                                : "font-semibold text-[var(--danger)]"
                            }
                          >
                            {r.todayBoarding.status === "boarded"
                              ? "on board"
                              : r.todayBoarding.status}
                          </span>
                          <span className="text-[10px] text-[var(--muted)]">
                            {r.todayBoarding.markedAt.slice(11, 16)}
                          </span>
                          {r.todayBoarding.lat != null &&
                          r.todayBoarding.lng != null ? (
                            <a
                              className="text-[10px] font-semibold text-[var(--brand-mid)] underline"
                              target="_blank"
                              rel="noreferrer"
                              href={`https://www.google.com/maps?q=${r.todayBoarding.lat},${r.todayBoarding.lng}`}
                              title={`Marked ${r.todayBoarding.accuracyM ?? "?"} m accuracy, ${r.todayBoarding.distanceFromSchoolKm ?? "?"} km from school`}
                            >
                              📍 pin
                            </a>
                          ) : (
                            <span
                              className="text-[10px] text-[var(--muted)]"
                              title="Marked without a location — older record"
                            >
                              no pin
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-[var(--muted)]">
                          not marked
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 print:hidden">
                      <div className="flex flex-wrap gap-1">
                        {/*
                          One editor, not three. Route, stop, fee and the month
                          a change may land in all interact, so they are edited
                          together in the amendment dialog. The label changes
                          to name whatever is wrong with this row, so the
                          office can see the problem and the fix in one place.
                        */}
                        <RiderBtn
                          label={
                            r.stopLinkBroken
                              ? "Fix stop"
                              : r.monthlyFeePaise <= 0
                                ? "Set fee"
                                : "Edit"
                          }
                          tone={
                            r.stopLinkBroken || r.monthlyFeePaise <= 0
                              ? "warn"
                              : undefined
                          }
                          onClick={() =>
                            onRiderAction?.(
                              r.stopLinkBroken ? "change-stop" : "amend",
                              r,
                              roster.routeId,
                            )
                          }
                        />
                        <RiderBtn
                          label={
                            r.serviceMode === "both" ? "One way" : "Both ways"
                          }
                          onClick={() => onRiderAction?.("service-mode", r, roster.routeId)}
                        />
                        {r.boardingSuspended ? (
                          <RiderBtn
                            label="Resume"
                            onClick={() => onRiderAction?.("resume", r, roster.routeId)}
                          />
                        ) : (
                          <RiderBtn
                            label="Suspend"
                            onClick={() => onRiderAction?.("suspend", r, roster.routeId)}
                          />
                        )}
                        <RiderBtn
                          label="Off bus"
                          tone="danger"
                          onClick={() => onRiderAction?.("end", r, roster.routeId)}
                        />
                      </div>
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

function RiderBtn({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone?: "warn" | "danger";
}) {
  const colour =
    tone === "danger"
      ? "border-[var(--danger)] text-[var(--danger)]"
      : tone === "warn"
        ? "border-[var(--warning)] text-[var(--warning)] font-bold"
        : "border-[var(--border)] text-[var(--ink)]";
  return (
    <button
      type="button"
      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold hover:bg-[var(--surface-sunken)] ${colour}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
