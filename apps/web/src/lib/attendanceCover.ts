/**
 * Who may take a class's attendance on a day its own teachers cannot
 * (director, 13 Oct 2026).
 *
 * Two kinds of cover, both for ONE day — the day it applies — and for the
 * student register only (not marks, homework or anything else the class's
 * teachers reach):
 *
 *  - a SUBSTITUTE: the office put them on one of the class's periods today
 *    in Timetable → Substitution;
 *  - the class's CO-ORDINATOR: the office gave them the class in Staff →
 *    Allocate teaching → Co-ordinators, and today the class teacher is absent
 *    (marked A / leave / half day on the staff register, or on approved
 *    leave). A class with no class teacher at all is theirs every day.
 *
 * A class has at most one co-ordinator: assigning it to a second person is
 * refused, naming who has it.
 */

export type ClassCoordinatorsState = {
  version: 1;
  /** staffId → "classId|sectionId" keys */
  byStaff: Record<string, string[]>;
  updatedAt: string;
  updatedBy: string;
};

export const CLASS_COORDINATORS_KEY = "class_coordinators";

export function emptyClassCoordinators(): ClassCoordinatorsState {
  return { version: 1, byStaff: {}, updatedAt: "", updatedBy: "" };
}

const KEY_RE = /^[^|\s]+\|[^|\s]+$/;

export function normalizeClassCoordinators(raw: unknown): ClassCoordinatorsState {
  const out = emptyClassCoordinators();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<ClassCoordinatorsState>;
  const by = r.byStaff && typeof r.byStaff === "object" ? r.byStaff : {};
  for (const [staffId, keys] of Object.entries(by)) {
    if (!staffId || !Array.isArray(keys)) continue;
    const clean = [...new Set(keys.map((k) => String(k).trim()).filter((k) => KEY_RE.test(k)))];
    if (clean.length) out.byStaff[staffId] = clean.sort();
  }
  out.updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : "";
  out.updatedBy = typeof r.updatedBy === "string" ? r.updatedBy : "";
  return out;
}

/** Section key → its co-ordinator's staff id. */
export function coordinatorBySection(state: ClassCoordinatorsState): Map<string, string> {
  const m = new Map<string, string>();
  for (const [staffId, keys] of Object.entries(state.byStaff)) for (const k of keys) if (!m.has(k)) m.set(k, staffId);
  return m;
}

/**
 * Give `staffId` exactly these classes as co-ordinator. Refused — nothing
 * changed — when any of them already belongs to someone else.
 */
export function setCoordinatorSections(
  state: ClassCoordinatorsState,
  staffId: string,
  sectionKeys: string[],
  by: string,
  nameOf: (staffId: string) => string = (id) => id,
  labelOf: (key: string) => string = (k) => k,
): { ok: true; state: ClassCoordinatorsState } | { ok: false; error: string } {
  if (!staffId) return { ok: false, error: "Choose a member of staff" };
  const keys = [...new Set(sectionKeys.map((k) => k.trim()).filter((k) => KEY_RE.test(k)))].sort();
  const owner = coordinatorBySection(state);
  const taken = keys.filter((k) => owner.has(k) && owner.get(k) !== staffId);
  if (taken.length) {
    const list = taken.map((k) => `${labelOf(k)} (${nameOf(owner.get(k)!)})`).join(", ");
    return {
      ok: false,
      error: `Not saved — a class has one co-ordinator, and ${list} ${taken.length === 1 ? "already has one" : "already have one"}. Remove ${taken.length === 1 ? "it" : "them"} from that person first.`,
    };
  }
  const byStaff = { ...state.byStaff };
  if (keys.length) byStaff[staffId] = keys;
  else delete byStaff[staffId];
  return { ok: true, state: { version: 1, byStaff, updatedAt: new Date().toISOString(), updatedBy: by } };
}

export type CoverReason = "substitute" | "coordinator";

export type CoverSection = {
  classId: string;
  sectionId: string;
  reason: CoverReason;
  /** e.g. "substituting period 3 for Kanchan Singh" */
  detail: string;
};

type SubstitutionLike = {
  academicYearCode: string;
  date: string;
  periodNo: number;
  classId: string;
  sectionId: string;
  absentTeacherId: string;
  substituteTeacherId: string;
};

type StaffLike = {
  id: string;
  fullName: string;
  status?: string;
  classTeacherLinks?: { classId: string; sectionId: string; academicYearCode?: string }[];
};

const yearOk = (linkAy: string | undefined, ay: string) => !linkAy || linkAy === ay;

/** The class teachers of a section this year (active staff). */
export function classTeachersOf(staff: StaffLike[], classId: string, sectionId: string, ay: string): StaffLike[] {
  return staff.filter(
    (s) =>
      s.status !== "inactive" &&
      (s.classTeacherLinks ?? []).some((l) => l.classId === classId && l.sectionId === sectionId && yearOk(l.academicYearCode, ay)),
  );
}

/**
 * The sections `staffId` may take attendance for on `date` beyond their own
 * classes. Pure: the caller supplies today's substitutions, the co-ordinator
 * assignments and who is absent. Unknown absence (null) gives co-ordinators
 * nothing — "we could not read the register" is not "the teacher is away".
 */
export function coverSectionsFor(input: {
  staffId: string;
  date: string;
  academicYearCode: string;
  substitutions: SubstitutionLike[];
  coordinators: ClassCoordinatorsState;
  staff: StaffLike[];
  absentStaffIds: Set<string> | null;
}): CoverSection[] {
  const { staffId, date, academicYearCode: ay } = input;
  if (!staffId) return [];
  const nameOf = (id: string) => input.staff.find((s) => s.id === id)?.fullName || "a teacher";
  const out = new Map<string, CoverSection>();

  for (const s of input.substitutions) {
    if (s.substituteTeacherId !== staffId || s.date !== date) continue;
    if (s.academicYearCode && s.academicYearCode !== ay) continue;
    const key = `${s.classId}|${s.sectionId}`;
    if (!out.has(key)) {
      out.set(key, {
        classId: s.classId,
        sectionId: s.sectionId,
        reason: "substitute",
        detail: `substituting period ${s.periodNo} for ${nameOf(s.absentTeacherId)}`,
      });
    }
  }

  if (input.absentStaffIds) {
    for (const key of input.coordinators.byStaff[staffId] ?? []) {
      if (out.has(key)) continue;
      const [classId, sectionId] = key.split("|") as [string, string];
      const teachers = classTeachersOf(input.staff, classId, sectionId, ay);
      const away = teachers.filter((t) => input.absentStaffIds!.has(t.id));
      if (teachers.length === 0) {
        out.set(key, { classId, sectionId, reason: "coordinator", detail: "co-ordinator · the class has no class teacher" });
      } else if (away.length === teachers.length) {
        out.set(key, {
          classId,
          sectionId,
          reason: "coordinator",
          detail: `co-ordinator · ${away.map((t) => t.fullName).join(", ")} absent today`,
        });
      }
    }
  }
  return [...out.values()];
}

/** The school's calendar day (IST). */
export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}
