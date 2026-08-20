/**
 * Staff GPS presence — the pure part of geofenced staff tracking during
 * school timing.
 *
 * How it works: enrolled staff keep the staff hub open on their phone;
 * it sends a GPS ping every few minutes (with consent, with a visible
 * "sharing" badge). A server tick evaluates the last ping per staff inside
 * the school-timing window on working days:
 *   - outside the geofence beyond the threshold → "left premises" incident;
 *   - no ping for longer than the stale threshold (location off, app
 *     closed, phone off) → "location off" incident;
 *   - recovery (back inside / pinging again) → closing incident.
 * Each state change alerts the configured people (owner / admin /
 * principal) once — no re-alert spam while the state persists.
 *
 * Privacy rules (deliberate):
 *   - tracking only between timing start/end on working days;
 *   - consent recorded per staff before the first ping is accepted;
 *   - the server keeps the LAST ping per staff + incidents, not a trail;
 *   - staff see their own status and incidents; exempt list supported.
 */

export type StaffGeoSettings = {
  version: 1;
  enabled: boolean;
  /** Geofence centre (defaults to the school campus) */
  lat: number;
  lng: number;
  /** Metres from centre that counts as "on premises" */
  radiusM: number;
  /** Extra slack added for GPS accuracy before an incident is raised */
  toleranceM: number;
  /** School timing, IST HH:MM */
  startTime: string;
  endTime: string;
  /** 0=Sun … 6=Sat */
  workingDays: number[];
  /** Minutes between pings the staff hub should send */
  pingIntervalMin: number;
  /** Minutes without a ping before "location off" (grace for phone locks) */
  staleAfterMin: number;
  /** Minutes outside the fence before "left premises" */
  outsideGraceMin: number;
  /** Staff ids explicitly exempt (management, drivers on duty, peons on errands) */
  exemptStaffIds: string[];
  /** Alert recipients — owner / admin / principal mobiles (WhatsApp) */
  recipients: { name: string; mobile: string }[];
  /** Skip staff marked A / L / LE in the staff attendance register that day */
  skipAbsent: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type StaffGeoConsent = { staffId: string; consentAt: string; device: string };

export type StaffGeoIncidentKind = "left_premises" | "location_off" | "returned" | "back_online";

export type StaffGeoIncident = {
  id: string;
  staffId: string;
  empCode: string;
  fullName: string;
  date: string;
  at: string;
  kind: StaffGeoIncidentKind;
  /** Metres from the fence centre at the time (left/returned) */
  distanceM: number | null;
  detail: string;
  alerted: boolean;
};

export type StaffGeoPing = {
  staffId: string;
  at: string;
  lat: number;
  lng: number;
  accuracyM: number;
};

/** Presence state derived per staff by the tick. */
export type StaffPresence = "inside" | "outside" | "stale" | "no_ping_yet" | "not_tracked";

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
const hhmm = (v: unknown, d: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? "")) ? String(v) : d);

export function defaultStaffGeoSettings(school?: { lat: number; lng: number }): StaffGeoSettings {
  return {
    version: 1,
    enabled: false,
    lat: school?.lat ?? 0,
    lng: school?.lng ?? 0,
    radiusM: 150,
    toleranceM: 60,
    startTime: "08:00",
    endTime: "14:30",
    workingDays: [1, 2, 3, 4, 5, 6],
    pingIntervalMin: 5,
    staleAfterMin: 20,
    outsideGraceMin: 10,
    exemptStaffIds: [],
    recipients: [],
    skipAbsent: true,
    updatedAt: "",
    updatedBy: "",
  };
}

export function normalizeStaffGeoSettings(raw: unknown, school?: { lat: number; lng: number }): StaffGeoSettings {
  const d = defaultStaffGeoSettings(school);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<StaffGeoSettings>;
  const lat = num(r.lat, d.lat);
  const lng = num(r.lng, d.lng);
  return {
    version: 1,
    enabled: r.enabled === true,
    lat: Math.abs(lat) <= 90 ? lat : d.lat,
    lng: Math.abs(lng) <= 180 ? lng : d.lng,
    radiusM: Math.min(2000, Math.max(30, Math.round(num(r.radiusM, d.radiusM)))),
    toleranceM: Math.min(500, Math.max(0, Math.round(num(r.toleranceM, d.toleranceM)))),
    startTime: hhmm(r.startTime, d.startTime),
    endTime: hhmm(r.endTime, d.endTime),
    workingDays: Array.isArray(r.workingDays) ? [...new Set(r.workingDays.map((x) => Math.round(num(x, -1))).filter((x) => x >= 0 && x <= 6))].sort() : d.workingDays,
    pingIntervalMin: Math.min(30, Math.max(2, Math.round(num(r.pingIntervalMin, d.pingIntervalMin)))),
    staleAfterMin: Math.min(120, Math.max(5, Math.round(num(r.staleAfterMin, d.staleAfterMin)))),
    outsideGraceMin: Math.min(60, Math.max(0, Math.round(num(r.outsideGraceMin, d.outsideGraceMin)))),
    exemptStaffIds: Array.isArray(r.exemptStaffIds) ? r.exemptStaffIds.map((x) => str(x, 40)).filter(Boolean).slice(0, 200) : [],
    recipients: Array.isArray(r.recipients)
      ? r.recipients
          .map((x) => ({ name: str((x as { name?: unknown })?.name, 80), mobile: String((x as { mobile?: unknown })?.mobile ?? "").replace(/\D/g, "").slice(-10) }))
          .filter((x) => x.mobile.length === 10)
          .slice(0, 10)
      : [],
    skipAbsent: r.skipAbsent !== false,
    updatedAt: str(r.updatedAt, 40),
    updatedBy: str(r.updatedBy, 120),
  };
}

/**
 * Implausible-jump check between two pings: the implied speed a real staff
 * phone cannot have (spoofers flipping between home and school teleport).
 * Below 2 km apart is never flagged — GPS scatter and short gaps stay safe.
 */
export function implausibleJump(prev: { lat: number; lng: number; at: string }, next: { lat: number; lng: number; at: string }, maxKmh = 150): boolean {
  const meters = distanceM(prev.lat, prev.lng, next.lat, next.lng);
  if (meters < 2000) return false;
  const seconds = Math.max(1, (new Date(next.at).getTime() - new Date(prev.at).getTime()) / 1000);
  const kmh = (meters / 1000) / (seconds / 3600);
  return kmh > maxKmh;
}

/** Haversine distance in metres. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/** Inside the fence, allowing for the reported GPS accuracy + tolerance. */
export function isInsideFence(s: StaffGeoSettings, ping: Pick<StaffGeoPing, "lat" | "lng" | "accuracyM">): { inside: boolean; distance: number } {
  const distance = distanceM(s.lat, s.lng, ping.lat, ping.lng);
  const slack = Math.min(200, Math.max(0, ping.accuracyM)) + s.toleranceM;
  return { inside: distance <= s.radiusM + slack, distance };
}

/** IST clock parts for a UTC instant. */
export function istParts(at: Date): { date: string; hhmm: string; day: number } {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), hhmm: ist.toISOString().slice(11, 16), day: ist.getUTCDay() };
}

/** Is `at` inside the tracked window (working day + school timing)? */
export function inTrackingWindow(s: StaffGeoSettings, at: Date): boolean {
  if (!s.enabled) return false;
  const { hhmm: t, day } = istParts(at);
  if (!s.workingDays.includes(day)) return false;
  return t >= s.startTime && t <= s.endTime;
}

export type StaffGeoEvalInput = {
  staffId: string;
  empCode: string;
  fullName: string;
  /** Last ping, if any */
  ping: StaffGeoPing | null;
  /** When the staff last had an OPEN incident of each kind today (from the log) */
  openIncident: StaffGeoIncidentKind | null;
  consented: boolean;
  /** Attendance letter for the day ("P","A","L","LE","HD","" = unmarked) */
  attendance: string;
};

export type StaffGeoEvalResult = {
  staffId: string;
  presence: StaffPresence;
  distanceM: number | null;
  minutesSincePing: number | null;
  /** New incident to record + alert, if the state changed */
  incident: Omit<StaffGeoIncident, "id" | "alerted"> | null;
};

/**
 * Evaluate one staff at `now`. Pure — the tick supplies pings, open
 * incidents and attendance; this decides presence and whether a NEW
 * incident (state change) must be raised.
 */
export function evaluateStaffGeo(s: StaffGeoSettings, inp: StaffGeoEvalInput, now: Date): StaffGeoEvalResult {
  const { date } = istParts(now);
  const base = { staffId: inp.staffId, distanceM: null as number | null, minutesSincePing: null as number | null, incident: null };
  if (s.exemptStaffIds.includes(inp.staffId) || !inp.consented) return { ...base, presence: "not_tracked" };
  if (s.skipAbsent && (inp.attendance === "A" || inp.attendance === "L" || inp.attendance === "LE")) return { ...base, presence: "not_tracked" };

  const mk = (kind: StaffGeoIncidentKind, detail: string, dist: number | null): Omit<StaffGeoIncident, "id" | "alerted"> => ({
    staffId: inp.staffId,
    empCode: inp.empCode,
    fullName: inp.fullName,
    date,
    at: now.toISOString(),
    kind,
    distanceM: dist,
    detail,
  });

  if (!inp.ping || istParts(new Date(inp.ping.at)).date !== date) {
    // Never pinged today. Raise "location off" once, after the stale window
    // has passed from timing start (so 8:00 sharp does not alert everyone).
    const { hhmm: t } = istParts(now);
    const startPlus = addMinutes(s.startTime, s.staleAfterMin);
    if (t >= startPlus && inp.openIncident !== "location_off") {
      return { ...base, presence: "no_ping_yet", incident: mk("location_off", "No location received today — app closed, location off, or phone off", null) };
    }
    return { ...base, presence: "no_ping_yet" };
  }

  const mins = Math.round((now.getTime() - new Date(inp.ping.at).getTime()) / 60000);
  const { inside, distance } = isInsideFence(s, inp.ping);

  if (mins > s.staleAfterMin) {
    if (inp.openIncident !== "location_off") {
      return { ...base, presence: "stale", distanceM: distance, minutesSincePing: mins, incident: mk("location_off", `Location stopped ${mins} min ago (last seen ${inside ? "on premises" : `${distance} m away`})`, distance) };
    }
    return { ...base, presence: "stale", distanceM: distance, minutesSincePing: mins };
  }

  if (!inside) {
    // Outside: raise after the grace period — the ping interval acts as the
    // sampling grain, so require the ping to be older than the grace OR the
    // open incident to already exist.
    if (inp.openIncident !== "left_premises" && mins * 0 === 0 && distanceOutsideLongEnough(s, inp, now)) {
      return { ...base, presence: "outside", distanceM: distance, minutesSincePing: mins, incident: mk("left_premises", `Outside school premises — ${distance} m from campus during school timing`, distance) };
    }
    return { ...base, presence: "outside", distanceM: distance, minutesSincePing: mins };
  }

  // Inside and fresh — close any open incident.
  if (inp.openIncident === "left_premises") {
    return { ...base, presence: "inside", distanceM: distance, minutesSincePing: mins, incident: mk("returned", `Back on premises (${distance} m from centre)`, distance) };
  }
  if (inp.openIncident === "location_off") {
    return { ...base, presence: "inside", distanceM: distance, minutesSincePing: mins, incident: mk("back_online", "Location sharing resumed on premises", distance) };
  }
  return { ...base, presence: "inside", distanceM: distance, minutesSincePing: mins };
}

/** Outside grace: the staff hub stamps `outsideSince` on consecutive outside pings; when absent, fall back to the single-ping test. */
function distanceOutsideLongEnough(s: StaffGeoSettings, inp: StaffGeoEvalInput, now: Date): boolean {
  const since = (inp.ping as StaffGeoPing & { outsideSince?: string }).outsideSince;
  if (!since) return true;
  return now.getTime() - new Date(since).getTime() >= s.outsideGraceMin * 60000;
}

export function addMinutes(hhmmStr: string, mins: number): string {
  const [h, m] = hhmmStr.split(":").map(Number);
  const total = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export const STAFF_GEO_INCIDENT_LABEL: Record<StaffGeoIncidentKind, string> = {
  left_premises: "Left premises",
  location_off: "Location off / no signal",
  returned: "Returned to premises",
  back_online: "Sharing resumed",
};

/** WhatsApp alert text for one incident. */
export function staffGeoAlertText(schoolName: string, i: Omit<StaffGeoIncident, "id" | "alerted">): string {
  const t = new Date(i.at);
  const ist = new Date(t.getTime() + 330 * 60_000);
  const when = `${ist.toISOString().slice(11, 16)} IST`;
  if (i.kind === "left_premises") {
    return `⚠️ *${schoolName} — staff presence alert*\n${i.fullName} (${i.empCode}) is *outside school premises* during school timing.\n${i.distanceM != null ? `Distance: ~${i.distanceM} m from campus · ` : ""}${when}.\nIncident logged — Staff → GPS presence.`;
  }
  if (i.kind === "location_off") {
    return `⚠️ *${schoolName} — staff presence alert*\n${i.fullName} (${i.empCode}): *location not available* during school timing (${i.detail.toLowerCase()}).\n${when}. Incident logged — Staff → GPS presence.`;
  }
  if (i.kind === "returned") {
    return `✅ *${schoolName}* — ${i.fullName} (${i.empCode}) is back on premises. ${when}.`;
  }
  return `✅ *${schoolName}* — ${i.fullName} (${i.empCode}) location sharing resumed. ${when}.`;
}
