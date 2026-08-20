import "server-only";

/**
 * Server side of staff GPS presence: accept pings (staff session, consent
 * enforced), evaluate everyone on the tick (Cloud Scheduler every 5 min),
 * write incidents, alert owner / admin / principal on WhatsApp, and serve
 * the live board. Settings + consents: module_local_state
 * ("staff_geo_settings"). Last ping + incidents: staff_geo_last /
 * staff_geo_incidents (service-role tables, migration 20260820090000).
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getSchoolMirrorSync } from "@/lib/schoolDataMirror";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadStaffAttendance, findStaffRegister, type StaffAttendanceState } from "@/lib/staffAttendance";
import {
  evaluateStaffGeo,
  implausibleJump,
  inTrackingWindow,
  isInsideFence,
  istParts,
  normalizeStaffGeoSettings,
  staffGeoAlertText,
  STAFF_GEO_INCIDENT_LABEL,
  type StaffGeoConsent,
  type StaffGeoIncident,
  type StaffGeoIncidentKind,
  type StaffGeoSettings,
  type StaffPresence,
} from "@/lib/staffGeo";
import { sendWaWithFailover } from "@/lib/waSend";
import { TENANT } from "@/lib/types";

const MODULE_KEY = "staff_geo_settings";

type StoredState = { settings: StaffGeoSettings; consents: StaffGeoConsent[] };

function school() {
  return { lat: TENANT.schoolLat, lng: TENANT.schoolLng };
}

export async function readStaffGeoState(): Promise<StoredState> {
  const ctx = await getServerTenantContext();
  const empty: StoredState = { settings: normalizeStaffGeoSettings(null, school()), consents: [] };
  if (!ctx) return empty;
  const { data } = await ctx.sb.from("module_local_state").select("state").eq("tenant_id", ctx.tenantId).eq("module_key", MODULE_KEY).maybeSingle();
  const raw = (data?.state ?? {}) as Partial<StoredState>;
  const consents = Array.isArray(raw.consents)
    ? raw.consents
        .map((c) => ({ staffId: String((c as StaffGeoConsent)?.staffId || ""), consentAt: String((c as StaffGeoConsent)?.consentAt || ""), device: String((c as StaffGeoConsent)?.device || "").slice(0, 120) }))
        .filter((c) => c.staffId && c.consentAt)
    : [];
  return { settings: normalizeStaffGeoSettings(raw.settings, school()), consents };
}

export async function writeStaffGeoState(next: StoredState): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const state: StoredState = { settings: normalizeStaffGeoSettings({ ...next.settings, updatedAt: new Date().toISOString() }, school()), consents: next.consents.slice(0, 500) };
  const { error } = await ctx.sb.from("module_local_state").upsert(
    { tenant_id: ctx.tenantId, module_key: MODULE_KEY, state, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id,module_key" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ─── Pings ────────────────────────────────────────────────────────── */

export async function recordStaffPing(input: {
  staffId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  device: string;
  consent?: boolean;
  /** Android geolocator isMocked — a mock provider is feeding coordinates */
  mocked?: boolean;
}): Promise<
  | { ok: true; inside: boolean; distanceM: number; tracking: boolean; consented: true }
  | { ok: false; error: string; needsConsent?: boolean }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const st = await readStaffGeoState();
  let consented = st.consents.some((c) => c.staffId === input.staffId);
  if (!consented) {
    if (!input.consent) return { ok: false, error: "Consent required before location is accepted", needsConsent: true };
    st.consents.push({ staffId: input.staffId, consentAt: new Date().toISOString(), device: input.device });
    const w = await writeStaffGeoState(st);
    if (!w.ok) return { ok: false, error: w.error || "Could not record consent" };
    consented = true;
  }
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) {
    return { ok: false, error: "Invalid coordinates" };
  }
  if (input.mocked === true) {
    // Refusing the ping stops the stream → the tick raises "location off",
    // which is exactly the incident a fake-GPS phone deserves.
    return { ok: false, error: "Mock location detected — disable the fake-GPS app; this is reported as location-off during school timing" };
  }
  const accuracyM = Math.min(9999, Math.max(0, Math.round(Number(input.accuracyM) || 0)));
  const { inside, distance } = isInsideFence(st.settings, { lat: input.lat, lng: input.lng, accuracyM });
  const now = new Date();
  // outside_since: keep the start of a continuous outside stretch.
  const { data: prev } = await ctx.sb.from("staff_geo_last").select("outside_since, at, lat, lng").eq("tenant_id", ctx.tenantId).eq("staff_id", input.staffId).maybeSingle();
  if (prev?.at && implausibleJump({ lat: Number(prev.lat), lng: Number(prev.lng), at: String(prev.at) }, { lat: input.lat, lng: input.lng, at: now.toISOString() })) {
    return { ok: false, error: "Location jump is not physically possible — ping rejected (spoofing suspected)" };
  }
  const outsideSince = inside ? null : (prev?.outside_since as string | null) || now.toISOString();
  const { error } = await ctx.sb.from("staff_geo_last").upsert(
    {
      tenant_id: ctx.tenantId,
      staff_id: input.staffId,
      at: now.toISOString(),
      lat: input.lat,
      lng: input.lng,
      accuracy_m: accuracyM,
      inside,
      distance_m: distance,
      outside_since: outsideSince,
      device: input.device.slice(0, 120),
      updated_at: now.toISOString(),
    },
    { onConflict: "tenant_id,staff_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, inside, distanceM: distance, tracking: inTrackingWindow(st.settings, now), consented: true };
}

/* ─── Tick: evaluate + alert ───────────────────────────────────────── */

function attendanceFor(att: StaffAttendanceState, date: string, ay: string, staffId: string): string {
  const reg = findStaffRegister(att, date, ay);
  const mark = reg?.marks.find((m) => m.staffId === staffId);
  return mark?.status || "";
}

export type StaffGeoBoardRow = {
  staffId: string;
  empCode: string;
  fullName: string;
  presence: StaffPresence;
  distanceM: number | null;
  minutesSincePing: number | null;
  consented: boolean;
  exempt: boolean;
  lastAt: string;
};

export async function runStaffGeoTick(opts?: { now?: Date; dryRun?: boolean }): Promise<{
  ok: boolean;
  tracking: boolean;
  date: string;
  evaluated: number;
  incidents: { kind: StaffGeoIncidentKind; fullName: string }[];
  alertsSent: number;
  alertErrors: string[];
  board: StaffGeoBoardRow[];
}> {
  const now = opts?.now ?? new Date();
  const ctx = await getServerTenantContext();
  const st = await readStaffGeoState();
  const { date } = istParts(now);
  const empty = { ok: true, tracking: false, date, evaluated: 0, incidents: [], alertsSent: 0, alertErrors: [], board: [] as StaffGeoBoardRow[] };
  if (!ctx) return { ...empty, ok: false };

  await ensureSchoolMirrorHydrated();
  const masters = (getSchoolMirrorSync().masters as MastersState | null) || loadMasters();
  const staff = (masters.staff ?? []).filter((s) => s.status === "active");
  const att = loadStaffAttendance();
  const ay = masters.academicYears?.find((y) => y.status === "current")?.code || "";

  const { data: pingRows } = await ctx.sb.from("staff_geo_last").select("staff_id, at, lat, lng, accuracy_m, outside_since").eq("tenant_id", ctx.tenantId);
  const pings = new Map((pingRows || []).map((r) => [String(r.staff_id), r]));

  // Open incident per staff today = latest of left/off without a matching close.
  const { data: incRows } = await ctx.sb
    .from("staff_geo_incidents")
    .select("staff_id, kind, at")
    .eq("tenant_id", ctx.tenantId)
    .eq("date", date)
    .order("at", { ascending: true });
  const openByStaff = new Map<string, StaffGeoIncidentKind | null>();
  for (const r of incRows || []) {
    const k = r.kind as StaffGeoIncidentKind;
    if (k === "left_premises" || k === "location_off") openByStaff.set(String(r.staff_id), k);
    else openByStaff.set(String(r.staff_id), null);
  }

  const tracking = inTrackingWindow(st.settings, now);
  const board: StaffGeoBoardRow[] = [];
  const newIncidents: StaffGeoIncident[] = [];

  for (const s of staff) {
    const p = pings.get(s.id);
    const consented = st.consents.some((c) => c.staffId === s.id);
    const exempt = st.settings.exemptStaffIds.includes(s.id);
    const r = evaluateStaffGeo(
      st.settings,
      {
        staffId: s.id,
        empCode: s.empCode,
        fullName: s.fullName,
        ping: p ? ({ staffId: s.id, at: String(p.at), lat: Number(p.lat), lng: Number(p.lng), accuracyM: Number(p.accuracy_m) || 0, outsideSince: p.outside_since ? String(p.outside_since) : undefined } as never) : null,
        openIncident: openByStaff.get(s.id) ?? null,
        consented,
        attendance: attendanceFor(att, date, ay, s.id),
      },
      now,
    );
    board.push({ staffId: s.id, empCode: s.empCode, fullName: s.fullName, presence: r.presence, distanceM: r.distanceM, minutesSincePing: r.minutesSincePing, consented, exempt, lastAt: p ? String(p.at) : "" });
    if (tracking && r.incident && !opts?.dryRun) {
      newIncidents.push({ ...r.incident, id: `sgi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, alerted: false });
    }
  }

  let alertsSent = 0;
  const alertErrors: string[] = [];
  if (newIncidents.length && !opts?.dryRun) {
    for (const inc of newIncidents) {
      let alerted = false;
      const details: string[] = [];
      // Alert only the "bad" kinds; recoveries are informational (still logged, lighter send).
      const shouldAlert = inc.kind === "left_premises" || inc.kind === "location_off";
      for (const rec of st.settings.recipients) {
        const send = await sendWaWithFailover({ primaryMobile: rec.mobile, body: staffGeoAlertText(TENANT.nameDisplay, inc), clientMessageId: `sgi_${inc.id}_${rec.mobile}` });
        details.push(`${rec.name || rec.mobile}: ${send.ok ? "sent" : send.error || "failed"}`);
        if (send.ok) alerted = true;
        if (!send.ok && shouldAlert) alertErrors.push(`${rec.mobile}: ${send.error || "failed"}`);
        if (!shouldAlert) break; // recoveries: first recipient only
      }
      if (alerted) alertsSent += 1;
      const { error } = await ctx.sb.from("staff_geo_incidents").insert({
        id: inc.id,
        tenant_id: ctx.tenantId,
        staff_id: inc.staffId,
        emp_code: inc.empCode,
        full_name: inc.fullName,
        date: inc.date,
        at: inc.at,
        kind: inc.kind,
        distance_m: inc.distanceM,
        detail: inc.detail,
        alerted,
        alert_detail: details.join(" · ").slice(0, 400),
      });
      if (error) alertErrors.push(`log: ${error.message}`);
    }
  }

  return { ok: true, tracking, date, evaluated: staff.length, incidents: newIncidents.map((i) => ({ kind: i.kind, fullName: i.fullName })), alertsSent, alertErrors, board };
}

export async function listStaffGeoIncidents(opts?: { date?: string; staffId?: string; limit?: number }): Promise<
  { id: string; staffId: string; empCode: string; fullName: string; date: string; at: string; kind: StaffGeoIncidentKind; kindLabel: string; distanceM: number | null; detail: string; alerted: boolean; alertDetail: string }[]
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  let q = ctx.sb.from("staff_geo_incidents").select("*").eq("tenant_id", ctx.tenantId).order("at", { ascending: false }).limit(Math.min(500, opts?.limit ?? 200));
  if (opts?.date) q = q.eq("date", opts.date);
  if (opts?.staffId) q = q.eq("staff_id", opts.staffId);
  const { data } = await q;
  return (data || []).map((r) => ({
    id: String(r.id),
    staffId: String(r.staff_id),
    empCode: String(r.emp_code),
    fullName: String(r.full_name),
    date: String(r.date),
    at: String(r.at),
    kind: r.kind as StaffGeoIncidentKind,
    kindLabel: STAFF_GEO_INCIDENT_LABEL[r.kind as StaffGeoIncidentKind] || String(r.kind),
    distanceM: r.distance_m == null ? null : Number(r.distance_m),
    detail: String(r.detail),
    alerted: !!r.alerted,
    alertDetail: String(r.alert_detail || ""),
  }));
}
