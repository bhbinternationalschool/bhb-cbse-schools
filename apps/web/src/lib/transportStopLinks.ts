/**
 * Broken stop links — detection, evidence, and repair.
 *
 * An assignment names its stop by id. When a route's stops are re-created —
 * a re-import, a rebuild, an edit that regenerates ids — every assignment
 * pointing at the old ids is orphaned. On 2026-08-23 all 124 live assignments
 * on this school's five buses were in that state: the routes were healthy,
 * all 47 stops measured and pinned, and not one rider resolved to a stop.
 *
 * That fault is quiet in the worst way. A missing stop means no distance,
 * no distance means no fee benchmark, and the roster reported a confident
 * ₹0 shortfall for every rider on every bus rather than admitting it could
 * not tell. It also emptied the driver's manifest, which groups children by
 * stop. One broken foreign key, and the module's three main jobs — bill
 * correctly, plan routes, hand the driver a list — all silently produced
 * plausible nonsense.
 *
 * So: detect it explicitly, describe it in the office's own terms, and
 * repair it a group at a time with a person confirming each one. The riders
 * sharing an orphaned id were together at a real stop; that grouping is
 * evidence and is preserved. Which stop it was is NOT evidence, and this
 * module never decides it alone — `suggestStopsForGroup` ranks candidates
 * and shows its reasoning, and `relinkStopGroup` only ever applies a choice
 * someone made.
 */

import {
  haversineKm,
  loadTransport,
  saveTransport,
  type TransportRoute,
  type TransportState,
  type TransportStop,
} from "@/lib/transport";
import type { StudentTransportProfile } from "@/lib/transportPlanner";

export type BrokenStopGroup = {
  routeId: string;
  routeCode: string;
  routeLabel: string;
  /** The orphaned id itself. Meaningless as a name, but it groups the riders. */
  orphanStopId: string;
  studentIds: string[];
  riderCount: number;
  /** Distinct monthly fees among these riders, in paise, ascending. */
  feesPaise: number[];
  /** Households with a map pin, used to rank candidate stops. */
  geoCount: number;
  centroid: { lat: number; lng: number } | null;
};

export type BrokenLinkReport = {
  groups: BrokenStopGroup[];
  ridersAffected: number;
  routesAffected: number;
  /** Riders whose stop resolves normally. */
  ridersHealthy: number;
};

export type StopCandidate = {
  stop: TransportStop;
  /** Km from the group's household centroid, null when nothing is pinned. */
  distanceKm: number | null;
  /** True when this stop's price equals a fee the group already pays. */
  feeMatches: boolean;
  /** Plain-language reason, shown next to the option. */
  reason: string;
};

function feeOf(a: { monthlyFeePaise?: number }): number {
  return Math.max(0, Number(a.monthlyFeePaise) || 0);
}

/**
 * Every rider whose stopId names no stop on their own route.
 *
 * Scoped to live assignments — an ended assignment pointing at a deleted stop
 * is history, not a problem to fix, and listing it would bury the ones that
 * still bill someone every month.
 */
export function findBrokenStopLinks(
  state: TransportState,
  profiles: StudentTransportProfile[],
): BrokenLinkReport {
  const routeById = new Map<string, TransportRoute>(
    state.routes.map((r) => [r.id, r]),
  );
  const geoByStudent = new Map(
    profiles.map((p) => [
      p.studentId,
      p.hasGeo && p.geoLat != null && p.geoLng != null
        ? { lat: p.geoLat, lng: p.geoLng }
        : null,
    ]),
  );

  const buckets = new Map<string, BrokenStopGroup>();
  let healthy = 0;

  for (const a of state.assignments) {
    if (a.effectiveTo != null) continue;
    const route = routeById.get(a.routeId);
    if (!route) continue;
    const stopId = String(a.stopId ?? "").trim();
    if (stopId && route.stops.some((s) => s.id === stopId)) {
      healthy += 1;
      continue;
    }

    // Blank and orphaned are both "no stop", but they read differently to the
    // office: one was never set, the other pointed somewhere that is gone.
    const key = `${route.id}::${stopId || "(blank)"}`;
    let g = buckets.get(key);
    if (!g) {
      g = {
        routeId: route.id,
        routeCode: route.code,
        routeLabel: route.busNo || route.code,
        orphanStopId: stopId,
        studentIds: [],
        riderCount: 0,
        feesPaise: [],
        geoCount: 0,
        centroid: null,
      };
      buckets.set(key, g);
    }
    g.studentIds.push(a.studentId);
    g.riderCount += 1;
    const fee = feeOf(a);
    if (fee > 0 && !g.feesPaise.includes(fee)) g.feesPaise.push(fee);
  }

  const groups = [...buckets.values()].map((g) => {
    const pins = g.studentIds
      .map((id) => geoByStudent.get(id) ?? null)
      .filter((p): p is { lat: number; lng: number } => p != null);
    g.geoCount = pins.length;
    // A centroid of one pin is that pin; of none, nothing. Averaging is only
    // ever used to RANK suggestions, never to assert where a stop is.
    g.centroid = pins.length
      ? {
          lat: pins.reduce((n, p) => n + p.lat, 0) / pins.length,
          lng: pins.reduce((n, p) => n + p.lng, 0) / pins.length,
        }
      : null;
    g.feesPaise.sort((a, b) => a - b);
    return g;
  });

  groups.sort(
    (a, b) =>
      a.routeLabel.localeCompare(b.routeLabel) || b.riderCount - a.riderCount,
  );

  return {
    groups,
    ridersAffected: groups.reduce((n, g) => n + g.riderCount, 0),
    routesAffected: new Set(groups.map((g) => g.routeId)).size,
    ridersHealthy: healthy,
  };
}

/**
 * Candidate stops for one orphaned group, best first.
 *
 * Ranked on two pieces of evidence that actually exist: how far the stop is
 * from where these families live, and whether the stop's price matches what
 * they are already being charged. Both are shown, so the office can see why
 * a suggestion is on top and overrule it — a family may live near one stop
 * and walk to another, and only they know that.
 *
 * Stops with no measured distance still appear; they are simply unranked.
 * Hiding them would make an unmeasured stop look like a stop that does not
 * exist, which is how this whole mess reads to begin with.
 */
export function suggestStopsForGroup(
  group: BrokenStopGroup,
  route: TransportRoute,
): StopCandidate[] {
  const stops = [...route.stops].sort((a, b) => a.sequence - b.sequence);

  const scored = stops.map((stop) => {
    const pinned = stop.geoLat != null && stop.geoLng != null;
    const distanceKm =
      group.centroid && pinned
        ? Math.round(
            haversineKm(
              group.centroid.lat,
              group.centroid.lng,
              stop.geoLat as number,
              stop.geoLng as number,
            ) * 10,
          ) / 10
        : null;
    const price = Math.max(0, Number(stop.monthlyFeePaise) || 0);
    const feeMatches = price > 0 && group.feesPaise.includes(price);

    const bits: string[] = [];
    if (distanceKm != null) {
      bits.push(`${distanceKm} km from where these families live`);
    } else if (!pinned) {
      bits.push("stop not pinned on the map");
    } else {
      bits.push("no household pins to compare");
    }
    if (feeMatches) bits.push(`price ₹${price / 100} matches what they pay`);

    return { stop, distanceKm, feeMatches, reason: bits.join(" · ") };
  });

  return scored.sort((a, b) => {
    if (a.feeMatches !== b.feeMatches) return a.feeMatches ? -1 : 1;
    if (a.distanceKm == null && b.distanceKm == null) return 0;
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

export type RelinkResult =
  | { ok: true; relinked: number }
  | { ok: false; error: string };

/**
 * Point one orphaned group at a real stop.
 *
 * Edits the existing assignments in place rather than ending them and
 * creating new ones: nobody changed bus, changed stop, or started riding
 * today — a clerical link is being restored, and rewriting effectiveFrom
 * would tell the fee engine that 124 children joined in August and rebill
 * them accordingly.
 *
 * The fee is left exactly as it is, for the same reason. Re-deriving it from
 * the newly linked stop would silently rewrite what families are charged on
 * the strength of a mapping someone just guessed at. The shortfall column
 * exists to show that gap; the office can then change a fee deliberately.
 */
export type RelinkInput = {
  routeId: string;
  orphanStopId: string;
  toStopId: string;
  studentIds?: string[];
};

/**
 * The repair itself, as a pure function of state — so the invariant that
 * matters (fee and start date untouched) can be tested without a browser.
 */
export function planStopRelink(
  state: TransportState,
  input: RelinkInput,
):
  | { ok: true; relinked: number; assignments: TransportState["assignments"] }
  | { ok: false; error: string } {
  const route = state.routes.find((r) => r.id === input.routeId);
  if (!route) return { ok: false, error: "Route not found" };
  if (!route.stops.some((s) => s.id === input.toStopId)) {
    return { ok: false, error: "Pick a stop on this route" };
  }

  const only = input.studentIds?.length ? new Set(input.studentIds) : null;
  const orphan = String(input.orphanStopId ?? "").trim();

  let relinked = 0;
  const assignments = state.assignments.map((a) => {
    if (a.effectiveTo != null) return a;
    if (a.routeId !== input.routeId) return a;
    if (String(a.stopId ?? "").trim() !== orphan) return a;
    if (only && !only.has(a.studentId)) return a;
    relinked += 1;
    // Only stopId. Spreading the original keeps monthlyFeePaise,
    // effectiveFrom, serviceMode and the rest exactly as they were.
    return { ...a, stopId: input.toStopId };
  });

  if (relinked === 0) {
    return { ok: false, error: "Nothing matched — the list may be out of date" };
  }
  return { ok: true, relinked, assignments };
}

export function relinkStopGroup(input: RelinkInput): RelinkResult {
  const state = loadTransport();
  const planned = planStopRelink(state, input);
  if (!planned.ok) return planned;
  saveTransport({ ...state, assignments: planned.assignments });
  return { ok: true, relinked: planned.relinked };
}
