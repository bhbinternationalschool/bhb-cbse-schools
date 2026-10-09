/**
 * Today's student attendance figure for the home dashboard and the
 * principal cockpit (director, 9 Oct 2026: "attendance % on dashboard may be
 * wrong"). It was P ÷ (P+A+LE) over whatever registers were marked, so with
 * 5 of 13 sections marked the tile said 77% for the school while 154 of 228
 * children had no mark at all — and Late / Half-day children vanished from
 * both sides of the sum.
 *
 * Now: Late counts present, Half-day counts half (the month register's
 * weights), every marked child is in the denominator, and the coverage
 * (sections and children marked) is reported beside the percentage so a
 * partial morning is never read as the school's figure. Pure.
 */

import type { AttendanceMark } from "@/lib/attendance";

export type TodayAttendanceFigures = {
  present: number;
  absent: number;
  leave: number;
  late: number;
  halfDay: number;
  /** Children with a mark today. */
  marked: number;
  /** P + L + ½HD over marked, rounded; 0 when nothing is marked. */
  pct: number;
  /** Distinct sections with a register today. */
  sectionsMarked: number;
};

export function todayAttendanceFigures(registers: { sectionId: string; marks?: AttendanceMark[] }[]): TodayAttendanceFigures {
  // One register per section counts — a duplicate must not double the children.
  const bySection = new Map<string, AttendanceMark[]>();
  for (const r of registers) {
    const prev = bySection.get(r.sectionId);
    if (!prev || (r.marks?.length ?? 0) > prev.length) bySection.set(r.sectionId, r.marks ?? []);
  }
  const out = { present: 0, absent: 0, leave: 0, late: 0, halfDay: 0 };
  for (const marks of bySection.values()) {
    for (const m of marks) {
      if (m.status === "P") out.present += 1;
      else if (m.status === "A") out.absent += 1;
      else if (m.status === "L") out.late += 1;
      else if (m.status === "HD") out.halfDay += 1;
      else if (m.status === "LE") out.leave += 1;
    }
  }
  const marked = out.present + out.absent + out.leave + out.late + out.halfDay;
  const attended = out.present + out.late + out.halfDay / 2;
  return {
    ...out,
    marked,
    pct: marked ? Math.round((attended / marked) * 100) : 0,
    sectionsMarked: bySection.size,
  };
}

/** "5 of 13 sections · 74 of 228 children marked" — empty when all are marked. */
export function attendanceCoverageNote(f: TodayAttendanceFigures, activeSections: number, activeStudents: number): string {
  if (!f.marked) return "";
  if (activeSections && f.sectionsMarked >= activeSections) return "";
  const parts = [`${f.sectionsMarked}${activeSections ? ` of ${activeSections}` : ""} sections`];
  if (activeStudents) parts.push(`${f.marked} of ${activeStudents} children marked`);
  return parts.join(" · ");
}
