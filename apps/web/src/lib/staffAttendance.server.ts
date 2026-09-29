/**
 * Staff attendance — server read/write for WhatsApp webhook punches.
 */

import { promises as fs } from "fs";
import path from "path";
import { istDateParts } from "@/lib/attendance";
import type { StaffRecord } from "@/lib/foundationMasters";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";
import {
  applyApprovedLeaveToMarks,
  emptyStaffAttendanceState,
  findStaffRegister,
  normalizeAttendanceSettings,
  normalizeStaffAttendanceState,
  staffAttendanceStateIsEmpty,
  upsertStaffMarkInState,
  writeStaffAttendanceLocalRaw,
  type StaffAttendanceState,
  type StaffPunchGeo,
} from "@/lib/staffAttendance";
import {
  campusGeofenceFromSettings,
  validateStaffPunchLocation,
  formatDistanceLabel,
  type PunchGeoInput,
} from "@/lib/staffGeofence.server";
import { waNormalizeLocal10 } from "@/lib/waSend";
import { trackServerWork } from "@/lib/serverWork";

const LOCAL_FILE = path.join(process.cwd(), ".data", "staff_attendance_server.json");

let cache: StaffAttendanceState | null = null;
let loaded = false;

function nowHhmmIst(): string {
  const { hour, minute } = istDateParts();
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function todayIst(): string {
  return istDateParts().date;
}

export async function loadStaffAttendanceServer(
  opts: { fresh?: boolean } = {},
): Promise<StaffAttendanceState> {
  if (opts.fresh) return loadStaffAttendanceFresh();
  if (loaded && cache) return cache;

  const { ensureStaffAttendanceHydratedServer } = await import(
    "@/lib/staffAttendancePersistence"
  );
  await ensureStaffAttendanceHydratedServer();

  const fromCache = (await import("@/lib/staffAttendance")).loadStaffAttendance();
  if (!staffAttendanceStateIsEmpty(fromCache)) {
    cache = fromCache;
    loaded = true;
    return cache;
  }

  const remote = await fetchServerBlob<StaffAttendanceState>(
    "staff_attendance_state",
  );
  if (remote.state?.version === 1 && Array.isArray(remote.state.registers)) {
    cache = normalizeStaffAttendanceState(remote.state);
    loaded = true;
    writeStaffAttendanceLocalRaw(cache);
    return cache;
  }
  try {
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    const parsed = JSON.parse(raw) as StaffAttendanceState;
    if (parsed?.version === 1) {
      cache = normalizeStaffAttendanceState(parsed);
      loaded = true;
      writeStaffAttendanceLocalRaw(cache);
      return cache;
    }
  } catch {
    /* first run */
  }
  cache = emptyStaffAttendanceState();
  loaded = true;
  return cache;
}

/**
 * The register as the database holds it NOW. loadStaffAttendanceServer()
 * keeps the first copy it ever read for the life of the instance, so a punch
 * read-modify-wrote a stale register and pushed it back over whatever the
 * office had saved since (and, with two Cloud Run instances, over each
 * other's punches).
 */
async function loadStaffAttendanceFresh(): Promise<StaffAttendanceState> {
  const { ensureStaffAttendanceHydratedServer } = await import(
    "@/lib/staffAttendancePersistence"
  );
  await ensureStaffAttendanceHydratedServer();
  const fresh = (await import("@/lib/staffAttendance")).loadStaffAttendance();
  cache = normalizeStaffAttendanceState(fresh);
  loaded = true;
  return cache;
}

/**
 * Persist ONE day's register — the one a punch touched — and wait for the
 * database to confirm it. The old path pushed the whole cached desk,
 * fire-and-forget: a failed write still answered "Punched in".
 */
async function saveStaffPunchRegister(
  state: StaffAttendanceState,
  register: import("@/lib/staffAttendance").StaffAttendanceRegister,
): Promise<{ ok: boolean; error?: string }> {
  const { pushStaffAttendanceRegisterToDb } = await import(
    "@/lib/staffAttendanceNormalized.server"
  );
  const pushed = await pushStaffAttendanceRegisterToDb(register);
  if (!pushed.ok) {
    console.error("[staff punch] register push failed", pushed.error);
    return { ok: false, error: pushed.error };
  }
  cache = normalizeStaffAttendanceState(state);
  loaded = true;
  writeStaffAttendanceLocalRaw(cache);
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (!deskSkipBlobPush("staff_attendance")) {
    void trackServerWork(pushServerBlob("staff_attendance_state", cache));
  }
  try {
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.writeFile(LOCAL_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* ephemeral disk */
  }
  return { ok: true };
}

export async function saveStaffAttendanceServer(
  state: StaffAttendanceState,
): Promise<void> {
  cache = normalizeStaffAttendanceState(state);
  loaded = true;
  writeStaffAttendanceLocalRaw(cache);
  void trackServerWork(pushServerBlob("staff_attendance_state", cache));
  const { pushStaffAttendanceDeskToDb } = await import(
    "@/lib/staffAttendanceNormalized.server"
  );
  void trackServerWork(pushStaffAttendanceDeskToDb(cache));
  try {
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.writeFile(LOCAL_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* ephemeral disk */
  }
}

export function staffMobileMatchedAlt(
  staff: StaffRecord,
  mobile10: string,
): boolean {
  const primary = waNormalizeLocal10(staff.mobile || "");
  const alt = waNormalizeLocal10(staff.altMobile || "");
  return alt === mobile10 && primary !== mobile10;
}

function punchGeoFromInput(
  geo: PunchGeoInput,
  distanceM: number,
  source: StaffPunchGeo["source"] = "wa_location",
): StaffPunchGeo {
  return {
    lat: geo.lat,
    lng: geo.lng,
    accuracyM: geo.accuracyM,
    distanceM,
    at: new Date().toISOString(),
    source,
  };
}

export type ApplyWaStaffPunchResult =
  | {
      ok: true;
      kind: "in" | "out";
      time: string;
      distanceM: number;
      mark: {
        status: string;
        inTime: string;
        outTime: string;
      };
      altMobile: boolean;
    }
  | { ok: false; error: string };

export async function applyWhatsAppStaffPunch(opts: {
  staff: StaffRecord;
  mobile10: string;
  kind: "in" | "out";
  geo: PunchGeoInput;
  /** Punch channel: WhatsApp location share (default) or the mobile app's GPS. */
  via?: "whatsapp" | "app";
  /** Confirmed early check-out — appended to the register note so HR sees it */
  earlyOutNote?: string;
  /** The year to file the punch under; the app's GET reads the same one. */
  academicYearCode?: string;
}): Promise<ApplyWaStaffPunchResult> {
  const via = opts.via ?? "whatsapp";
  let state = await loadStaffAttendanceFresh();
  const settings = normalizeAttendanceSettings(state.settings);
  if (via === "whatsapp" && !settings.allowWhatsAppPunch) {
    return {
      ok: false,
      error: "WhatsApp attendance is disabled. Ask admin to enable it in Masters → Attendance settings.",
    };
  }
  if (via === "app" && !settings.allowSelfPunch) {
    return {
      ok: false,
      error: "Self punch is disabled. Ask admin to enable it in Masters → Attendance settings.",
    };
  }

  const fence = campusGeofenceFromSettings(settings);
  const check = validateStaffPunchLocation(opts.geo, fence);
  if (!check.ok) {
    return { ok: false, error: check.reason || "Outside school geofence." };
  }

  const masters = loadMasters();
  const ay = opts.academicYearCode || currentAcademicYearCode(masters);
  const date = todayIst();
  const roster = masters.staff ?? [];
  const saveFailed = {
    ok: false as const,
    error:
      via === "app"
        ? "Your punch could not be saved to the school database. Please try again."
        : "Could not save your punch — please try again in a minute.",
  };
  const time = nowHhmmIst();
  const altMobile =
    via === "whatsapp" && staffMobileMatchedAlt(opts.staff, opts.mobile10);
  const geoAudit = punchGeoFromInput(
    opts.geo,
    check.distanceM,
    via === "app" ? "app_gps" : "wa_location",
  );
  const channelLabel = via === "app" ? "App" : "WhatsApp";
  const punchWay = via === "app" ? ("self" as const) : ("whatsapp" as const);
  const markedBy = via === "app" ? "Mobile app attendance" : "WhatsApp attendance";

  const existingReg = findStaffRegister(state, date, ay);
  let marks = existingReg
    ? [...existingReg.marks]
    : roster
        .filter((s) => s.status === "active")
        .map((s) => ({
          staffId: s.id,
          status: "P" as const,
          note: "",
          inTime: "",
          outTime: "",
          punchWay: "" as const,
        }));

  if (settings.syncLeaveToAttendance) {
    marks = applyApprovedLeaveToMarks(marks, date, ay);
  }

  const cur = marks.find((m) => m.staffId === opts.staff.id);
  if (cur?.status === "LE") {
    return {
      ok: false,
      error: "You are on approved leave today. Contact HR if this is wrong.",
    };
  }

  if (opts.kind === "in") {
    if (cur?.inTime && cur.inTime.trim()) {
      return {
        ok: false,
        error:
          via === "app"
            ? `Already punched IN at ${cur.inTime}. Use Punch OUT when you leave.`
            : `Already punched IN at ${cur.inTime}. Reply *STATUS* or *OUT* to punch out.`,
      };
    }
    const noteParts = [
      `${channelLabel} campus punch-in`,
      altMobile ? "alt mobile" : null,
      `~${formatDistanceLabel(check.distanceM)} from school`,
    ].filter(Boolean);
    const merged = upsertStaffMarkInState(state, {
      academicYearCode: ay,
      date,
      staffId: opts.staff.id,
      status: "P",
      inTime: time,
      outTime: cur?.outTime || "",
      note: noteParts.join(" · "),
      punchWay,
      punchGeo: geoAudit,
      markedBy,
      roster,
    });
    state = merged.state;
    if (!(await saveStaffPunchRegister(state, merged.register)).ok) return saveFailed;
    const mark = merged.register.marks.find((m) => m.staffId === opts.staff.id)!;
    return {
      ok: true,
      kind: "in",
      time,
      distanceM: check.distanceM,
      mark: {
        status: mark.status,
        inTime: mark.inTime,
        outTime: mark.outTime,
      },
      altMobile,
    };
  }

  if (!cur?.inTime?.trim()) {
    return {
      ok: false,
      error:
        via === "app"
          ? "No punch-in today — punch IN first."
          : "No punch-in today. Reply *IN* first, then share location.",
    };
  }
  if (cur.outTime?.trim()) {
    return {
      ok: false,
      error:
        via === "app"
          ? `Already punched OUT at ${cur.outTime}.`
          : `Already punched OUT at ${cur.outTime}. Reply *STATUS* for summary.`,
    };
  }

  const noteParts = [
    cur.note || `${channelLabel} campus punch`,
    `OUT ${time}`,
    opts.earlyOutNote || null,
    altMobile ? "alt mobile" : null,
    `~${formatDistanceLabel(check.distanceM)} from school`,
  ].filter(Boolean);
  const merged = upsertStaffMarkInState(state, {
    academicYearCode: ay,
    date,
    staffId: opts.staff.id,
    status: cur.status === "HD" ? "HD" : "P",
    inTime: cur.inTime,
    outTime: time,
    note: noteParts.join(" · "),
    punchWay,
    punchGeo: geoAudit,
    markedBy,
    roster,
  });
  state = merged.state;
  if (!(await saveStaffPunchRegister(state, merged.register)).ok) return saveFailed;
  const mark = merged.register.marks.find((m) => m.staffId === opts.staff.id)!;
  return {
    ok: true,
    kind: "out",
    time,
    distanceM: check.distanceM,
    mark: {
      status: mark.status,
      inTime: mark.inTime,
      outTime: mark.outTime,
    },
    altMobile,
  };
}

export async function staffAttendanceStatusForWa(
  staffId: string,
): Promise<string> {
  const state = await loadStaffAttendanceServer();
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const date = todayIst();
  const reg = findStaffRegister(state, date, ay);
  const mark = reg?.marks.find((m) => m.staffId === staffId);
  if (!mark) {
    return `*Attendance* — ${date}\n\nNo punch yet. Reply *IN* and share your live location pin.`;
  }
  const geo = mark.punchGeo
    ? `📍 last pin ~${formatDistanceLabel(mark.punchGeo.distanceM ?? -1)} from school`
    : "";
  return [
    `*Attendance* — ${date}`,
    `Status: *${mark.status}*`,
    `IN: ${mark.inTime || "—"} · OUT: ${mark.outTime || "—"}`,
    mark.note ? `Note: ${mark.note}` : null,
    geo || null,
    "",
    "Reply *IN* or *OUT* + location pin to update.",
  ]
    .filter(Boolean)
    .join("\n");
}
