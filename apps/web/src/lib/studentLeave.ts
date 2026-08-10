/**
 * Student leave & half-day (§19c) — parent request → approve → attendance codes.
 * Demo store: localStorage `bhb_student_leave_v1`.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  findRegister,
  rosterForSection,
  upsertRegister,
  type AttendanceStatus,
} from "@/lib/attendance";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisStudent } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const STORAGE_KEY = "bhb_student_leave_v1";

let serverStudentLeaveCache: StudentLeaveState | null = null;

export type StudentLeaveType = "SL" | "HD_AM" | "HD_PM" | "ML" | "OD" | "LL";

export type StudentLeaveStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export type StudentLeaveRequest = {
  id: string;
  academicYearCode: string;
  studentId: string;
  fromDate: string;
  toDate: string;
  leaveType: StudentLeaveType;
  reason: string;
  attachmentUrl: string;
  status: StudentLeaveStatus;
  requestedBy: string;
  householdId: string;
  createdAt: string;
  decidedBy: string;
  decidedAt: string;
  decisionNote: string;
  attendanceApplied: boolean;
};

export type StudentLeaveState = {
  version: 1;
  requests: StudentLeaveRequest[];
};

export const STUDENT_LEAVE_TYPES: {
  code: StudentLeaveType;
  label: string;
  attendance: AttendanceStatus;
  note: string;
}[] = [
  { code: "SL", label: "Full day", attendance: "LE", note: "Absent excused" },
  { code: "HD_AM", label: "Half day (AM)", attendance: "HD", note: "Morning half" },
  { code: "HD_PM", label: "Half day (PM)", attendance: "HD", note: "Afternoon half" },
  { code: "ML", label: "Medical", attendance: "LE", note: "Excused + optional cert" },
  { code: "OD", label: "Duty / competition", attendance: "P", note: "Present-equivalent" },
  { code: "LL", label: "Long leave", attendance: "LE", note: "Multi-day" },
];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
  return new Date().toISOString();
}

function daysInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function leaveTypeLabel(code: StudentLeaveType): string {
  return STUDENT_LEAVE_TYPES.find((t) => t.code === code)?.label ?? code;
}

export function leaveDayCount(req: Pick<StudentLeaveRequest, "fromDate" | "toDate">): number {
  return daysInclusive(req.fromDate, req.toDate).length || 1;
}

export function emptyStudentLeaveState(): StudentLeaveState {
  return { version: 1, requests: [] };
}

export function loadStudentLeave(): StudentLeaveState {
  if (typeof window === "undefined") {
    if (serverStudentLeaveCache) return serverStudentLeaveCache;
    return emptyStudentLeaveState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStudentLeaveState();
    const parsed = JSON.parse(raw) as Partial<StudentLeaveState>;
    return {
      version: 1,
      requests: Array.isArray(parsed.requests)
        ? (parsed.requests as StudentLeaveRequest[])
        : [],
    };
  } catch {
    return emptyStudentLeaveState();
  }
}

export function writeStudentLeaveLocalRaw(state: StudentLeaveState) {
  if (typeof window === "undefined") {
    serverStudentLeaveCache = state;
    return;
  }
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("[studentLeave] localStorage quota exceeded — relying on server DB sync", e);
  }
}

export function studentLeaveStateIsEmpty(state: StudentLeaveState): boolean {
  return (state.requests?.length ?? 0) === 0;
}

export function saveStudentLeave(state: StudentLeaveState): void {
  if (!assertModulePermission("student_leave", "edit", "saveStudentLeave")) return;

  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("[studentLeave] localStorage quota exceeded — relying on server DB sync", e);
  }
  void import("@/lib/studentLeavePersistence").then(({ scheduleStudentLeaveSync }) => {
    scheduleStudentLeaveSync(state);
  });
}

export function createStudentLeaveRequest(input: {
  academicYearCode: string;
  studentId: string;
  fromDate: string;
  toDate: string;
  leaveType: StudentLeaveType;
  reason: string;
  attachmentUrl?: string;
  requestedBy: string;
  householdId: string;
}): { ok: true; request: StudentLeaveRequest } | { ok: false; error: string } {
  if (!input.studentId) return { ok: false, error: "Select student" };
  if (!input.fromDate) return { ok: false, error: "From date required" };
  const toDate = input.toDate || input.fromDate;
  if (toDate < input.fromDate) {
    return { ok: false, error: "To date must be on or after from date" };
  }
  if (!input.reason.trim()) return { ok: false, error: "Reason required" };
  if (
    (input.leaveType === "HD_AM" || input.leaveType === "HD_PM") &&
    toDate !== input.fromDate
  ) {
    return { ok: false, error: "Half-day leave is for a single date" };
  }
  const state = loadStudentLeave();
  const request: StudentLeaveRequest = {
    id: nid("slr"),
    academicYearCode: input.academicYearCode,
    studentId: input.studentId,
    fromDate: input.fromDate,
    toDate,
    leaveType: input.leaveType,
    reason: input.reason.trim(),
    attachmentUrl: input.attachmentUrl || "",
    status: "pending",
    requestedBy: input.requestedBy,
    householdId: input.householdId,
    createdAt: nowIso(),
    decidedBy: "",
    decidedAt: "",
    decisionNote: "",
    attendanceApplied: false,
  };
  saveStudentLeave({ ...state, requests: [request, ...state.requests] });
  return { ok: true, request };
}

export function cancelStudentLeaveRequest(
  id: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadStudentLeave();
  const i = state.requests.findIndex((r) => r.id === id);
  if (i < 0) return { ok: false, error: "Request not found" };
  if (state.requests[i].status !== "pending") {
    return { ok: false, error: "Only pending requests can be cancelled" };
  }
  const requests = [...state.requests];
  requests[i] = { ...requests[i], status: "cancelled" };
  saveStudentLeave({ ...state, requests });
  return { ok: true };
}

export function updateStudentLeaveRequest(input: {
  id: string;
  fromDate: string;
  toDate: string;
  leaveType: StudentLeaveType;
  reason: string;
}): { ok: true; request: StudentLeaveRequest } | { ok: false; error: string } {
  const state = loadStudentLeave();
  const i = state.requests.findIndex((r) => r.id === input.id);
  if (i < 0) return { ok: false, error: "Request not found" };
  const req = state.requests[i];
  if (req.status !== "pending") {
    return { ok: false, error: "Only pending requests can be edited" };
  }
  if (!input.fromDate) return { ok: false, error: "From date required" };
  const toDate = input.toDate || input.fromDate;
  if (toDate < input.fromDate) {
    return { ok: false, error: "To date must be on or after from date" };
  }
  if (!input.reason.trim()) return { ok: false, error: "Reason required" };
  const requests = [...state.requests];
  requests[i] = {
    ...req,
    fromDate: input.fromDate,
    toDate,
    leaveType: input.leaveType,
    reason: input.reason.trim(),
  };
  saveStudentLeave({ ...state, requests });
  return { ok: true, request: requests[i]! };
}

export function deleteStudentLeaveRequest(
  id: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadStudentLeave();
  const req = state.requests.find((r) => r.id === id);
  if (!req) return { ok: false, error: "Request not found" };
  if (req.status !== "pending" && req.status !== "cancelled") {
    return {
      ok: false,
      error: "Only pending or cancelled requests can be deleted",
    };
  }
  saveStudentLeave({
    ...state,
    requests: state.requests.filter((r) => r.id !== id),
  });
  return { ok: true };
}

export function decideStudentLeave(input: {
  id: string;
  approve: boolean;
  by: string;
  note?: string;
}): { ok: true; request: StudentLeaveRequest } | { ok: false; error: string } {
  const state = loadStudentLeave();
  const i = state.requests.findIndex((r) => r.id === input.id);
  if (i < 0) return { ok: false, error: "Request not found" };
  const req = state.requests[i];
  if (req.status !== "pending") {
    return { ok: false, error: "Already decided" };
  }
  const days = leaveDayCount(req);
  const needsPrincipal =
    days > 3 || req.leaveType === "ML" || req.leaveType === "LL";
  // Soft rule note only in decisionNote when teacher decides short leave
  void needsPrincipal;

  let next: StudentLeaveRequest = {
    ...req,
    status: input.approve ? "approved" : "rejected",
    decidedBy: input.by,
    decidedAt: nowIso(),
    decisionNote: input.note || "",
  };

  if (input.approve) {
    const applied = applyLeaveToAttendance(next);
    next = { ...next, attendanceApplied: applied.ok };
    if (!applied.ok && !next.decisionNote) {
      next = {
        ...next,
        decisionNote: `Approved; attendance note: ${applied.error}`,
      };
    }
  }

  const requests = [...state.requests];
  requests[i] = next;
  saveStudentLeave({ ...state, requests });
  return { ok: true, request: next };
}

/** Map approved leave onto attendance registers for the date range. */
export function applyLeaveToAttendance(
  req: StudentLeaveRequest,
): { ok: true } | { ok: false; error: string } {
  const sis = loadSis();
  const student = (sis?.students ?? []).find((s) => s.id === req.studentId);
  if (!student) return { ok: false, error: "Student not found" };
  const typeMeta = STUDENT_LEAVE_TYPES.find((t) => t.code === req.leaveType);
  const status: AttendanceStatus = typeMeta?.attendance ?? "LE";
  const note = `Leave ${req.leaveType}: ${req.reason}`.slice(0, 120);
  const dates = daysInclusive(req.fromDate, req.toDate);
  if (!dates.length) return { ok: false, error: "Invalid date range" };

  for (const date of dates) {
    const existing = findRegister(
      req.academicYearCode,
      student.sectionId,
      date,
    );
    const roster = rosterForSection(sis?.students ?? [], student.sectionId, {
      classId: student.classId,
      academicYearCode: req.academicYearCode,
    });
    if (!roster.length) continue;
    const marks = roster.map((st) => {
      const prev = existing?.marks.find((m) => m.studentId === st.id);
      if (st.id === student.id) {
        return { studentId: st.id, status, note };
      }
      return {
        studentId: st.id,
        status: prev?.status ?? ("P" as AttendanceStatus),
        note: prev?.note ?? "",
      };
    });
    const r = upsertRegister({
      academicYearCode: req.academicYearCode,
      campusId: student.campusId || "",
      classId: student.classId,
      sectionId: student.sectionId,
      date,
      marks,
      markedBy: `Leave:${req.id}`,
      remark: existing?.remark || `Auto from student leave ${req.id}`,
      skipLockCheck: true,
      openAbsentNudges: false,
    });
    if (!r.ok) return { ok: false, error: r.error };
  }
  return { ok: true };
}

export function pendingApproverHint(req: StudentLeaveRequest): string {
  const days = leaveDayCount(req);
  if (days > 3 || req.leaveType === "ML" || req.leaveType === "LL") {
    return "Principal (over 3 days / medical / long leave)";
  }
  return "Class teacher (≤3 days)";
}

export type StudentLeaveReportId =
  | "leave_register"
  | "medical_pct"
  | "chronic_alert";

export const STUDENT_LEAVE_REPORTS: {
  id: StudentLeaveReportId;
  label: string;
  hint?: string;
}[] = [
  { id: "leave_register", label: "Leave register by class", hint: "Approved + pending" },
  { id: "medical_pct", label: "Medical leave %", hint: "ML share of approved days" },
  {
    id: "chronic_alert",
    label: "Chronic leave alert",
    hint: "Students with ≥5 leave days in range",
  },
];

export function describeStudentLeaveFilters(filters: string[]): string {
  return filters.filter(Boolean).join(" · ");
}

export function runStudentLeaveReport(
  id: StudentLeaveReportId,
  filters: {
    academicYearCode: string;
    fromDate: string;
    toDate: string;
    format: "excel" | "pdf";
    leave?: StudentLeaveState;
    masters?: MastersState;
  },
): { ok: true; message: string } | { ok: false; error: string } {
  const leave = filters.leave ?? loadStudentLeave();
  const masters = filters.masters ?? loadMasters();
  const sis = loadSis();
  const note = describeFilters([
    `AY ${filters.academicYearCode}`,
    `${filters.fromDate} → ${filters.toDate}`,
  ]);

  function studentOf(id: string): SisStudent | undefined {
    return (sis?.students ?? []).find((s) => s.id === id);
  }
  function classLabel(s?: SisStudent) {
    if (!s) return "";
    const c = masters.classes.find((x) => x.id === s.classId);
    const sec = masters.sections.find((x) => x.id === s.sectionId);
    return [c?.name, sec?.name].filter(Boolean).join(" · ");
  }

  const inRange = leave.requests.filter(
    (r) =>
      r.academicYearCode === filters.academicYearCode &&
      r.fromDate <= filters.toDate &&
      r.toDate >= filters.fromDate,
  );

  switch (id) {
    case "leave_register": {
      const rows = inRange.map((r) => {
        const s = studentOf(r.studentId);
        return {
          student: s?.fullName || r.studentId,
          class: classLabel(s),
          type: leaveTypeLabel(r.leaveType),
          from: r.fromDate,
          to: r.toDate,
          days: leaveDayCount(r),
          status: r.status,
          reason: r.reason,
        };
      });
      const r = exportFilterReport(
        {
          title: "Student leave register",
          subtitle: TENANT.shortName,
          filterNote: note,
          columns: [
            { key: "student", header: "Student" },
            { key: "class", header: "Class" },
            { key: "type", header: "Type" },
            { key: "from", header: "From" },
            { key: "to", header: "To" },
            { key: "days", header: "Days", align: "right" },
            { key: "status", header: "Status" },
            { key: "reason", header: "Reason" },
          ],
          rows,
          fileBaseName: "student_leave_register",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Register: ${rows.length} row(s)` }
        : r;
    }
    case "medical_pct": {
      const approved = inRange.filter((r) => r.status === "approved");
      const byClass = new Map<string, { total: number; medical: number }>();
      for (const r of approved) {
        const s = studentOf(r.studentId);
        const key = classLabel(s) || "—";
        const row = byClass.get(key) || { total: 0, medical: 0 };
        const d = leaveDayCount(r);
        row.total += d;
        if (r.leaveType === "ML") row.medical += d;
        byClass.set(key, row);
      }
      const rows = [...byClass.entries()].map(([klass, v]) => ({
        class: klass,
        leaveDays: v.total,
        medicalDays: v.medical,
        pct: v.total ? `${Math.round((v.medical / v.total) * 100)}%` : "0%",
      }));
      const r = exportFilterReport(
        {
          title: "Medical leave %",
          subtitle: TENANT.shortName,
          filterNote: note,
          columns: [
            { key: "class", header: "Class" },
            { key: "leaveDays", header: "Leave days", align: "right" },
            { key: "medicalDays", header: "Medical days", align: "right" },
            { key: "pct", header: "Medical %", align: "right" },
          ],
          rows,
          fileBaseName: "student_leave_medical_pct",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Medical %: ${rows.length} class row(s)` }
        : r;
    }
    case "chronic_alert": {
      const daysByStudent = new Map<string, number>();
      for (const r of inRange.filter((x) => x.status === "approved")) {
        daysByStudent.set(
          r.studentId,
          (daysByStudent.get(r.studentId) || 0) + leaveDayCount(r),
        );
      }
      const rows = [...daysByStudent.entries()]
        .filter(([, d]) => d >= 5)
        .map(([sid, d]) => {
          const s = studentOf(sid);
          return {
            student: s?.fullName || sid,
            class: classLabel(s),
            days: d,
          };
        })
        .sort((a, b) => b.days - a.days);
      const r = exportFilterReport(
        {
          title: "Chronic leave alert (≥5 days)",
          subtitle: TENANT.shortName,
          filterNote: note,
          columns: [
            { key: "student", header: "Student" },
            { key: "class", header: "Class" },
            { key: "days", header: "Leave days", align: "right" },
          ],
          rows,
          fileBaseName: "student_leave_chronic",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Chronic: ${rows.length} student(s)` }
        : r;
    }
    default:
      return { ok: false, error: "Unknown report" };
  }
}
