/**
 * Staff daily attendance — separate from student section registers.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/lib/attendance";
import type { StaffRecord } from "@/lib/foundationMasters";
import { DEFAULT_AY } from "@/lib/masters";
import { loadStaffHr } from "@/lib/staffHr";

/** How this attendance mark was captured */
export type AttendancePunchWay =
  | "manual"
  | "self"
  | "rfid"
  | "biometric"
  | "direct"
  | "adjusted"
  | "leave_sync"
  | "rule"
  | "survey";

export const ATTENDANCE_PUNCH_WAYS: {
  code: AttendancePunchWay;
  label: string;
  short: string;
}[] = [
  { code: "manual", label: "Manual", short: "Manual" },
  { code: "self", label: "Self punch", short: "Self" },
  { code: "rfid", label: "RFID card", short: "RFID" },
  { code: "biometric", label: "Biometric", short: "Bio" },
  { code: "direct", label: "Direct mark", short: "Direct" },
  { code: "adjusted", label: "Adjusted", short: "Adj" },
  { code: "leave_sync", label: "Leave sync", short: "Leave" },
  { code: "rule", label: "Punch rules", short: "Rule" },
  { code: "survey", label: "Field survey", short: "Survey" },
];

export function punchWayLabel(way: string | undefined): string {
  if (!way) return "—";
  return ATTENDANCE_PUNCH_WAYS.find((w) => w.code === way)?.label ?? way;
}

export function punchWayShort(way: string | undefined): string {
  if (!way) return "—";
  return ATTENDANCE_PUNCH_WAYS.find((w) => w.code === way)?.short ?? way;
}

export type StaffAttendanceMark = {
  staffId: string;
  status: AttendanceStatus;
  note: string;
  /** HH:mm punch-in (optional; used with attendance rules) */
  inTime: string;
  /** HH:mm punch-out (optional) */
  outTime: string;
  /** Channel / way attendance was marked */
  punchWay: AttendancePunchWay | "";
};

export type StaffAttendanceRegister = {
  id: string;
  academicYearCode: string;
  date: string;
  marks: StaffAttendanceMark[];
  markedBy: string;
  markedAt: string;
  remark: string;
};

export type StaffAttendanceSettings = {
  /** Staff can punch their own attendance */
  allowSelfPunch: boolean;
  /** When saving the day register, run punch rules automatically */
  autoApplyRulesOnSave: boolean;
  /** Overlay approved leave as LE / HD when loading or syncing a date */
  syncLeaveToAttendance: boolean;
};

export type StaffAttendanceState = {
  version: 1;
  settings: StaffAttendanceSettings;
  registers: StaffAttendanceRegister[];
};

const STORAGE_KEY = "bhb_staff_attendance_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultAttendanceSettings(): StaffAttendanceSettings {
  return {
    allowSelfPunch: true,
    autoApplyRulesOnSave: false,
    syncLeaveToAttendance: true,
  };
}

export function normalizeAttendanceSettings(
  s?: Partial<StaffAttendanceSettings> | null,
): StaffAttendanceSettings {
  const d = defaultAttendanceSettings();
  return {
    allowSelfPunch:
      typeof s?.allowSelfPunch === "boolean"
        ? s.allowSelfPunch
        : d.allowSelfPunch,
    autoApplyRulesOnSave:
      typeof s?.autoApplyRulesOnSave === "boolean"
        ? s.autoApplyRulesOnSave
        : d.autoApplyRulesOnSave,
    syncLeaveToAttendance:
      typeof s?.syncLeaveToAttendance === "boolean"
        ? s.syncLeaveToAttendance
        : d.syncLeaveToAttendance,
  };
}

export function emptyStaffAttendanceState(): StaffAttendanceState {
  return {
    version: 1,
    settings: defaultAttendanceSettings(),
    registers: [],
  };
}

function normalizeRegister(
  r: Partial<StaffAttendanceRegister>,
): StaffAttendanceRegister {
  return {
    id: r.id || nid("sar"),
    academicYearCode: r.academicYearCode || DEFAULT_AY,
    date: r.date || "",
    marks: Array.isArray(r.marks)
      ? r.marks.map((m) => {
          const way = (m as StaffAttendanceMark).punchWay;
          return {
            staffId: m.staffId || "",
            status: (ATTENDANCE_STATUSES.some((s) => s.code === m.status)
              ? m.status
              : "P") as AttendanceStatus,
            note: m.note || "",
            inTime: typeof m.inTime === "string" ? m.inTime : "",
            outTime: typeof m.outTime === "string" ? m.outTime : "",
            punchWay: (ATTENDANCE_PUNCH_WAYS.some((w) => w.code === way)
              ? way
              : "") as AttendancePunchWay | "",
          };
        })
      : [],
    markedBy: r.markedBy || "",
    markedAt: r.markedAt || "",
    remark: r.remark || "",
  };
}

function normalizeState(
  raw: Partial<StaffAttendanceState>,
): StaffAttendanceState {
  return {
    version: 1,
    settings: normalizeAttendanceSettings(
      (raw as { settings?: Partial<StaffAttendanceSettings> }).settings,
    ),
    registers: Array.isArray(raw.registers)
      ? raw.registers.map(normalizeRegister)
      : [],
  };
}

export function loadStaffAttendance(): StaffAttendanceState {
  if (typeof window === "undefined") return emptyStaffAttendanceState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStaffAttendanceState();
    const parsed = JSON.parse(raw) as StaffAttendanceState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.registers)) {
      return emptyStaffAttendanceState();
    }
    return normalizeState(parsed);
  } catch {
    return emptyStaffAttendanceState();
  }
}

export function saveStaffAttendance(state: StaffAttendanceState) {
  if (!assertModulePermission("staff", "edit", "saveStaffAttendance")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
  void import("@/lib/staffAttendancePersistence").then(
    ({ scheduleStaffAttendanceSync }) => {
      scheduleStaffAttendanceSync(state);
    },
  );
}

export function writeStaffAttendanceLocalRaw(state: StaffAttendanceState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
}

export function staffAttendanceStateIsEmpty(
  state: StaffAttendanceState,
): boolean {
  return (state.registers?.length ?? 0) === 0;
}

export function saveAttendanceSettings(
  patch: Partial<StaffAttendanceSettings>,
): StaffAttendanceState {
  const state = loadStaffAttendance();
  const next = {
    ...state,
    settings: normalizeAttendanceSettings({
      ...state.settings,
      ...patch,
    }),
  };
  saveStaffAttendance(next);
  return next;
}

export function findStaffRegister(
  state: StaffAttendanceState,
  date: string,
  academicYearCode: string,
): StaffAttendanceRegister | null {
  return (
    state.registers.find(
      (r) => r.date === date && r.academicYearCode === academicYearCode,
    ) ?? null
  );
}

export function defaultStaffMarks(
  staff: StaffRecord[],
): StaffAttendanceMark[] {
  return staff
    .filter((s) => s.status === "active")
    .map((s) => ({
      staffId: s.id,
      status: "P" as AttendanceStatus,
      note: "",
      inTime: "",
      outTime: "",
      punchWay: "" as const,
    }));
}

/** Overlay approved leave onto marks for a date (LE or HD). */
export function applyApprovedLeaveToMarks(
  marks: StaffAttendanceMark[],
  date: string,
  academicYearCode: string,
): StaffAttendanceMark[] {
  const hr = loadStaffHr();
  const leaves = hr.leaveRequests.filter(
    (r) =>
      r.status === "approved" &&
      r.academicYearCode === academicYearCode &&
      r.fromDate <= date &&
      r.toDate >= date,
  );
  if (leaves.length === 0) return marks;
  const byStaff = new Map(leaves.map((r) => [r.staffId, r]));
  return marks.map((m) => {
    const leave = byStaff.get(m.staffId);
    if (!leave) return m;
    if (leave.halfDay) {
      return {
        ...m,
        status: "HD" as const,
        note: `Half-day leave (${leave.typeCode})`,
        punchWay: "leave_sync" as const,
      };
    }
    return {
      ...m,
      status: "LE" as const,
      note: `On leave (${leave.typeCode})`,
      punchWay: "leave_sync" as const,
    };
  });
}

export function upsertStaffRegister(input: {
  academicYearCode: string;
  date: string;
  marks: StaffAttendanceMark[];
  markedBy: string;
  remark?: string;
  /** When true (default from settings), overlay approved leave */
  applyLeave?: boolean;
}): StaffAttendanceRegister {
  const state = loadStaffAttendance();
  const settings = normalizeAttendanceSettings(state.settings);
  const applyLeave =
    typeof input.applyLeave === "boolean"
      ? input.applyLeave
      : settings.syncLeaveToAttendance;
  const marks = applyLeave
    ? applyApprovedLeaveToMarks(
        input.marks,
        input.date,
        input.academicYearCode,
      )
    : input.marks;

  const existing = findStaffRegister(
    state,
    input.date,
    input.academicYearCode,
  );
  const row: StaffAttendanceRegister = {
    id: existing?.id ?? nid("sar"),
    academicYearCode: input.academicYearCode,
    date: input.date,
    marks,
    markedBy: input.markedBy,
    markedAt: new Date().toISOString(),
    remark: input.remark ?? "",
  };
  const registers = existing
    ? state.registers.map((r) => (r.id === existing.id ? row : r))
    : [row, ...state.registers];
  saveStaffAttendance({ ...state, version: 1, registers });
  return row;
}

/** Ensure a register exists for the date, then patch one staff mark. */
export function upsertStaffMark(input: {
  academicYearCode: string;
  date: string;
  staffId: string;
  status: AttendanceStatus;
  inTime?: string;
  outTime?: string;
  note?: string;
  punchWay?: AttendancePunchWay | "";
  markedBy: string;
  roster: StaffRecord[];
}):
  | { ok: true; register: StaffAttendanceRegister }
  | { ok: false; error: string } {
  if (!input.staffId) return { ok: false, error: "Select a staff member" };
  if (!input.date) return { ok: false, error: "Date is required" };

  const state = loadStaffAttendance();
  const existing = findStaffRegister(
    state,
    input.date,
    input.academicYearCode,
  );
  let marks = existing
    ? [...existing.marks]
    : defaultStaffMarks(input.roster);

  const idx = marks.findIndex((m) => m.staffId === input.staffId);
  const base: StaffAttendanceMark =
    idx >= 0
      ? marks[idx]!
      : {
          staffId: input.staffId,
          status: "P",
          note: "",
          inTime: "",
          outTime: "",
          punchWay: "",
        };
  const nextMark: StaffAttendanceMark = {
    staffId: input.staffId,
    status: input.status,
    note: input.note !== undefined ? input.note : base.note,
    inTime: input.inTime !== undefined ? input.inTime : base.inTime,
    outTime: input.outTime !== undefined ? input.outTime : base.outTime,
    punchWay:
      input.punchWay !== undefined ? input.punchWay : base.punchWay || "manual",
  };
  if (idx >= 0) marks[idx] = nextMark;
  else marks.push(nextMark);

  const register = upsertStaffRegister({
    academicYearCode: input.academicYearCode,
    date: input.date,
    marks,
    markedBy: input.markedBy,
    remark: existing?.remark ?? "",
    applyLeave: false,
  });
  return { ok: true, register };
}

export function adjustStaffAttendance(input: {
  academicYearCode: string;
  date: string;
  staffId: string;
  status: AttendanceStatus;
  inTime: string;
  outTime: string;
  note?: string;
  markedBy: string;
  roster: StaffRecord[];
}): ReturnType<typeof upsertStaffMark> {
  return upsertStaffMark({
    ...input,
    note: input.note ?? `Adjusted by ${input.markedBy}`,
    punchWay: "adjusted",
  });
}

export function adjustStaffHalfDayAttendance(input: {
  academicYearCode: string;
  date: string;
  staffId: string;
  halfDay: boolean;
  markedBy: string;
  roster: StaffRecord[];
}): ReturnType<typeof upsertStaffMark> {
  const state = loadStaffAttendance();
  const existing = findStaffRegister(
    state,
    input.date,
    input.academicYearCode,
  );
  const cur = existing?.marks.find((m) => m.staffId === input.staffId);
  return upsertStaffMark({
    academicYearCode: input.academicYearCode,
    date: input.date,
    staffId: input.staffId,
    status: input.halfDay
      ? "HD"
      : cur?.status === "HD"
        ? "P"
        : (cur?.status ?? "P"),
    inTime: cur?.inTime ?? "",
    outTime: cur?.outTime ?? "",
    note: input.halfDay
      ? `Half-day adjusted by ${input.markedBy}`
      : `Full day adjusted by ${input.markedBy}`,
    punchWay: "adjusted",
    markedBy: input.markedBy,
    roster: input.roster,
  });
}

/** Sync all approved leave for a date onto the day register. */
export function syncLeaveOntoAttendanceDate(input: {
  academicYearCode: string;
  date: string;
  markedBy: string;
  roster: StaffRecord[];
}): StaffAttendanceRegister {
  const state = loadStaffAttendance();
  const existing = findStaffRegister(
    state,
    input.date,
    input.academicYearCode,
  );
  const base = existing ? existing.marks : defaultStaffMarks(input.roster);
  return upsertStaffRegister({
    academicYearCode: input.academicYearCode,
    date: input.date,
    marks: applyApprovedLeaveToMarks(
      base,
      input.date,
      input.academicYearCode,
    ),
    markedBy: input.markedBy,
    remark: existing?.remark ?? "Synced from approved leave",
    applyLeave: false,
  });
}

export function summarizeStaffMarks(marks: StaffAttendanceMark[]) {
  const counts: Record<string, number> = {};
  for (const m of marks) {
    counts[m.status] = (counts[m.status] ?? 0) + 1;
  }
  return counts;
}

export function nowHhmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
