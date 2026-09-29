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
  gradeStaffPunch,
  normalizeAttendanceRulesState,
  type StaffAttendanceRulesState,
} from "@/lib/staffAttendanceRules";
import {
  applyApprovedLeaveToMarks,
  attendanceExemptStaffIds,
  defaultStaffMarks,
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
  const pushed = await pushStaffAttendanceRegisterToDb(register).catch(
    (e: unknown) => ({ ok: false as const, error: (e as Error)?.message || String(e) }),
  );
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

/** Half-day leave already on the mark: the punch records times, the leave
 * decides the status. */
function halfDayLeave(m: { status: string; punchWay?: string } | undefined): boolean {
  return !!m && m.status === "HD" && m.punchWay === "leave_sync";
}

/** Masters → Attendance rules as saved (module_local_state). Unreadable or
 * never saved = no assignments, so everyone is graded on school timing. */
async function loadAttendanceRulesServer() {
  const { readModuleLocalState } = await import("@/lib/moduleLocalState.server");
  const row = await readModuleLocalState<Partial<StaffAttendanceRulesState>>(
    "staff_attendance_rules",
  ).catch(() => null);
  if (!row) console.warn("[staff punch] attendance rules unreadable — grading on school timing");
  return normalizeAttendanceRulesState(row?.state ?? null);
}

async function exemptStaffIdsServer(
  settings: ReturnType<typeof normalizeAttendanceSettings>,
): Promise<Set<string>> {
  try {
    const { loadServerRbac } = await import("@/lib/api/v1/auth");
    const rbac = await loadServerRbac();
    return attendanceExemptStaffIds(settings, rbac);
  } catch {
    return attendanceExemptStaffIds(settings, null);
  }
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

  // Leave (approved requests) and the late grace both live in Staff HR,
  // which the server never loaded here — so approved leave was never
  // applied to a punch-created register.
  const { ensureStaffHrHydratedServer } = await import("@/lib/staffHrPersistence");
  await ensureStaffHrHydratedServer().catch(() => false);
  const rules = await loadAttendanceRulesServer();

  // Staff who keep no attendance stay off the register (same list the
  // office desk uses); everyone else starts "Not punched" (A).
  const exempt = await exemptStaffIdsServer(settings);
  const existingReg = findStaffRegister(state, date, ay);
  let marks = existingReg
    ? [...existingReg.marks]
    : defaultStaffMarks(roster.filter((s) => !exempt.has(s.id)));

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
    const graded = gradeStaffPunch(rules, opts.staff.id, date, time, "");
    const status = halfDayLeave(cur) ? "HD" : graded.status;
    const noteParts = [
      `${channelLabel} campus punch-in`,
      halfDayLeave(cur) ? cur!.note : `${graded.label} (${graded.ruleName})`,
      altMobile ? "alt mobile" : null,
      `~${formatDistanceLabel(check.distanceM)} from school`,
    ].filter(Boolean);
    const merged = upsertStaffMarkInState(state, {
      academicYearCode: ay,
      date,
      staffId: opts.staff.id,
      status,
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

  const gradedOut = gradeStaffPunch(rules, opts.staff.id, date, cur.inTime, time);
  const noteParts = [
    `${channelLabel} campus punch`,
    halfDayLeave(cur) ? cur.note : `${gradedOut.label} (${gradedOut.ruleName})`,
    `OUT ${time}`,
    opts.earlyOutNote || null,
    altMobile ? "alt mobile" : null,
    `~${formatDistanceLabel(check.distanceM)} from school`,
  ].filter(Boolean);
  const merged = upsertStaffMarkInState(state, {
    academicYearCode: ay,
    date,
    staffId: opts.staff.id,
    // The day is graded again with both punches (early out → half day).
    status: halfDayLeave(cur) ? "HD" : gradedOut.status,
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

/**
 * Today's punch for one staff member — IN and OUT times, "" when missing —
 * or null when there is no mark at all today.
 */
export async function staffPunchToday(
  staffId: string,
): Promise<{ inTime: string; outTime: string } | null> {
  // Fresh: the punch may have been saved by another server a minute ago.
  const state = await loadStaffAttendanceServer({ fresh: true });
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const reg = findStaffRegister(state, todayIst(), ay);
  const mark = reg?.marks.find((m) => m.staffId === staffId);
  if (!mark) return null;
  return { inTime: mark.inTime || "", outTime: mark.outTime || "" };
}

/** Is this staff member exempt from attendance — the same list the register uses? */
export async function staffAttendanceExempt(staffId: string): Promise<boolean> {
  const state = await loadStaffAttendanceServer();
  return (await exemptStaffIdsServer(normalizeAttendanceSettings(state.settings))).has(staffId);
}

/**
 * Approved leave onto the days whose register already exists — today, once
 * anyone has punched. Days with no register yet need nothing: the register
 * created on that day starts this person as on leave (upsertStaffMarkInState).
 * Returns how many days were marked.
 */
export async function markApprovedLeaveOnRegisters(opts: {
  staffId: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  typeCode: string;
  by: string;
}): Promise<number> {
  let state = await loadStaffAttendanceFresh();
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const roster = masters.staff ?? [];
  let marked = 0;
  const end = opts.halfDay ? opts.fromDate : opts.toDate;
  for (let d = opts.fromDate; d <= end; ) {
    if (findStaffRegister(state, d, ay)) {
      const merged = upsertStaffMarkInState(state, {
        academicYearCode: ay,
        date: d,
        staffId: opts.staffId,
        status: opts.halfDay ? "HD" : "LE",
        note: opts.halfDay ? `Half-day leave (${opts.typeCode})` : `On leave (${opts.typeCode})`,
        punchWay: "leave_sync",
        markedBy: opts.by,
        roster,
      });
      state = merged.state;
      // One day's register at a time, confirmed by the database — the same
      // way a punch is saved.
      if ((await saveStaffPunchRegister(state, merged.register)).ok) marked += 1;
    }
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return marked;
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
    return `*Attendance* — ${date}\n\nNo punch yet. To punch IN, send your location: 📎 → *Location* → *Send your current location*.`;
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
    "To punch, send your location: 📎 → *Location* → *Send your current location*.",
  ]
    .filter(Boolean)
    .join("\n");
}
