/**
 * Today's staff attendance as the principal's home shows it — ONE place that
 * decides who is counted, so the "Present today" / "Absent" cards and the
 * lists they open always agree (approved request mr_mv9ym54sdge3, 20 Oct
 * 2026).
 *
 * Who is counted: active staff who keep attendance. Staff the office marked
 * exempt (Masters → Attendance settings, plus whoever holds owner / admin
 * as their main role — `attendanceExemptStaffIds`) never appear, even when a
 * mark for them sits in the register (6 Oct 2026: a punch filed all 16
 * exempt staff as "A", and the home counted them absent).
 *
 * Present = P, L (late) or HD (half day), as staffMarkTotals counts it.
 * Absent = A. Leave = LE. "" = not marked yet.
 */

import type { StaffAttendanceMark } from "@/lib/staffAttendance";

export type StaffTodayFilter = "present" | "absent";

export type StaffTodayRow = {
  staffId: string;
  fullName: string;
  designation: string;
  mobile: string;
  status: string;
  inTime: string;
  outTime: string;
  punchWay: string;
};

export type StaffTodayTotals = {
  present: number;
  absent: number;
  leave: number;
  notMarked: number;
  /** Everyone who keeps attendance (the rows). */
  total: number;
};

type StaffLike = {
  id: string;
  fullName: string;
  status: string;
  designationId?: string | null;
  mobile?: string | null;
};

export function isPresentStatus(status: string): boolean {
  return status === "P" || status === "L" || status === "HD";
}

export function staffTodayRows(input: {
  staff: StaffLike[];
  designations: { id: string; name: string }[];
  marks: StaffAttendanceMark[];
  exempt: Set<string>;
}): StaffTodayRow[] {
  const marks = new Map(input.marks.map((m) => [m.staffId, m]));
  const desig = (id: string | null | undefined) =>
    input.designations.find((d) => d.id === id)?.name || "";
  const rank = (s: string) => (s === "" ? 0 : s === "A" ? 1 : s === "L" ? 2 : 3);
  return input.staff
    .filter((s) => s.status === "active" && !input.exempt.has(s.id))
    .map((s) => {
      const m = marks.get(s.id);
      return {
        staffId: s.id,
        fullName: s.fullName,
        designation: desig(s.designationId),
        mobile: s.mobile || "",
        status: m?.status || "",
        inTime: m?.inTime || "",
        outTime: m?.outTime || "",
        punchWay: m?.punchWay || "",
      };
    })
    // Unmarked and absent first — that's what the principal is looking for.
    .sort((a, b) => rank(a.status) - rank(b.status) || a.fullName.localeCompare(b.fullName));
}

export function staffTodayTotals(rows: StaffTodayRow[]): StaffTodayTotals {
  let present = 0;
  let absent = 0;
  let leave = 0;
  let notMarked = 0;
  for (const r of rows) {
    if (isPresentStatus(r.status)) present += 1;
    else if (r.status === "A") absent += 1;
    else if (r.status === "LE") leave += 1;
    else if (r.status === "") notMarked += 1;
  }
  return { present, absent, leave, notMarked, total: rows.length };
}

export function filterStaffToday(rows: StaffTodayRow[], filter: StaffTodayFilter | null): StaffTodayRow[] {
  if (filter === "present") return rows.filter((r) => isPresentStatus(r.status));
  if (filter === "absent") return rows.filter((r) => r.status === "A");
  return rows;
}
