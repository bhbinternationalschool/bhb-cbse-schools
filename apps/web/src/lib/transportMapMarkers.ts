/**
 * Map marker model for Transport → Live (Google Maps JS).
 */

import { DEFAULT_AY, type MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  buildStudentTransportProfiles,
  listUnassignedStudents,
  SCHOOL_GEO,
} from "@/lib/transportPlanner";
import {
  lastGpsPingByVehicle,
  listActiveRoutes,
  type TransportState,
} from "@/lib/transport";

export type TransportMapMarkerKind =
  | "school"
  | "stop"
  | "unassigned"
  | "rider"
  | "bus";

export type TransportMapMarker = {
  id: string;
  kind: TransportMapMarkerKind;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  routeCode?: string;
};

function destinationPoint(
  lat: number,
  lng: number,
  distanceKm: number,
  bearingDeg: number,
): { lat: number; lng: number } {
  const r = 6371;
  const d = distanceKm / r;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

function bearingFromKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h + key.charCodeAt(i) * (i + 1)) % 360;
  }
  return h;
}

export type TransportMapLayers = {
  school: boolean;
  stops: boolean;
  unassigned: boolean;
  riders: boolean;
  buses: boolean;
};

export const DEFAULT_MAP_LAYERS: TransportMapLayers = {
  school: true,
  stops: true,
  unassigned: true,
  riders: false,
  buses: true,
};

export function buildTransportMapMarkers(input: {
  transport: TransportState;
  sis: SisState | null;
  masters: MastersState | null;
  academicYearCode?: string;
  layers?: Partial<TransportMapLayers>;
}): TransportMapMarker[] {
  const layers = { ...DEFAULT_MAP_LAYERS, ...input.layers };
  const markers: TransportMapMarker[] = [];
  const ay = input.academicYearCode || DEFAULT_AY;

  if (layers.school) {
    markers.push({
      id: "school",
      kind: "school",
      lat: SCHOOL_GEO.lat,
      lng: SCHOOL_GEO.lng,
      title: TENANT.name,
      subtitle: TENANT.schoolAddress,
    });
  }

  if (layers.stops) {
    for (const route of listActiveRoutes(input.transport)) {
      for (const stop of route.stops) {
        const km = Math.max(0.3, stop.distanceKm || 1);
        const bearing = bearingFromKey(`${route.id}:${stop.id}`);
        const pos = destinationPoint(SCHOOL_GEO.lat, SCHOOL_GEO.lng, km, bearing);
        markers.push({
          id: `stop:${route.id}:${stop.id}`,
          kind: "stop",
          lat: pos.lat,
          lng: pos.lng,
          title: stop.name,
          subtitle: `${route.code} · ~${km} km zone`,
          routeCode: route.code,
        });
      }
    }
  }

  if (input.sis && input.masters && (layers.unassigned || layers.riders)) {
    const profiles = buildStudentTransportProfiles(
      input.sis,
      input.masters,
      input.transport,
      ay,
    );

    if (layers.unassigned) {
      for (const p of listUnassignedStudents(profiles)) {
        if (!p.hasGeo || p.geoLat == null || p.geoLng == null) continue;
        markers.push({
          id: `unassigned:${p.studentId}`,
          kind: "unassigned",
          lat: p.geoLat,
          lng: p.geoLng,
          title: p.fullName,
          subtitle: [p.locality, p.landmark].filter(Boolean).join(" · ") || "No transport",
        });
      }
    }

    if (layers.riders) {
      for (const p of profiles) {
        if (!p.hasAssignment || !p.hasGeo || p.geoLat == null || p.geoLng == null) {
          continue;
        }
        markers.push({
          id: `rider:${p.studentId}`,
          kind: "rider",
          lat: p.geoLat,
          lng: p.geoLng,
          title: p.fullName,
          subtitle: p.routeCode ? `Route ${p.routeCode}` : "Assigned",
          routeCode: p.routeCode,
        });
      }
    }
  }

  if (layers.buses) {
    const last = lastGpsPingByVehicle(input.transport);
    for (const v of input.transport.vehicles) {
      if (!v.isActive) continue;
      const ping = last.get(v.id);
      if (!ping) continue;
      markers.push({
        id: `bus:${v.id}`,
        kind: "bus",
        lat: ping.lat,
        lng: ping.lng,
        title: v.registrationNo || v.name || "Bus",
        subtitle: `Last ping ${ping.recordedAt.slice(0, 16)}`,
        routeCode: v.registrationNo,
      });
    }
  }

  return markers;
}

export function fitMapBounds(
  markers: TransportMapMarker[],
): { center: { lat: number; lng: number }; zoom: number } {
  if (!markers.length) {
    return { center: { lat: SCHOOL_GEO.lat, lng: SCHOOL_GEO.lng }, zoom: 12 };
  }

  let minLat = markers[0]!.lat;
  let maxLat = markers[0]!.lat;
  let minLng = markers[0]!.lng;
  let maxLng = markers[0]!.lng;

  for (const m of markers) {
    minLat = Math.min(minLat, m.lat);
    maxLat = Math.max(maxLat, m.lat);
    minLng = Math.min(minLng, m.lng);
    maxLng = Math.max(maxLng, m.lng);
  }

  const center = {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };

  const span = Math.max(maxLat - minLat, maxLng - minLng);
  let zoom = 13;
  if (span > 0.35) zoom = 10;
  else if (span > 0.2) zoom = 11;
  else if (span > 0.1) zoom = 12;
  else if (span > 0.05) zoom = 13;
  else zoom = 14;

  return { center, zoom };
}
