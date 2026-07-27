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
  upsertStaffMark,
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

/** Survey Start → ensure Present / outdoor note; fill inTime only if missing. */
export function syncStaffAttendanceOnSurveyStart(
  member: SurveyTeamMember,
  beatName: string,
  startedAt: string,
): void {
  if (member.kind !== "staff" || !member.staffId) return;
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const date = (startedAt || todayYmd()).slice(0, 10);
  const existing = staffMarkForDay(member.staffId, date, ay);
  const beat = beatName.trim() || "beat";
  const note = mergeSurveyNote(
    existing?.note || "",
    `Outdoor duty · field survey · ${beat}`,
  );
  upsertStaffMark({
    academicYearCode: ay,
    date,
    staffId: member.staffId,
    status: "P",
    inTime: existing?.inTime || isoToHHmm(startedAt) || undefined,
    outTime: existing?.outTime || undefined,
    note,
    punchWay: "survey",
    markedBy: "Field survey",
    roster: masters.staff ?? [],
  });
}

/**
 * Survey End → Present; set outTime from End only if school OUT empty
 * (home after survey). If campus OUT already exists, keep it.
 */
export function syncStaffAttendanceOnSurveyEnd(
  member: SurveyTeamMember,
  session: SurveyWorkSession,
  beatName: string,
): { usedSurveyOutTime: boolean } {
  if (member.kind !== "staff" || !member.staffId) {
    return { usedSurveyOutTime: false };
  }
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const date = (session.date || todayYmd()).slice(0, 10);
  const existing = staffMarkForDay(member.staffId, date, ay);
  const worked = formatHours(sessionWorkedMsLocal(session));
  const beat = beatName.trim() || "beat";
  const hadSchoolOut = !!(existing?.outTime && existing.outTime.trim());
  const surveyOut = isoToHHmm(session.endedAt);
  const note = mergeSurveyNote(
    existing?.note || "",
    hadSchoolOut
      ? `Outdoor duty · field survey closed · ${worked} · returned to school`
      : `Outdoor duty · field survey closed · ${worked}`,
  );
  upsertStaffMark({
    academicYearCode: ay,
    date,
    staffId: member.staffId,
    status: "P",
    inTime: existing?.inTime || isoToHHmm(session.startedAt) || undefined,
    outTime: hadSchoolOut ? existing!.outTime : surveyOut || undefined,
    note,
    punchWay: "survey",
    markedBy: "Field survey",
    roster: masters.staff ?? [],
  });
  return { usedSurveyOutTime: !hadSchoolOut };
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
