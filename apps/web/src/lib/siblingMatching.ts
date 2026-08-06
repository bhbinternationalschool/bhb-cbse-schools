/**
 * Sibling groups (same household) + possible siblings (matching family signals).
 */

import {
  applySharedFamilyToHousehold,
  householdOf,
  loadSis,
  normalizeMobile,
  saveSis,
  sharedFamilyContactsOf,
  siblingsOf,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";

function normName(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(shri|smt|mr|mrs|ms)\.?\s+/i, "");
}

function digits(v: string): string {
  return normalizeMobile(v);
}

export type SiblingMatchReason =
  | "father_mobile"
  | "mother_mobile"
  | "guardian_mobile"
  | "whatsapp"
  | "father_name"
  | "mother_name"
  | "father_aadhaar"
  | "address";

export const SIBLING_REASON_LABELS: Record<SiblingMatchReason, string> = {
  father_mobile: "Same father mobile",
  mother_mobile: "Same mother mobile",
  guardian_mobile: "Same guardian mobile",
  whatsapp: "Same WhatsApp",
  father_name: "Same father name",
  mother_name: "Same mother name",
  father_aadhaar: "Same father Aadhaar****",
  address: "Same address + father",
};

export type ExistingSiblingGroup = {
  householdId: string;
  household: Household | undefined;
  students: SisStudent[];
};

export type RealSiblingGroup = {
  key: string;
  fatherName: string;
  motherName: string;
  students: SisStudent[];
};

export type PossibleSiblingPair = {
  id: string;
  a: SisStudent;
  b: SisStudent;
  reasons: SiblingMatchReason[];
  score: number;
};

const REASON_SCORE: Record<SiblingMatchReason, number> = {
  father_mobile: 40,
  mother_mobile: 40,
  guardian_mobile: 35,
  whatsapp: 30,
  father_aadhaar: 35,
  address: 25,
  father_name: 15,
  mother_name: 12,
};

/** Households that already have 2+ students linked. */
function ayValue(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

export function listExistingSiblingGroups(
  sis: SisState,
): ExistingSiblingGroup[] {
  const byHh = new Map<string, SisStudent[]>();
  for (const s of sis.students) {
    if (!s.householdId) continue;
    const list = byHh.get(s.householdId) ?? [];
    list.push(s);
    byHh.set(s.householdId, list);
  }
  /** One record per child (latest session) so multi-year rosters don't duplicate names. */
  const dedupePerChild = (students: SisStudent[]): SisStudent[] => {
    const byChild = new Map<string, SisStudent>();
    for (const s of students) {
      const key = s.admissionNo.trim().toUpperCase() || (s.fullName || "").trim().toLowerCase() || s.id;
      const prev = byChild.get(key);
      if (!prev || ayValue(s.academicYearCode) > ayValue(prev.academicYearCode)) {
        byChild.set(key, s);
      }
    }
    return [...byChild.values()];
  };
  return [...byHh.entries()]
    .map(([householdId, students]) => [householdId, dedupePerChild(students)] as const)
    .filter(([, students]) => students.length >= 2)
    .map(([householdId, students]) => ({
      householdId,
      household: householdOf(sis, householdId),
      students: students
        .slice()
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    }))
    .sort(
      (a, b) =>
        b.students.length - a.students.length ||
        (a.household?.guardianName ?? "").localeCompare(
          b.household?.guardianName ?? "",
        ),
    );
}

/**
 * Real siblings grouped by the SAME father + mother name (across households).
 * Deduped to one record per child (latest session). Only groups with 2+ children.
 */
export function listRealSiblingGroups(sis: SisState): RealSiblingGroup[] {
  const byParents = new Map<
    string,
    { fatherName: string; motherName: string; students: Map<string, SisStudent> }
  >();

  for (const s of sis.students) {
    const father = normName(s.fatherName ?? "");
    const mother = normName(s.motherName ?? "");
    // Need both parents to reliably identify real siblings
    if (!father || !mother) continue;
    const key = `${father}|${mother}`;
    const bucket =
      byParents.get(key) ??
      {
        fatherName: s.fatherName.trim(),
        motherName: s.motherName.trim(),
        students: new Map<string, SisStudent>(),
      };
    const childKey = s.admissionNo.trim().toUpperCase() || (s.fullName || "").trim().toLowerCase() || s.id;
    const prev = bucket.students.get(childKey);
    if (!prev || ayValue(s.academicYearCode) > ayValue(prev.academicYearCode)) {
      bucket.students.set(childKey, s);
    }
    byParents.set(key, bucket);
  }

  return [...byParents.entries()]
    .map(([key, v]) => ({
      key,
      fatherName: v.fatherName,
      motherName: v.motherName,
      students: [...v.students.values()].sort((a, b) =>
        a.fullName.localeCompare(b.fullName),
      ),
    }))
    .filter((g) => g.students.length >= 2)
    .sort(
      (a, b) =>
        b.students.length - a.students.length ||
        a.fatherName.localeCompare(b.fatherName),
    );
}

function matchReasons(
  a: SisStudent,
  b: SisStudent,
  hhA?: Household,
  hhB?: Household,
): SiblingMatchReason[] {
  const reasons: SiblingMatchReason[] = [];
  const fA = digits(a.fatherMobile);
  const fB = digits(b.fatherMobile);
  if (fA.length === 10 && fA === fB) reasons.push("father_mobile");

  const mA = digits(a.motherMobile);
  const mB = digits(b.motherMobile);
  if (mA.length === 10 && mA === mB) reasons.push("mother_mobile");

  const gA = digits(hhA?.mobile ?? "");
  const gB = digits(hhB?.mobile ?? "");
  if (gA.length === 10 && gA === gB) reasons.push("guardian_mobile");

  const wA = digits(hhA?.whatsappMobile || hhA?.mobile || "");
  const wB = digits(hhB?.whatsappMobile || hhB?.mobile || "");
  if (wA.length === 10 && wA === wB && !reasons.includes("guardian_mobile")) {
    reasons.push("whatsapp");
  }

  if (
    a.fatherAadhaarLast4.length === 4 &&
    a.fatherAadhaarLast4 === b.fatherAadhaarLast4
  ) {
    reasons.push("father_aadhaar");
  }

  const fatherSame =
    normName(a.fatherName).length >= 3 &&
    normName(a.fatherName) === normName(b.fatherName);
  const motherSame =
    normName(a.motherName).length >= 3 &&
    normName(a.motherName) === normName(b.motherName);

  if (fatherSame) reasons.push("father_name");
  if (motherSame) reasons.push("mother_name");

  const addrA = normName(hhA?.address ?? "");
  const addrB = normName(hhB?.address ?? "");
  if (
    fatherSame &&
    addrA.length >= 8 &&
    addrA === addrB &&
    !reasons.includes("address")
  ) {
    reasons.push("address");
  }

  return reasons;
}

/**
 * Students on different households that look like siblings.
 * Requires at least one strong signal (mobile / aadhaar / address)
 * or father+mother name together.
 */
export function listPossibleSiblingPairs(
  sis: SisState,
  options?: { limit?: number },
): PossibleSiblingPair[] {
  const byChild = new Map<string, SisStudent>();
  for (const s of sis.students) {
    if (s.status !== "active") continue;
    const key = s.admissionNo.trim().toUpperCase() || s.id;
    const prev = byChild.get(key);
    if (!prev || ayValue(s.academicYearCode) > ayValue(prev.academicYearCode)) {
      byChild.set(key, s);
    }
  }
  const active = [...byChild.values()];
  const pairs: PossibleSiblingPair[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < active.length; i++) {
    const a = active[i]!;
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j]!;
      if (a.householdId && a.householdId === b.householdId) continue;

      const hhA = householdOf(sis, a.householdId);
      const hhB = householdOf(sis, b.householdId);
      const reasons = matchReasons(a, b, hhA, hhB);
      if (!reasons.length) continue;

      const strong =
        reasons.includes("father_mobile") ||
        reasons.includes("mother_mobile") ||
        reasons.includes("guardian_mobile") ||
        reasons.includes("whatsapp") ||
        reasons.includes("father_aadhaar") ||
        reasons.includes("address") ||
        (reasons.includes("father_name") && reasons.includes("mother_name"));

      if (!strong) continue;

      const score = reasons.reduce((n, r) => n + REASON_SCORE[r], 0);
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        id: key,
        a,
        b,
        reasons,
        score,
      });
    }
  }

  pairs.sort((x, y) => y.score - x.score || x.a.fullName.localeCompare(y.a.fullName));
  const limit = options?.limit ?? 200;
  return pairs.slice(0, limit);
}

/** Possible matches for one focus student (not already same household). */
export function possibleSiblingsFor(
  sis: SisState,
  student: SisStudent,
): PossibleSiblingPair[] {
  return listPossibleSiblingPairs(sis).filter(
    (p) => p.a.id === student.id || p.b.id === student.id,
  );
}

/**
 * Move `fromStudentId` onto the household of `toStudentId`
 * and sync shared family contacts.
 */
export function linkAsSiblings(
  fromStudentId: string,
  toStudentId: string,
): { ok: true; state: SisState } | { ok: false; error: string } {
  if (fromStudentId === toStudentId) {
    return { ok: false, error: "Pick two different students" };
  }
  const sis = loadSis();
  const from = sis.students.find((s) => s.id === fromStudentId);
  const to = sis.students.find((s) => s.id === toStudentId);
  if (!from || !to) return { ok: false, error: "Student not found" };
  if (!to.householdId) return { ok: false, error: "Target has no household" };
  if (from.householdId === to.householdId) {
    return { ok: false, error: "Already linked as siblings" };
  }

  const targetHh = to.householdId;
  let students = sis.students.map((s) =>
    s.id === from.id ? { ...s, householdId: targetHh } : s,
  );
  students = applySharedFamilyToHousehold(
    students,
    targetHh,
    sharedFamilyContactsOf(to),
    to,
  );

  const orphanHh = from.householdId;
  const hhStillUsed = students.some((s) => s.householdId === orphanHh);
  const households = hhStillUsed
    ? sis.households
    : sis.households.filter((h) => h.id !== orphanHh);

  const state: SisState = { ...sis, students, households };
  saveSis(state);
  return { ok: true, state };
}

export function existingSiblingsCount(sis: SisState): number {
  return listExistingSiblingGroups(sis).reduce(
    (n, g) => n + g.students.length,
    0,
  );
}

export { siblingsOf };
