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
  halfDayLeaveMark,
  isHalfDayLeaveMark,
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
 * decides the status — "HD" once the person has come in for the other half
 * (lib/staffAttendance.ts halfDayLeaveMark). */
function halfDayLeave(m: { note?: string } | undefined): boolean {
  return isHalfDayLeaveMark(m ? { note: m.note || "" } : undefined);
}

/** The half-day note once the other half has been punched. */
function workedHalfNote(note: string): string {
  return note.replace(" · not punched for the ", " · worked the ");
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
  /** GPS / location pin. Not used (and may be omitted) for a QR punch. */
  geo?: PunchGeoInput;
  /**
   * "qr": presence was proven by the office screen's rotating code (and,
   * in the app, by the phone's registered signing key) — checked by the
   * caller. The geofence is then not consulted: the code says "at the gate
   * a moment ago", which a GPS pin cannot (director, 30 Sep 2026).
   */
  presence?: "qr" | "printed_qr";
  /** Punch channel: WhatsApp location share (default) or the mobile app's GPS. */
  via?: "whatsapp" | "app";
  /** Confirmed early check-out — appended to the register note so HR sees it */
  earlyOutNote?: string;
  /** The year to file the punch under; the app's GET reads the same one. */
  academicYearCode?: string;
  /**
   * Record the punch at an earlier moment of TODAY (IST) instead of now —
   * the office approving a new phone records the attempt the old phone
   * rule refused, at the time it was made (director, 30 Sep 2026). Only for
   * attempts that already passed the office-screen code check.
   */
  at?: { date: string; time: string };
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

  // The printed gate QR is checked by the caller the same way (registered
  // phone + live GPS inside the campus + the gate window); the register
  // records which one it was so the office can watch the printed punches.
  const qr = opts.presence === "qr" || opts.presence === "printed_qr";
  let check: { ok: boolean; reason?: string; distanceM: number } = { ok: true, distanceM: 0 };
  if (!qr) {
    if (!opts.geo) return { ok: false, error: "Location required." };
    const fence = campusGeofenceFromSettings(settings);
    check = validateStaffPunchLocation(opts.geo, fence);
    if (!check.ok) {
      return { ok: false, error: check.reason || "Outside school geofence." };
    }
  }

  const masters = loadMasters();
  const ay = opts.academicYearCode || currentAcademicYearCode(masters);
  const date = opts.at?.date || todayIst();
  const roster = masters.staff ?? [];
  const saveFailed = {
    ok: false as const,
    error:
      via === "app"
        ? "Your punch could not be saved to the school database. Please try again."
        : "Could not save your punch — please try again in a minute.",
  };
  const time = opts.at?.time || nowHhmmIst();
  const altMobile =
    via === "whatsapp" && staffMobileMatchedAlt(opts.staff, opts.mobile10);
  const geoAudit =
    !qr && opts.geo
      ? punchGeoFromInput(opts.geo, check.distanceM, via === "app" ? "app_gps" : "wa_location")
      : undefined;
  const channelLabel = qr
    ? via === "app"
      ? "Office QR (own phone)"
      : "Office QR code on WhatsApp"
    : via === "app"
      ? "App"
      : "WhatsApp";
  const punchWay =
    opts.presence === "printed_qr"
      ? ("printed_qr" as const)
      : via === "app"
        ? ("self" as const)
        : ("whatsapp" as const);
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
      qr ? `${channelLabel} punch-in` : `${channelLabel} campus punch-in`,
      halfDayLeave(cur) ? workedHalfNote(cur!.note) : `${graded.label} (${graded.ruleName})`,
      altMobile ? "alt mobile" : null,
      qr ? null : `~${formatDistanceLabel(check.distanceM)} from school`,
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
    qr ? `${channelLabel} punch` : `${channelLabel} campus punch`,
    halfDayLeave(cur) ? workedHalfNote(cur.note) : `${gradedOut.label} (${gradedOut.ruleName})`,
    `OUT ${time}`,
    opts.earlyOutNote || null,
    altMobile ? "alt mobile" : null,
    qr ? null : `~${formatDistanceLabel(check.distanceM)} from school`,
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
  halfDaySession?: import("@/lib/staffHr").HalfDaySession;
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
    const reg = findStaffRegister(state, d, ay);
    if (reg) {
      const cur = reg.marks.find((m) => m.staffId === opts.staffId);
      // A half day counts only once the other half is punched; a punch
      // already on the register keeps its times and becomes "HD".
      const leaveMark = opts.halfDay
        ? halfDayLeaveMark(cur, { typeCode: opts.typeCode, halfDaySession: opts.halfDaySession })
        : { status: "LE" as const, note: `On leave (${opts.typeCode})`, punchWay: "leave_sync" as const };
      const merged = upsertStaffMarkInState(state, {
        academicYearCode: ay,
        date: d,
        staffId: opts.staffId,
        status: leaveMark.status,
        note: leaveMark.note,
        punchWay: leaveMark.punchWay,
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
    return `*Attendance* — ${date}\n\nNo punch yet. To punch IN, send *IN* with the 6-digit code on the office QR screen — e.g. _IN 482913_.`;
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
    "To punch, send *IN* or *OUT* with the 6-digit code on the office QR screen — e.g. _OUT 482913_.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Write ONE member of staff's mark for one day, server-side: fresh read,
 * single-register write confirmed by the database. The field-survey bridge
 * used to write the browser's copy, which only staff.edit could save — a
 * surveyor's Start/End never reached the register.
 */
export async function applyStaffDayMarkServer(opts: {
  staffId: string;
  date: string;
  academicYearCode?: string;
  markedBy: string;
  build: (existing: import("@/lib/staffAttendance").StaffAttendanceMark | null) => {
    status: import("@/lib/attendance").AttendanceStatus;
    inTime?: string;
    outTime?: string;
    note: string;
    punchWay: import("@/lib/staffAttendance").AttendancePunchWay;
  };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const state = await loadStaffAttendanceFresh();
  const settings = normalizeAttendanceSettings(state.settings);
  const masters = loadMasters();
  const ay = opts.academicYearCode || currentAcademicYearCode(masters);
  const exempt = await exemptStaffIdsServer(settings);
  const roster = (masters.staff ?? []).filter((s) => !exempt.has(s.id));
  const existing =
    findStaffRegister(state, opts.date, ay)?.marks.find((m) => m.staffId === opts.staffId) ??
    null;
  const next = opts.build(existing);
  const merged = upsertStaffMarkInState(state, {
    academicYearCode: ay,
    date: opts.date,
    staffId: opts.staffId,
    ...next,
    markedBy: opts.markedBy,
    roster,
  });
  const saved = await saveStaffPunchRegister(merged.state, merged.register);
  return saved.ok
    ? { ok: true }
    : { ok: false, error: "Attendance could not be saved to the school database. Please try again." };
}

/**
 * Outdoor duty check-out / check-in, server-side. Same rules as the desk
 * (lib/staffAttendance.ts start/endOutdoorDuty), computed on a fresh copy;
 * writes that day's register and the one duty session. Until 2026-09-29 the
 * browser pushed the whole staff register for this — refused for anyone
 * who is not office — so outdoor duty never saved for a teacher.
 */
export async function applyOutdoorDutyServer(opts: {
  staff: StaffRecord;
  action: "start" | "end";
  purpose?: import("@/lib/staffAttendance").OutdoorDutyPurpose;
  destination?: string;
  note?: string;
  sessionId?: string;
  geo?: import("@/lib/staffAttendance").OutdoorDutyGeoPoint | null;
  actorName: string;
  academicYearCode: string;
}): Promise<
  | { ok: true; session: import("@/lib/staffAttendance").OutdoorDutySession }
  | { ok: false; error: string }
> {
  const { startOutdoorDuty, endOutdoorDuty } = await import("@/lib/staffAttendance");
  const state = await loadStaffAttendanceFresh();
  const masters = loadMasters();
  const roster = masters.staff ?? [];
  const r =
    opts.action === "start"
      ? startOutdoorDuty({
          academicYearCode: opts.academicYearCode,
          staffId: opts.staff.id,
          purpose: opts.purpose ?? "other",
          destination: opts.destination || "",
          note: opts.note,
          startGeo: opts.geo ?? null,
          createdBy: opts.actorName,
          roster,
          state,
          persist: false,
        })
      : endOutdoorDuty({
          academicYearCode: opts.academicYearCode,
          sessionId: opts.sessionId || "",
          staffId: opts.staff.id,
          endGeo: opts.geo ?? null,
          markedBy: opts.actorName,
          roster,
          state,
          persist: false,
        });
  if (!r.ok) return r;
  const { pushStaffAttendanceOutdoorDutyToDb } = await import(
    "@/lib/staffAttendanceOutdoorDuty.server"
  );
  const od = await pushStaffAttendanceOutdoorDutyToDb([r.session]).catch(
    (e: unknown) => ({ ok: false as const, count: 0, error: (e as Error)?.message }),
  );
  if (!od.ok) {
    console.error("[outdoor duty] session push failed", od.error);
    return { ok: false, error: "Outdoor duty could not be saved to the school database. Please try again." };
  }
  const saved = await saveStaffPunchRegister(r.state, r.register);
  if (!saved.ok) {
    return { ok: false, error: "Outdoor duty was saved but the day's attendance was not. Please try again." };
  }
  return { ok: true, session: r.session };
}
