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
  /** Client-reported mock-location flag (Android isMocked) */
  mocked?: boolean;
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
  // A WhatsApp "current location" share carries only coordinates; a pin
  // picked from search / saved places carries a name/address. Those can be
  // any place on earth (including the school), so they are never accepted.
  if ((geo.name || "").trim() || (geo.address || "").trim()) {
    return {
      ok: false,
      distanceM: -1,
      reason:
        "That is a searched/saved place pin, not your live location — not accepted. Tap 📎 → Location → *Send your current location*. / यह सर्च की गई जगह का पिन है — मान्य नहीं। 📎 → Location → *Send your current location* भेजें।",
    };
  }
  if (geo.mocked === true) {
    return {
      ok: false,
      distanceM: -1,
      reason:
        "Mock location detected on this phone — disable the fake-GPS app and try again. / फ़ोन पर नकली (mock) लोकेशन चालू है — fake-GPS ऐप बंद करके फिर से भेजें।",
    };
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

/**
 * Is this QR screen inside the school?
 *
 * Director, 3 Oct 2026: the punch QR may only be shown on school premises.
 * Anyone with the office role could switch a QR screen on from their own
 * login, anywhere — at home, a screen shows codes as readily as in the
 * office, and a phone can punch from it.
 *
 * A screen is usually a tablet or a laptop on a desk, and a laptop's browser
 * locates itself by Wi-Fi, not GPS — tens of metres, sometimes a few hundred.
 * So the fence allows a little of the reported uncertainty (at most 100 m
 * past the radius), and refuses a reading too vague to place the screen at
 * all (over 300 m), rather than either letting a vague one through or
 * locking out every laptop.
 */
export const SCREEN_MAX_ACCURACY_M = 300;
export const SCREEN_ACCURACY_ALLOWANCE_M = 100;

export type ScreenGeoInput = { lat?: unknown; lng?: unknown; accuracyM?: unknown };

export function validateScreenLocation(
  geo: ScreenGeoInput | null | undefined,
  fence: Pick<CampusGeofence, "lat" | "lng" | "radiusM">,
): GeofenceValidation {
  const lat = Number(geo?.lat);
  const lng = Number(geo?.lng);
  if (!geo || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return {
      ok: false,
      distanceM: -1,
      reason: "Allow location for this screen — the punch QR is shown only inside the school.",
    };
  }
  const acc = Number(geo.accuracyM);
  const accuracyM = Number.isFinite(acc) && acc > 0 ? acc : SCREEN_MAX_ACCURACY_M;
  const distanceM = haversineDistanceM(lat, lng, fence.lat, fence.lng);
  if (accuracyM > SCREEN_MAX_ACCURACY_M) {
    return {
      ok: false,
      distanceM,
      reason: `This device can't tell where it is precisely enough (~${Math.round(accuracyM)} m). Turn on Wi-Fi / GPS, or use a phone or tablet as the screen.`,
    };
  }
  const allowed = fence.radiusM + Math.min(accuracyM, SCREEN_ACCURACY_ALLOWANCE_M);
  if (distanceM > allowed) {
    return {
      ok: false,
      distanceM,
      reason: `This screen is ~${formatDistanceLabel(distanceM)} from the school. The punch QR is shown only inside the school.`,
    };
  }
  return { ok: true, distanceM };
}
