/**
 * New stops from the buses' own GPS — the pure half.
 *
 * Director, 14 Oct 2026: keep watching the Fleet Edge feed and, whenever a
 * bus starts stopping somewhere new and keeps doing it, add that place as a
 * stop in the ERP by itself, so the office can put children on it.
 *
 * WHY NOT haltClustering.findHalts
 * Trackers report about once a minute. A pickup lasts twenty to sixty seconds,
 * so it usually leaves ONE stationary ping. findHalts measures a halt from the
 * first to the last stationary ping, so a one-ping halt is 0 s and dropped —
 * it finds traffic jams and misses boarding points. Here a halt lasts until
 * the next MOVING ping, which is what the 14 Oct audit used to find the 50
 * stops the office accepted.
 *
 * WHAT MAY BECOME A STOP (all must hold)
 *  - halted inside the school-run hours (05:00–15:30 IST), bounded by movement
 *    on both sides — a vehicle parked overnight is a depot, not a stop;
 *  - more than 400 m from school;
 *  - seen on at least `minDays` different days AND on at least `minShare` of
 *    the days that vehicle ran — once is a red light, every day is a child;
 *  - a typical (median) halt of at most 10 minutes — longer is parking;
 *  - more than 150 m from every stop already on that vehicle's route, and from
 *    every point this job ever added before (so a stop the office deleted as
 *    "not a boarding point" is never added back);
 *  - not a petrol pump, workshop or pollution-check centre (checked by the
 *    server against the place Google names there).
 *
 * WHAT IT NEVER DOES
 * Move or delete a stop, move a child, or set a price. A new stop is unpriced,
 * so nobody is billed for it until the office puts a child there on purpose.
 */

import { GPS_STOP_NOTE_PREFIX } from "@/lib/transportStopOrigin";

export type GpsPosition = {
  vehicleKey: string;
  at: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
};

export type GpsHalt = {
  vehicleKey: string;
  lat: number;
  lng: number;
  day: string;
  /** Minutes after midnight IST when the halt began. */
  minuteIst: number;
  seconds: number;
};

export type GpsHaltCluster = {
  vehicleKey: string;
  lat: number;
  lng: number;
  daysSeen: number;
  halts: number;
  medianSeconds: number;
  /** Median IST start minute of morning (before 10:00) and later halts; null when none. */
  morningMinute: number | null;
  afternoonMinute: number | null;
};

export type StopPoint = { lat: number; lng: number };

export type DiscoveryOptions = {
  schoolRadiusM: number;
  stoppedKmh: number;
  haltRadiusM: number;
  maxPingGapSeconds: number;
  minHaltSeconds: number;
  clusterRadiusM: number;
  mergeRadiusM: number;
  existingStopRadiusM: number;
  minDays: number;
  minShare: number;
  maxMedianSeconds: number;
  dayStartMinute: number;
  dayEndMinute: number;
};

export const DISCOVERY_DEFAULTS: DiscoveryOptions = {
  schoolRadiusM: 400,
  stoppedKmh: 2,
  haltRadiusM: 60,
  maxPingGapSeconds: 200,
  minHaltSeconds: 30,
  clusterRadiusM: 120,
  mergeRadiusM: 200,
  existingStopRadiusM: 150,
  minDays: 8,
  minShare: 0.4,
  maxMedianSeconds: 600,
  dayStartMinute: 5 * 60,
  dayEndMinute: 15 * 60 + 30,
};

const EARTH_M = 6_371_000;
export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(x));
}

function ist(iso: string): { day: string; minute: number } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 5.5 * 3600_000);
  return { day: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** IST days on which each vehicle actually moved during school-run hours. */
export function runDaysByVehicle(points: GpsPosition[], opts: Partial<DiscoveryOptions> = {}): Map<string, Set<string>> {
  const o = { ...DISCOVERY_DEFAULTS, ...opts };
  const out = new Map<string, Set<string>>();
  for (const p of points) {
    if ((p.speedKmh ?? 0) <= 5) continue;
    const t = ist(p.at);
    if (!t || t.minute < o.dayStartMinute || t.minute > o.dayEndMinute) continue;
    const set = out.get(p.vehicleKey) ?? new Set<string>();
    set.add(t.day);
    out.set(p.vehicleKey, set);
  }
  return out;
}

/**
 * Halts on school runs. A halt starts at the first stationary ping and lasts
 * until the next moving one; it must have moving pings on both sides.
 */
export function findRunHalts(
  points: GpsPosition[],
  school: StopPoint,
  opts: Partial<DiscoveryOptions> = {},
): GpsHalt[] {
  const o = { ...DISCOVERY_DEFAULTS, ...opts };
  const byVehicle = new Map<string, GpsPosition[]>();
  for (const p of points) {
    if (!p.vehicleKey || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (Math.abs(p.lat) < 1e-4 && Math.abs(p.lng) < 1e-4) continue;
    const list = byVehicle.get(p.vehicleKey) ?? [];
    list.push(p);
    byVehicle.set(p.vehicleKey, list);
  }
  const halts: GpsHalt[] = [];
  for (const [vehicleKey, raw] of byVehicle) {
    const list = [...raw].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let i = 1;
    while (i < list.length - 1) {
      const start = list[i]!;
      if ((start.speedKmh ?? 0) > o.stoppedKmh) {
        i += 1;
        continue;
      }
      let j = i;
      while (
        j + 1 < list.length &&
        (list[j + 1]!.speedKmh ?? 0) <= o.stoppedKmh &&
        metres(start.lat, start.lng, list[j + 1]!.lat, list[j + 1]!.lng) <= o.haltRadiusM
      ) {
        j += 1;
      }
      const before = list[i - 1]!;
      const after = list[j + 1];
      const t = ist(start.at);
      const gapIn = (Date.parse(start.at) - Date.parse(before.at)) / 1000;
      if (
        after &&
        t &&
        (before.speedKmh ?? 0) > o.stoppedKmh &&
        (after.speedKmh ?? 0) > o.stoppedKmh &&
        gapIn <= o.maxPingGapSeconds &&
        (Date.parse(after.at) - Date.parse(list[j]!.at)) / 1000 <= o.maxPingGapSeconds &&
        t.minute >= o.dayStartMinute &&
        t.minute <= o.dayEndMinute
      ) {
        const seconds = (Date.parse(after.at) - Date.parse(start.at)) / 1000;
        const run = list.slice(i, j + 1);
        const lat = run.reduce((s, p) => s + p.lat, 0) / run.length;
        const lng = run.reduce((s, p) => s + p.lng, 0) / run.length;
        if (seconds >= o.minHaltSeconds && metres(lat, lng, school.lat, school.lng) > o.schoolRadiusM) {
          halts.push({ vehicleKey, lat, lng, day: t.day, minuteIst: t.minute, seconds: Math.round(seconds) });
        }
      }
      i = j + 1;
    }
  }
  return halts;
}

/** Same place on different days, per vehicle. Longest halts seed clusters. */
export function clusterRunHalts(halts: GpsHalt[], opts: Partial<DiscoveryOptions> = {}): GpsHaltCluster[] {
  const o = { ...DISCOVERY_DEFAULTS, ...opts };
  const groups: { vehicleKey: string; lat: number; lng: number; members: GpsHalt[] }[] = [];
  for (const h of [...halts].sort((a, b) => b.seconds - a.seconds)) {
    const hit = groups.find(
      (g) => g.vehicleKey === h.vehicleKey && metres(g.lat, g.lng, h.lat, h.lng) <= o.clusterRadiusM,
    );
    if (hit) hit.members.push(h);
    else groups.push({ vehicleKey: h.vehicleKey, lat: h.lat, lng: h.lng, members: [h] });
  }
  return groups.map((g) => {
    const morning = g.members.filter((m) => m.minuteIst < 10 * 60).map((m) => m.minuteIst);
    const later = g.members.filter((m) => m.minuteIst >= 11 * 60).map((m) => m.minuteIst);
    return {
      vehicleKey: g.vehicleKey,
      lat: g.members.reduce((s, m) => s + m.lat, 0) / g.members.length,
      lng: g.members.reduce((s, m) => s + m.lng, 0) / g.members.length,
      daysSeen: new Set(g.members.map((m) => m.day)).size,
      halts: g.members.length,
      medianSeconds: median(g.members.map((m) => m.seconds)),
      morningMinute: morning.length ? Math.round(median(morning)) : null,
      afternoonMinute: later.length ? Math.round(median(later)) : null,
    };
  });
}

/**
 * Clusters that should become stops on this vehicle's route.
 * `existing` = stops already on the vehicle's routes; `everAdded` = every
 * point this job has added before, kept or deleted.
 */
export function proposeGpsStops(input: {
  clusters: GpsHaltCluster[];
  vehicleKey: string;
  runDays: number;
  existing: StopPoint[];
  everAdded: StopPoint[];
  opts?: Partial<DiscoveryOptions>;
}): GpsHaltCluster[] {
  const o = { ...DISCOVERY_DEFAULTS, ...input.opts };
  const needDays = Math.max(o.minDays, Math.ceil(o.minShare * input.runDays));
  const blocked = [...input.existing, ...input.everAdded];
  const qualified = input.clusters
    .filter((c) => c.vehicleKey === input.vehicleKey)
    .filter((c) => c.daysSeen >= needDays && c.medianSeconds <= o.maxMedianSeconds)
    .filter((c) => blocked.every((b) => metres(c.lat, c.lng, b.lat, b.lng) > o.existingStopRadiusM))
    .sort((a, b) => b.daysSeen - a.daysSeen || b.halts - a.halts);
  const kept: GpsHaltCluster[] = [];
  for (const c of qualified) {
    if (kept.every((k) => metres(c.lat, c.lng, k.lat, k.lng) > o.mergeRadiusM)) kept.push(c);
  }
  return kept;
}

const ERRAND_TYPES = new Set(["gas_station", "car_repair", "car_wash", "car_dealer"]);
const ERRAND_WORDS = /\b(petrol|pump|fuel|cng|diesel|puc|pollution|service (centre|center)|workshop|garage|motors?)\b/i;

/** A place a vehicle goes for itself, not for a child. */
export function isVehicleErrandPlace(name: string, types: string[] = []): boolean {
  return types.some((t) => ERRAND_TYPES.has(t)) || ERRAND_WORDS.test(name);
}

const hhmm = (m: number | null) =>
  m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The stop's note. Must start with GPS_STOP_NOTE_PREFIX — that is what marks it "Actual · GPS". */
export function gpsStopNote(c: GpsHaltCluster, vehicleName: string, runDays: number, onDate: string, place?: string): string {
  const when = [
    c.morningMinute != null ? `usually about ${hhmm(c.morningMinute)} in the morning` : "",
    c.afternoonMinute != null ? `${hhmm(c.afternoonMinute)} in the afternoon` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    `${GPS_STOP_NOTE_PREFIX} ${vehicleName} stops here on ${c.daysSeen} of ${runDays} school days` +
    (when ? ` (${when})` : "") +
    `. Added automatically on ${onDate} for the office to assign boarders. Not priced yet.` +
    (place ? ` Google: ${place}` : "")
  );
}

/**
 * Put a new stop after the existing stop nearest to it and renumber 1..n.
 * Order is otherwise untouched.
 */
export function insertAfterNearest<T extends { sequence: number; geoLat?: number; geoLng?: number }>(
  stops: T[],
  added: T,
): T[] {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  let at = ordered.length;
  let best = Infinity;
  ordered.forEach((s, idx) => {
    if (!Number.isFinite(s.geoLat) || !Number.isFinite(s.geoLng)) return;
    const m = metres(Number(added.geoLat), Number(added.geoLng), Number(s.geoLat), Number(s.geoLng));
    if (m < best) {
      best = m;
      at = idx + 1;
    }
  });
  ordered.splice(at, 0, added);
  return ordered.map((s, idx) => ({ ...s, sequence: idx + 1 }));
}
