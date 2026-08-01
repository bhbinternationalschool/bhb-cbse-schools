/**
 * Campus geofence validation for staff WhatsApp attendance punches.
 */

import type { StaffAttendanceSettings } from "@/lib/staffAttendance";
import { normalizeAttendanceSettings } from "@/lib/staffAttendance";
import { TENANT } from "@/lib/types";

export type CampusGeofence = {
  lat: number;
  lng: number;
  radiusM: number;
  maxAccuracyM: number;
};

export type PunchGeoInput = {
  lat: number;
  lng: number;
  accuracyM?: number;
  name?: string;
  address?: string;
};

export type GeofenceValidation = {
  ok: boolean;
  distanceM: number;
  reason?: string;
};

export function haversineDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const r = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function campusGeofenceFromSettings(
  settings?: Partial<StaffAttendanceSettings> | null,
): CampusGeofence {
  const s = normalizeAttendanceSettings(settings);
  return {
    lat: TENANT.schoolLat,
    lng: TENANT.schoolLng,
    radiusM: s.geofenceRadiusM,
    maxAccuracyM: s.maxLocationAccuracyM,
  };
}

export function validateStaffPunchLocation(
  geo: PunchGeoInput,
  fence: CampusGeofence,
): GeofenceValidation {
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
    return { ok: false, distanceM: -1, reason: "Invalid GPS coordinates." };
  }

  const distanceM = haversineDistanceM(
    geo.lat,
    geo.lng,
    fence.lat,
    fence.lng,
  );

  if (
    fence.maxAccuracyM > 0 &&
    typeof geo.accuracyM === "number" &&
    geo.accuracyM > fence.maxAccuracyM
  ) {
    return {
      ok: false,
      distanceM,
      reason: `GPS accuracy too low (~${Math.round(geo.accuracyM)} m). Move outdoors and share *current location* again.`,
    };
  }

  if (distanceM > fence.radiusM) {
    return {
      ok: false,
      distanceM,
      reason: `You are ~${Math.round(distanceM)} m from campus (limit ${fence.radiusM} m). Punch only from school premises.`,
    };
  }

  return { ok: true, distanceM };
}

export function formatDistanceLabel(distanceM: number): string {
  if (distanceM < 0) return "—";
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}
