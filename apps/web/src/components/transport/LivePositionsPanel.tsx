"use client";

import { useCallback, useEffect, useState } from "react";

import { normalizeVehicleKey } from "@/lib/fleetEdgeLink";
import type { TransportState } from "@/lib/transport";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

/**
 * Where each bus actually is.
 *
 * The map beside this reads `state.gpsPings`, a desk-local array filled in by
 * hand, so it has never shown a real vehicle. This reads the Fleet Edge /live
 * feed instead — the only genuine position source the school has.
 *
 * Two things are shown that a tracking screen usually hides, because both
 * decide whether the number on screen means anything:
 *
 *  - how old each fix is, next to the fix itself; and
 *  - which vehicles have no tracker at all, named rather than omitted.
 *
 * As of 10 Sep 2026 only three of six report. A panel that quietly listed
 * three buses would read as "all buses", and the office would trust a screen
 * that cannot see half the fleet.
 */

type ApiPosition = {
  vehicleRef: string;
  registrationNumber: string | null;
  lat: number;
  lng: number;
  speed: number | null;
  ignitionOn: boolean | null;
  at: string;
  ageLabel: string;
  freshness: "live" | "recent" | "stale" | "cold";
  motion: "moving" | "idling" | "parked" | "unknown";
};

const REFRESH_MS = 30_000;

const FRESHNESS_STYLE: Record<ApiPosition["freshness"], { dot: string; label: string }> = {
  live: { dot: "var(--success)", label: "live" },
  recent: { dot: "var(--warning)", label: "recent" },
  stale: { dot: "var(--danger)", label: "stale" },
  cold: { dot: "var(--muted)", label: "no recent fix" },
};

const MOTION_LABEL: Record<ApiPosition["motion"], string> = {
  moving: "Moving",
  idling: "Engine on, stopped",
  parked: "Parked",
  unknown: "Unknown",
};

export function LivePositionsPanel({ state }: { state: TransportState }) {
  const [positions, setPositions] = useState<ApiPosition[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/transport/live-positions", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Could not read live positions");
        return;
      }
      setPositions(body.positions || []);
      setFetchedAt(body.serverNow || "");
      setError("");
    } catch {
      setError("Could not reach the live position feed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void load();
    };
    tick();
    // The feed pushes about every 30s; polling faster only costs reads.
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load]);

  // Match a ping to a desk vehicle on either key: two of the six desk rows
  // hold a chassis number where a registration belongs, so matching on the
  // plate alone silently drops MAGIC-2 and MAGIC-3.
  const byVehicle = new Map<string, ApiPosition>();
  for (const p of positions || []) {
    for (const key of [normalizeVehicleKey(p.vehicleRef), normalizeVehicleKey(p.registrationNumber)]) {
      if (key && !byVehicle.has(key)) byVehicle.set(key, p);
    }
  }

  const rows = state.vehicles
    .filter((v) => v.isActive && v.status === "active")
    .map((v) => {
      const route = state.routes.find((r) => r.vehicleId === v.id);
      const students = route
        ? state.assignments.filter((a) => a.routeId === route.id).length
        : 0;
      return {
        vehicleId: v.id,
        label: route?.busNo || route?.code || v.registrationNo,
        registrationNo: v.registrationNo,
        students,
        position: byVehicle.get(normalizeVehicleKey(v.registrationNo)) ?? null,
      };
    })
    .sort((a, b) => Number(!!b.position) - Number(!!a.position) || b.students - a.students);

  const tracked = rows.filter((r) => r.position);
  // Sorted by how fresh the fix is, newest first — the order somebody
  // watching the fleet already wants — and every column sorts by its value,
  // so "Last fix" orders by the actual timestamp rather than by the words
  // "3 minutes ago".
  const busSort = useTableSort(
    tracked,
    {
      bus: (r) => r.label || r.registrationNo,
      children: (r) => r.students,
      status: (r) => r.position?.motion ?? "",
      lastFix: (r) => r.position?.at ?? "",
    },
    "lastFix",
    "desc",
  );
  const untracked = rows.filter((r) => !r.position);
  const childrenUntracked = untracked.reduce((n, r) => n + r.students, 0);

  if (loading) {
    return (
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-[11px] text-[var(--muted)]">
        Reading live positions…
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Where the buses are</h3>
        <span className="text-[10px] text-[var(--muted)]">
          {fetchedAt
            ? `checked ${new Date(fetchedAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}`
            : ""}
          {" · refreshes every 30s"}
        </span>
      </div>

      {error ? (
        // "The check failed" and "nothing is reporting" mean opposite things
        // to someone asking whether the fleet is on the road.
        <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 py-2 text-[11px] text-[var(--danger)]">
          {error}. This is not the same as no vehicle reporting.
        </p>
      ) : null}

      {!error && tracked.length === 0 ? (
        <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--ink)]">
          <strong>No vehicle is reporting a position right now.</strong> The
          Fleet Edge feed only pushes while a vehicle is awake, so this is
          normal outside the runs.
        </p>
      ) : null}

      {tracked.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                <ErpSortTh sort={busSort} field="bus" className="py-1 pr-3">Bus</ErpSortTh>
                <ErpSortTh sort={busSort} field="children" className="py-1 pr-3">Children</ErpSortTh>
                <ErpSortTh sort={busSort} field="status" className="py-1 pr-3">Status</ErpSortTh>
                <ErpSortTh sort={busSort} field="lastFix" className="py-1 pr-3">Last fix</ErpSortTh>
                <th className="py-1 font-semibold">Position</th>
              </tr>
            </thead>
            <tbody>
              {busSort.rows.map((r) => {
                const p = r.position!;
                const style = FRESHNESS_STYLE[p.freshness];
                return (
                  <tr key={r.vehicleId} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-3">
                      <span className="font-semibold text-[var(--ink)]">{r.label}</span>
                      <span className="ml-1 text-[var(--muted)]">{r.registrationNo}</span>
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-[var(--muted)]">{r.students}</td>
                    <td className="py-1.5 pr-3">
                      {MOTION_LABEL[p.motion]}
                      {p.speed !== null && p.motion === "moving" ? (
                        <span className="ml-1 tabular-nums text-[var(--muted)]">
                          {Math.round(p.speed)} km/h
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span
                        aria-hidden
                        className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: style.dot }}
                      />
                      {p.ageLabel}
                      <span className="ml-1 text-[var(--muted)]">({style.label})</span>
                    </td>
                    <td className="py-1.5">
                      <a
                        className="underline"
                        href={`https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Maps
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {untracked.length > 0 ? (
        // Named, not omitted. A list of three buses would read as the whole
        // fleet to anyone who did not already know there are six.
        <p className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
          <strong className="text-[var(--ink)]">No tracker on:</strong>{" "}
          {untracked.map((r) => `${r.label} (${r.students})`).join(", ")}.{" "}
          {childrenUntracked} child{childrenUntracked === 1 ? "" : "ren"} ride a
          vehicle this screen cannot see. Fleet Edge reports Tata vehicles only.
        </p>
      ) : null}
    </section>
  );
}
