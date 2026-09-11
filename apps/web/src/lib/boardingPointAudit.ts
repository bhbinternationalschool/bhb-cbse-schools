/**
 * Is each rider assigned to the right boarding point on their own bus?
 *
 * WHY THIS EXISTS
 * findMisroutedRiders already compares every rider's home against every pinned
 * stop — and then throws away the answer this asks for, in one line:
 *
 *     // A closer stop on the same bus is a stop change, not a wrong vehicle.
 *     if (best.routeId === current.routeId) continue;
 *
 * That was a deliberate scope choice about *route* changes. It leaves the more
 * common error completely undetected: the right bus, the wrong stop. Run
 * against production on 11 Sep 2026, 32 of 119 checkable riders sat more than
 * a kilometre from a nearer stop on their own route, and 14 more than three.
 *
 * Nine of them had defaulted onto "9XX9+VG Ekala" — a Plus Code, first in the
 * stop list on MAGIC-1 — from three different villages, each of which had a
 * properly named stop closer by. Three villages independently choosing the
 * same first-in-list option is a picker problem, not nine mistakes.
 *
 * WHY IT MATTERS BEYOND THE BUS
 * A stop carries distanceKm, and distanceKm drives the fee. A wrong boarding
 * point is a wrong bill, in both directions: eight Bhopapur riders are billed
 * from a stop 1.9 km from school whose village sits nearest a 7.5 km stop,
 * while two Kanudih riders are billed from 11.2 km against a nearer 2.7 km.
 *
 * WHAT IT REFUSES TO DO
 * It never reassigns anyone. A boarding point has reasons the system cannot
 * see — an aunt on the way, a sibling at another school, a road the family
 * will not let a child cross — so this produces a list for a human, and says
 * how confident each row is.
 */

import {
  haversineKm,
  listActiveRoutes,
  type TransportState,
  type TransportStop,
} from "@/lib/transport";

/**
 * Where a child lives, and how precisely we know it.
 *
 * "village" is a census centroid: right village, not right corner. It places a
 * family within a kilometre or so, which is enough to catch a rider assigned
 * four kilometres away and useless for anything finer. "pin" is a point
 * somebody actually dropped for this student.
 */
export type BoardingHome = {
  lat: number;
  lng: number;
  /** Village name, or whatever the pin was called. Shown to the office. */
  label: string;
  precision: "village" | "pin";
};

export type BoardingPointFlag = {
  studentId: string;
  fullName: string;
  householdId: string;
  homeLabel: string;
  homePrecision: BoardingHome["precision"];
  routeId: string;
  routeLabel: string;
  assignedStopId: string;
  assignedStopName: string;
  assignedHomeKm: number;
  assignedSchoolKm: number | null;
  nearestStopId: string;
  nearestStopName: string;
  nearestHomeKm: number;
  nearestSchoolKm: number | null;
  /** How much closer the nearer stop is. */
  gapKm: number;
  /**
   * True when the two stops sit in different fee bands, i.e. correcting this
   * changes what the family pays. Null when the policy prices some other way
   * or either stop has no distance recorded — an unpriced stop must not be
   * reported as "no change".
   */
  feeChanges: boolean | null;
};

/** Rows the audit could not judge, counted rather than quietly dropped. */
export type BoardingAuditSkips = {
  /** No home location at all — household never matched to a village. */
  noHome: number;
  /** Assigned stop carries no coordinates, so nothing can be compared. */
  assignedStopUnpinned: number;
  /** Their route has no pinned stop to compare against. */
  noPinnedStopsOnRoute: number;
};

export type BoardingAuditResult = {
  flags: BoardingPointFlag[];
  /** Riders actually compared. */
  checked: number;
  skipped: BoardingAuditSkips;
};

/**
 * Number.isFinite, not typeof — NaN is a number, and a stop carrying NaN
 * coordinates would sail through a typeof check, produce NaN distances, fail
 * every comparison silently (NaN < x is false) and be reported as a finding
 * with blank numbers. An unpinned stop must reach the "cannot compare" count.
 */
function stopHasGeo(s: TransportStop): s is TransportStop & { geoLat: number; geoLng: number } {
  return Number.isFinite(s.geoLat) && Number.isFinite(s.geoLng);
}

/**
 * Which fee band a stop falls in, as an index. Bands are the stop-priced
 * tier list; past the last one the policy switches to a formula, which is
 * still a distinct outcome, so it gets its own index.
 */
function bandIndex(km: number | null | undefined, bands: { upToKm: number }[]): number | null {
  if (typeof km !== "number" || !Number.isFinite(km)) return null;
  const sorted = [...bands].sort((a, b) => a.upToKm - b.upToKm);
  for (let i = 0; i < sorted.length; i++) {
    if (km <= sorted[i]!.upToKm) return i;
  }
  return sorted.length;
}

export function auditBoardingPoints(input: {
  state: TransportState;
  /** householdId → where that family lives. */
  homes: Map<string, BoardingHome>;
  nameOf: (studentId: string) => string;
  academicYearCode: string;
  /**
   * Below this, a "closer" stop is indistinguishable from centroid error.
   * A village pin is good to roughly a kilometre, so that is the floor.
   */
  minGapKm?: number;
}): BoardingAuditResult {
  const minGap = input.minGapKm ?? 1;
  const bands = input.state.feePolicy?.bands ?? [];

  const flags: BoardingPointFlag[] = [];
  const skipped: BoardingAuditSkips = {
    noHome: 0,
    assignedStopUnpinned: 0,
    noPinnedStopsOnRoute: 0,
  };
  let checked = 0;

  const routes = listActiveRoutes(input.state);
  const routeById = new Map(routes.map((r) => [r.id, r]));

  for (const a of input.state.assignments) {
    // Active only. A student carries several assignment rows per year as
    // stops change, and an expired one compared against a current stop
    // manufactures a gap that nobody can act on — it did exactly that on the
    // first run of this audit, inventing a 7.4 km error that was two
    // superseded rows overlapping.
    if (a.effectiveTo != null) continue;
    if (a.academicYearCode !== input.academicYearCode) continue;
    if (a.boardingSuspended) continue;

    const route = routeById.get(a.routeId);
    if (!route) continue;

    const home = input.homes.get(a.householdId);
    if (!home) {
      skipped.noHome += 1;
      continue;
    }

    const pinned = route.stops.filter(stopHasGeo);
    if (pinned.length === 0) {
      skipped.noPinnedStopsOnRoute += 1;
      continue;
    }

    const assigned = pinned.find((s) => s.id === a.stopId);
    if (!assigned) {
      // Either the stop is unpinned or it is not on this route any more.
      // Both mean "cannot compare", never "no problem".
      skipped.assignedStopUnpinned += 1;
      continue;
    }

    checked += 1;

    const assignedHomeKm = haversineKm(home.lat, home.lng, assigned.geoLat, assigned.geoLng);
    let nearest = assigned;
    let nearestHomeKm = assignedHomeKm;
    for (const s of pinned) {
      const km = haversineKm(home.lat, home.lng, s.geoLat, s.geoLng);
      if (km < nearestHomeKm) {
        nearest = s;
        nearestHomeKm = km;
      }
    }

    const gapKm = assignedHomeKm - nearestHomeKm;
    if (nearest.id === assigned.id || gapKm < minGap) continue;

    const aBand = bandIndex(assigned.distanceKm, bands);
    const nBand = bandIndex(nearest.distanceKm, bands);

    flags.push({
      studentId: a.studentId,
      fullName: input.nameOf(a.studentId),
      householdId: a.householdId,
      homeLabel: home.label,
      homePrecision: home.precision,
      routeId: route.id,
      routeLabel: route.busNo || route.code,
      assignedStopId: assigned.id,
      assignedStopName: assigned.name,
      assignedHomeKm: Math.round(assignedHomeKm * 10) / 10,
      assignedSchoolKm: assigned.distanceKm ?? null,
      nearestStopId: nearest.id,
      nearestStopName: nearest.name,
      nearestHomeKm: Math.round(nearestHomeKm * 10) / 10,
      nearestSchoolKm: nearest.distanceKm ?? null,
      gapKm: Math.round(gapKm * 10) / 10,
      feeChanges:
        bands.length === 0 || aBand == null || nBand == null ? null : aBand !== nBand,
    });
  }

  flags.sort((x, y) => y.gapKm - x.gapKm);
  return { flags, checked, skipped };
}

/**
 * Stops that several different villages have all defaulted onto.
 *
 * One family choosing an odd stop is a decision. Three villages independently
 * choosing the same one, each with a nearer named stop, is the stop picker
 * offering a bad default — and it is fixed once, in the picker, not fifty
 * times in the assignment list.
 */
export function clusterByAssignedStop(
  flags: BoardingPointFlag[],
): { stopId: string; stopName: string; routeLabel: string; riders: number; villages: string[] }[] {
  const byStop = new Map<string, BoardingPointFlag[]>();
  for (const f of flags) {
    const list = byStop.get(f.assignedStopId) ?? [];
    list.push(f);
    byStop.set(f.assignedStopId, list);
  }
  return [...byStop.entries()]
    .map(([stopId, list]) => ({
      stopId,
      stopName: list[0]!.assignedStopName,
      routeLabel: list[0]!.routeLabel,
      riders: list.length,
      villages: [...new Set(list.map((f) => f.homeLabel))].sort(),
    }))
    .filter((c) => c.villages.length > 1)
    .sort((a, b) => b.riders - a.riders);
}
