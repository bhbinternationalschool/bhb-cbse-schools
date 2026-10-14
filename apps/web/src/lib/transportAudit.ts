/**
 * Transport audit — the rules behind its suggestions (pure).
 *
 * Director, 14 Oct 2026: audit transport at intervals and suggest, with
 * action buttons — move a child to the vehicle that really passes them, drive
 * a run in a cheaper order — and watch for road closures.
 *
 * MOVE A CHILD (nightly)
 * Only for children with a boarding pin (where the family or the office says
 * the child waits — sis_student_transport_point). A child whose stop their bus
 * does not reach, or whose stop is more than 400 m from that pin, is offered a stop that some
 * bus DOES reach on its morning run, within 300 m of the pin: their own bus
 * first, then a bus a brother or sister already rides, then the nearest.
 * Without a pin we know where the stop is, not where the child is, so no
 * move is suggested — those stay "stop not reached" for the office.
 * The fee never changes: the move carries the fee the child pays today. A
 * child whose fee today is unknown (unpriced stop, no fixed fee) gets the
 * suggestion without a button — price first.
 *
 * ROAD ALERTS (nightly)
 * There is no public road-closure feed for these villages, so closures are
 * read from the buses: a stop a run reached on most days of the last weeks
 * and on none of its last three journeys, or a run that suddenly takes much
 * longer. Both clear themselves when the bus is back to normal.
 *
 * RUN ORDER (weekly, server: Google Directions) — see transportAudit.server.
 */

import { metresBetween, passMinute, legShift, type RunShift, type SchoolLeg, type RunOrder } from "@/lib/runStopOrder";

export type AuditStop = { id: string; name: string; geoLat?: number; geoLng?: number };
export type AuditRoute = { id: string; name: string; vehicleName: string; stops: AuditStop[] };
export type AuditRider = {
  assignmentId: string;
  studentId: string;
  studentName: string;
  householdId: string;
  routeId: string;
  stopId: string;
  /** What the child pays a month today, paise; null when it cannot be worked out. */
  feePaise: number | null;
};

export type MoveSuggestion = {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  fromRouteId: string;
  fromStopId: string;
  toRouteId: string;
  toStopId: string;
  toStopName: string;
  toVehicle: string;
  sameBus: boolean;
  siblingOnBus: boolean;
  metresFromHome: number;
  metresFromHomeNow: number | null;
  reachedNow: boolean;
  feePaise: number | null;
};

const geo = (s: AuditStop | undefined) =>
  s && Number.isFinite(s.geoLat) && Number.isFinite(s.geoLng) ? { lat: Number(s.geoLat), lng: Number(s.geoLng) } : null;

export function suggestMoves(input: {
  routes: AuditRoute[];
  riders: AuditRider[];
  pickupOrders: Map<string, Pick<RunOrder, "stops">>;
  pins: Map<string, { lat: number; lng: number }>;
  okFromHomeM?: number;
  maxWalkM?: number;
}): MoveSuggestion[] {
  const okM = input.okFromHomeM ?? 400;
  const walkM = input.maxWalkM ?? 300;
  const routeById = new Map(input.routes.map((r) => [r.id, r]));
  const reached = new Map<string, Set<string>>();
  for (const [routeId, o] of input.pickupOrders) reached.set(routeId, new Set(o.stops.map((s) => s.stopId)));
  const siblingRoutes = new Map<string, Set<string>>();
  for (const r of input.riders) {
    if (!r.householdId) continue;
    const set = siblingRoutes.get(r.householdId) ?? new Set<string>();
    set.add(r.routeId);
    siblingRoutes.set(r.householdId, set);
  }

  const out: MoveSuggestion[] = [];
  for (const r of input.riders) {
    const pin = input.pins.get(r.studentId);
    if (!pin) continue;
    const route = routeById.get(r.routeId);
    if (!route || !reached.has(r.routeId)) continue; // own bus has no tracker — nothing to compare
    const cur = route.stops.find((s) => s.id === r.stopId);
    const curGeo = geo(cur);
    const curDist = curGeo ? metresBetween(pin.lat, pin.lng, curGeo.lat, curGeo.lng) : null;
    const curReached = reached.get(r.routeId)!.has(r.stopId);
    if (curReached && curDist != null && curDist <= okM) continue;

    const sibs = siblingRoutes.get(r.householdId) ?? new Set<string>();
    type Cand = { route: AuditRoute; stop: AuditStop; m: number; rank: number };
    const cands: Cand[] = [];
    for (const other of input.routes) {
      const seen = reached.get(other.id);
      if (!seen) continue;
      for (const s of other.stops) {
        if (!seen.has(s.id)) continue;
        const g = geo(s);
        if (!g) continue;
        const m = metresBetween(pin.lat, pin.lng, g.lat, g.lng);
        if (m > walkM) continue;
        const rank = other.id === r.routeId ? 0 : sibs.has(other.id) && other.id !== r.routeId ? 1 : 2;
        cands.push({ route: other, stop: s, m, rank });
      }
    }
    cands.sort((a, b) => a.rank - b.rank || a.m - b.m);
    const best = cands[0];
    if (!best || best.stop.id === r.stopId) continue;
    // Only worth a move if it is clearly better than today.
    if (curReached && curDist != null && curDist - best.m < 200) continue;
    out.push({
      id: `sug:move:${r.assignmentId}:${best.stop.id}`,
      assignmentId: r.assignmentId,
      studentId: r.studentId,
      studentName: r.studentName,
      fromRouteId: r.routeId,
      fromStopId: r.stopId,
      toRouteId: best.route.id,
      toStopId: best.stop.id,
      toStopName: best.stop.name,
      toVehicle: best.route.vehicleName,
      sameBus: best.route.id === r.routeId,
      siblingOnBus: best.rank === 1,
      metresFromHome: Math.round(best.m),
      metresFromHomeNow: curDist == null ? null : Math.round(curDist),
      reachedNow: curReached,
      feePaise: r.feePaise,
    });
  }
  return out;
}

export type RoadAlert = {
  id: string;
  routeId: string;
  shiftId: string;
  direction: "pickup" | "drop";
  kind: "stop_dropped" | "run_slower";
  stopId: string;
  since: string;
  detail: string;
};

/**
 * Closures and diversions read from the buses. `stopsWithRiders` limits stop
 * checks to places children actually board.
 */
export function detectRoadAlerts(input: {
  routeId: string;
  stops: AuditStop[];
  stopsWithRiders: Set<string>;
  shifts: RunShift[];
  legs: SchoolLeg[];
  recentDays?: number;
}): RoadAlert[] {
  const recentN = input.recentDays ?? 3;
  const byRun = new Map<string, { direction: "pickup" | "drop"; shiftId: string; legs: SchoolLeg[] }>();
  for (const leg of input.legs) {
    const s = legShift(leg, input.shifts);
    if (!s) continue;
    const k = `${s.direction}|${s.shiftId}`;
    const g = byRun.get(k) ?? { ...s, legs: [] };
    g.legs.push(leg);
    byRun.set(k, g);
  }
  const out: RoadAlert[] = [];
  for (const run of byRun.values()) {
    const days = [...new Set(run.legs.map((l) => l.day))].sort();
    if (days.length < recentN + 6) continue;
    const recent = new Set(days.slice(-recentN));
    const since = days[days.length - recentN]!;
    const base = new Set(days.slice(0, -recentN));

    for (const stop of input.stops) {
      if (!input.stopsWithRiders.has(stop.id)) continue;
      const g = geo(stop);
      if (!g) continue;
      const reachedOn = new Set<string>();
      for (const leg of run.legs) if (passMinute(leg, g.lat, g.lng) != null) reachedOn.add(leg.day);
      const baseHits = [...base].filter((d) => reachedOn.has(d)).length;
      const recentHits = [...recent].filter((d) => reachedOn.has(d)).length;
      if (baseHits / base.size >= 0.8 && recentHits === 0) {
        out.push({
          id: `road:stop:${input.routeId}:${run.direction}:${run.shiftId || "-"}:${stop.id}`,
          routeId: input.routeId,
          shiftId: run.shiftId,
          direction: run.direction,
          kind: "stop_dropped",
          stopId: stop.id,
          since,
          detail: `The bus reached ${stop.name} on ${baseHits} of ${base.size} earlier journeys of this run, and on none of the last ${recentN} (since ${since}). A road may be closed or the driver has changed the route — the children there may be walking further or being missed.`,
        });
      }
    }

    const dur = (ls: SchoolLeg[]) => {
      const xs = ls.filter((l) => l.startedAtSchool || l.endedAtSchool).map((l) => l.endMinute - l.startMinute).sort((a, b) => a - b);
      return xs.length ? xs[Math.floor(xs.length / 2)]! : null;
    };
    const firstPerDay = (filter: Set<string>) => {
      const seen = new Set<string>();
      return run.legs
        .filter((l) => filter.has(l.day))
        .sort((a, b) => a.startMinute - b.startMinute)
        .filter((l) => (seen.has(l.day) ? false : (seen.add(l.day), true)));
    };
    const before = dur(firstPerDay(base));
    const now = dur(firstPerDay(recent));
    if (before != null && now != null && now - before >= 8 && now >= before * 1.25) {
      out.push({
        id: `road:slow:${input.routeId}:${run.direction}:${run.shiftId || "-"}`,
        routeId: input.routeId,
        shiftId: run.shiftId,
        direction: run.direction,
        kind: "run_slower",
        stopId: "",
        since,
        detail: `This run has taken about ${Math.round(now)} minutes on its last ${recentN} journeys (since ${since}), against ${Math.round(before)} before — ${Math.round(now - before)} minutes longer. A diversion, a bad road or a new stop; worth asking the driver.`,
      });
    }
  }
  return out;
}

/** Fuel cost per km, by fuel — an estimate; mileage is not recorded on the desk. */
export function fuelRupeesPerKm(fuelType: string): { perKm: number; basis: string } {
  if (fuelType === "cng") return { perKm: 93 / 24, basis: "CNG ₹93/kg at about 24 km/kg" };
  if (fuelType === "petrol") return { perKm: 105 / 15, basis: "petrol ₹105/l at about 15 km/l" };
  return { perKm: 88 / 10, basis: "diesel ₹88/l at about 10 km/l" };
}
