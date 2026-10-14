import { emptyMastersShell } from "@/lib/masters";

/**
 * The parts of Masters every member of staff needs to do their job: the
 * school's years, terms, classes, sections, subjects, holidays and timings.
 * Nothing about money (fee heads, structures, concessions and the families
 * they were granted to), numbering, statutory setup or students.
 *
 * One list for every reader that serves it (data-layer 1.4): GET
 * /api/school-data/masters-desk and GET /api/data/views/masters.
 */
export const TEACHING_MASTERS_KEYS = [
  "academicYears",
  "academicTerms",
  "campuses",
  "classes",
  "sections",
  "subjects",
  "classSubjects",
  "seniorStreams",
  "holidays",
  "schoolTiming",
  "schoolProfile",
] as const;

/**
 * `book` cut down to the teaching keys. Every other key is present but
 * empty (from the empty shell, without `version`) so a client reading e.g.
 * `bundle.feeHeads.length` does not crash — which is why every reader that
 * serves this also says it is the teaching subset (`teachingOnly` /
 * `scope: "teaching"`): empty here means withheld, not "the school has none".
 * The staff roster, departments and designations are left out entirely.
 */
export function teachingMastersSubset(book: Record<string, unknown>): Record<string, unknown> {
  const subset = { ...emptyMastersShell() } as unknown as Record<string, unknown>;
  delete subset.version;
  for (const k of TEACHING_MASTERS_KEYS) subset[k] = book[k];
  delete subset.staff;
  delete subset.departments;
  delete subset.designations;
  return subset;
}
