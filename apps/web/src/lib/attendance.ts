/**
 * Class attendance — daily section registers (demo localStorage).
 * Never gated by fee holds / defaulter playbook.
 */

import { DEFAULT_AY } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";

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

export type AttendanceState = {
  version: 1;
  registers: AttendanceRegister[];
};

const STORAGE_KEY = "bhb_attendance_v1";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function attendanceStatusLabel(code: AttendanceStatus): string {
  return ATTENDANCE_STATUSES.find((s) => s.code === code)?.label ?? code;
}

export function emptyAttendanceState(): AttendanceState {
  return { version: 1, registers: [] };
}

export function loadAttendance(): AttendanceState {
  if (typeof window === "undefined") return emptyAttendanceState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAttendanceState();
    const parsed = JSON.parse(raw) as AttendanceState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.registers)) {
      return emptyAttendanceState();
    }
    return {
      version: 1,
      registers: parsed.registers.map(normalizeRegister),
    };
  } catch {
    return emptyAttendanceState();
  }
}

export function saveAttendance(state: AttendanceState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

export function upsertRegister(input: {
  academicYearCode: string;
  campusId: string;
  classId: string;
  sectionId: string;
  date: string;
  marks: AttendanceMark[];
  markedBy: string;
  remark?: string;
}):
  | { ok: true; register: AttendanceRegister }
  | { ok: false; error: string } {
  if (!input.sectionId) return { ok: false, error: "Select a section" };
  if (!input.classId) return { ok: false, error: "Select a class" };
  if (!input.date) return { ok: false, error: "Date is required" };
  if (!input.marks.length) {
    return { ok: false, error: "No students in this section roster" };
  }

  const state = loadAttendance();
  const existing = findRegister(
    input.academicYearCode,
    input.sectionId,
    input.date,
    state,
  );
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
    remark: input.remark ?? "",
  });

  const next = existing
    ? state.registers.map((r) => (r.id === existing.id ? register : r))
    : [register, ...state.registers];

  saveAttendance({ version: 1, registers: next });
  return { ok: true, register };
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
