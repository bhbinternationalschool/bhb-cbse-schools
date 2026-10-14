/**
 * Stop order per run, from the buses' own GPS — the pure half.
 *
 * Director, 14 Oct 2026: make the serial of stops for pick-up and for each
 * drop run automatically, and suggest early drop for the children picked up
 * early.
 *
 * WHY PER RUN
 * A route has one stop list, and the driver's manifest used that one order
 * for every journey. But a bus collects from the far end inwards in the
 * morning and usually drops from the near end outwards — the reverse — and
 * the 11:30 pre-primary run visits only some stops. Each run's order is read
 * from the trail: the median time the vehicle passes each stop on journeys of
 * that run.
 *
 * FIRST PICKED, FIRST DROPPED
 * On a reversed drop the child collected first (the far end) is dropped last,
 * so the same child rides longest twice a day. Driving the drop in the
 * morning's direction — straight out to the far end, then back towards school
 * dropping as it goes — evens that out. On a loop route (the bus comes back
 * to school empty after its last drop) it is the same roads the other way
 * round, so the km barely change. Where the bus ends its day at the far end
 * (City Bus parks there) it would add a whole empty return, so it is not
 * suggested. Times after the change are ESTIMATES, built only from times
 * already observed, and are labelled so.
 */

export type TrailPoint = { vehicleKey: string; at: string; lat: number; lng: number; speedKmh: number | null };

export type SchoolLeg = {
  vehicleKey: string;
  day: string;
  weekday: number;
  /** IST minute the bus left school (or first moved, if it did not start at school). */
  startMinute: number;
  /** IST minute it was back at school (or last reported, if it did not return). */
  endMinute: number;
  startedAtSchool: boolean;
  endedAtSchool: boolean;
  points: { minute: number; lat: number; lng: number }[];
};

export type RunStop = {
  stopId: string;
  /** Median IST minute the bus passes this stop on this run. */
  minute: number;
  /** Median minutes a child rides: to school (pickup) or from school (drop). Null when not observable. */
  rideMinutes: number | null;
  days: number;
};

export type RunOrder = {
  routeId: string;
  /** "" when the route has no runs configured for the direction. */
  shiftId: string;
  direction: "pickup" | "drop";
  stops: RunStop[];
  /** Stops on the route this run never came within reach of. */
  unseenStopIds: string[];
  legs: number;
  /** Drop runs: median minutes from the last drop back to school, when the bus returns. */
  returnMinutes: number | null;
  /** Share of this run's journeys that ended back at school. */
  returnsToSchoolShare: number;
};

const EARTH_M = 6_371_000;
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const x =
    Math.sin(r(bLat - aLat) / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(x));
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function ist(iso: string): { day: string; minute: number; weekday: number } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 5.5 * 3600_000);
  return {
    day: d.toISOString().slice(0, 10),
    minute: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60,
    weekday: d.getUTCDay(),
  };
}

/** Journeys away from school, per vehicle per day. A leg needs at least 3 moving pings. */
export function schoolLegs(points: TrailPoint[], school: { lat: number; lng: number }, schoolRadiusM = 300): SchoolLeg[] {
  const byKey = new Map<string, { t: NonNullable<ReturnType<typeof ist>>; p: TrailPoint }[]>();
  for (const p of points) {
    const t = ist(p.at);
    if (!t || !p.vehicleKey || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const k = `${p.vehicleKey}|${t.day}`;
    const list = byKey.get(k) ?? [];
    list.push({ t, p });
    byKey.set(k, list);
  }
  const legs: SchoolLeg[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.t.minute - b.t.minute);
    let i = 0;
    while (i < list.length) {
      const atSchool = (k: number) => metresBetween(list[k]!.p.lat, list[k]!.p.lng, school.lat, school.lng) <= schoolRadiusM;
      if (atSchool(i)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < list.length && !atSchool(j + 1)) j += 1;
      const away = list.slice(i, j + 1);
      const moving = away.filter((x) => (x.p.speedKmh ?? 0) > 3).length;
      if (moving >= 3) {
        const before = i > 0 ? list[i - 1]! : null;
        const after = j + 1 < list.length ? list[j + 1]! : null;
        legs.push({
          vehicleKey: away[0]!.p.vehicleKey,
          day: away[0]!.t.day,
          weekday: away[0]!.t.weekday,
          startMinute: before ? before.t.minute : away[0]!.t.minute,
          endMinute: after ? after.t.minute : away[away.length - 1]!.t.minute,
          startedAtSchool: before != null,
          endedAtSchool: after != null,
          points: away.map((x) => ({ minute: x.t.minute, lat: x.p.lat, lng: x.p.lng })),
        });
      }
      i = j + 1;
    }
  }
  return legs;
}

/** When the leg came closest to a point, if within `withinM` (interpolating between pings). */
export function passMinute(leg: Pick<SchoolLeg, "points">, lat: number, lng: number, withinM = 150): number | null {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  let best = Infinity;
  let at: number | null = null;
  const pts = leg.points;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1];
    if (!b || b.minute - a.minute > 3.5) {
      const d = metresBetween(a.lat, a.lng, lat, lng);
      if (d < best) {
        best = d;
        at = a.minute;
      }
      continue;
    }
    const ax = (a.lng - lng) * kx;
    const ay = (a.lat - lat) * ky;
    const dx = (b.lng - a.lng) * kx;
    const dy = (b.lat - a.lat) * ky;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) {
      best = d;
      at = a.minute + t * (b.minute - a.minute);
    }
  }
  return best <= withinM ? at : null;
}

export type RunShift = { id: string; direction: "pickup" | "drop"; departTime: string; weekdays: number[]; isActive: boolean };

const hhmmToMinute = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Which run a journey was. Mornings are pickup; later journeys go to the drop run nearest their start. */
export function legShift(leg: Pick<SchoolLeg, "startMinute" | "weekday">, shifts: RunShift[]): { direction: "pickup" | "drop"; shiftId: string } | null {
  const direction = leg.startMinute < 10 * 60 ? "pickup" : "drop";
  const mine = shifts.filter(
    (s) => s.isActive !== false && s.direction === direction && (s.weekdays.length === 0 || s.weekdays.includes(leg.weekday)),
  );
  if (shifts.filter((s) => s.direction === direction).length === 0) return { direction, shiftId: "" };
  if (direction === "pickup") return mine.length ? { direction, shiftId: mine[0]!.id } : null;
  let best: RunShift | null = null;
  let gap = Infinity;
  for (const s of mine) {
    const m = hhmmToMinute(s.departTime);
    if (m == null) continue;
    const g = Math.abs(leg.startMinute - m);
    if (g < gap) {
      gap = g;
      best = s;
    }
  }
  return best && gap <= 60 ? { direction, shiftId: best.id } : null;
}

/** Per-run stop order for one route, from that route's vehicle's journeys. */
export function buildRunOrders(input: {
  routeId: string;
  stops: { id: string; geoLat?: number; geoLng?: number }[];
  shifts: RunShift[];
  legs: SchoolLeg[];
  minLegs?: number;
}): RunOrder[] {
  const minLegs = input.minLegs ?? 5;
  const groups = new Map<string, { direction: "pickup" | "drop"; shiftId: string; legs: SchoolLeg[] }>();
  for (const leg of input.legs) {
    const s = legShift(leg, input.shifts);
    if (!s) continue;
    const k = `${s.direction}|${s.shiftId}`;
    const g = groups.get(k) ?? { ...s, legs: [] };
    g.legs.push(leg);
    groups.set(k, g);
  }
  const out: RunOrder[] = [];
  for (const g of groups.values()) {
    const days = new Set(g.legs.map((l) => l.day));
    if (days.size < minLegs) continue;
    const runStops: RunStop[] = [];
    const unseen: string[] = [];
    const lastDropReturn: number[] = [];
    for (const stop of input.stops) {
      if (!Number.isFinite(stop.geoLat) || !Number.isFinite(stop.geoLng)) {
        unseen.push(stop.id);
        continue;
      }
      const minutes: number[] = [];
      const rides: number[] = [];
      const seenDays = new Set<string>();
      for (const leg of g.legs) {
        const m = passMinute(leg, Number(stop.geoLat), Number(stop.geoLng));
        if (m == null) continue;
        minutes.push(m);
        seenDays.add(leg.day);
        if (g.direction === "pickup" && leg.endedAtSchool) rides.push(leg.endMinute - m);
        if (g.direction === "drop" && leg.startedAtSchool) rides.push(m - leg.startMinute);
      }
      // Seen on under a third of this run's days: a detour, not the run.
      if (seenDays.size < Math.max(2, Math.ceil(days.size / 3))) {
        unseen.push(stop.id);
        continue;
      }
      runStops.push({
        stopId: stop.id,
        minute: Math.round(median(minutes)),
        rideMinutes: rides.length ? Math.round(median(rides)) : null,
        days: seenDays.size,
      });
    }
    runStops.sort((a, b) => a.minute - b.minute);
    if (g.direction === "drop" && runStops.length) {
      // How long the empty run home takes after the last drop.
      const last = input.stops.find((s) => s.id === runStops[runStops.length - 1]!.stopId)!;
      for (const leg of g.legs) {
        if (!leg.endedAtSchool) continue;
        const m = passMinute(leg, Number(last.geoLat), Number(last.geoLng));
        if (m != null) lastDropReturn.push(leg.endMinute - m);
      }
    }
    out.push({
      routeId: input.routeId,
      shiftId: g.shiftId,
      direction: g.direction,
      stops: runStops,
      unseenStopIds: unseen,
      legs: g.legs.length,
      returnMinutes: lastDropReturn.length ? Math.round(median(lastDropReturn)) : null,
      returnsToSchoolShare: g.legs.filter((l) => l.endedAtSchool).length / g.legs.length,
    });
  }
  return out;
}

/** Route stop sequence that follows the morning: stops in pickup order, the rest after in their old order. */
export function sequenceByPickup<T extends { id: string; sequence: number }>(stops: T[], pickup: RunOrder | undefined): T[] {
  if (!pickup || pickup.stops.length === 0) return stops;
  const rank = new Map(pickup.stops.map((s, i) => [s.stopId, i]));
  const seen = [...stops].filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = [...stops].filter((s) => !rank.has(s.id)).sort((a, b) => a.sequence - b.sequence);
  return [...seen, ...rest].map((s, i) => ({ ...s, sequence: i + 1 }));
}

export type FairDropRow = {
  stopId: string;
  riders: number;
  pickupMinute: number;
  pickupRide: number | null;
  dropRideNow: number | null;
  dropRideSuggested: number;
};

export type FairDropSuggestion =
  | { suggested: false; reason: string }
  | {
      suggested: true;
      order: string[];
      rows: FairDropRow[];
      longestNow: number;
      longestSuggested: number;
      childrenBetter: number;
      childrenWorse: number;
      estimated: true;
    };

/**
 * First picked, first dropped — for one drop run, against the morning run.
 * Only stops with riders on BOTH runs count, and only where the bus returns
 * to school after the drop (a loop), so reversing costs no extra km.
 */
export function suggestFairDrop(input: {
  pickup: RunOrder;
  drop: RunOrder;
  ridersByStop: Map<string, number>;
  /** Stop coordinates and the school, for the drive out to the first drop. */
  stopPoints: Map<string, { lat: number; lng: number }>;
  school: { lat: number; lng: number };
  minGainMinutes?: number;
}): FairDropSuggestion {
  const { pickup, drop } = input;
  if (drop.returnsToSchoolShare < 0.6) {
    return { suggested: false, reason: "The bus does not come back to school after this run, so driving it the other way would add an empty trip." };
  }
  const dropBy = new Map(drop.stops.map((s) => [s.stopId, s]));
  const common = pickup.stops.filter((s) => dropBy.has(s.stopId) && (input.ridersByStop.get(s.stopId) ?? 0) > 0);
  if (common.length < 3) return { suggested: false, reason: "Too few stops with children on both runs to compare." };
  // Same-direction drop: straight out to the first-picked stop, then the
  // morning's own path in the morning's own minutes. The drive out uses the
  // ERP's ETA rule (straight line × 1.3 at about 22 km/h) — an estimate.
  const first = common[0]!;
  const fp = input.stopPoints.get(first.stopId);
  if (!fp) return { suggested: false, reason: "The first stop has no map location." };
  const outMinutes = (metresBetween(input.school.lat, input.school.lng, fp.lat, fp.lng) / 1000) * 1.3 / 22 * 60;
  const rows: FairDropRow[] = common.map((s) => ({
    stopId: s.stopId,
    riders: input.ridersByStop.get(s.stopId) ?? 0,
    pickupMinute: s.minute,
    pickupRide: s.rideMinutes,
    dropRideNow: dropBy.get(s.stopId)!.rideMinutes,
    dropRideSuggested: Math.round(outMinutes + (s.minute - first.minute)),
  }));
  const total = (r: FairDropRow, d: number | null) => (r.pickupRide ?? 0) + (d ?? 0);
  const longestNow = Math.max(...rows.map((r) => total(r, r.dropRideNow)));
  const longestSuggested = Math.max(...rows.map((r) => total(r, r.dropRideSuggested)));
  let better = 0;
  let worse = 0;
  for (const r of rows) {
    if (r.dropRideNow == null) continue;
    if (r.dropRideSuggested < r.dropRideNow - 2) better += r.riders;
    else if (r.dropRideSuggested > r.dropRideNow + 2) worse += r.riders;
  }
  if (longestNow - longestSuggested < (input.minGainMinutes ?? 5)) {
    return { suggested: false, reason: "The longest ride would not get meaningfully shorter — the current order is already fair enough." };
  }
  return {
    suggested: true,
    order: rows.map((r) => r.stopId),
    rows,
    longestNow,
    longestSuggested,
    childrenBetter: better,
    childrenWorse: worse,
    estimated: true,
  };
}

/**
 * The order a driver's list should follow for one run.
 *  - "fair": a drop run the office switched to first-picked-first-dropped →
 *    the morning's order.
 *  - "gps": the order observed for this run.
 *  - "route": nothing observed → the route's own sequence.
 * Stops the run was never seen at go last, in route order — never dropped,
 * because a stop missing from a driver's list is a child left behind.
 */
export function orderForRun(input: {
  routeStops: { id: string; sequence: number }[];
  run?: Pick<RunOrder, "stops"> & { chosen?: "gps" | "fair" };
  pickup?: Pick<RunOrder, "stops">;
}): { ids: string[]; expectedMinute: Map<string, number>; basis: "gps" | "fair" | "route" } {
  const byRoute = [...input.routeStops].sort((a, b) => a.sequence - b.sequence).map((s) => s.id);
  const valid = new Set(byRoute);
  const useFair = input.run?.chosen === "fair" && (input.pickup?.stops.length ?? 0) > 0;
  const source = useFair ? input.pickup!.stops : input.run?.stops ?? [];
  if (source.length === 0) return { ids: byRoute, expectedMinute: new Map(), basis: "route" };
  const first = source.map((s) => s.stopId).filter((id) => valid.has(id));
  const seen = new Set(first);
  return {
    ids: [...first, ...byRoute.filter((id) => !seen.has(id))],
    // Fair order has no observed times yet — none rather than invented ones.
    expectedMinute: useFair ? new Map() : new Map(source.map((s) => [s.stopId, s.minute])),
    basis: useFair ? "fair" : "gps",
  };
}

export const minuteToHhmm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
