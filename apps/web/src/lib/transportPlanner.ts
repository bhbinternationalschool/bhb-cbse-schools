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
  listActiveRoutes,
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

export function suggestStopDistanceKm(
  stop: TransportStop | undefined,
  roadKm?: number,
): number {
  if (roadKm && roadKm > 0) return Math.round(roadKm * 10) / 10;
  return stop?.distanceKm ?? 0;
}
