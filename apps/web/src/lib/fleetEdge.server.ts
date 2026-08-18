/**
 * Tata Motors Fleet Edge webhook ingestion — three independent push
 * streams, all server-initiated by Fleet Edge (we never call out):
 *
 *  - `/alerts` (TimeBound Push spec) — event-driven: FuelDrainAlert,
 *    RefuelAlert, GeoFenceEntered, GeoFenceExited, OverSpeedEvent,
 *    DriverSOSAlert.
 *  - `/` root (TimeBound Push spec) — a periodic windowed summary:
 *    vehicleSafety / vehiclePerformance / vehicleEfficiency / vehicleHealth.
 *  - `/live` (Basic Push spec) — continuous VehicleTelemetry: one flat
 *    snapshot per push (gpsLatitude/gpsLongitude/speed/ignitionOn/fuel/etc),
 *    no time window. This is the only stream with a genuinely continuous
 *    position feed; the other two only carry location tied to specific
 *    events or stoppage/idling points.
 *
 * Neither spec documents a signature/token scheme, only that pushes
 * originate from a single IP (3.6.12.131) — see `isAllowedFleetEdgeSource`
 * for how that's enforced (fail-open by default, not hard-assumed).
 *
 * Every insert is append-only into fleet_edge_events (payload jsonb) —
 * deliberately not normalized into per-field columns yet, since the vendor
 * docs only show "Example Payload"s, not guaranteed exhaustive schemas.
 * Normalizing into GpsPing / driver-safety-scorecard / auto-raised
 * RepairRequest is a fast-follow once real traffic has been observed AND
 * a vehicle has a real FleetVehicle record to join against — Basic Push
 * telemetry keys primarily on vehicleId (chassis) rather than
 * registrationNumber specifically because a newly-onboarded vehicle can
 * report telemetry before its registration number is even allotted.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { sendWaWithFailover } from "@/lib/waSend";

const KNOWN_ALERT_NAMES = new Set([
  "FuelDrainAlert",
  "RefuelAlert",
  "GeoFenceEntered",
  "GeoFenceExited",
  "OverSpeedEvent",
  "DriverSOSAlert",
  "PanicSosEvent",
]);

/**
 * Every alertName Fleet Edge uses for a driver panic button. The spec PDF
 * says "DriverSOSAlert"; the live system sends "PanicSosEvent" — 159 of
 * them from two school buses on 16–18 Aug 2026, none of which was
 * recognised, escalated, or counted (audit 2026-08-18). Both are SOS.
 */
export const SOS_ALERT_NAMES = new Set(["DriverSOSAlert", "PanicSosEvent"]);
export function isSosAlert(alertName: string | null | undefined): boolean {
  return !!alertName && SOS_ALERT_NAMES.has(alertName);
}

/**
 * Minimum gap between two SOS escalations for the same vehicle. A held or
 * repeatedly pressed panic button pushes an alert every few seconds; the
 * first one is the escalation, the rest are logged as suppressed so the
 * desk still sees them, but no one gets 159 WhatsApp messages.
 */
export const SOS_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

export type FleetEdgeAlertPayload = {
  timestamp?: string;
  eventDateTime?: string;
  subscriptionId?: string;
  vehicleId?: string;
  registrationNumber?: string;
  alertName?: string;
  eventDetails?: Record<string, unknown>;
};

export type FleetEdgeDetailsPayload = {
  subscriptionId?: string;
  vehicleId?: string;
  timestamp?: string;
  from?: string;
  to?: string;
  registrationNumber?: string;
  vehicleSafety?: Record<string, unknown>;
  vehiclePerformance?: Record<string, unknown>;
  vehicleEfficiency?: Record<string, unknown>;
  vehicleHealth?: Record<string, unknown>;
};

/** Basic Push spec's flat VehicleTelemetry — every field optional/nullable
 * per the vendor doc; "Some fields are applicable only for certain vehicle
 * models." registrationNumber is deliberately last-resort: a brand-new
 * vehicle can report telemetry before RTO allots its plate. */
export type FleetEdgeTelemetryPayload = {
  vehicleId?: string;
  registrationNumber?: string;
  imei?: string;
  eventDateTime?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAltitude?: number;
  gpsCourseInDegrees?: number;
  gpsSignalQuality?: number;
  gpsFix?: boolean;
  ignitionOn?: boolean;
  crankOn?: boolean;
  speed?: number;
  odometer?: number;
  fuelLevelPercent?: number;
  vehicleStatus?: string;
  engineRunHour?: number;
  currentGear?: number;
  raw: Record<string, unknown>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Fleet Edge's eventDateTime example in the Basic Push doc has a malformed
 * fractional-second count (7 digits, not the documented 3) — never trust it
 * enough to force into a typed timestamptz column; only use it when it
 * actually parses. */
function parseableIso(v: string | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Lenient — Fleet Edge's own doc doesn't mark any field required, so this
 * only rejects a body that isn't even a JSON object. */
export function parseFleetEdgeAlert(raw: unknown): FleetEdgeAlertPayload | null {
  if (!isObject(raw)) return null;
  return {
    timestamp: str(raw.timestamp),
    eventDateTime: str(raw.eventDateTime),
    subscriptionId: str(raw.subscriptionId),
    vehicleId: str(raw.vehicleId),
    registrationNumber: str(raw.registrationNumber),
    alertName: str(raw.alertName),
    eventDetails: isObject(raw.eventDetails) ? raw.eventDetails : undefined,
  };
}

export function parseFleetEdgeDetails(raw: unknown): FleetEdgeDetailsPayload | null {
  if (!isObject(raw)) return null;
  return {
    subscriptionId: str(raw.subscriptionId),
    vehicleId: str(raw.vehicleId),
    timestamp: str(raw.timestamp),
    from: str(raw.from),
    to: str(raw.to),
    registrationNumber: str(raw.registrationNumber),
    vehicleSafety: isObject(raw.vehicleSafety) ? raw.vehicleSafety : undefined,
    vehiclePerformance: isObject(raw.vehiclePerformance) ? raw.vehiclePerformance : undefined,
    vehicleEfficiency: isObject(raw.vehicleEfficiency) ? raw.vehicleEfficiency : undefined,
    vehicleHealth: isObject(raw.vehicleHealth) ? raw.vehicleHealth : undefined,
  };
}

export function parseFleetEdgeTelemetry(raw: unknown): FleetEdgeTelemetryPayload | null {
  if (!isObject(raw)) return null;
  return {
    vehicleId: str(raw.vehicleId),
    registrationNumber: str(raw.registrationNumber),
    imei: str(raw.imei),
    eventDateTime: str(raw.eventDateTime),
    gpsLatitude: num(raw.gpsLatitude),
    gpsLongitude: num(raw.gpsLongitude),
    gpsAltitude: num(raw.gpsAltitude),
    gpsCourseInDegrees: num(raw.gpsCourseInDegrees),
    gpsSignalQuality: num(raw.gpsSignalQuality),
    gpsFix: bool(raw.gpsFix),
    ignitionOn: bool(raw.ignitionOn),
    crankOn: bool(raw.crankOn),
    speed: num(raw.speed),
    odometer: num(raw.odometer),
    fuelLevelPercent: num(raw.fuelLevelPercent ?? raw.primaryFuelLevel),
    vehicleStatus: str(raw.vehicleStatus),
    engineRunHour: num(raw.engineRunHour),
    currentGear: num(raw.currentGear),
    raw,
  };
}

/**
 * Fleet Edge's own spec never documents a signature or shared-secret header
 * — the only stated control is that pushes originate from 3.6.12.131. This
 * check is opt-in (fail OPEN when unset) rather than hard-coding that IP as
 * a known fact: set FLEET_EDGE_ALLOWED_IPS (comma-separated) once real
 * production traffic has confirmed what actually shows up in
 * x-forwarded-for, then it fails closed. Until then every request is
 * logged with its source IP so that confirmation is possible.
 */
export function isAllowedFleetEdgeSource(ip: string | null): boolean {
  const allowlist = (process.env.FLEET_EDGE_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return true;
  return !!ip && allowlist.includes(ip);
}

export function sourceIpFrom(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}

async function insertEvent(row: {
  event_type: "alert" | "details" | "telemetry";
  alert_name: string | null;
  vehicle_ref: string | null;
  registration_number: string | null;
  event_at: string | null;
  window_from: string | null;
  window_to: string | null;
  source_ip: string | null;
  payload: unknown;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) {
      console.warn("[fleetEdge] no server tenant context — event dropped");
      return { ok: false, error: "No tenant context" };
    }
    const { sb, tenantId } = ctx;
    const { data, error } = await sb
      .from("fleet_edge_events")
      .insert({ tenant_id: tenantId, ...row })
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("[fleetEdge] insert failed", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: (data?.id as string | undefined) ?? undefined };
  } catch (e) {
    console.warn("[fleetEdge] insertEvent threw", e);
    return { ok: false, error: String(e) };
  }
}

type NotificationLogRow = {
  event_id: string | null;
  alert_name: string;
  vehicle_ref: string | null;
  registration_number: string | null;
  recipient: string;
  status: "sent" | "failed" | "suppressed" | "skipped";
  detail?: string | null;
  body?: string | null;
};

async function logFleetEdgeNotification(row: NotificationLogRow): Promise<void> {
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return;
    const { error } = await ctx.sb.from("fleet_edge_notifications").insert({
      tenant_id: ctx.tenantId,
      channel: "whatsapp",
      ...row,
    });
    if (error) console.warn("[fleetEdge] notification log insert failed", error.message);
  } catch (e) {
    console.warn("[fleetEdge] notification log threw", e);
  }
}

export function fleetEdgeNotifyMobiles(): string[] {
  return (process.env.FLEET_EDGE_SOS_NOTIFY_MOBILE || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * SOS notify — best-effort, never throws, never blocks the caller's ack
 * back to Fleet Edge. FLEET_EDGE_SOS_NOTIFY_MOBILE is a comma-separated
 * list of mobiles; unset = a logged "skipped" row, not a silent no-op.
 * One escalation per vehicle per SOS_NOTIFY_COOLDOWN_MS; the rest are
 * logged as "suppressed" so the Notifications tab still shows them.
 */
async function notifyFleetEdgeSos(
  alert: FleetEdgeAlertPayload,
  eventId: string | null,
): Promise<void> {
  const alertName = alert.alertName || "DriverSOSAlert";
  const vehicleRef = alert.vehicleId || null;
  const reg = alert.registrationNumber || alert.vehicleId || "unknown vehicle";
  const mobiles = fleetEdgeNotifyMobiles();
  if (mobiles.length === 0) {
    console.warn(
      "[fleetEdge] SOS received but FLEET_EDGE_SOS_NOTIFY_MOBILE is unset — no one notified",
    );
    await logFleetEdgeNotification({
      event_id: eventId,
      alert_name: alertName,
      vehicle_ref: vehicleRef,
      registration_number: alert.registrationNumber || null,
      recipient: "—",
      status: "skipped",
      detail: "FLEET_EDGE_SOS_NOTIFY_MOBILE is not set",
    });
    return;
  }

  // Cooldown: latest SENT escalation for this vehicle.
  try {
    const ctx = await getServerTenantContext();
    if (ctx && vehicleRef) {
      const since = new Date(Date.now() - SOS_NOTIFY_COOLDOWN_MS).toISOString();
      const { data } = await ctx.sb
        .from("fleet_edge_notifications")
        .select("id, created_at")
        .eq("tenant_id", ctx.tenantId)
        .eq("vehicle_ref", vehicleRef)
        .eq("status", "sent")
        .in("alert_name", [...SOS_ALERT_NAMES])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if ((data?.length ?? 0) > 0) {
        await logFleetEdgeNotification({
          event_id: eventId,
          alert_name: alertName,
          vehicle_ref: vehicleRef,
          registration_number: alert.registrationNumber || null,
          recipient: mobiles.join(","),
          status: "suppressed",
          detail: `Within ${SOS_NOTIFY_COOLDOWN_MS / 60000}-minute cooldown of an escalation already sent for ${reg}`,
        });
        return;
      }
    }
  } catch (e) {
    console.warn("[fleetEdge] SOS cooldown check threw — sending anyway", e);
  }

  const details = alert.eventDetails || {};
  const location = str(details.location);
  const lat = typeof details.latitude === "number" ? details.latitude : undefined;
  const lng = typeof details.longitude === "number" ? details.longitude : undefined;
  const when = alert.eventDateTime || alert.timestamp || new Date().toISOString();
  const body =
    `DRIVER SOS ALERT — vehicle ${reg} — ${when}.` +
    `${location ? ` Location: ${location}.` : ""}` +
    `${lat != null && lng != null ? ` https://maps.google.com/?q=${lat},${lng}` : ""}`;
  for (const mobile of mobiles) {
    let status: NotificationLogRow["status"] = "sent";
    let detail: string | null = null;
    try {
      const r = await sendWaWithFailover({ primaryMobile: mobile, body });
      if (!r.ok) {
        status = "failed";
        detail = r.error || "send failed";
        console.warn("[fleetEdge] SOS notify failed", mobile, r.error);
      }
    } catch (e) {
      status = "failed";
      detail = String(e);
      console.warn("[fleetEdge] SOS notify threw", mobile, e);
    }
    await logFleetEdgeNotification({
      event_id: eventId,
      alert_name: alertName,
      vehicle_ref: vehicleRef,
      registration_number: alert.registrationNumber || null,
      recipient: mobile,
      status,
      detail,
      body,
    });
  }
}

export async function ingestFleetEdgeAlert(
  alert: FleetEdgeAlertPayload,
  sourceIp: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (alert.alertName && !KNOWN_ALERT_NAMES.has(alert.alertName)) {
    console.warn("[fleetEdge] unrecognized alertName (stored anyway)", alert.alertName);
  }
  const result = await insertEvent({
    event_type: "alert",
    alert_name: alert.alertName || null,
    vehicle_ref: alert.vehicleId || null,
    registration_number: alert.registrationNumber || null,
    event_at: parseableIso(alert.eventDateTime) || parseableIso(alert.timestamp),
    window_from: null,
    window_to: null,
    source_ip: sourceIp,
    payload: alert,
  });
  if (isSosAlert(alert.alertName)) {
    // Fire regardless of insert success — a DB hiccup must never suppress
    // a safety escalation.
    void notifyFleetEdgeSos(alert, result.id ?? null);
  }
  return { ok: result.ok, error: result.error };
}

export async function ingestFleetEdgeDetails(
  details: FleetEdgeDetailsPayload,
  sourceIp: string | null,
): Promise<{ ok: boolean; error?: string }> {
  return insertEvent({
    event_type: "details",
    alert_name: null,
    vehicle_ref: details.vehicleId || null,
    registration_number: details.registrationNumber || null,
    event_at: parseableIso(details.timestamp),
    window_from: parseableIso(details.from),
    window_to: parseableIso(details.to),
    source_ip: sourceIp,
    payload: details,
  });
}

/**
 * One-time admin confirmation the moment a vehicle's telemetry is first
 * seen — lets whoever's setting up a new tracker confirm it's actually
 * working without digging through Cloud Run logs. Best-effort like the SOS
 * notify; a race between concurrent first pushes can double-send, which is
 * harmless (worse would be silence).
 */
async function notifyFleetEdgeFirstSeen(vehicleRef: string): Promise<void> {
  const mobiles = fleetEdgeNotifyMobiles();
  if (mobiles.length === 0) return;
  const body = `Fleet Edge tracker is live for vehicle ${vehicleRef} — first telemetry received.`;
  for (const mobile of mobiles) {
    let status: NotificationLogRow["status"] = "sent";
    let detail: string | null = null;
    try {
      const r = await sendWaWithFailover({ primaryMobile: mobile, body });
      if (!r.ok) {
        status = "failed";
        detail = r.error || "send failed";
        console.warn("[fleetEdge] first-seen notify failed", mobile, r.error);
      }
    } catch (e) {
      status = "failed";
      detail = String(e);
      console.warn("[fleetEdge] first-seen notify threw", mobile, e);
    }
    await logFleetEdgeNotification({
      event_id: null,
      alert_name: "TrackerFirstSeen",
      vehicle_ref: vehicleRef,
      registration_number: null,
      recipient: mobile,
      status,
      detail,
      body,
    });
  }
}

export async function ingestFleetEdgeTelemetry(
  telemetry: FleetEdgeTelemetryPayload,
  sourceIp: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const vehicleRef = telemetry.vehicleId || telemetry.registrationNumber || null;

  if (vehicleRef) {
    void (async () => {
      try {
        const ctx = await getServerTenantContext();
        if (!ctx) return;
        const { sb, tenantId } = ctx;
        const { count, error } = await sb
          .from("fleet_edge_events")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("event_type", "telemetry")
          .eq("vehicle_ref", vehicleRef);
        if (error) {
          console.warn("[fleetEdge] first-seen check failed", error.message);
          return;
        }
        if ((count ?? 0) === 0) void notifyFleetEdgeFirstSeen(vehicleRef);
      } catch (e) {
        console.warn("[fleetEdge] first-seen check threw", e);
      }
    })();
  }

  return insertEvent({
    event_type: "telemetry",
    alert_name: null,
    vehicle_ref: telemetry.vehicleId || null,
    registration_number: telemetry.registrationNumber || null,
    event_at: parseableIso(telemetry.eventDateTime),
    window_from: null,
    window_to: null,
    source_ip: sourceIp,
    payload: telemetry.raw,
  });
}
