/**
 * Transport route planner — SIS address → stop/route suggestions,
 * vehicle alignment, and mid-year assignment previews.
 */

import { DEFAULT_AY, type MastersState } from "@/lib/masters";
import type { SisState, SisStudent } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { householdHasGeo } from "@/lib/mapsGeocode";
import {
  alignVehiclesToRoutes,
  computeTransportPeriodDues,
  expectedMonthlyFeePaise,
  haversineKm,
  applyServiceMode,
  listActiveRoutes,
  stopHasGeo,
  type StopDistanceSource,
  type TransportServiceMode,
  type TransportAssignment,
  type TransportRoute,
  type TransportState,
  type TransportStop,
} from "@/lib/transport";

/** BHB campus — geocoded via Google Maps (Distance Matrix / Geocoding). */
export const SCHOOL_GEO = {
  lat: TENANT.schoolLat,
  lng: TENANT.schoolLng,
  label: `${TENANT.name}, ${TENANT.city}`,
  address: TENANT.schoolAddress,
};

export type StudentTransportProfile = {
  studentId: string;
  fullName: string;
  admissionNo: string;
  classLabel: string;
  householdId: string;
  addressLine: string;
  locality: string;
  landmark: string;
  pincode: string;
  academicYearCode: string;
  hasAssignment: boolean;
  assignment?: TransportAssignment;
  routeCode?: string;
  geoLat?: number;
  geoLng?: number;
  hasGeo: boolean;
};

export type RouteStopSuggestion = {
  routeId: string;
  routeCode: string;
  routeName: string;
  stopId: string;
  stopName: string;
  distanceKm: number;
  matchScore: number;
  monthlyFeePaise: number;
  vehicleId: string;
  busNo: string;
  vehicleReg: string;
  vehiclePhotoUrl: string;
  riderCount: number;
  seatCapacity: number;
};

export type RouteClusterRow = {
  routeId: string;
  routeCode: string;
  routeName: string;
  busNo: string;
  vehicleReg: string;
  vehicleId: string;
  riderCount: number;
  seatCapacity: number;
  unassignedNearby: StudentTransportProfile[];
  suggestedAdds: string[];
};

export type AssignmentMonthPreview = {
  periodKey: string;
  periodLabel: string;
  dueOn: string;
  amountPaise: number;
  billable: boolean;
};

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function matchScore(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) {
    if (tb.has(t)) hit += 1;
  }
  for (const t of tb) {
    if (a.toLowerCase().includes(t) || b.toLowerCase().includes(t)) hit += 0.5;
  }
  return Math.min(100, Math.round((hit / Math.max(ta.size, tb.size)) * 100));
}

function studentAddressBlob(
  student: SisStudent,
  household?: { address?: string; locality?: string; landmark?: string; pincode?: string },
): string {
  return [
    household?.address,
    household?.locality,
    household?.landmark,
    household?.pincode,
    student.permanentAddress,
    student.permanentPincode,
    student.transportRoute,
  ]
    .filter(Boolean)
    .join(" ");
}

function activeAssignment(
  studentId: string,
  ay: string,
  state: TransportState,
): TransportAssignment | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return state.assignments.find(
    (a) =>
      a.studentId === studentId &&
      a.academicYearCode === ay &&
      a.effectiveFrom <= today &&
      (!a.effectiveTo || a.effectiveTo >= today),
  );
}

export function buildStudentTransportProfiles(
  sis: SisState,
  masters: MastersState,
  transport: TransportState,
  academicYearCode?: string,
): StudentTransportProfile[] {
  const ay = academicYearCode || DEFAULT_AY;
  const hhMap = new Map(sis.households.map((h) => [h.id, h]));
  const classMap = new Map(masters.classes.map((c) => [c.id, c.name]));

  return sis.students
    .filter((s) => s.status === "active" && (!ay || s.academicYearCode === ay))
    .map((student) => {
      const hh = hhMap.get(student.householdId);
      const asg = activeAssignment(student.id, ay, transport);
      const route = asg
        ? transport.routes.find((r) => r.id === asg.routeId)
        : undefined;
      return {
        studentId: student.id,
        fullName: student.fullName,
        admissionNo: student.admissionNo,
        classLabel: classMap.get(student.classId || "") || "—",
        householdId: student.householdId,
        addressLine: studentAddressBlob(student, hh),
        locality: hh?.locality || "",
        landmark: hh?.landmark || "",
        pincode: hh?.pincode || student.permanentPincode || "",
        academicYearCode: student.academicYearCode || ay,
        hasAssignment: Boolean(asg),
        assignment: asg,
        routeCode: route?.code,
        geoLat: hh && householdHasGeo(hh) ? hh.geoLat : undefined,
        geoLng: hh && householdHasGeo(hh) ? hh.geoLng : undefined,
        hasGeo: Boolean(hh && householdHasGeo(hh)),
      };
    });
}

export type SiblingTransportGap = {
  householdId: string;
  /** Guardian or father's name — how the front desk refers to the family. */
  householdLabel: string;
  riders: {
    studentId: string;
    fullName: string;
    classLabel: string;
    routeLabel: string;
  }[];
  nonRiders: { studentId: string; fullName: string; classLabel: string }[];
  /** True when the riding siblings are not all on the same bus. */
  splitAcrossRoutes: boolean;
};

/**
 * Households where somebody rides the bus and somebody does not.
 *
 * Two different things fall out of the same query. A family with one child on
 * the bus and one walking is a sales prompt. Siblings on *different* buses is
 * almost always a data-entry mistake, since the same house cannot be on two
 * catchments — so that case is flagged separately rather than buried.
 *
 * Deliberately deterministic: this is a grouping over `householdId`, and there
 * is nothing here for a model to infer.
 */
export function findSiblingTransportGaps(
  profiles: StudentTransportProfile[],
  state: TransportState,
  householdLabels?: Map<string, string>,
): SiblingTransportGap[] {
  const byHousehold = new Map<string, StudentTransportProfile[]>();
  for (const p of profiles) {
    if (!p.householdId) continue;
    const list = byHousehold.get(p.householdId);
    if (list) list.push(p);
    else byHousehold.set(p.householdId, [p]);
  }

  const out: SiblingTransportGap[] = [];
  for (const [householdId, members] of byHousehold) {
    if (members.length < 2) continue;
    const riders = members.filter((m) => m.hasAssignment);
    const nonRiders = members.filter((m) => !m.hasAssignment);
    if (riders.length === 0 || nonRiders.length === 0) continue;

    const riderRows = riders.map((m) => {
      const route = m.assignment
        ? state.routes.find((r) => r.id === m.assignment?.routeId)
        : undefined;
      const stop = route?.stops.find((st) => st.id === m.assignment?.stopId);
      return {
        studentId: m.studentId,
        fullName: m.fullName,
        classLabel: m.classLabel,
        routeLabel:
          [route?.busNo || route?.code, stop?.name].filter(Boolean).join(" · ") ||
          "a bus",
      };
    });

    const routeIds = new Set(
      riders.map((m) => m.assignment?.routeId).filter(Boolean),
    );

    out.push({
      householdId,
      householdLabel: householdLabels?.get(householdId) || "",
      riders: riderRows,
      nonRiders: nonRiders.map((m) => ({
        studentId: m.studentId,
        fullName: m.fullName,
        classLabel: m.classLabel,
      })),
      splitAcrossRoutes: routeIds.size > 1,
    });
  }

  // Split families first — those are errors, not opportunities — then the
  // households with the most children left off the bus.
  return out.sort((a, b) => {
    if (a.splitAcrossRoutes !== b.splitAcrossRoutes) {
      return a.splitAcrossRoutes ? -1 : 1;
    }
    return b.nonRiders.length - a.nonRiders.length;
  });
}

export function ridersOnRoute(state: TransportState, routeId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return state.assignments.filter(
    (a) =>
      a.routeId === routeId &&
      a.effectiveFrom <= today &&
      (!a.effectiveTo || a.effectiveTo >= today),
  ).length;
}

function vehicleForRoute(
  route: TransportRoute,
  state: TransportState,
): {
  vehicleId: string;
  busNo: string;
  vehicleReg: string;
  photoUrl: string;
  seatCapacity: number;
} {
  const veh = route.vehicleId
    ? state.vehicles.find((v) => v.id === route.vehicleId)
    : state.vehicles.find((v) => v.primaryRouteId === route.id);
  return {
    vehicleId: veh?.id || route.vehicleId || "",
    busNo: route.busNo || veh?.name || "",
    vehicleReg: route.vehicleReg || veh?.registrationNo || "",
    photoUrl: veh?.photoUrl || "",
    seatCapacity: veh?.seatCapacity || 40,
  };
}

export function suggestRoutesForStudent(
  profile: StudentTransportProfile,
  state: TransportState,
  limit = 5,
): RouteStopSuggestion[] {
  const blob = profile.addressLine;
  const routes = listActiveRoutes(state);
  const scored: RouteStopSuggestion[] = [];

  for (const route of routes) {
    for (const stop of route.stops) {
      const stopText = `${stop.name} ${route.name} ${route.code}`;
      const localityScore = matchScore(blob, stopText);
      const pinScore = profile.pincode && stopText.includes(profile.pincode) ? 25 : 0;
      const landmarkScore = profile.landmark
        ? matchScore(profile.landmark, stop.name) * 0.6
        : 0;
      const score = Math.min(100, Math.round(localityScore + pinScore + landmarkScore));
      if (score < 8 && !profile.locality) continue;

      const veh = vehicleForRoute(route, state);
      const fee = expectedMonthlyFeePaise(route, stop, state.feePolicy);
      scored.push({
        routeId: route.id,
        routeCode: route.code,
        routeName: route.name,
        stopId: stop.id,
        stopName: stop.name,
        distanceKm: stop.distanceKm || 0,
        matchScore: score,
        monthlyFeePaise: fee,
        vehicleId: veh.vehicleId,
        busNo: veh.busNo,
        vehicleReg: veh.vehicleReg,
        vehiclePhotoUrl: veh.photoUrl,
        riderCount: ridersOnRoute(state, route.id),
        seatCapacity: veh.seatCapacity,
      });
    }
  }

  return scored
    .sort((a, b) => b.matchScore - a.matchScore || a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

export function listUnassignedStudents(
  profiles: StudentTransportProfile[],
): StudentTransportProfile[] {
  return profiles.filter((p) => !p.hasAssignment);
}

export function buildRouteClusters(
  state: TransportState,
  profiles: StudentTransportProfile[],
): RouteClusterRow[] {
  const unassigned = listUnassignedStudents(profiles);
  return listActiveRoutes(state).map((route) => {
    const veh = vehicleForRoute(route, state);
    const riders = ridersOnRoute(state, route.id);
    const nearby = unassigned
      .map((p) => ({
        profile: p,
        suggestion: suggestRoutesForStudent(p, state, 1)[0],
      }))
      .filter((x) => x.suggestion?.routeId === route.id)
      .sort((a, b) => (b.suggestion?.matchScore ?? 0) - (a.suggestion?.matchScore ?? 0))
      .slice(0, 8)
      .map((x) => x.profile);

    const seatsLeft = Math.max(0, veh.seatCapacity - riders);
    return {
      routeId: route.id,
      routeCode: route.code,
      routeName: route.name,
      busNo: veh.busNo,
      vehicleReg: veh.vehicleReg,
      vehicleId: veh.vehicleId,
      riderCount: riders,
      seatCapacity: veh.seatCapacity,
      unassignedNearby: nearby,
      suggestedAdds: nearby.slice(0, seatsLeft).map((p) => p.studentId),
    };
  });
}

export { alignVehiclesToRoutes } from "@/lib/transport";

export function previewAssignmentMonths(
  input: {
    studentId: string;
    householdId: string;
    routeId: string;
    stopId: string;
    effectiveFrom: string;
    academicYearCode: string;
    monthlyFeePaise?: number;
  },
  state: TransportState,
): AssignmentMonthPreview[] {
  const probe: TransportAssignment = {
    id: "preview",
    studentId: input.studentId,
    householdId: input.householdId,
    routeId: input.routeId,
    stopId: input.stopId,
    academicYearCode: input.academicYearCode,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    monthlyFeePaise: input.monthlyFeePaise ?? 0,
    feeOverrideReason: "",
    boardingSuspended: false,
    createdAt: new Date().toISOString(),
  };
  const dues = computeTransportPeriodDues(input.studentId, {
    academicYearCode: input.academicYearCode,
    includeFuture: true,
    state: {
      ...state,
      assignments: [...state.assignments, probe],
    },
  });
  const fromKey = input.effectiveFrom.slice(0, 7);
  return dues
    .filter((d) => d.periodKey >= fromKey)
    .map((d) => ({
      periodKey: d.periodKey,
      periodLabel: d.periodLabel,
      dueOn: d.dueOn,
      amountPaise: d.amountPaise,
      billable: true,
    }));
}

export function formatAddressForMaps(profile: StudentTransportProfile): string {
  if (profile.hasGeo && profile.geoLat != null && profile.geoLng != null) {
    return `${profile.geoLat},${profile.geoLng}`;
  }
  const parts = [
    profile.addressLine,
    profile.locality,
    profile.landmark,
    profile.pincode,
    TENANT.city,
    TENANT.state,
  ].filter(Boolean);
  return parts.join(", ");
}

export async function fetchRoadDistanceKm(
  origin: string,
  destination: string = SCHOOL_GEO.address,
  originLatLng?: { lat: number; lng: number },
): Promise<{ km: number; source: "google" | "estimate" }> {
  try {
    const q = new URLSearchParams({ origin, destination });
    if (originLatLng) {
      q.set("originLat", String(originLatLng.lat));
      q.set("originLng", String(originLatLng.lng));
    }
    const res = await fetch(`/api/maps/road-distance?${q}`);
    if (!res.ok) throw new Error("distance api failed");
    const data = (await res.json()) as { km?: number; source?: string };
    if (typeof data.km === "number" && data.km > 0) {
      return { km: data.km, source: data.source === "google" ? "google" : "estimate" };
    }
  } catch {
    /* fallback */
  }
  return { km: 5, source: "estimate" };
}

/**
 * Road distance from campus to a stop, or `null` when Google cannot say.
 *
 * Deliberately separate from `fetchRoadDistanceKm`, which falls back to an
 * estimate. A stop's distance sets what every family at that stop is billed,
 * so an estimate here would become an invoice. No answer is the correct answer
 * when the road network cannot be measured.
 */
export async function fetchStopRoadDistanceKm(input: {
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
}): Promise<
  { ok: true; km: number } | { ok: false; error: string }
> {
  const hasLatLng =
    typeof input.lat === "number" &&
    typeof input.lng === "number" &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng);
  if (!hasLatLng && !input.address?.trim()) {
    return { ok: false, error: "Pick the stop on the map first" };
  }
  const q = new URLSearchParams({ strict: "1" });
  if (hasLatLng) {
    q.set("originLat", String(input.lat));
    q.set("originLng", String(input.lng));
    q.set("origin", input.address?.trim() || `${input.lat},${input.lng}`);
  } else {
    q.set("origin", input.address!.trim());
  }
  try {
    const res = await fetch(`/api/maps/road-distance?${q}`);
    const data = (await res.json()) as {
      km?: number | null;
      source?: string;
      error?: string;
    };
    if (data.source === "google" && typeof data.km === "number" && data.km > 0) {
      return { ok: true, km: Math.round(data.km * 10) / 10 };
    }
    return {
      ok: false,
      error: data.error || "Google returned no road distance",
    };
  } catch {
    return { ok: false, error: "Could not reach the distance service" };
  }
}

/* ── Nearest stops to a point ──────────────────────────────── */

export type RankedStop = {
  routeId: string;
  routeCode: string;
  routeLabel: string;
  stopId: string;
  stopName: string;
  /** Straight-line km from the point being searched from. */
  fromPointKm: number;
  /** Road km from campus — what the fee is worked out on. */
  distanceFromSchoolKm: number;
  monthlyFeePaise: number;
  seatsLeft: number;
};

export type NearestStops = {
  ranked: RankedStop[];
  /** Stops that carry no coordinates, so they cannot be ranked at all. */
  unpinned: { routeId: string; routeLabel: string; stopId: string; stopName: string }[];
};

/**
 * Every mapped stop, ordered by how close it is to a point.
 *
 * The point is normally the child's home; the stop picker also lets a clerk
 * type a village or locality and rank from there instead, which is what you
 * want when the household has never been geocoded.
 *
 * Unpinned stops are returned separately rather than sorted to the end. A stop
 * with no coordinates is not "far away" — its distance is unknown, and putting
 * it in the ranked list at any position would state something untrue.
 */
export function rankStopsNearPoint(
  state: TransportState,
  point: { lat: number; lng: number },
  opts?: { limit?: number; withinKm?: number },
): NearestStops {
  const ranked: RankedStop[] = [];
  const unpinned: NearestStops["unpinned"] = [];

  for (const route of listActiveRoutes(state)) {
    const routeLabel = route.busNo || route.code;
    const veh = vehicleForRoute(route, state);
    const seatsLeft = Math.max(0, veh.seatCapacity - ridersOnRoute(state, route.id));

    for (const stop of route.stops) {
      if (!stopHasGeo(stop)) {
        unpinned.push({
          routeId: route.id,
          routeLabel,
          stopId: stop.id,
          stopName: stop.name,
        });
        continue;
      }
      const km = haversineKm(point.lat, point.lng, stop.geoLat!, stop.geoLng!);
      if (opts?.withinKm != null && km > opts.withinKm) continue;
      ranked.push({
        routeId: route.id,
        routeCode: route.code,
        routeLabel,
        stopId: stop.id,
        stopName: stop.name,
        fromPointKm: Math.round(km * 10) / 10,
        distanceFromSchoolKm: stop.distanceKm,
        monthlyFeePaise: expectedMonthlyFeePaise(route, stop, state.feePolicy),
        seatsLeft,
      });
    }
  }

  ranked.sort(
    (a, b) => a.fromPointKm - b.fromPointKm || a.stopName.localeCompare(b.stopName),
  );

  return {
    ranked: opts?.limit ? ranked.slice(0, opts.limit) : ranked,
    unpinned,
  };
}

/**
 * The distance rule, applied to every rider regardless of how they are billed.
 *
 * ₹500 covers the first 5 km; beyond that ₹100 for each started kilometre, so
 * 5.4 km benchmarks at ₹600 and 8.1 km at ₹900. Whole rupees, no decimals —
 * this is read off a screen and argued about, not accounted to the paisa.
 *
 * This is a yardstick, NOT the billing rule. Stops inside a band are priced
 * per stop and a rider may legitimately sit below the benchmark on a
 * concession. Its job is to show where money is not being collected, so the
 * office can decide whether each gap is deliberate.
 *
 * Returns 0 when the distance is unknown — an unmeasured stop cannot produce a
 * shortfall, and inventing one would send the office chasing a family over a
 * blank field.
 */
export function distanceBenchmarkPaise(
  km: number,
  policy?: { formula?: { basePaise: number; baseCoversKm: number; perKmPaise: number } },
): number {
  if (!km || km <= 0) return 0;
  const f = policy?.formula ?? {
    basePaise: 50000,
    baseCoversKm: 5,
    perKmPaise: 10000,
  };
  const beyond = Math.max(0, Math.ceil(km - f.baseCoversKm));
  return f.basePaise + beyond * f.perKmPaise;
}

/* ── Point 3: who is on each bus ───────────────────────────── */

export type FleetRiderRow = {
  studentId: string;
  fullName: string;
  classLabel: string;
  fatherName: string;
  householdId: string;
  stopName: string;
  distanceKm: number;
  distanceSource: StopDistanceSource;
  monthlyFeePaise: number;
  serviceMode: TransportServiceMode;
  /** True when the fee differs from what the policy would charge. */
  feeOverridden: boolean;
  /**
   * What the plain distance rule says this rider should pay: ₹500 covering the
   * first 5 km, then ₹100 for every started km after that.
   */
  benchmarkPaise: number;
  /** benchmark − charged, floored at 0. The money not being collected. */
  shortfallPaise: number;
  effectiveFrom: string;
  boardingSuspended: boolean;
  /** Sibling on the same bus — useful when the conductor calls the roll. */
  siblingOnBoard: boolean;
};

export type FleetRosterRow = {
  routeId: string;
  routeCode: string;
  routeName: string;
  busNo: string;
  vehicleReg: string;
  seatCapacity: number;
  crewLabel: string;
  stops: { id: string; name: string; distanceKm: number; pinned: boolean }[];
  riders: FleetRiderRow[];
  monthlyTotalPaise: number;
  /** Riders whose monthly fee is zero — on the bus, billed nothing. */
  unbilledRiders: number;
  /** Total monthly gap against the distance rule across this bus. */
  shortfallTotalPaise: number;
  ridersWithShortfall: number;
};

/**
 * One roster per bus: who rides it, from which stop, at what fee.
 *
 * `ridersOnRoute` only ever returned a count, so nobody could see the list —
 * which is also why fee leakage was invisible. `unbilledRiders` counts riders
 * carrying a zero monthly fee: on the vehicle, billed nothing.
 */
export function buildFleetRosters(
  state: TransportState,
  profiles: StudentTransportProfile[],
  fatherNameByStudent?: Map<string, string>,
  crewLabelByRoute?: Map<string, string>,
): FleetRosterRow[] {
  const byRoute = new Map<string, StudentTransportProfile[]>();
  for (const p of profiles) {
    if (!p.hasAssignment || !p.assignment) continue;
    const list = byRoute.get(p.assignment.routeId);
    if (list) list.push(p);
    else byRoute.set(p.assignment.routeId, [p]);
  }

  return listActiveRoutes(state).map((route) => {
    const veh = vehicleForRoute(route, state);
    const members = byRoute.get(route.id) ?? [];

    const householdCounts = new Map<string, number>();
    for (const p of members) {
      householdCounts.set(
        p.householdId,
        (householdCounts.get(p.householdId) ?? 0) + 1,
      );
    }

    const riders: FleetRiderRow[] = members
      .map((p) => {
        const asg = p.assignment!;
        const stop = route.stops.find((s) => s.id === asg.stopId);
        const expected = expectedMonthlyFeePaise(route, stop, state.feePolicy);
        const fullFee = asg.monthlyFeePaise > 0 ? asg.monthlyFeePaise : expected;
        const fee = applyServiceMode(fullFee, asg.serviceMode);
        const km = stop?.distanceKm ?? 0;
        // The benchmark halves with the service too. Without that, every
        // pick-up-only rider would show a permanent shortfall for money the
        // school never intended to charge.
        const benchmark = applyServiceMode(
          distanceBenchmarkPaise(km, state.feePolicy),
          asg.serviceMode,
        );
        return {
          studentId: p.studentId,
          fullName: p.fullName,
          classLabel: p.classLabel,
          fatherName: fatherNameByStudent?.get(p.studentId) || "",
          householdId: p.householdId,
          stopName: stop?.name || "—",
          distanceKm: km,
          distanceSource: stop?.distanceSource ?? "",
          monthlyFeePaise: fee,
          serviceMode: asg.serviceMode ?? "both",
          benchmarkPaise: benchmark,
          // Only a genuine gap counts. A rider paying above the benchmark is
          // not a negative shortfall, and showing one would read as a refund.
          shortfallPaise: benchmark > 0 ? Math.max(0, benchmark - fee) : 0,
          feeOverridden: asg.monthlyFeePaise > 0 && asg.monthlyFeePaise !== expected,
          effectiveFrom: asg.effectiveFrom,
          boardingSuspended: asg.boardingSuspended,
          siblingOnBoard: (householdCounts.get(p.householdId) ?? 0) > 1,
        };
      })
      // Stop order first, then name — this is read off the bus in boarding
      // sequence, not alphabetically across the whole route.
      .sort((a, b) => {
        const sa = route.stops.findIndex((s) => s.name === a.stopName);
        const sb = route.stops.findIndex((s) => s.name === b.stopName);
        if (sa !== sb) return sa - sb;
        return a.fullName.localeCompare(b.fullName);
      });

    return {
      routeId: route.id,
      routeCode: route.code,
      routeName: route.name,
      busNo: veh.busNo,
      vehicleReg: veh.vehicleReg,
      seatCapacity: veh.seatCapacity,
      crewLabel: crewLabelByRoute?.get(route.id) || "",
      stops: route.stops.map((s) => ({
        id: s.id,
        name: s.name,
        distanceKm: s.distanceKm,
        pinned: stopHasGeo(s),
      })),
      riders,
      monthlyTotalPaise: riders.reduce((sum, r) => sum + r.monthlyFeePaise, 0),
      unbilledRiders: riders.filter((r) => r.monthlyFeePaise <= 0).length,
      shortfallTotalPaise: riders.reduce((sum, r) => sum + r.shortfallPaise, 0),
      ridersWithShortfall: riders.filter((r) => r.shortfallPaise > 0).length,
    };
  });
}

/* ── Point 6: riders who are not on their nearest bus ──────── */

export type MisroutedRider = {
  studentId: string;
  fullName: string;
  classLabel: string;
  householdId: string;
  currentRouteId: string;
  currentRouteLabel: string;
  currentStopName: string;
  currentStopKm: number;
  betterRouteId: string;
  betterRouteLabel: string;
  betterStopName: string;
  betterStopKm: number;
  /** How much closer the child's home is to the suggested stop. */
  savingKm: number;
};

/**
 * Riders whose home sits closer to a stop on a *different* route.
 *
 * Straight-line distance from the house to the boarding point, which is what
 * the walk to the stop actually is — road distance is the right measure from
 * campus to stop (that is what gets billed), but not for the last 500 metres.
 *
 * Only riders whose household AND assigned stop both carry coordinates are
 * considered. A stop nobody has pinned yet cannot be compared, and guessing
 * would move a child onto a different bus on the strength of a blank field.
 *
 * Never auto-reassigns. Route changes have reasons the system cannot see —
 * an aunt on the route, a sibling at another school, a road the family will
 * not cross — so this produces a list for a human to approve.
 */
export function findMisroutedRiders(
  profiles: StudentTransportProfile[],
  state: TransportState,
  opts?: { minSavingKm?: number },
): MisroutedRider[] {
  const minSaving = opts?.minSavingKm ?? 1.5;
  const routes = listActiveRoutes(state);

  const pinnedStops: {
    routeId: string;
    routeLabel: string;
    stop: TransportStop;
  }[] = [];
  for (const route of routes) {
    for (const stop of route.stops) {
      if (!stopHasGeo(stop)) continue;
      pinnedStops.push({
        routeId: route.id,
        routeLabel: route.busNo || route.code,
        stop,
      });
    }
  }
  if (pinnedStops.length === 0) return [];

  const out: MisroutedRider[] = [];
  for (const p of profiles) {
    if (!p.hasAssignment || !p.assignment) continue;
    if (!p.hasGeo || p.geoLat == null || p.geoLng == null) continue;

    const current = pinnedStops.find(
      (x) =>
        x.routeId === p.assignment?.routeId &&
        x.stop.id === p.assignment?.stopId,
    );
    if (!current) continue; // assigned stop not pinned — nothing to compare

    const currentKm = haversineKm(
      p.geoLat,
      p.geoLng,
      current.stop.geoLat!,
      current.stop.geoLng!,
    );

    let best = current;
    let bestKm = currentKm;
    for (const cand of pinnedStops) {
      const km = haversineKm(
        p.geoLat,
        p.geoLng,
        cand.stop.geoLat!,
        cand.stop.geoLng!,
      );
      if (km < bestKm) {
        best = cand;
        bestKm = km;
      }
    }

    // A closer stop on the same bus is a stop change, not a wrong vehicle.
    if (best.routeId === current.routeId) continue;
    const saving = currentKm - bestKm;
    if (saving < minSaving) continue;

    out.push({
      studentId: p.studentId,
      fullName: p.fullName,
      classLabel: p.classLabel,
      householdId: p.householdId,
      currentRouteId: current.routeId,
      currentRouteLabel: current.routeLabel,
      currentStopName: current.stop.name,
      currentStopKm: Math.round(currentKm * 10) / 10,
      betterRouteId: best.routeId,
      betterRouteLabel: best.routeLabel,
      betterStopName: best.stop.name,
      betterStopKm: Math.round(bestKm * 10) / 10,
      savingKm: Math.round(saving * 10) / 10,
    });
  }

  return out.sort((a, b) => b.savingKm - a.savingKm);
}

export function suggestStopDistanceKm(
  stop: TransportStop | undefined,
  roadKm?: number,
): number {
  if (roadKm && roadKm > 0) return Math.round(roadKm * 10) / 10;
  return stop?.distanceKm ?? 0;
}
