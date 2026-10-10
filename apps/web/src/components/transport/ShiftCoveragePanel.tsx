"use client";

import { useMemo } from "react";
import { CLASS_GROUPS } from "@/lib/masters";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import type { TransportState } from "@/lib/transport";
import {
  buildShiftRiders,
  checkRouteShiftFeasibility,
  listRouteShifts,
  routeShiftCoverage,
} from "@/lib/transportShifts";

/**
 * Every child who has no afternoon run, named.
 *
 * The rules deliberately refuse to put a rider on a run they cannot be
 * resolved onto — see `resolveRiderShift`. That refusal is only safe if
 * somebody sees the result, so this is the screen that makes it impossible to
 * leave a child unrouted without knowing.
 *
 * Routes with no runs set up are not listed. They do one journey each way,
 * which is how the whole module worked until shifts existed, and listing them
 * as "incomplete" would bury the three routes that actually have a problem
 * under nine that do not.
 */
export function ShiftCoveragePanel({
  state,
  sis,
  masters,
  academicYearCode,
}: {
  state: TransportState;
  sis: SisState | null;
  masters: MastersState | null;
  academicYearCode: string;
}) {
  const rows = useMemo(() => {
    if (!sis || !masters) return [];
    return state.routes
      .filter((r) => r.isActive)
      .filter(
        (r) =>
          listRouteShifts(r, "pickup").length +
            listRouteShifts(r, "drop").length >
          0,
      )
      .map((route) => {
        const riders = buildShiftRiders({
          assignments: state.assignments,
          students: sis.students,
          classes: masters.classes,
          academicYearCode,
          routeId: route.id,
        });
        return {
          route,
          coverage: routeShiftCoverage(route, riders),
          feasibility: checkRouteShiftFeasibility(route),
        };
      });
  }, [state.routes, state.assignments, sis, masters, academicYearCode]);

  if (!sis || !masters) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Runs — who is on which
        </h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          The roster has not loaded, so runs cannot be checked against the
          children on them.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Runs — who is on which
        </h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          No route has runs set up yet. Each does one journey each way. Add runs
          on a route above when the same bus goes out twice — the little ones at
          one time and the rest at another.
        </p>
      </div>
    );
  }

  const totalUnresolved = rows.reduce(
    (n, r) => n + r.coverage.unresolved.length,
    0,
  );

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Runs — who is on which
        </h2>
        <span
          className={`text-[11px] font-bold ${
            totalUnresolved > 0
              ? "text-[var(--danger)]"
              : "text-[var(--success)]"
          }`}
        >
          {totalUnresolved > 0
            ? `${totalUnresolved} rider${totalUnresolved === 1 ? "" : "s"} without a run`
            : "Every rider has a run"}
        </span>
      </div>

      <ul className="mt-3 space-y-3">
        {rows.map(({ route, coverage, feasibility }) => (
          <li
            key={route.id}
            className="rounded-lg border border-[var(--border)] p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[12px] font-bold text-[var(--brand-deep)]">
                {route.busNo || route.code} · {route.name}
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                {coverage.riderCount} rider
                {coverage.riderCount === 1 ? "" : "s"} · {coverage.pickupRuns}{" "}
                pick-up, {coverage.dropRuns} drop
              </span>
            </div>

            <ul className="mt-1 space-y-0.5">
              {[
                ...listRouteShifts(route, "pickup"),
                ...listRouteShifts(route, "drop"),
              ].map((s) => (
                <li key={s.id} className="text-[10px] text-[var(--muted)]">
                  <span className="font-semibold text-[var(--ink)]">
                    {s.name}
                  </span>{" "}
                  · {s.direction === "pickup" ? "pick-up" : "drop"} ·{" "}
                  {s.departTime || (
                    <span className="font-semibold text-[var(--danger)]">
                      no time set
                    </span>
                  )}{" "}
                  ·{" "}
                  {s.classGroups.length === 0
                    ? "no class group — nobody reaches it by rule"
                    : s.classGroups
                        .map(
                          (g) =>
                            CLASS_GROUPS.find((x) => x.code === g)?.shortLabel ??
                            g,
                        )
                        .join(", ")}
                </li>
              ))}
            </ul>

            {coverage.unservedDropGroups.length > 0 ? (
              <p className="mt-1 text-[10px] font-semibold text-[var(--danger)]">
                No drop run carries{" "}
                {coverage.unservedDropGroups
                  .map(
                    (g) => CLASS_GROUPS.find((x) => x.code === g)?.label ?? g,
                  )
                  .join(", ")}
                .
              </p>
            ) : null}

            {coverage.contestedGroups.length > 0 ? (
              <p className="mt-1 text-[10px] font-semibold text-[var(--danger)]">
                Two runs both carry{" "}
                {coverage.contestedGroups
                  .map(
                    (g) => CLASS_GROUPS.find((x) => x.code === g)?.label ?? g,
                  )
                  .join(", ")}
                — only one may, or every child in the group needs placing by
                hand.
              </p>
            ) : null}

            {feasibility.verdict === "impossible" ? (
              <p className="mt-1 text-[10px] font-semibold text-[var(--danger)]">
                {feasibility.pairs
                  .filter((p) => p.verdict === "impossible")
                  .map((p) => p.detail)
                  .join(" ")}
              </p>
            ) : feasibility.verdict === "unknown-round-trip" ? (
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Never measured, so one bus doing two runs cannot be checked.
              </p>
            ) : null}

            {coverage.unresolved.length > 0 ? (
              <div className="mt-2 rounded-lg bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-2 py-1.5">
                <p className="text-[10px] font-bold text-[var(--danger)]">
                  {coverage.unresolved.length} rider
                  {coverage.unresolved.length === 1 ? "" : "s"} with no run
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {coverage.unresolved.slice(0, 8).map((u) => (
                    <li
                      key={`${u.studentId}:${u.direction}`}
                      className="text-[10px] text-[var(--ink)]"
                    >
                      <strong>{u.studentName}</strong> ·{" "}
                      {u.direction === "pickup" ? "pick-up" : "drop"} —{" "}
                      {u.detail}
                    </li>
                  ))}
                </ul>
                {coverage.unresolved.length > 8 ? (
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                    and {coverage.unresolved.length - 8} more.
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] text-[var(--muted)]">
        A rider with no run is not put on one by default. Fix it by ticking
        their class group on a run above, or by placing the child on a run in
        Riders → Change.
      </p>
    </div>
  );
}
