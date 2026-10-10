/**
 * Which home a staff member gets in the staff app.
 *
 * The app used to know three homes (teacher, principal-like, transport crew)
 * and sent everyone else — accountant, counsellor, computer operator, peons,
 * sweepers — to the teacher home with a picker over every class. The kind is
 * resolved here, on the server, from the same signals RBAC uses (role code,
 * designation, stream, class-teacher links) so the app never has to guess
 * from a role code again.
 *
 * Pure: no I/O, so it is self-tested in staffHomeKind.selftest.ts.
 */

export type StaffHomeKind =
  | "leadership"
  | "teaching"
  | "crew"
  | "office"
  | "support";

export const STAFF_HOME_KINDS: StaffHomeKind[] = [
  "leadership",
  "teaching",
  "crew",
  "office",
  "support",
];

export type StaffHomeSignals = {
  roleCode: string;
  /** Designation code + name, any case. Empty when the roster has none. */
  designation: string;
  /** Roster stream: "teaching" | "non_teaching" | … */
  stream: string;
  /** Has a class-teacher link or timetable periods this year. */
  teachesClasses: boolean;
};

const LEADERSHIP_ROLE = /principal|owner|admin|director|hm|head.?master|vice.?principal/;
const LEADERSHIP_DES = /principal|director|trustee|hm\b|head.?master|vice.?principal|chairman|secretary|manager/;
const CREW_ROLE = /^(driver|field)$/;
const CREW_DES = /driver|conductor|attend[ae]nt|helper|cleaner|vehicle|bus\b/;
const OFFICE_ROLE = /^(accounts|office|auditor|transport)$/;
const OFFICE_DES = /account|cashier|clerk|operator|reception|office|counsel|librar|nurse|computer|admission|transport|coordinator|it\b|data entry|steno|typist/;
const TEACHING_ROLE = /^teacher$/;
const TEACHING_DES = /teacher|tgt|pgt|prt|pprt|ngt|nursery|faculty|lecturer|coach|instructor|tutor|educator|trainer/;

/**
 * Order matters: leadership beats everything (a Director who also teaches
 * still gets the school snapshot); crew beats office so a "Transport
 * Attendent" (sic — the roster spells it that way) rides the bus home; a
 * Transport in-charge role without a crew designation is office work.
 */
export function staffHomeKind(s: StaffHomeSignals): StaffHomeKind {
  const rc = (s.roleCode || "").trim().toLowerCase();
  const des = (s.designation || "").trim().toLowerCase();
  const stream = (s.stream || "").trim().toLowerCase();

  if (LEADERSHIP_ROLE.test(rc) || LEADERSHIP_DES.test(des)) return "leadership";
  if (CREW_ROLE.test(rc) || CREW_DES.test(des)) return "crew";
  if (TEACHING_DES.test(des)) return "teaching";
  if (OFFICE_DES.test(des) || OFFICE_ROLE.test(rc)) return "office";
  if (TEACHING_ROLE.test(rc) && (stream === "teaching" || s.teachesClasses)) {
    return "teaching";
  }
  if (stream === "teaching" || s.teachesClasses) return "teaching";
  // Unmatched designations default to roleCode "teacher" at login, so the
  // role alone is not evidence of teaching — a peon carries it too.
  return "support";
}

/** The app route each kind lands on. Kept here so both sides agree. */
export function staffHomePath(kind: StaffHomeKind): string {
  switch (kind) {
    case "leadership":
      return "/principal";
    case "crew":
      return "/driver";
    case "office":
    case "support":
      return "/desk";
    default:
      return "/staff";
  }
}

/** Kinds that may act school-wide (approvals, any section) without a class link. */
export function isSchoolWideKind(kind: StaffHomeKind): boolean {
  return kind === "leadership" || kind === "office";
}
