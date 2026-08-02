/**
 * Class attendance — daily section registers (demo localStorage).
 * Never gated by fee holds / defaulter playbook.
 *
 * Policy: teacher cut-off lock, absent WhatsApp nudges, office exceptions.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { getSessionActor } from "@/lib/sessionActor";
import { hasPermission } from "@/lib/rbac";
import { DEFAULT_AY, loadMasters } from "@/lib/masters";
import {
  householdOf,
  householdWhatsApp,
  loadSis,
  type SisStudent,
} from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { openWaMe, waMeUrl } from "@/lib/waMe";

export type AttendanceStatus = "P" | "A" | "L" | "HD" | "LE";

export const ATTENDANCE_STATUSES: {
  code: AttendanceStatus;
  label: string;
  short: string;
}[] = [
  { code: "P", label: "Present", short: "P" },
  { code: "A", label: "Absent", short: "A" },
  { code: "L", label: "Late", short: "L" },
  { code: "HD", label: "Half day", short: "HD" },
  { code: "LE", label: "Leave / excused", short: "LE" },
];

export type AttendanceMark = {
  studentId: string;
  status: AttendanceStatus;
  note: string;
};

export type AttendanceRegister = {
  id: string;
  academicYearCode: string;
  campusId: string;
  classId: string;
  sectionId: string;
  /** Attendance date YYYY-MM-DD */
  date: string;
  marks: AttendanceMark[];
  markedBy: string;
  markedAt: string;
  /** Optional teacher note for the day */
  remark: string;
};

export type AttendancePolicy = {
  /** HH:MM in Asia/Kolkata — teachers cannot edit after this on the register date */
  teacherCutoffTime: string;
  lockTeachersAfterCutoff: boolean;
  absentNudgeEnabled: boolean;
  /** Cap how many wa.me tabs open after one save */
  absentNudgeMaxOpen: number;
};

export type AbsentNudgeLog = {
  id: string;
  studentId: string;
  registerId: string;
  date: string;
  sectionId: string;
  academicYearCode: string;
  mobile: string;
  message: string;
  sentAt: string;
  sentBy: string;
};

export type AttendanceExceptionKind =
  | "present_on_leave"
  | "late_on_leave"
  | "absent_no_whatsapp"
  | "perfect_present_streak"
  | "parent_dispute";

export type AttendanceExceptionStatus = "open" | "resolved";

export type AttendanceException = {
  id: string;
  kind: AttendanceExceptionKind;
  status: AttendanceExceptionStatus;
  studentId: string;
  academicYearCode: string;
  classId: string;
  sectionId: string;
  date: string;
  registerId: string;
  detail: string;
  createdAt: string;
  resolvedAt: string;
  resolvedBy: string;
  resolveNote: string;
};

export type AttendanceState = {
  version: 2;
  registers: AttendanceRegister[];
  policy: AttendancePolicy;
  absentNudges: AbsentNudgeLog[];
  exceptions: AttendanceException[];
};

const STORAGE_KEY = "bhb_attendance_v1";

let serverAttendanceCache: AttendanceState | null = null;

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  teacherCutoffTime: "10:30",
  lockTeachersAfterCutoff: true,
  absentNudgeEnabled: true,
  absentNudgeMaxOpen: 12,
};

const PERFECT_STREAK_DAYS = 8;

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function todayIso() {
  return istDateParts(new Date()).date;
}

/** Asia/Kolkata calendar date + clock parts. */
export function istDateParts(now = new Date()): {
  date: string;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === "24" ? "0" : parts.hour) || 0,
    minute: Number(parts.minute) || 0,
  };
}

export function parseCutoffHm(hm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm || "").trim());
  if (!m) return { hour: 10, minute: 30 };
  return {
    hour: Math.min(23, Math.max(0, Number(m[1]))),
    minute: Math.min(59, Math.max(0, Number(m[2]))),
  };
}

export function isPastCutoffIst(
  cutoffHm: string,
  now = new Date(),
): boolean {
  const { hour, minute } = istDateParts(now);
  const cut = parseCutoffHm(cutoffHm);
  return hour > cut.hour || (hour === cut.hour && minute >= cut.minute);
}

export function attendanceStatusLabel(code: AttendanceStatus): string {
  return ATTENDANCE_STATUSES.find((s) => s.code === code)?.label ?? code;
}

export function emptyAttendanceState(): AttendanceState {
  return {
    version: 2,
    registers: [],
    policy: { ...DEFAULT_ATTENDANCE_POLICY },
    absentNudges: [],
    exceptions: [],
  };
}

function normalizePolicy(raw?: Partial<AttendancePolicy> | null): AttendancePolicy {
  return {
    teacherCutoffTime:
      typeof raw?.teacherCutoffTime === "string" &&
      /^\d{1,2}:\d{2}$/.test(raw.teacherCutoffTime.trim())
        ? raw.teacherCutoffTime.trim()
        : DEFAULT_ATTENDANCE_POLICY.teacherCutoffTime,
    lockTeachersAfterCutoff:
      raw?.lockTeachersAfterCutoff !== undefined
        ? !!raw.lockTeachersAfterCutoff
        : DEFAULT_ATTENDANCE_POLICY.lockTeachersAfterCutoff,
    absentNudgeEnabled:
      raw?.absentNudgeEnabled !== undefined
        ? !!raw.absentNudgeEnabled
        : DEFAULT_ATTENDANCE_POLICY.absentNudgeEnabled,
    absentNudgeMaxOpen: Math.min(
      40,
      Math.max(
        1,
        Number(raw?.absentNudgeMaxOpen) ||
          DEFAULT_ATTENDANCE_POLICY.absentNudgeMaxOpen,
      ),
    ),
  };
}

function normalizeNudge(n: AbsentNudgeLog): AbsentNudgeLog {
  return {
    id: n.id || id("an"),
    studentId: n.studentId || "",
    registerId: n.registerId || "",
    date: n.date || "",
    sectionId: n.sectionId || "",
    academicYearCode: n.academicYearCode || DEFAULT_AY,
    mobile: n.mobile || "",
    message: n.message || "",
    sentAt: n.sentAt || new Date().toISOString(),
    sentBy: n.sentBy || "",
  };
}

function normalizeException(e: AttendanceException): AttendanceException {
  return {
    id: e.id || id("aex"),
    kind: e.kind || "parent_dispute",
    status: e.status === "resolved" ? "resolved" : "open",
    studentId: e.studentId || "",
    academicYearCode: e.academicYearCode || DEFAULT_AY,
    classId: e.classId || "",
    sectionId: e.sectionId || "",
    date: e.date || "",
    registerId: e.registerId || "",
    detail: e.detail || "",
    createdAt: e.createdAt || new Date().toISOString(),
    resolvedAt: e.resolvedAt || "",
    resolvedBy: e.resolvedBy || "",
    resolveNote: e.resolveNote || "",
  };
}

export function normalizeAttendanceState(raw: unknown): AttendanceState {
  const empty = emptyAttendanceState();
  if (!raw || typeof raw !== "object") return empty;
  const p = raw as Partial<AttendanceState> & { version?: number };
  if (!Array.isArray(p.registers)) return empty;
  return {
    version: 2,
    registers: p.registers.map(normalizeRegister),
    policy: normalizePolicy(p.policy),
    absentNudges: Array.isArray(p.absentNudges)
      ? p.absentNudges.map(normalizeNudge)
      : [],
    exceptions: Array.isArray(p.exceptions)
      ? p.exceptions.map(normalizeException)
      : [],
  };
}

export function loadAttendance(): AttendanceState {
  if (typeof window === "undefined") {
    if (serverAttendanceCache) return serverAttendanceCache;
    return emptyAttendanceState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAttendanceState();
    return normalizeAttendanceState(JSON.parse(raw));
  } catch {
    return emptyAttendanceState();
  }
}

export function saveAttendance(state: AttendanceState) {
  if (typeof window !== "undefined") {
    if (!assertModulePermission("attendance", "edit", "saveAttendance")) return;
  }

  const next = normalizeAttendanceState(state);
  if (typeof window === "undefined") {
    writeAttendanceLocalRaw(next);
    void import("@/lib/attendancePersistence").then(
      ({ scheduleAttendanceSync }) => {
        scheduleAttendanceSync(next);
      },
    );
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  void import("@/lib/attendancePersistence").then(
    ({ scheduleAttendanceSync }) => {
      scheduleAttendanceSync(next);
    },
  );
}

export function writeAttendanceLocalRaw(state: AttendanceState) {
  const next = normalizeAttendanceState(state);
  if (typeof window === "undefined") {
    serverAttendanceCache = next;
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function attendanceStateIsEmpty(state: AttendanceState): boolean {
  return (state.registers?.length ?? 0) === 0;
}

function normalizeRegister(r: AttendanceRegister): AttendanceRegister {
  return {
    id: r.id || id("ar"),
    academicYearCode: r.academicYearCode || DEFAULT_AY,
    campusId: r.campusId || "",
    classId: r.classId || "",
    sectionId: r.sectionId || "",
    date: r.date || todayIso(),
    marks: Array.isArray(r.marks)
      ? r.marks.map((m) => ({
          studentId: m.studentId,
          status: (m.status as AttendanceStatus) || "P",
          note: m.note || "",
        }))
      : [],
    markedBy: r.markedBy || "",
    markedAt: r.markedAt || new Date().toISOString(),
    remark: r.remark || "",
  };
}

export function registerKey(
  academicYearCode: string,
  sectionId: string,
  date: string,
): string {
  return `${academicYearCode}|${sectionId}|${date}`;
}

export function findRegister(
  academicYearCode: string,
  sectionId: string,
  date: string,
  state?: AttendanceState,
): AttendanceRegister | undefined {
  const s = state ?? loadAttendance();
  return s.registers.find(
    (r) =>
      r.academicYearCode === academicYearCode &&
      r.sectionId === sectionId &&
      r.date === date,
  );
}

export function summarizeMarks(marks: AttendanceMark[]): {
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
  total: number;
} {
  const out = {
    present: 0,
    absent: 0,
    late: 0,
    halfDay: 0,
    leave: 0,
    total: marks.length,
  };
  for (const m of marks) {
    if (m.status === "P") out.present += 1;
    else if (m.status === "A") out.absent += 1;
    else if (m.status === "L") out.late += 1;
    else if (m.status === "HD") out.halfDay += 1;
    else if (m.status === "LE") out.leave += 1;
  }
  return out;
}

/** Active students in a section, sorted by roll then name. */
export function rosterForSection(
  students: SisStudent[],
  sectionId: string,
  options?: { classId?: string; academicYearCode?: string },
): SisStudent[] {
  const ay = options?.academicYearCode;
  const classId = options?.classId;
  return students
    .filter((st) => {
      if (st.status !== "active") return false;
      if (st.sectionId !== sectionId) return false;
      if (classId && st.classId !== classId) return false;
      if (ay && st.academicYearCode && st.academicYearCode !== ay) return false;
      return true;
    })
    .sort((a, b) => {
      const ra = Number(a.rollNo) || 0;
      const rb = Number(b.rollNo) || 0;
      if (ra !== rb) return ra - rb;
      return a.fullName.localeCompare(b.fullName);
    });
}

export function defaultMarksForRoster(
  roster: SisStudent[],
  existing?: AttendanceRegister | null,
): AttendanceMark[] {
  const byId = new Map(existing?.marks.map((m) => [m.studentId, m]) ?? []);
  return roster.map((st) => {
    const prev = byId.get(st.id);
    return {
      studentId: st.id,
      status: prev?.status ?? "P",
      note: prev?.note ?? "",
    };
  });
}

export function getAttendancePolicy(state?: AttendanceState): AttendancePolicy {
  return normalizePolicy((state ?? loadAttendance()).policy);
}

export function saveAttendancePolicy(
  patch: Partial<AttendancePolicy>,
): { ok: true; policy: AttendancePolicy } | { ok: false; error: string } {
  if (!assertModulePermission("attendance", "edit", "saveAttendancePolicy")) {
    return { ok: false, error: "Not allowed to edit attendance settings" };
  }
  const state = loadAttendance();
  const policy = normalizePolicy({ ...state.policy, ...patch });
  saveAttendance({ ...state, policy });
  return { ok: true, policy };
}

/**
 * Teachers locked after cut-off on the register date (IST), or any past date.
 * Office/principal with attendance.approve may override.
 */
export function isTeacherAttendanceLocked(
  date: string,
  policy?: AttendancePolicy,
  now = new Date(),
): boolean {
  const p = policy ?? getAttendancePolicy();
  if (!p.lockTeachersAfterCutoff) return false;
  const today = istDateParts(now).date;
  if (date < today) return true;
  if (date > today) return false;
  return isPastCutoffIst(p.teacherCutoffTime, now);
}

export function canOverrideAttendanceLock(
  session = getSessionActor(),
): boolean {
  if (!session) return false;
  const role = (session.roleCode || "").toLowerCase();
  if (role === "principal" || role === "admin" || role === "office") {
    return true;
  }
  if (typeof window === "undefined") return false;
  try {
    const masters = loadMasters();
    return hasPermission(session, masters, "attendance", "approve");
  } catch {
    return false;
  }
}

export function attendanceLockReason(
  date: string,
  policy?: AttendancePolicy,
  now = new Date(),
): string | null {
  if (!isTeacherAttendanceLocked(date, policy, now)) return null;
  const p = policy ?? getAttendancePolicy();
  const today = istDateParts(now).date;
  if (date < today) {
    return `Past date locked after teacher cut-off (${p.teacherCutoffTime} IST). Office can override with a note.`;
  }
  return `Locked after teacher cut-off ${p.teacherCutoffTime} IST. Office can override with a note.`;
}

export function composeAbsentNudgeMessage(input: {
  studentName: string;
  date: string;
  classLabel?: string;
}): string {
  const where = input.classLabel ? ` (${input.classLabel})` : "";
  return (
    `${TENANT.shortName}: ${input.studentName}${where} is marked ABSENT on ${input.date}. ` +
    `Reply OK if correct, or WRONG if the child was present. Thank you.`
  );
}

export type AbsentNudgeDraft = {
  studentId: string;
  studentName: string;
  mobile: string;
  message: string;
  waUrl: string;
};

export function buildAbsentNudgeDrafts(input: {
  register: AttendanceRegister;
  previous?: AttendanceRegister | null;
  students: SisStudent[];
  classLabel?: string;
  maxOpen?: number;
}): AbsentNudgeDraft[] {
  const prevBy = new Map(
    (input.previous?.marks ?? []).map((m) => [m.studentId, m.status]),
  );
  const byId = new Map(input.students.map((s) => [s.id, s]));
  const sis = loadSis();
  const drafts: AbsentNudgeDraft[] = [];
  const cap = Math.max(1, input.maxOpen ?? DEFAULT_ATTENDANCE_POLICY.absentNudgeMaxOpen);

  for (const mark of input.register.marks) {
    if (mark.status !== "A") continue;
    const prev = prevBy.get(mark.studentId);
    if (prev === "A") continue;
    const st = byId.get(mark.studentId);
    if (!st) continue;
    const hh = householdOf(sis, st.householdId);
    const mobile = householdWhatsApp(hh);
    if (!mobile || mobile.length < 10) continue;
    const message = composeAbsentNudgeMessage({
      studentName: st.fullName,
      date: input.register.date,
      classLabel: input.classLabel,
    });
    drafts.push({
      studentId: st.id,
      studentName: st.fullName,
      mobile,
      message,
      waUrl: waMeUrl(mobile, message),
    });
    if (drafts.length >= cap) break;
  }
  return drafts;
}

export function openAbsentNudges(
  drafts: AbsentNudgeDraft[],
  options?: { maxOpen?: number },
): number {
  const cap = Math.max(1, options?.maxOpen ?? drafts.length);
  let opened = 0;
  for (const d of drafts) {
    if (opened >= cap) break;
    openWaMe(d.mobile, d.message);
    opened += 1;
  }
  return opened;
}

export type UpsertRegisterResult =
  | {
      ok: true;
      register: AttendanceRegister;
      lockedOverride: boolean;
      nudges: AbsentNudgeDraft[];
      nudgesOpened: number;
    }
  | { ok: false; error: string; locked?: boolean };

export function upsertRegister(input: {
  academicYearCode: string;
  campusId: string;
  classId: string;
  sectionId: string;
  date: string;
  marks: AttendanceMark[];
  markedBy: string;
  remark?: string;
  /** Leave sync / system writes bypass teacher cut-off */
  skipLockCheck?: boolean;
  /** Required when office overrides a locked register */
  officeOverrideNote?: string;
  /** Open wa.me tabs for newly absent students (default true when policy on) */
  openAbsentNudges?: boolean;
  classLabel?: string;
  students?: SisStudent[];
}): UpsertRegisterResult {
  if (!input.sectionId) return { ok: false, error: "Select a section" };
  if (!input.classId) return { ok: false, error: "Select a class" };
  if (!input.date) return { ok: false, error: "Date is required" };
  if (!input.marks.length) {
    return { ok: false, error: "No students in this section roster" };
  }

  const state = loadAttendance();
  const policy = normalizePolicy(state.policy);
  let lockedOverride = false;

  if (!input.skipLockCheck && isTeacherAttendanceLocked(input.date, policy)) {
    if (!canOverrideAttendanceLock()) {
      return {
        ok: false,
        locked: true,
        error:
          attendanceLockReason(input.date, policy) ||
          "Attendance locked after teacher cut-off",
      };
    }
    const note = (input.officeOverrideNote || "").trim();
    if (!note) {
      return {
        ok: false,
        locked: true,
        error:
          "Office override note required after cut-off (why are you changing this register?)",
      };
    }
    lockedOverride = true;
  }

  const existing = findRegister(
    input.academicYearCode,
    input.sectionId,
    input.date,
    state,
  );
  const remarkBase = input.remark ?? "";
  const remark =
    lockedOverride && input.officeOverrideNote
      ? `${remarkBase}${remarkBase ? " · " : ""}Override: ${input.officeOverrideNote.trim()}`.slice(
          0,
          280,
        )
      : remarkBase;

  const register = normalizeRegister({
    id: existing?.id ?? id("ar"),
    academicYearCode: input.academicYearCode || DEFAULT_AY,
    campusId: input.campusId,
    classId: input.classId,
    sectionId: input.sectionId,
    date: input.date,
    marks: input.marks,
    markedBy: input.markedBy,
    markedAt: new Date().toISOString(),
    remark,
  });

  const nextRegisters = existing
    ? state.registers.map((r) => (r.id === existing.id ? register : r))
    : [register, ...state.registers];

  let nudges: AbsentNudgeDraft[] = [];
  let nudgesOpened = 0;
  let absentNudges = state.absentNudges;

  const shouldNudge =
    policy.absentNudgeEnabled &&
    !input.skipLockCheck &&
    input.openAbsentNudges !== false;

  if (shouldNudge) {
    const students = input.students ?? loadSis().students;
    nudges = buildAbsentNudgeDrafts({
      register,
      previous: existing,
      students,
      classLabel: input.classLabel,
      maxOpen: policy.absentNudgeMaxOpen,
    });
    if (nudges.length && input.openAbsentNudges !== false) {
      nudgesOpened = openAbsentNudges(nudges, {
        maxOpen: policy.absentNudgeMaxOpen,
      });
    }
    const stamp = new Date().toISOString();
    const logs: AbsentNudgeLog[] = nudges.map((d) =>
      normalizeNudge({
        id: id("an"),
        studentId: d.studentId,
        registerId: register.id,
        date: register.date,
        sectionId: register.sectionId,
        academicYearCode: register.academicYearCode,
        mobile: d.mobile,
        message: d.message,
        sentAt: stamp,
        sentBy: input.markedBy,
      }),
    );
    absentNudges = [...logs, ...state.absentNudges].slice(0, 500);
  }

  const nextState: AttendanceState = {
    version: 2,
    registers: nextRegisters,
    policy,
    absentNudges,
    exceptions: state.exceptions,
  };

  // Rebuild exceptions after write (uses leave via dynamic import to avoid cycle)
  const withExceptions = rebuildExceptionsInto(nextState);
  saveAttendance(withExceptions);

  return {
    ok: true,
    register,
    lockedOverride,
    nudges,
    nudgesOpened,
  };
}

function loadApprovedLeaveForDate(
  academicYearCode: string,
  date: string,
): { studentId: string; leaveType: string; reason: string }[] {
  try {
    // Dynamic require avoids studentLeave ↔ attendance cycle
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const leaveMod = require("@/lib/studentLeave") as typeof import("@/lib/studentLeave");
    const state = leaveMod.loadStudentLeave();
    const out: { studentId: string; leaveType: string; reason: string }[] = [];
    for (const req of state.requests) {
      if (req.status !== "approved") continue;
      if (req.academicYearCode !== academicYearCode) continue;
      if (date < req.fromDate || date > req.toDate) continue;
      out.push({
        studentId: req.studentId,
        leaveType: req.leaveType,
        reason: req.reason,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function exceptionFingerprint(e: Pick<
  AttendanceException,
  "kind" | "studentId" | "date" | "sectionId"
>): string {
  return `${e.kind}|${e.studentId}|${e.date}|${e.sectionId}`;
}

/** Recompute auto exceptions; keep resolved + parent disputes. */
export function rebuildExceptionsInto(state: AttendanceState): AttendanceState {
  const sis = loadSis();
  const kept = state.exceptions.filter(
    (e) => e.status === "resolved" || e.kind === "parent_dispute",
  );
  const openManual = state.exceptions.filter(
    (e) => e.status === "open" && e.kind === "parent_dispute",
  );
  const auto: AttendanceException[] = [];
  const seen = new Set(
    [...kept, ...openManual].map((e) => exceptionFingerprint(e)),
  );

  const recentDates = [
    ...new Set(state.registers.map((r) => r.date)),
  ]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 14);

  for (const date of recentDates) {
    const dayRegs = state.registers.filter((r) => r.date === date);
    for (const reg of dayRegs) {
      const leaves = loadApprovedLeaveForDate(reg.academicYearCode, date);
      const leaveByStudent = new Map(leaves.map((l) => [l.studentId, l]));

      for (const mark of reg.marks) {
        const leave = leaveByStudent.get(mark.studentId);
        if (leave && (mark.status === "P" || mark.status === "L")) {
          const kind: AttendanceExceptionKind =
            mark.status === "L" ? "late_on_leave" : "present_on_leave";
          const fp = exceptionFingerprint({
            kind,
            studentId: mark.studentId,
            date,
            sectionId: reg.sectionId,
          });
          if (seen.has(fp)) continue;
          seen.add(fp);
          auto.push(
            normalizeException({
              id: id("aex"),
              kind,
              status: "open",
              studentId: mark.studentId,
              academicYearCode: reg.academicYearCode,
              classId: reg.classId,
              sectionId: reg.sectionId,
              date,
              registerId: reg.id,
              detail: `Marked ${mark.status} while on approved leave (${leave.leaveType})${
                leave.reason ? `: ${leave.reason}` : ""
              }`.slice(0, 200),
              createdAt: new Date().toISOString(),
              resolvedAt: "",
              resolvedBy: "",
              resolveNote: "",
            }),
          );
        }

        if (mark.status === "A") {
          const st = sis.students.find((s) => s.id === mark.studentId);
          if (!st) continue;
          const mobile = householdWhatsApp(householdOf(sis, st.householdId));
          if (mobile && mobile.length >= 10) continue;
          const kind: AttendanceExceptionKind = "absent_no_whatsapp";
          const fp = exceptionFingerprint({
            kind,
            studentId: mark.studentId,
            date,
            sectionId: reg.sectionId,
          });
          if (seen.has(fp)) continue;
          seen.add(fp);
          auto.push(
            normalizeException({
              id: id("aex"),
              kind,
              status: "open",
              studentId: mark.studentId,
              academicYearCode: reg.academicYearCode,
              classId: reg.classId,
              sectionId: reg.sectionId,
              date,
              registerId: reg.id,
              detail: "Marked absent but household has no WhatsApp number",
              createdAt: new Date().toISOString(),
              resolvedAt: "",
              resolvedBy: "",
              resolveNote: "",
            }),
          );
        }
      }
    }
  }

  // Perfect present streak (spot-check candidates)
  const sortedRegs = [...state.registers].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const studentIds = new Set(
    state.registers.flatMap((r) => r.marks.map((m) => m.studentId)),
  );
  for (const studentId of studentIds) {
    const dayMarks: {
      date: string;
      status: AttendanceStatus;
      reg: AttendanceRegister;
    }[] = [];
    const seenDates = new Set<string>();
    for (const reg of sortedRegs) {
      if (seenDates.has(reg.date)) continue;
      const mark = reg.marks.find((m) => m.studentId === studentId);
      if (!mark) continue;
      seenDates.add(reg.date);
      dayMarks.push({ date: reg.date, status: mark.status, reg });
      if (dayMarks.length >= PERFECT_STREAK_DAYS + 2) break;
    }
    let streak = 0;
    for (const d of dayMarks) {
      if (d.status !== "P") break;
      streak += 1;
    }
    if (streak < PERFECT_STREAK_DAYS) continue;
    const head = dayMarks[0]!;
    const kind: AttendanceExceptionKind = "perfect_present_streak";
    const fp = exceptionFingerprint({
      kind,
      studentId,
      date: head.date,
      sectionId: head.reg.sectionId,
    });
    if (seen.has(fp)) continue;
    seen.add(fp);
    auto.push(
      normalizeException({
        id: id("aex"),
        kind,
        status: "open",
        studentId,
        academicYearCode: head.reg.academicYearCode,
        classId: head.reg.classId,
        sectionId: head.reg.sectionId,
        date: head.date,
        registerId: head.reg.id,
        detail: `${streak}+ consecutive Present marks — spot-check candidate`,
        createdAt: new Date().toISOString(),
        resolvedAt: "",
        resolvedBy: "",
        resolveNote: "",
      }),
    );
  }

  return {
    ...state,
    exceptions: [...openManual, ...auto, ...kept].slice(0, 800),
  };
}

export function rebuildAttendanceExceptions(): AttendanceState {
  const next = rebuildExceptionsInto(loadAttendance());
  if (!assertModulePermission("attendance", "edit", "rebuildExceptions")) {
    return next;
  }
  saveAttendance(next);
  return next;
}

export function listOpenAttendanceExceptions(
  state?: AttendanceState,
): AttendanceException[] {
  const s = state ?? loadAttendance();
  return s.exceptions
    .filter((e) => e.status === "open")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function exceptionKindLabel(kind: AttendanceExceptionKind): string {
  switch (kind) {
    case "present_on_leave":
      return "Present on approved leave";
    case "late_on_leave":
      return "Late on approved leave";
    case "absent_no_whatsapp":
      return "Absent · no WhatsApp";
    case "perfect_present_streak":
      return "Perfect Present streak";
    case "parent_dispute":
      return "Parent dispute (WRONG)";
  }
}

export function resolveAttendanceException(input: {
  id: string;
  note: string;
  resolvedBy: string;
}): { ok: true } | { ok: false; error: string } {
  const session = getSessionActor();
  const masters = typeof window !== "undefined" ? loadMasters() : null;
  const allowed =
    !session ||
    hasPermission(session, masters, "attendance", "approve") ||
    hasPermission(session, masters, "attendance", "edit");
  if (!allowed) {
    return { ok: false, error: "Not allowed to resolve exceptions" };
  }
  const note = input.note.trim();
  if (!note) return { ok: false, error: "Add a resolve note" };
  const state = loadAttendance();
  const i = state.exceptions.findIndex((e) => e.id === input.id);
  if (i < 0) return { ok: false, error: "Exception not found" };
  const next = [...state.exceptions];
  next[i] = {
    ...next[i]!,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolvedBy: input.resolvedBy,
    resolveNote: note.slice(0, 240),
  };
  const nextState = { ...state, exceptions: next };
  writeAttendanceLocalRaw(nextState);
  void import("@/lib/attendancePersistence").then(
    ({ scheduleAttendanceSync }) => {
      scheduleAttendanceSync(nextState);
    },
  );
  return { ok: true };
}

export function fileParentAttendanceDispute(input: {
  studentId: string;
  date: string;
  academicYearCode: string;
  detail?: string;
  filedBy?: string;
}): { ok: true; exception: AttendanceException } | { ok: false; error: string } {
  const sis = loadSis();
  const st = sis.students.find((s) => s.id === input.studentId);
  if (!st) return { ok: false, error: "Student not found" };
  const state = loadAttendance();
  const reg = findRegister(
    input.academicYearCode || st.academicYearCode || DEFAULT_AY,
    st.sectionId,
    input.date,
    state,
  );
  const exception = normalizeException({
    id: id("aex"),
    kind: "parent_dispute",
    status: "open",
    studentId: st.id,
    academicYearCode:
      input.academicYearCode || st.academicYearCode || DEFAULT_AY,
    classId: st.classId,
    sectionId: st.sectionId,
    date: input.date,
    registerId: reg?.id || "",
    detail: (
      input.detail ||
      `Parent replied WRONG — marked absent on ${input.date} but claims present`
    ).slice(0, 240),
    createdAt: new Date().toISOString(),
    resolvedAt: "",
    resolvedBy: "",
    resolveNote: "",
  });
  const withoutDup = state.exceptions.filter(
    (e) =>
      !(
        e.status === "open" &&
        e.kind === "parent_dispute" &&
        e.studentId === st.id &&
        e.date === input.date
      ),
  );
  const next = {
    ...state,
    exceptions: [exception, ...withoutDup].slice(0, 800),
  };
  // Parent portal / office may file without edit — write raw then soft-save
  if (assertModulePermission("attendance", "edit", "fileDispute")) {
    saveAttendance(next);
  } else {
    writeAttendanceLocalRaw(next);
    void import("@/lib/attendancePersistence").then(
      ({ scheduleAttendanceSync }) => {
        scheduleAttendanceSync(next);
      },
    );
  }
  return { ok: true, exception };
}

export function listRecentRegisters(
  limit = 12,
  state?: AttendanceState,
): AttendanceRegister[] {
  const s = state ?? loadAttendance();
  return [...s.registers]
    .sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return b.markedAt.localeCompare(a.markedAt);
    })
    .slice(0, limit);
}

export function listRecentAbsentNudges(
  limit = 20,
  state?: AttendanceState,
): AbsentNudgeLog[] {
  const s = state ?? loadAttendance();
  return [...s.absentNudges]
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .slice(0, limit);
}

export function statusTone(status: AttendanceStatus): {
  bg: string;
  text: string;
  ring: string;
} {
  switch (status) {
    case "P":
      return {
        bg: "bg-[#16a34a]",
        text: "text-white",
        ring: "ring-[#16a34a]",
      };
    case "A":
      return {
        bg: "bg-[#dc2626]",
        text: "text-white",
        ring: "ring-[#dc2626]",
      };
    case "L":
      return {
        bg: "bg-[#d97706]",
        text: "text-white",
        ring: "ring-[#d97706]",
      };
    case "HD":
      return {
        bg: "bg-[#2563eb]",
        text: "text-white",
        ring: "ring-[#2563eb]",
      };
    case "LE":
      return {
        bg: "bg-[#7c3aed]",
        text: "text-white",
        ring: "ring-[#7c3aed]",
      };
  }
}
