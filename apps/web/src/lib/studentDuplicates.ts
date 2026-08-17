/**
 * Suspected duplicate students — detection + merge/remove helpers.
 *
 * Duplicates are always evaluated *within a single academic session* so that a
 * student legitimately carried forward across years (same admission no in
 * 2023-24 and 2024-25) is never flagged. Cross-session carry-forward is the
 * expected promotion flow, handled elsewhere.
 */

import { saveSis, type SisState, type SisStudent } from "@/lib/sis";
import { normalizeSessionCode } from "@/lib/studentImport";
import { recordSisDeletion } from "@/lib/sisNormalizedClient";

export type DuplicateReason =
  | "admissionNo"
  | "pen"
  | "apaar"
  | "aadhaar"
  | "name_dob"
  | "name_father";

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  admissionNo: "Same admission no",
  pen: "Same PEN",
  apaar: "Same APAAR",
  aadhaar: "Same Aadhaar",
  name_dob: "Same name & DOB",
  name_father: "Same name & father",
};

const REASON_WEIGHT: Record<DuplicateReason, number> = {
  admissionNo: 100,
  pen: 95,
  apaar: 95,
  aadhaar: 95,
  name_dob: 80,
  name_father: 60,
};

export type DuplicateGroup = {
  key: string;
  session: string;
  reasons: DuplicateReason[];
  score: number;
  students: SisStudent[];
};

function normName(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function digitsOnly(value: string): string {
  return (value || "").replace(/\D/g, "");
}

/** Common junk / placeholder values written by imports (e.g. PEN "0", "NA"). */
const PLACEHOLDER_IDS = new Set([
  "",
  "0",
  "00",
  "000",
  "na",
  "n/a",
  "nil",
  "none",
  "null",
  "-",
  "--",
  "xxxx",
  "0000",
  "00000000000",
  "000000000000",
]);

/** True when an ID/code value is a real, distinguishing identifier. */
function isMeaningfulId(value: string): boolean {
  const v = (value || "").trim().toLowerCase();
  if (v.length < 3) return false;
  if (PLACEHOLDER_IDS.has(v)) return false;
  // all-same-character (e.g. "0000000", "xxxxxxx") — not a real id
  if (/^(.)\1+$/.test(v)) return false;
  return true;
}

/** Minimal union-find over student indices. */
class DisjointSet {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function detectWithinSession(
  session: string,
  students: SisStudent[],
): DuplicateGroup[] {
  if (students.length < 2) return [];

  const dsu = new DisjointSet(students.length);
  // reasons attached to each connected edge, collected per member root later
  const memberReasons: Set<DuplicateReason>[] = students.map(
    () => new Set<DuplicateReason>(),
  );

  function linkBySignature(
    reason: DuplicateReason,
    sigOf: (s: SisStudent) => string | null,
  ) {
    const buckets = new Map<string, number[]>();
    students.forEach((s, i) => {
      const sig = sigOf(s);
      if (!sig) return;
      const arr = buckets.get(sig);
      if (arr) arr.push(i);
      else buckets.set(sig, [i]);
    });
    for (const idxs of buckets.values()) {
      if (idxs.length < 2) continue;
      const first = idxs[0];
      for (const i of idxs) {
        dsu.union(first, i);
        memberReasons[i].add(reason);
      }
    }
  }

  linkBySignature("admissionNo", (s) =>
    isMeaningfulId(s.admissionNo) ? `adm:${normName(s.admissionNo)}` : null,
  );
  linkBySignature("pen", (s) =>
    isMeaningfulId(s.pen) ? `pen:${s.pen.trim().toUpperCase()}` : null,
  );
  linkBySignature("apaar", (s) => {
    const d = digitsOnly(s.apaarId);
    return d.length >= 12 && isMeaningfulId(d) ? `apaar:${d}` : null;
  });
  linkBySignature("aadhaar", (s) => {
    const full = digitsOnly(s.aadhaarNumber);
    return full.length >= 12 && isMeaningfulId(full) ? `aad:${full}` : null;
  });
  const isFullName = (n: string) => n.length >= 4 && n.includes(" ");
  linkBySignature("name_dob", (s) => {
    const n = normName(s.fullName);
    return isFullName(n) && s.dob ? `nd:${n}|${s.dob}` : null;
  });
  linkBySignature("name_father", (s) => {
    const n = normName(s.fullName);
    const f = normName(s.fatherName);
    return isFullName(n) && f.length >= 3 ? `nf:${n}|${f}` : null;
  });

  const groupsByRoot = new Map<number, number[]>();
  students.forEach((_, i) => {
    if (memberReasons[i].size === 0) return;
    const root = dsu.find(i);
    const arr = groupsByRoot.get(root);
    if (arr) arr.push(i);
    else groupsByRoot.set(root, [i]);
  });

  const out: DuplicateGroup[] = [];
  for (const [root, idxs] of groupsByRoot) {
    if (idxs.length < 2) continue;
    const reasons = new Set<DuplicateReason>();
    for (const i of idxs) memberReasons[i].forEach((r) => reasons.add(r));
    const reasonList = [...reasons].sort(
      (a, b) => REASON_WEIGHT[b] - REASON_WEIGHT[a],
    );
    const base = reasonList.length ? REASON_WEIGHT[reasonList[0]] : 0;
    const score = Math.min(100, base + (reasonList.length - 1) * 5);
    const groupStudents = idxs
      .map((i) => students[i])
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    out.push({
      key: `${session}:${root}:${groupStudents.map((s) => s.id).join("-")}`,
      session,
      reasons: reasonList,
      score,
      students: groupStudents,
    });
  }
  return out;
}

/**
 * List suspected duplicate student groups.
 * @param options.academicYearCode When set (and not "all"), only that session.
 */
export function listSuspectedDuplicates(
  sis: SisState,
  options?: { academicYearCode?: string; minScore?: number },
): DuplicateGroup[] {
  const minScore = options?.minScore ?? 60;
  const scope = options?.academicYearCode;
  const wantSession =
    scope && scope !== "all" ? normalizeSessionCode(scope) : null;

  const bySession = new Map<string, SisStudent[]>();
  for (const s of sis.students) {
    const sess = normalizeSessionCode(s.academicYearCode || "") || "—";
    if (wantSession && sess !== wantSession) continue;
    const arr = bySession.get(sess);
    if (arr) arr.push(s);
    else bySession.set(sess, [s]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [session, students] of bySession) {
    groups.push(...detectWithinSession(session, students));
  }
  return groups
    .filter((g) => g.score >= minScore)
    .sort((a, b) => b.score - a.score || a.session.localeCompare(b.session));
}

/** Count of students involved in suspected duplicates (for badges). */
export function countSuspectedDuplicates(
  sis: SisState,
  options?: { academicYearCode?: string },
): number {
  return listSuspectedDuplicates(sis, options).reduce(
    (n, g) => n + g.students.length,
    0,
  );
}

const MERGE_FILL_KEYS: (keyof SisStudent)[] = [
  "fullName",
  "gender",
  "dob",
  "rollNo",
  "fatherName",
  "motherName",
  "fatherMobile",
  "motherMobile",
  "fatherAadhaarLast4",
  "motherAadhaarLast4",
  "fatherPan",
  "motherPan",
  "guardianRelation",
  "emergencyName",
  "emergencyMobile",
  "bloodGroup",
  "religion",
  "category",
  "nationality",
  "motherTongue",
  "placeOfBirth",
  "aadhaarLast4",
  "aadhaarNumber",
  "pen",
  "apaarId",
  "srn",
  "previousSchool",
  "previousTcNo",
  "previousUdise",
  "photoUrl",
  "fatherPhotoUrl",
  "motherPhotoUrl",
  "rfidNo",
  "biometricId",
  "notes",
];

function isBlank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

/**
 * Merge duplicate records into a single kept record.
 * Blank fields on the kept student are back-filled from the dropped records
 * (in order), docs missing files are pulled in, tags are unioned, then the
 * dropped student rows are deleted. Persists and returns the new state.
 */
export function mergeStudents(
  state: SisState,
  keepId: string,
  dropIds: string[],
): { ok: true; state: SisState; merged: number } | { ok: false; reason: string } {
  const keep = state.students.find((s) => s.id === keepId);
  if (!keep) return { ok: false, reason: "Kept student not found" };
  const drops = dropIds
    .filter((id) => id !== keepId)
    .map((id) => state.students.find((s) => s.id === id))
    .filter((s): s is SisStudent => Boolean(s));
  if (drops.length === 0) return { ok: false, reason: "No records to merge" };

  const nextKeep: SisStudent = { ...keep };
  const tagSet = new Set<string>(nextKeep.tagIds || []);

  for (const drop of drops) {
    for (const key of MERGE_FILL_KEYS) {
      if (isBlank(nextKeep[key]) && !isBlank(drop[key])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (nextKeep as any)[key] = drop[key];
      }
    }
    if (!nextKeep.feeGroupId && drop.feeGroupId) {
      nextKeep.feeGroupId = drop.feeGroupId;
    }
    if (drop.docs) {
      const docs = { ...(nextKeep.docs || {}) };
      for (const dkey of Object.keys(drop.docs) as (keyof typeof drop.docs)[]) {
        const cur = docs[dkey];
        const cand = drop.docs[dkey];
        if ((!cur || !cur.fileUrl) && cand && cand.fileUrl) {
          docs[dkey] = cand;
        }
      }
      nextKeep.docs = docs;
    }
    for (const t of drop.tagIds || []) tagSet.add(t);
  }
  nextKeep.tagIds = [...tagSet];

  const dropSet = new Set(drops.map((d) => d.id));
  const nextStudents = state.students.map((s) =>
    s.id === keepId ? nextKeep : s,
  );
  const survivors = nextStudents.filter((s) => !dropSet.has(s.id));
  const usedHouseholds = new Set(survivors.map((s) => s.householdId));
  const nextHouseholds = state.households.filter((h) => usedHouseholds.has(h.id));
  const next: SisState = {
    ...state,
    students: survivors,
    households: nextHouseholds,
  };

  // State the deletion before saving. The push upserts whatever's in the
  // payload — dropping ids from the local array doesn't tell the server
  // to delete those rows, so without this the merged-away duplicates
  // stay in the database and come back on the next hydrate (see the
  // identical gotcha documented at StudentsWorkspace.tsx's onRemove).
  const removedHouseholdIds = state.households
    .filter((h) => !nextHouseholds.some((x) => x.id === h.id))
    .map((h) => h.id);
  recordSisDeletion({
    studentIds: [...dropSet],
    householdIds: removedHouseholdIds,
  });

  saveSis(next);
  void import("@/lib/sisPersistence").then(({ pushSisState, flushSisSync }) => {
    pushSisState(next).then(() => flushSisSync()).catch(console.error);
  });
  return { ok: true, state: next, merged: drops.length };
}

/**
 * Hard-remove student records (dedup cleanup) — bypasses the active-status
 * guard used by the normal roster removal, since these are explicit duplicates.
 */
export function removeDuplicateStudents(
  state: SisState,
  ids: string[],
): SisState {
  const dropSet = new Set(ids);
  const survivors = state.students.filter((s) => !dropSet.has(s.id));
  const usedHouseholds = new Set(survivors.map((s) => s.householdId));
  const nextHouseholds = state.households.filter((h) => usedHouseholds.has(h.id));
  const next: SisState = {
    ...state,
    students: survivors,
    households: nextHouseholds,
  };

  const removedHouseholdIds = state.households
    .filter((h) => !nextHouseholds.some((x) => x.id === h.id))
    .map((h) => h.id);
  recordSisDeletion({
    studentIds: [...dropSet],
    householdIds: removedHouseholdIds,
  });

  saveSis(next);
  void import("@/lib/sisPersistence").then(({ pushSisState, flushSisSync }) => {
    pushSisState(next).then(() => flushSisSync()).catch(console.error);
  });
  return next;
}
