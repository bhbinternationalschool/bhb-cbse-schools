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
  },
): WaGapStudent[] {
  if (!sis) return [];
  const active = (sis.students ?? []).filter(
    (s) => (s.status ?? "active") === "active" && !!s.householdId,
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
