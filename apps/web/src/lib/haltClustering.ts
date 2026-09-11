/**
 * Where the buses actually stop, from the position trail.
 *
 * The stop list says where the office believes children board. This says
 * where the vehicles genuinely halt, morning after morning, and the two are
 * not the same question. It answers the ones nobody can answer from the desk:
 * a stop with riders that the bus never goes near, and a place the bus stops
 * every single day that is not a stop at all.
 *
 * HOW CONFIDENT THIS IS ALLOWED TO BE
 * A halt seen once is a halt seen once. It could be a boarding point, a level
 * crossing, a puncture, or traffic. Only repetition separates those, so every
 * cluster carries the number of distinct days it was seen on and the caller
 * decides what to trust — `minDaysSeen` defaults to 3 and nothing below it may
 * be presented as a boarding point. With one morning of telemetry this
 * returns observations, not conclusions, and says which it is.
 *
 * WHAT IS DELIBERATELY THROWN AWAY
 *  - Halts at the school. The bus stops there every trip and it is not a
 *    boarding point.
 *  - Halts that run to the beginning or the end of the trail. A bus parked
 *    overnight reports a stationary position every minute until morning; that
 *    is the depot, and it would otherwise be the strongest "cluster" in the
 *    data by a wide margin.
 */

export type TrailPoint = {
  vehicleRef: string;
  at: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  ignitionOn: boolean | null;
};

export type KnownStop = {
  stopId: string;
  stopName: string;
  routeId: string;
  routeLabel: string;
  lat: number;
  lng: number;
  riders: number;
};

export type Halt = {
  vehicleRef: string;
  lat: number;
  lng: number;
  startedAt: string;
  endedAt: string;
  seconds: number;
  /** IST calendar day, so "seen on three days" means three mornings. */
  day: string;
};

export type HaltCluster = {
  lat: number;
  lng: number;
  halts: number;
  daysSeen: number;
  vehicles: string[];
  longestSeconds: number;
  /** The stop this sits on, when it sits on one. */
  matchedStopId: string | null;
  matchedStopName: string | null;
  matchedRouteLabel: string | null;
  metresFromStop: number | null;
};

export type UnvisitedStop = KnownStop & { nearestClusterMetres: number | null };

const EARTH_M = 6_371_000;

export function metresBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_M * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** IST calendar day for a timestamp. The school day is the unit of repetition. */
export function istDay(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export type HaltOptions = {
  /** At or below this the vehicle counts as standing still. */
  stoppedKmh?: number;
  /** Shorter than this and nobody could have boarded. */
  minHaltSeconds?: number;
  /** Points further apart than this are two halts, not one. */
  haltRadiusM?: number;
  /** Halts within this of the school are the school. */
  schoolRadiusM?: number;
  /** Halts this close to each other are the same place on different days. */
  clusterRadiusM?: number;
  /** A cluster this close to a stop IS that stop. */
  stopMatchRadiusM?: number;
};

const DEFAULTS: Required<HaltOptions> = {
  stoppedKmh: 2,
  minHaltSeconds: 45,
  haltRadiusM: 60,
  schoolRadiusM: 250,
  clusterRadiusM: 120,
  stopMatchRadiusM: 150,
};

/**
 * Find the halts in one vehicle's trail.
 *
 * A halt must be BOUNDED by movement — the bus arrived and then left again.
 * An unbounded run at either end of the trail is where the vehicle was parked
 * when the window opened or closed, which is the depot, not a stop.
 */
export function findHalts(
  points: TrailPoint[],
  school: { lat: number; lng: number },
  opts: HaltOptions = {},
): Halt[] {
  const o = { ...DEFAULTS, ...opts };
  const byVehicle = new Map<string, TrailPoint[]>();
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (!Number.isFinite(Date.parse(p.at))) continue;
    const list = byVehicle.get(p.vehicleRef) ?? [];
    list.push(p);
    byVehicle.set(p.vehicleRef, list);
  }

  const halts: Halt[] = [];
  for (const [vehicleRef, list] of byVehicle) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    let i = 0;
    while (i < list.length) {
      const start = list[i]!;
      if ((start.speedKmh ?? 0) > o.stoppedKmh) {
        i += 1;
        continue;
      }
      let j = i;
      while (
        j + 1 < list.length &&
        (list[j + 1]!.speedKmh ?? 0) <= o.stoppedKmh &&
        metresBetween(start.lat, start.lng, list[j + 1]!.lat, list[j + 1]!.lng) <=
          o.haltRadiusM
      ) {
        j += 1;
      }

      const bounded = i > 0 && j < list.length - 1;
      const end = list[j]!;
      const seconds = (Date.parse(end.at) - Date.parse(start.at)) / 1000;

      if (bounded && seconds >= o.minHaltSeconds) {
        const lat = (start.lat + end.lat) / 2;
        const lng = (start.lng + end.lng) / 2;
        if (metresBetween(lat, lng, school.lat, school.lng) > o.schoolRadiusM) {
          halts.push({
            vehicleRef,
            lat,
            lng,
            startedAt: start.at,
            endedAt: end.at,
            seconds: Math.round(seconds),
            day: istDay(start.at),
          });
        }
      }
      i = j + 1;
    }
  }
  return halts;
}

/** Group halts that are the same place, and say how many days each was seen on. */
export function clusterHalts(
  halts: Halt[],
  stops: KnownStop[],
  opts: HaltOptions = {},
): HaltCluster[] {
  const o = { ...DEFAULTS, ...opts };
  const clusters: { lat: number; lng: number; members: Halt[] }[] = [];

  for (const h of halts) {
    const hit = clusters.find(
      (c) => metresBetween(c.lat, c.lng, h.lat, h.lng) <= o.clusterRadiusM,
    );
    if (hit) {
      hit.members.push(h);
      // Recentre, so a cluster follows the halts rather than its first member.
      hit.lat = hit.members.reduce((s, m) => s + m.lat, 0) / hit.members.length;
      hit.lng = hit.members.reduce((s, m) => s + m.lng, 0) / hit.members.length;
    } else {
      clusters.push({ lat: h.lat, lng: h.lng, members: [h] });
    }
  }

  return clusters
    .map((c) => {
      let matched: KnownStop | null = null;
      let bestM = Infinity;
      for (const s of stops) {
        const m = metresBetween(c.lat, c.lng, s.lat, s.lng);
        if (m < bestM) {
          bestM = m;
          matched = s;
        }
      }
      const isMatch = matched != null && bestM <= o.stopMatchRadiusM;
      return {
        lat: c.lat,
        lng: c.lng,
        halts: c.members.length,
        daysSeen: new Set(c.members.map((m) => m.day)).size,
        vehicles: [...new Set(c.members.map((m) => m.vehicleRef))].sort(),
        longestSeconds: Math.max(...c.members.map((m) => m.seconds)),
        matchedStopId: isMatch ? matched!.stopId : null,
        matchedStopName: isMatch ? matched!.stopName : null,
        matchedRouteLabel: isMatch ? matched!.routeLabel : null,
        metresFromStop: matched ? Math.round(bestM) : null,
      };
    })
    .sort((a, b) => b.daysSeen - a.daysSeen || b.halts - a.halts);
}

/**
 * Stops with riders that no cluster sits on.
 *
 * Reported with the distance to the nearest halt cluster rather than as a
 * bare "not visited": a stop 80 metres from where the bus actually pulls up
 * is a stop whose pin is wrong, and a stop two kilometres from any halt is a
 * stop nobody uses. Those need different fixes.
 */
export function unvisitedStopsWithRiders(
  stops: KnownStop[],
  clusters: HaltCluster[],
): UnvisitedStop[] {
  const matched = new Set(
    clusters.map((c) => c.matchedStopId).filter((x): x is string => Boolean(x)),
  );
  return stops
    .filter((s) => s.riders > 0 && !matched.has(s.stopId))
    .map((s) => {
      let best: number | null = null;
      for (const c of clusters) {
        const m = metresBetween(s.lat, s.lng, c.lat, c.lng);
        if (best == null || m < best) best = m;
      }
      return { ...s, nearestClusterMetres: best == null ? null : Math.round(best) };
    })
    .sort((a, b) => b.riders - a.riders);
}

/**
 * Clusters that look like real boarding points the stop list does not have.
 *
 * `minDaysSeen` is the whole guard. Below it a cluster is an observation —
 * a puncture, a level crossing, a chat at a gate — and calling it a boarding
 * point would put a place on a map that nobody boards at.
 */
export function candidateBoardingPoints(
  clusters: HaltCluster[],
  minDaysSeen = 3,
): HaltCluster[] {
  return clusters.filter((c) => c.matchedStopId == null && c.daysSeen >= minDaysSeen);
}
