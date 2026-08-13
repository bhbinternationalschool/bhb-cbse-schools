"use client";

import { useEffect, useMemo, useState } from "react";
import { formatInr } from "@/lib/fees";
import { DEFAULT_AY, type MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import {
  alignVehiclesToRoutes,
  assignStudentToRoute,
  saveTransport,
  type TransportState,
} from "@/lib/transport";
import {
  buildRouteClusters,
  buildStudentTransportProfiles,
  fetchRoadDistanceKm,
  formatAddressForMaps,
  listUnassignedStudents,
  previewAssignmentMonths,
  suggestRoutesForStudent,
  type RouteStopSuggestion,
  type StudentTransportProfile,
} from "@/lib/transportPlanner";
import {
  bulkGeocodeHouseholds,
  countHouseholdsNeedingGeocode,
} from "@/lib/householdGeo";
import { TransportMapsApiHelp } from "@/components/transport/TransportMapsApiHelp";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type Props = {
  state: TransportState;
  masters: MastersState | null;
  sis: SisState | null;
  academicYearCode?: string;
  onRefresh: () => void;
  onSisRefresh?: () => void;
  onFlash: (message: string) => void;
  onError: (message: string) => void;
  onOpenRiders?: (studentId: string) => void;
};

export function TransportPlannerPanel({
  state,
  masters,
  sis,
  academicYearCode,
  onRefresh,
  onSisRefresh,
  onFlash,
  onError,
}: Props) {
  const ay = academicYearCode || DEFAULT_AY;
  const [view, setView] = useState<"unassigned" | "routes">("unassigned");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [roadKm, setRoadKm] = useState<number | null>(null);
  const [roadSource, setRoadSource] = useState<string>("");
  const [pick, setPick] = useState<RouteStopSuggestion | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState("");

  const profiles = useMemo(() => {
    if (!sis || !masters) return [];
    return buildStudentTransportProfiles(sis, masters, state, ay);
  }, [sis, masters, state, ay]);

  const unassigned = useMemo(
    () => listUnassignedStudents(profiles),
    [profiles],
  );

  const unassignedHouseholdIds = useMemo(
    () => [...new Set(unassigned.map((p) => p.householdId))],
    [unassigned],
  );

  const needsGeocodeCount = useMemo(
    () => countHouseholdsNeedingGeocode(unassignedHouseholdIds),
    [unassignedHouseholdIds],
  );

  const clusters = useMemo(
    () => buildRouteClusters(state, profiles),
    [state, profiles],
  );

  const selected = profiles.find((p) => p.studentId === selectedId) ?? null;

  const suggestions = useMemo(() => {
    if (!selected) return [];
    return suggestRoutesForStudent(selected, state, 6);
  }, [selected, state]);

  useEffect(() => {
    if (!selected) {
      setRoadKm(null);
      setRoadSource("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const originLatLng =
        selected.hasGeo && selected.geoLat != null && selected.geoLng != null
          ? { lat: selected.geoLat, lng: selected.geoLng }
          : undefined;
      const r = await fetchRoadDistanceKm(
        formatAddressForMaps(selected),
        undefined,
        originLatLng,
      );
      if (!cancelled) {
        setRoadKm(r.km);
        setRoadSource(r.source);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (suggestions[0]) setPick(suggestions[0]);
  }, [suggestions]);

  const monthPreview = useMemo(() => {
    if (!selected || !pick) return [];
    return previewAssignmentMonths(
      {
        studentId: selected.studentId,
        householdId: selected.householdId,
        routeId: pick.routeId,
        stopId: pick.stopId,
        effectiveFrom,
        academicYearCode: selected.academicYearCode,
        monthlyFeePaise: pick.monthlyFeePaise,
      },
      state,
    );
  }, [selected, pick, effectiveFrom, state]);

  function onAlignVehicles() {
    const aligned = alignVehiclesToRoutes(state);
    saveTransport(aligned);
    onRefresh();
    onFlash("Vehicles aligned to routes from fleet records");
  }

  async function onGeocodeUnassigned() {
    if (!unassignedHouseholdIds.length) return;
    setGeocoding(true);
    setGeocodeProgress("Starting…");
    try {
      const result = await bulkGeocodeHouseholds(
        unassignedHouseholdIds,
        (p) => {
          setGeocodeProgress(`${p.done} / ${p.total}`);
        },
      );
      onSisRefresh?.();
      onFlash(
        `Geocoded ${result.ok} households · ${result.failed} failed · ${result.skipped} skipped`,
      );
    } catch {
      onError("Geocoding failed — check Google Geocoding API is enabled");
    } finally {
      setGeocoding(false);
      setGeocodeProgress("");
    }
  }

  function onAssign(profile: StudentTransportProfile, suggestion: RouteStopSuggestion) {
    const result = assignStudentToRoute({
      studentId: profile.studentId,
      householdId: profile.householdId,
      routeId: suggestion.routeId,
      stopId: suggestion.stopId,
      effectiveFrom,
      academicYearCode: profile.academicYearCode,
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onFlash(
      `${profile.fullName} assigned to ${suggestion.routeCode} · fees from ${effectiveFrom.slice(0, 7)} in Fee Take`,
    );
    setSelectedId(null);
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Route planner
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Suggests routes from SIS locality · aligns buses · mid-year assign with
            fee preview from effective month
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {needsGeocodeCount > 0 ? (
            <button
              type="button"
              disabled={geocoding}
              className="rounded-lg border border-[#1565c0]/30 bg-[#1565c0]/8 px-3 py-1.5 text-xs font-semibold text-[#1565c0] disabled:opacity-60"
              onClick={() => void onGeocodeUnassigned()}
            >
              {geocoding
                ? `Geocoding… ${geocodeProgress}`
                : `Pin homes on map (${needsGeocodeCount})`}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={onAlignVehicles}
          >
            Align vehicles ↔ routes
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              view === "unassigned"
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "border border-[var(--border)] text-[var(--brand-deep)]"
            }`}
            onClick={() => setView("unassigned")}
          >
            Unassigned ({unassigned.length})
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              view === "routes"
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "border border-[var(--border)] text-[var(--brand-deep)]"
            }`}
            onClick={() => setView("routes")}
          >
            By route / vehicle
          </button>
        </div>
      </div>

      <TransportMapsApiHelp />

      {view === "routes" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {clusters.map((c) => (
            <section
              key={c.routeId}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-[var(--brand-deep)]">
                    {c.routeCode} · {c.routeName}
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    {c.busNo}
                    {c.vehicleReg ? ` (${c.vehicleReg})` : ""} · {c.riderCount}/
                    {c.seatCapacity} seats
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    c.riderCount >= c.seatCapacity
                      ? "bg-[#c2410c]/15 text-[#c2410c]"
                      : "bg-[var(--success-soft)] text-[var(--success)]"
                  }`}
                >
                  {c.riderCount >= c.seatCapacity ? "Full" : "Seats open"}
                </span>
              </div>
              {c.unassignedNearby.length ? (
                <ul className="mt-3 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Nearby unassigned students
                  </p>
                  {c.unassignedNearby.map((p) => (
                    <li
                      key={p.studentId}
                      className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-sunken)] px-2.5 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate font-medium text-[var(--ink)]">
                        {p.fullName}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-[var(--brand-mid)]"
                        onClick={() => {
                          setView("unassigned");
                          setSelectedId(p.studentId);
                        }}
                      >
                        Plan →
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  No nearby unassigned students for this route.
                </p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Students without transport
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Pick a student — we match locality, landmark, and pincode to stops.
            </p>
            <ul className="mt-3 max-h-[28rem] space-y-1 overflow-y-auto">
              {unassigned.length === 0 ? (
                <li className="rounded-lg bg-[var(--surface-sunken)] px-3 py-4 text-sm text-[var(--muted)]">
                  All active students have a route for this session.
                </li>
              ) : (
                unassigned.map((p) => (
                  <li key={p.studentId}>
                    <button
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                        selectedId === p.studentId
                          ? "border-[var(--brand-deep)] bg-[rgba(197,160,40,0.1)]"
                          : "border-[var(--border)] hover:bg-[var(--surface-sunken)]"
                      }`}
                      onClick={() => setSelectedId(p.studentId)}
                    >
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        {p.fullName}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {p.classLabel} · {p.admissionNo}
                        {p.locality ? ` · ${p.locality}` : ""}
                        {p.hasGeo ? " · 📍 pinned" : ""}
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            {!selected ? (
              <p className="text-sm text-[var(--muted)]">
                Select a student to see route suggestions and fee months.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                    Suggestions for {selected.fullName}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {selected.landmark || selected.locality || selected.addressLine}
                  </p>
                  {roadKm != null ? (
                    <p className="mt-1 text-xs font-semibold text-[var(--brand-mid)]">
                      ~{roadKm} km from school by road
                      {roadSource === "google" ? " (Google Maps)" : " (estimate)"}
                      {selected.hasGeo ? " · home pinned" : " · geocode home for accuracy"}
                    </p>
                  ) : null}
                </div>

                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Effective from (mid-year / session start)
                  </span>
                  <input
                    type="date"
                    className="field !py-1.5"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                  />
                </label>

                <ul className="space-y-2">
                  {suggestions.length === 0 ? (
                    <li className="text-sm text-[var(--muted)]">
                      No route match — add stops near &quot;{selected.locality}&quot; or
                      assign manually in Riders.
                    </li>
                  ) : (
                    suggestions.map((s) => (
                      <li key={`${s.routeId}-${s.stopId}`}>
                        <button
                          type="button"
                          className={`w-full rounded-lg border p-3 text-left ${
                            pick?.stopId === s.stopId && pick?.routeId === s.routeId
                              ? "border-[var(--brand-deep)] bg-[rgba(197,160,40,0.08)]"
                              : "border-[var(--border)]"
                          }`}
                          onClick={() => setPick(s)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-bold text-[var(--brand-deep)]">
                                {s.routeCode} · {s.stopName}
                              </p>
                              <p className="text-[11px] text-[var(--muted)]">
                                {s.busNo}
                                {s.vehicleReg ? ` · ${s.vehicleReg}` : ""} ·{" "}
                                {s.riderCount}/{s.seatCapacity} riders ·{" "}
                                {formatInr(s.monthlyFeePaise)}/mo
                              </p>
                            </div>
                            <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-deep)]">
                              {s.matchScore}% match
                            </span>
                          </div>
                          {s.distanceKm > 0 ? (
                            <p className="mt-1 text-[11px] text-[var(--muted)]">
                              Stop zone {s.distanceKm} km from school
                            </p>
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>

                {pick && monthPreview.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                      Fee months (Fee Take)
                    </p>
                    <ErpTableShell className="mt-1 overflow-x-auto">
                      <ErpTable minWidth="min-w-[16rem]" className="text-xs">
                        <ErpTableHead>
                          <tr>
                            <th className="px-2 py-1.5 font-semibold">Month</th>
                            <th className="px-2 py-1.5 text-right font-semibold">
                              Fee
                            </th>
                          </tr>
                        </ErpTableHead>
                        <ErpTableBody>
                          {monthPreview.map((m) => (
                            <tr key={m.periodKey}>
                              <td className="px-2 py-1.5">{m.periodLabel}</td>
                              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                                {formatInr(m.amountPaise)}
                              </td>
                            </tr>
                          ))}
                        </ErpTableBody>
                      </ErpTable>
                    </ErpTableShell>
                  </div>
                ) : null}

                {pick ? (
                  <button
                    type="button"
                    className="btn-accent w-full rounded-lg py-2 text-sm font-bold"
                    onClick={() => onAssign(selected, pick)}
                  >
                    Assign to {pick.routeCode} from {effectiveFrom}
                  </button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
