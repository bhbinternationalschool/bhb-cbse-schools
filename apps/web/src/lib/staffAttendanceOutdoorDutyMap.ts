/**
 * Outdoor duty ↔ desk row mapping, and the staff-id filter that guards the
 * push. Pure — no Supabase client — so it is testable on its own, the same
 * split staffAttendanceNormalizedMerge.ts already uses.
 */

import type {
  OutdoorDutyGeoPoint,
  OutdoorDutyPurpose,
  OutdoorDutySession,
} from "@/lib/staffAttendance";

export function geoOrNull(g: unknown): OutdoorDutyGeoPoint | null {
  const p = g as Partial<OutdoorDutyGeoPoint> | null;
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return {
    lat: Number(p.lat),
    lng: Number(p.lng),
    accuracyM:
      typeof p.accuracyM === "number" && p.accuracyM >= 0
        ? p.accuracyM
        : undefined,
    at: String(p.at || ""),
  };
}

export function outdoorDutySessionToRow(
  tenantId: string,
  s: OutdoorDutySession,
): Record<string, unknown> {
  const ended = s.status === "ended";
  return {
    id: s.id,
    tenant_id: tenantId,
    staff_id: s.staffId,
    purpose: s.purpose,
    destination: s.destination || "",
    note: s.note || "",
    started_at: s.startedAt,
    // The table ties status and ended_at together with a check constraint.
    // Trust status and synthesise the timestamp rather than let one
    // half-closed client row fail the whole batch.
    ended_at: ended ? s.endedAt || s.startedAt : null,
    status: ended ? "ended" : "active",
    start_geo: s.startGeo,
    end_geo: ended ? s.endGeo : null,
    created_by: s.createdBy || "",
    updated_at: new Date().toISOString(),
  };
}

export function outdoorDutyRowToSession(
  r: Record<string, unknown>,
): OutdoorDutySession {
  const ended = String(r.status) === "ended";
  return {
    id: String(r.id),
    staffId: String(r.staff_id),
    purpose: String(r.purpose) as OutdoorDutyPurpose,
    destination: String(r.destination || ""),
    note: String(r.note || ""),
    startedAt: String(r.started_at || ""),
    startGeo: geoOrNull(r.start_geo),
    endedAt: ended ? String(r.ended_at || "") : null,
    endGeo: ended ? geoOrNull(r.end_geo) : null,
    status: ended ? "ended" : "active",
    createdBy: String(r.created_by || ""),
  };
}

/**
 * Split a push payload into sessions whose staffId is a real staff record
 * and those that are not.
 *
 * The chat actor manufactures a `sess_…` key for a login with no staff row,
 * and one such session is still sitting in at least one browser's
 * localStorage from before that was fixed. Without this filter it would be
 * pushed on the first sync after this ships — persistence would resurrect
 * exactly what we set out to stop storing.
 */
export function partitionSessionsByRealStaff(
  sessions: OutdoorDutySession[],
  realStaffIds: Set<string>,
): { kept: OutdoorDutySession[]; dropped: OutdoorDutySession[] } {
  const kept: OutdoorDutySession[] = [];
  const dropped: OutdoorDutySession[] = [];
  for (const s of sessions ?? []) {
    if (s.staffId && realStaffIds.has(s.staffId)) kept.push(s);
    else dropped.push(s);
  }
  return { kept, dropped };
}
