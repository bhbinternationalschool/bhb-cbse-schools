/**
 * Mirror field survey Start/End into school staff attendance for salary.
 * External (survey-only) crew are skipped — not on payroll.
 */

import type {
  SurveyTeamMember,
  SurveyWorkSession,
} from "@/lib/admissions";
import { todayYmd } from "@/lib/admissions";
import {
  currentAcademicYearCode,
  loadMasters,
} from "@/lib/masters";
import {
  findStaffRegister,
  loadStaffAttendance,
  type StaffAttendanceMark,
} from "@/lib/staffAttendance";

export function isoToHHmm(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatHours(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function sessionWorkedMsLocal(session: SurveyWorkSession): number {
  if (!session.startedAt) return 0;
  const now = Date.now();
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  let breakMs = 0;
  for (const b of session.breaks) {
    if (!b.startedAt) continue;
    const bs = Date.parse(b.startedAt);
    const be = b.endedAt
      ? Date.parse(b.endedAt)
      : session.status === "on_break"
        ? now
        : bs;
    breakMs += Math.max(0, be - bs);
  }
  return Math.max(0, end - start - breakMs);
}

export function staffMarkForDay(
  staffId: string,
  date: string,
  academicYearCode?: string,
): StaffAttendanceMark | null {
  const masters = loadMasters();
  const ay = academicYearCode || currentAcademicYearCode(masters);
  const reg = findStaffRegister(loadStaffAttendance(), date, ay);
  if (!reg) return null;
  return reg.marks.find((m) => m.staffId === staffId) ?? null;
}

function mergeSurveyNote(existing: string, line: string): string {
  const base = (existing || "")
    .replace(/\s*·?\s*Outdoor duty[^\n]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return base ? `${base} · ${line}` : line;
}

/** HH:mm in India time — the server runs in UTC, so getHours() is wrong there. */
export function istHHmm(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** The day's mark after a survey Start: present, outdoor note, in-time only
 * if the school punch has none. Pure — used by the server route. */
export function surveyStartMark(
  existing: StaffAttendanceMark | null,
  beatName: string,
  startedAt: string,
) {
  const beat = beatName.trim() || "beat";
  return {
    status: "P" as const,
    inTime: existing?.inTime || istHHmm(startedAt) || undefined,
    outTime: existing?.outTime || undefined,
    note: mergeSurveyNote(existing?.note || "", `Outdoor duty · field survey · ${beat}`),
    punchWay: "survey" as const,
  };
}

/** After survey End: present; out-time from End only if there is no school
 * OUT (went home from the field). */
export function surveyEndMark(
  existing: StaffAttendanceMark | null,
  session: { startedAt: string; endedAt: string; workedMs: number },
  beatName: string,
) {
  const beat = beatName.trim() || "beat";
  const hadSchoolOut = !!(existing?.outTime && existing.outTime.trim());
  const worked = formatHours(session.workedMs);
  return {
    status: "P" as const,
    inTime: existing?.inTime || istHHmm(session.startedAt) || undefined,
    outTime: hadSchoolOut ? existing!.outTime : istHHmm(session.endedAt) || undefined,
    note: mergeSurveyNote(
      existing?.note || "",
      hadSchoolOut
        ? `Outdoor duty · field survey closed · ${worked} · returned to school · ${beat}`
        : `Outdoor duty · field survey closed · ${worked} · ${beat}`,
    ),
    punchWay: "survey" as const,
    usedSurveyOutTime: !hadSchoolOut,
  };
}

/**
 * Survey Start/End → staff attendance, through the server
 * (POST /api/v1/staff/attendance/survey). The browser used to write its own
 * copy of the register, which only staff.edit can save: a surveyor's day
 * never reached the register, and nobody was told.
 */
async function postSurveyAttendance(body: Record<string, unknown>): Promise<void> {
  if (typeof window === "undefined") return;
  let message = "";
  try {
    const res = await fetch("/api/v1/staff/attendance/survey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    message = j?.error?.message || "";
  } catch {
    /* network */
  }
  const { pushToast } = await import("@/components/shell/Toast");
  pushToast({
    kind: "error",
    message:
      `Field survey attendance was NOT saved${message ? ` — ${message}` : ""}. ` +
      "Ask the office to mark the day.",
    durationMs: 0,
  });
}

/** Survey Start → the member's attendance for the day (server). */
export function syncStaffAttendanceOnSurveyStart(
  member: SurveyTeamMember,
  beatName: string,
  startedAt: string,
): void {
  if (member.kind !== "staff" || !member.staffId) return;
  void postSurveyAttendance({
    action: "start",
    staffId: member.staffId,
    beatName,
    startedAt,
  });
}

/** Survey End → the member's attendance for the day (server). */
export function syncStaffAttendanceOnSurveyEnd(
  member: SurveyTeamMember,
  session: SurveyWorkSession,
  beatName: string,
): { usedSurveyOutTime: boolean } {
  if (member.kind !== "staff" || !member.staffId) {
    return { usedSurveyOutTime: false };
  }
  const existing = staffMarkForDay(member.staffId, (session.date || todayYmd()).slice(0, 10));
  void postSurveyAttendance({
    action: "end",
    staffId: member.staffId,
    beatName,
    date: (session.date || todayYmd()).slice(0, 10),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    workedMs: sessionWorkedMsLocal(session),
  });
  return { usedSurveyOutTime: !(existing?.outTime && existing.outTime.trim()) };
}

export type SurveySalaryDayOutcome =
  | "external_na"
  | "open_hr_review"
  | "p_outdoor_home"
  | "p_school_out_after";

export function surveySalaryDayOutcome(
  session: SurveyWorkSession,
  memberKind?: "staff" | "external",
): { code: SurveySalaryDayOutcome; label: string } {
  if (memberKind === "external" || !session.staffId) {
    return { code: "external_na", label: "N/A · survey-only (not on payroll)" };
  }
  if (session.status !== "ended") {
    return {
      code: "open_hr_review",
      label: "Open · needs End / HR (no auto LWP)",
    };
  }
  const mark = staffMarkForDay(session.staffId, session.date);
  const surveyOut = isoToHHmm(session.endedAt);
  if (mark?.outTime && surveyOut && mark.outTime !== surveyOut) {
    return {
      code: "p_school_out_after",
      label: "P · school OUT after survey",
    };
  }
  if (/returned to school/i.test(mark?.note || "")) {
    return {
      code: "p_school_out_after",
      label: "P · school OUT after survey",
    };
  }
  return {
    code: "p_outdoor_home",
    label: "P · outdoor (home after End)",
  };
}

/** Payroll safety: ended survey session exists for staff+date. */
export function hasEndedSurveyWorkForStaff(
  staffId: string,
  date: string,
): boolean {
  if (!staffId || typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem("bhb_admissions_v1");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      surveySessions?: SurveyWorkSession[];
    };
    return (parsed.surveySessions || []).some(
      (s) =>
        s.staffId === staffId &&
        (s.date || "").slice(0, 10) === date.slice(0, 10) &&
        s.status === "ended",
    );
  } catch {
    return false;
  }
}
