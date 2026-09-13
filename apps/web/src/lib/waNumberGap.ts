/**
 * Which families the school cannot reach on WhatsApp, and why.
 *
 * The office collects a mobile number at admission and assumes it is a
 * WhatsApp number. Ten of this school's are not, and nothing on the desk
 * said so: the fee reminder was simply never delivered, and the counter
 * clerk taking that family's money had no idea a second number was needed.
 * The moment to ask a parent for their WhatsApp number is while they are
 * standing at the counter — so the gap has to be visible there and on the
 * student roster, not only inside Automation.
 *
 * ONE RULE runs through all of this: an unchecked number is not a bad
 * number. Nobody may be nagged for a number Meta has never been asked
 * about — that would flag the whole school on day one and teach the office
 * to ignore the banner. A family appears here only when the answer is
 * established:
 *
 *   not_on_whatsapp — every number they have was CHECKED and came back no.
 *   no_number       — they have no usable number at all (blank, or a
 *                     placeholder like 0000000000 that is not a mobile).
 *
 * Pure: the desk, the counter and the tests all read the same verdicts.
 */

import {
  householdCandidateNumbers,
  type WaCandidateNumber,
} from "@/lib/waHouseholdNumbers";

/** What Meta (or a failed send) established about one number. */
export type WaNumberVerdict = {
  /** true = on WhatsApp, false = not. Never null here: unknown is absent. */
  onWhatsApp: boolean;
  checkedAt?: string;
  /** "contacts_api" (asked) or "send_failure" (observed). */
  source?: string;
};

/** Keyed by bare 10 digits. A number missing from the map is UNCHECKED. */
export type WaVerdictMap = Record<string, WaNumberVerdict>;

export type WaNumberGapReason = "not_on_whatsapp" | "no_number";

export type WaGapNumber = WaCandidateNumber & {
  /** null = never checked. */
  onWhatsApp: boolean | null;
};

export type WaNumberGap = {
  householdId: string;
  guardianName: string;
  reason: WaNumberGapReason;
  /** Every number on the family, each with its verdict. */
  numbers: WaGapNumber[];
  /** One line the office can act on. */
  headline: string;
};

export type WaGapStudent = {
  studentId: string;
  studentName: string;
  fatherName: string;
  className: string;
  admissionNo: string;
  gap: WaNumberGap;
};

type HouseholdLike = {
  id: string;
  guardianName?: string;
  whatsappMobile?: string;
  mobile?: string;
  altMobile?: string;
};

type StudentLike = {
  id: string;
  fullName?: string;
  fatherName?: string;
  admissionNo?: string;
  householdId?: string;
  status?: string;
  fatherMobile?: string;
  motherMobile?: string;
  /**
   * SIS keeps ONE ROW PER CHILD PER ACADEMIC YEAR and every one of them stays
   * `status: "active"`. Filtering on status alone therefore returns the same
   * child once for every year they have been enrolled — on this school's
   * production data, 717 rows for 239 children, with 83% of children carrying
   * two to four rows each. That is why the office saw the same name three
   * times on a screen meant to list families once.
   */
  academicYearCode?: string;
};

function verdictOf(
  verdicts: WaVerdictMap,
  mobile10: string,
): boolean | null {
  const hit = verdicts[mobile10];
  return hit ? hit.onWhatsApp : null;
}

/**
 * Does this family need a WhatsApp number collected? null = no.
 *
 * `students` are that family's children — their parents' own numbers count
 * as numbers the family can be reached on.
 */
export function householdWaGap(
  household: HouseholdLike | null | undefined,
  students: StudentLike[],
  verdicts: WaVerdictMap,
): WaNumberGap | null {
  if (!household) return null;
  const candidates = householdCandidateNumbers({
    household,
    students: students.map((s) => ({
      fatherMobile: s.fatherMobile,
      motherMobile: s.motherMobile,
    })),
  });
  const guardianName = (household.guardianName || "").trim();

  if (!candidates.length) {
    return {
      householdId: household.id,
      guardianName,
      reason: "no_number",
      numbers: [],
      headline: "No mobile number on record — nothing can be sent at all",
    };
  }

  const numbers: WaGapNumber[] = candidates.map((c) => ({
    ...c,
    onWhatsApp: verdictOf(verdicts, c.mobile10),
  }));

  // Reachable, or not yet established → no reminder. Silence here is the
  // whole point: a banner that cries wolf is a banner nobody reads.
  if (numbers.some((n) => n.onWhatsApp !== false)) return null;

  const many = numbers.length > 1;
  return {
    householdId: household.id,
    guardianName,
    reason: "not_on_whatsapp",
    numbers,
    headline: many
      ? `All ${numbers.length} numbers on this family are not on WhatsApp`
      : "This number is not on WhatsApp",
  };
}

/**
 * Enrolled students whose family cannot be reached on WhatsApp.
 *
 * One row per STUDENT, not per family: the counter and the roster both work
 * child by child, and a clerk looking at Aarav should see Aarav's name.
 */
/**
 * One row per child, for the session the school is actually running.
 *
 * TWO THINGS THIS FIXES, AND THEY ARE DIFFERENT
 *
 * 1. WRONG YEAR. With `academicYearCode` given, a child with no row in that
 *    session has left the school and is dropped. The office asking "whose
 *    number is this?" is asking about families it teaches today.
 *
 * 2. REPEATED NAMES. Even with no session given — an older caller, a test —
 *    the same child is never listed twice. The fallback keeps their NEWEST
 *    row, because a child's contact details are most likely to be current
 *    there. Collapsing regardless means forgetting to pass the session makes
 *    the list slightly too long, never visibly broken.
 *
 * A row carrying no year at all is kept rather than dropped. It is an old
 * record, not a wrong one, and dropping it would quietly hide a family from
 * the very screen that exists to find families nobody can reach.
 */
function oneRowPerChild(
  students: StudentLike[],
  academicYearCode?: string,
): StudentLike[] {
  const scoped = academicYearCode
    ? students.filter(
        (s) => !s.academicYearCode || s.academicYearCode === academicYearCode,
      )
    : students;

  const best = new Map<string, StudentLike>();
  for (const s of scoped) {
    // The key is the admission number AND the name, never the number alone.
    // A child's identity across years is the number, but two rows sharing one
    // number are not necessarily one child — an admission number typed twice
    // is an ordinary office error, and merging those two children would HIDE
    // one from the very screen that exists to find families nobody can reach.
    // Requiring the name to agree as well means the worst case is a child
    // listed twice, which is visible, rather than a child missing, which is
    // not. Falling back to the row id would defeat the exercise entirely:
    // every year's row has its own.
    const name = (s.fullName || "").trim().toUpperCase();
    const adm = (s.admissionNo || "").trim().toUpperCase();
    const key = adm ? `${adm}::${name}` : `${s.householdId ?? ""}::${name}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, s);
      continue;
    }
    // Prefer the requested session outright; otherwise the later year.
    const prevYear = prev.academicYearCode ?? "";
    const thisYear = s.academicYearCode ?? "";
    if (academicYearCode) {
      if (thisYear === academicYearCode && prevYear !== academicYearCode) {
        best.set(key, s);
      }
    } else if (thisYear > prevYear) {
      best.set(key, s);
    }
  }
  return [...best.values()];
}

export function studentsNeedingWaNumber(
  sis: {
    students?: StudentLike[];
    households?: HouseholdLike[];
  } | null,
  verdicts: WaVerdictMap,
  opts?: {
    /** Resolve a class label for display. */
    classLabel?: (student: StudentLike) => string;
    /** Only these students (the counter scopes to one family). */
    studentIds?: string[];
    /**
     * The running session, e.g. "2026-27". Children with no row in it are a
     * child who has left, and are dropped. Pass it from the signed-in
     * session — every screen that lists families is asking about families
     * the school currently teaches.
     */
    academicYearCode?: string;
  },
): WaGapStudent[] {
  if (!sis) return [];
  const active = oneRowPerChild(
    (sis.students ?? []).filter(
      (s) => (s.status ?? "active") === "active" && !!s.householdId,
    ),
    opts?.academicYearCode,
  );
  const wanted = opts?.studentIds ? new Set(opts.studentIds) : null;
  const byHousehold = new Map<string, StudentLike[]>();
  for (const s of active) {
    const list = byHousehold.get(s.householdId!) ?? [];
    list.push(s);
    byHousehold.set(s.householdId!, list);
  }
  const households = new Map(
    (sis.households ?? []).map((h) => [h.id, h] as const),
  );

  const gaps = new Map<string, WaNumberGap | null>();
  const rows: WaGapStudent[] = [];
  for (const s of active) {
    if (wanted && !wanted.has(s.id)) continue;
    const householdId = s.householdId!;
    if (!gaps.has(householdId)) {
      gaps.set(
        householdId,
        householdWaGap(
          households.get(householdId),
          byHousehold.get(householdId) ?? [],
          verdicts,
        ),
      );
    }
    const gap = gaps.get(householdId);
    if (!gap) continue;
    rows.push({
      studentId: s.id,
      studentName: (s.fullName || "").trim() || "(unnamed)",
      fatherName: (s.fatherName || "").trim(),
      className: opts?.classLabel?.(s) || "",
      admissionNo: (s.admissionNo || "").trim(),
      gap,
    });
  }

  // Deterministic: class, then child. A list that reshuffles between
  // renders is a list the office loses its place in.
  return rows.sort(
    (a, b) =>
      a.className.localeCompare(b.className) ||
      a.studentName.localeCompare(b.studentName) ||
      a.studentId.localeCompare(b.studentId),
  );
}

/** How many FAMILIES the rows cover — the number worth announcing. */
export function waGapFamilyCount(rows: WaGapStudent[]): number {
  return new Set(rows.map((r) => r.gap.householdId)).size;
}

/**
 * The banner's own words.
 *
 * Says families and children separately: "3 families (5 children)" is the
 * honest shape of the work, and a clerk who fixes one number clears more
 * than one row.
 */
export function waGapHeadline(rows: WaGapStudent[]): string {
  if (!rows.length) return "";
  const families = waGapFamilyCount(rows);
  const kids = rows.length;
  const fam = families === 1 ? "1 family is" : `${families} families are`;
  const child = kids === 1 ? "1 child" : `${kids} children`;
  return `${fam} NOT on WhatsApp — ${child} affected`;
}
