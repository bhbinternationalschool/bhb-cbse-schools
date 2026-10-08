/**
 * Which families a parents audience reaches — the pure half of
 * waAudienceResolve.server, kept apart so a selftest can run it.
 *
 * SIS keeps one row per child per academic year and leaves every one of them
 * `status: "active"`. Counting families off "active rows" therefore reaches
 * every family that had a child here in ANY year: a whole-school dry run on
 * 8 Oct 2026 came back with 190 households against 164 with children this
 * session. A "parents" send is a send to this session's families, so the
 * rows are first narrowed to the session with `studentsInSession`, which
 * also collapses a child's duplicate rows to one.
 */

import {
  studentsInSession,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";

export type HouseholdHit = { household: Household; students: SisStudent[] };

type SisLike = Pick<SisState, "households" | "students">;

/** Group active rows that pass `studentFilter` by household. */
export function householdHits(
  studentFilter: (s: SisStudent) => boolean,
  students: SisStudent[],
  households: Household[],
): HouseholdHit[] {
  const byHousehold = new Map<string, SisStudent[]>();
  for (const s of students) {
    if (s.status !== "active" || !s.householdId) continue;
    if (!studentFilter(s)) continue;
    const list = byHousehold.get(s.householdId) ?? [];
    list.push(s);
    byHousehold.set(s.householdId, list);
  }
  const byId = new Map(households.map((h) => [h.id, h]));
  const out: HouseholdHit[] = [];
  for (const [householdId, list] of byHousehold) {
    const household = byId.get(householdId);
    if (!household) continue;
    out.push({ household, students: list });
  }
  return out;
}

/**
 * Families with a child in `academicYearCode`, optionally narrowed to
 * sections. A section filter is matched against the child's THIS-session
 * row, so a child who was in V-A last year and is in VI-A now is a VI-A
 * family, not both.
 */
export function sessionParentHits(
  sis: SisLike,
  academicYearCode: string,
  sectionIds: Set<string> | null,
): HouseholdHit[] {
  // studentsInSession reads only `students`.
  const inSession = studentsInSession(sis as SisState, academicYearCode);
  return householdHits(
    (s) => (sectionIds ? sectionIds.has(s.sectionId) : true),
    inSession,
    sis.households ?? [],
  );
}
