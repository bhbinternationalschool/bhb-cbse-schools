/**
 * The UDISE+ Teacher module (teacher.udiseplus.gov.in) from the ERP's Staff
 * records — what the Office Robot may type into a teacher's profile, and how
 * the portal's teacher list lines up with the ERP's staff.
 *
 * Director, 6 Oct 2026: "start with UDISE teacher profiles". All 17 teaching
 * profiles on the portal read "Incomplete" for 2026-27.
 *
 * The profile is three steps, each its own page, keyed by the form's
 * `formcontrolname`s with the portal's own option codes (read off the live
 * forms on 6 Oct 2026, logged in, nothing saved):
 *   GP  #/editteachercommonfirst  — general profile
 *   AT  #/getTeacherSecondForm    — appointment & teaching
 *   TD  #/getTeacherThirdForm     — training (the ERP holds none of it)
 *
 * Same rules as the student robot (lib/udisePortalFill): the extension fills
 * only a field that is EMPTY on the portal, outlines it, and a person checks
 * and presses Save. Name, date of birth, Aadhaar and date of joining service
 * are locked on the portal after UIDAI verification and are never offered.
 * Unknown must not become fact: a code is offered only when the ERP's wording
 * says it outright; everything else is listed for the person to type.
 */

import type { ClassGroupCode, MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import { aadhaarChecksumValid, aadhaarDigits } from "@/lib/aadhaar";

export type TeacherForm = "gp" | "at" | "td";

export type TeacherFillField = {
  control: string;
  /** ng-select dropdown, plain text box, or a Yes/No radio group. */
  kind: "ngselect" | "text" | "radio";
  /** The portal's option code (ng-select / radio) or the text to type. */
  value: string;
  label: string;
  /** What the ERP holds, shown beside it. */
  shown: string;
};

export type TeacherFillPlan = {
  fields: TeacherFillField[];
  /** Portal questions the ERP cannot answer — the person types these. */
  leftForYou: string[];
};

/** One row of the portal's teacher list (teacher-details/<school>/1). */
export type PortalTeacher = {
  empStaffId: number | string;
  nationalCode: string;
  staffName: string;
  gender?: string;
  dateOfBirth?: string;
  dateOfJoiningInService?: string;
  dateOfJoiningInPresentSchool?: string;
  natureOfAppointment?: string;
  typeOfTeacher?: string;
  classTaught?: string;
  academicQualification?: string;
  professionalQualification?: string;
  socialCategory?: string;
  mainSubject1?: string;
  email?: string;
  /** Which portal list the row came from (the robot tags it; absent = teaching). */
  staffType?: "teaching" | "non_teaching";
};

/** The fields of a portal teacher row that may leave the portal tab. */
export const PORTAL_TEACHER_FIELDS = [
  "empStaffId",
  "nationalCode",
  "staffName",
  "gender",
  "dateOfBirth",
  "dateOfJoiningInService",
  "dateOfJoiningInPresentSchool",
  "natureOfAppointment",
  "typeOfTeacher",
  "classTaught",
  "academicQualification",
  "professionalQualification",
  "socialCategory",
  "mainSubject1",
  "email",
] as const;

export function pickPortalTeacher(raw: Record<string, unknown>): PortalTeacher {
  const out: Record<string, unknown> = {};
  for (const k of PORTAL_TEACHER_FIELDS) if (k in raw) out[k] = raw[k];
  if (raw.staffType === "non_teaching") out.staffType = "non_teaching";
  return out as PortalTeacher;
}

// ─── Small helpers ───────────────────────────────────────────────────────

const clean = (s: string) => (s || "").toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();

/** ERP ISO date (YYYY-MM-DD) or DD/MM/YYYY → the portal's DD/MM/YYYY. */
export function portalDate(v: string): string {
  const s = (v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return "";
}

function mobile10(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  const m = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(m) ? m : "";
}

/** The leading portal code of a "5-Post Graduate" / "1 - Regular" label. */
export function portalCode(label: string | undefined | null): string {
  const m = String(label ?? "").match(/^\s*(-?\d+)\s*-/);
  return m ? m[1]! : "";
}

// ─── ERP wording → portal codes ──────────────────────────────────────────

const GENDER: Record<string, string> = { M: "1", F: "2", O: "3" };
const SOCIAL: Record<string, string> = { GENERAL: "1", SC: "2", ST: "3", OBC: "4" };

/**
 * Highest academic level, portal scale: 1 Below Secondary, 2 Secondary,
 * 3 Higher Secondary, 4 Graduate, 5 Post Graduate, 6 M.Phil., 7 Ph.D.
 * From the ERP's free-text qualification ("M.A., B.Ed", "BSc BEd", …).
 */
export function academicLevelCode(q: string): string {
  const s = ` ${(q || "").toLowerCase().replace(/[.,/()]/g, " ")} `;
  if (!s.trim()) return "";
  if (/\bpost ?doc/.test(s)) return "8";
  if (/\bph ?d\b/.test(s)) return "7";
  if (/\bm ?phil\b/.test(s)) return "6";
  if (/\b(post ?grad\w*|pg|m ?a|m ?sc|m ?com|mba|mca|m ?tech|m ?lib|msw)\b/.test(s)) return "5";
  if (/\b(grad\w*|b ?a|b ?sc|b ?com|bba|bca|b ?tech|b ?e|llb|b ?lib|bsw)\b/.test(s)) return "4";
  if (/\b(12th|xii|intermediate|inter|higher secondary|hsc|senior secondary)\b/.test(s)) return "3";
  if (/\b(10th|high ?school|matric|ssc)\b/.test(s)) return "2";
  return "";
}

/**
 * Highest professional (teacher-training) qualification, portal codes:
 * 1 D.El.Ed/BTC (≥2 yr), 3 B.Ed, 4 M.Ed, 10 D.El.Ed, 11 NTT/ECCE,
 * 12 B.Ed (Nursery), 13 B.P.Ed, 14 M.P.Ed. Highest one named wins.
 * Nothing named → blank (not "None": the ERP may simply not say).
 */
export function professionalQualCode(q: string): string {
  const s = ` ${(q || "").toLowerCase().replace(/[.,/()]/g, " ")} `;
  if (/\bm ?p ?ed\b/.test(s)) return "14";
  if (/\bm ?ed\b/.test(s)) return "4";
  if (/\bb ?p ?ed\b/.test(s)) return "13";
  if (/\bb ?ed\b.*\bnursery\b|\bnursery\b.*\bb ?ed\b/.test(s)) return "12";
  if (/\bb ?ed\b/.test(s)) return "3";
  if (/\bd ?el ?ed\b/.test(s)) return "10";
  if (/\b(btc|basic teacher|jbt)\b/.test(s)) return "1";
  if (/\b(ntt|nursery teacher|ecce|montessori)\b/.test(s)) return "11";
  return "";
}

/** Nature of appointment: 1 Regular, 2 Contract, 3 Guest / part-time. */
function appointmentCode(jobType: string): string {
  if (jobType === "confirmed" || jobType === "probation") return "1";
  if (jobType === "contract") return "2";
  return "";
}

/** Type of teacher / post held, from the ERP designation name. */
export function teacherTypeCode(designation: string): string {
  const d = (designation || "").toLowerCase();
  if (!d) return "";
  if (/\bvice[\s-]?principal\b/.test(d)) return "7";
  if (/\bprincipal\b/.test(d)) return "6";
  if (/\b(acting|incharge|in-charge) head\b/.test(d)) return "2";
  if (/\bhead ?(teacher|master|mistress)\b/.test(d)) return "1";
  if (/\blecturer\b/.test(d)) return "8";
  if (/\b(teacher|tgt|prt|ntt|pgt|asst|assistant|instructor|coach)\b/.test(d)) return "3";
  return "";
}

/** Portal subject codes, from a Masters subject (code / English name). */
export function subjectCode(code: string, name: string): string {
  const s = `${code} ${name}`.toLowerCase();
  if (/\b(math|maths|mathematics|ganit)\b/.test(s)) return "3";
  if (/\b(evs|environment)/.test(s)) return "4";
  if (/\bmusic\b/.test(s)) return "6";
  if (/\b(sst|social|civics)\b/.test(s)) return "8";
  if (/\bscience\b/.test(s)) return "7";
  if (/\bgeograph/.test(s)) return "18";
  if (/\bhistory\b/.test(s)) return "19";
  if (/\bhindi\b/.test(s)) return "41";
  if (/\bsanskrit\b/.test(s)) return "43";
  if (/\burdu\b/.test(s)) return "45";
  if (/\benglish\b/.test(s)) return "46";
  if (/\b(art|drawing|craft)\b/.test(s)) return "91";
  if (/\b(physical|pe|sports|games|yoga|health)\b/.test(s)) return "92";
  if (/\bwork education\b/.test(s)) return "93";
  return "";
}

/**
 * Classes taught, portal codes: 1 Primary (I–V), 2 Upper primary (VI–VIII),
 * 3 both, 10 Pre-primary only, 11 Pre-primary & primary. From the class
 * groups of the teacher's class-teacher and subject links this year.
 */
export function classesTaughtCode(groups: Set<ClassGroupCode>): string {
  const pre = groups.has("PRE_PRIMARY");
  const pri = groups.has("PRIMARY");
  const mid = groups.has("MIDDLE");
  if (pre && !pri && !mid) return "10";
  if (pre && pri && !mid) return "11";
  if (!pre && pri && !mid) return "1";
  if (!pre && !pri && mid) return "2";
  if (!pre && pri && mid) return "3";
  return "";
}

// ─── Matching the portal's teachers to ERP staff ─────────────────────────

export type TeacherMatch =
  | { kind: "matched"; staff: StaffRecord; by: "national_code" | "name_dob" }
  | { kind: "unsure"; candidates: StaffRecord[] }
  | { kind: "none" };

/**
 * A National Code, or "" when the value is not one.
 *
 * Until UDISE+ issues a code, its list says "Will Be Generated Shortly" —
 * 13 of the school's 30 portal staff on 9 Oct 2026. That sentence was copied
 * into NEHA PATHAK's ERP record as her code, so every one of the 13 "had" her
 * code: all matched to her, and the review told the office their code was
 * "on Neha Pathak's record". Real codes are letters then digits (TR30222856,
 * TP07405881); anything else is no code at all.
 */
export function realNationalCode(v: unknown): string {
  const c = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{1,4}\d{5,12}$/.test(c) ? c : "";
}

/**
 * The ERP staff member a portal teacher is. The portal's National Code
 * stored in the ERP (Staff → OASIS / UDISE id) settles it; otherwise the
 * same name AND the same date of birth. A name alone is never an identity.
 */
export function matchPortalTeacher(staff: StaffRecord[], t: PortalTeacher): TeacherMatch {
  const code = realNationalCode(t.nationalCode);
  if (code) {
    const byCode = staff.filter((s) => realNationalCode(s.oasisId) === code);
    if (byCode.length === 1) return { kind: "matched", staff: byCode[0]!, by: "national_code" };
    if (byCode.length > 1) return { kind: "unsure", candidates: byCode };
  }
  const name = clean(t.staffName);
  const dob = portalDate(t.dateOfBirth || "");
  const sameName = staff.filter((s) => clean(s.fullName) === name);
  const both = sameName.filter((s) => dob && portalDate(s.dateOfBirth) === dob);
  if (both.length === 1) return { kind: "matched", staff: both[0]!, by: "name_dob" };
  if (sameName.length) return { kind: "unsure", candidates: sameName };
  return { kind: "none" };
}

// ─── The fill plan ───────────────────────────────────────────────────────

function designationName(m: MastersState, s: StaffRecord): string {
  return m.designations.find((d) => d.id === s.designationId)?.name || "";
}

export function teachingGroups(m: MastersState, s: StaffRecord, ay: string): Set<ClassGroupCode> {
  const ids = [
    ...s.classTeacherLinks.filter((l) => !ay || l.academicYearCode === ay).map((l) => l.classId),
    ...s.subjectTeachingLinks.filter((l) => !ay || l.academicYearCode === ay).map((l) => l.classId),
  ];
  const out = new Set<ClassGroupCode>();
  for (const id of ids) {
    const g = m.classes.find((c) => c.id === id)?.groupCode;
    if (g) out.add(g);
  }
  return out;
}

/** The teacher's subjects this year, most periods first, as portal codes. */
function teachingSubjects(m: MastersState, s: StaffRecord, ay: string): string[] {
  const periods = new Map<string, number>();
  for (const l of s.subjectTeachingLinks.filter((x) => !ay || x.academicYearCode === ay)) {
    const sub = m.subjects.find((x) => x.id === l.subjectId);
    const code = sub ? subjectCode(sub.code, sub.nameEn) : "";
    if (code) periods.set(code, (periods.get(code) || 0) + (l.periodsPerWeek || 1));
  }
  return [...periods.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function buildTeacherFillPlan(
  s: StaffRecord,
  form: TeacherForm,
  masters: MastersState,
  academicYearCode: string,
): TeacherFillPlan {
  const fields: TeacherFillField[] = [];
  const left: string[] = [];
  const add = (f: TeacherFillField | null, missing: string) => {
    if (f && f.value) fields.push(f);
    else left.push(missing);
  };

  if (form === "gp") {
    add(GENDER[s.gender] ? { control: "gender", kind: "ngselect", value: GENDER[s.gender]!, label: "Gender", shown: s.gender } : null, "Gender");
    add(
      SOCIAL[s.casteCategory] ? { control: "socialCat", kind: "ngselect", value: SOCIAL[s.casteCategory]!, label: "Social category", shown: s.casteCategory } : null,
      "Social category",
    );
    const acad = academicLevelCode(s.qualification);
    add(acad ? { control: "qualAcad", kind: "ngselect", value: acad, label: "Highest academic qualification", shown: s.qualification } : null, "Highest academic qualification");
    const prof = professionalQualCode(s.qualification);
    add(prof ? { control: "qualProf", kind: "ngselect", value: prof, label: "Highest professional qualification", shown: s.qualification } : null, "Highest professional qualification");
    const mob = mobile10(s.mobile);
    add(mob ? { control: "mobile", kind: "text", value: mob, label: "Mobile", shown: mob } : null, "Mobile");
    const email = (s.email || "").trim();
    add(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { control: "email", kind: "text", value: email, label: "Email", shown: email } : null, "Email");
    left.push("Trade / degree", "Subjects studied up to (Maths, Science, English, Social Science, Language)", "Type of disability");
  } else if (form === "at") {
    const appt = appointmentCode(s.jobType);
    add(appt ? { control: "natureOfAppt", kind: "ngselect", value: appt, label: "Nature of appointment", shown: s.jobType } : null, "Nature of appointment");
    const doj = portalDate(s.joiningDate);
    add(doj ? { control: "dojPs", kind: "text", value: doj, label: "Date of joining in present school", shown: doj } : null, "Date of joining in present school");
    const desig = designationName(masters, s);
    const type = teacherTypeCode(desig);
    add(type ? { control: "tchType", kind: "ngselect", value: type, label: "Type of teacher / post", shown: desig } : null, "Type of teacher / post held");
    const taught = classesTaughtCode(teachingGroups(masters, s, academicYearCode));
    add(taught ? { control: "classTaught", kind: "ngselect", value: taught, label: "Classes taught", shown: "from this year's class & subject links" } : null, "Classes taught");
    const subs = teachingSubjects(masters, s, academicYearCode);
    // Pre-primary only offers "All subjects".
    const subjects = taught === "10" ? ["1"] : subs;
    add(subjects[0] ? { control: "subTaught1", kind: "ngselect", value: subjects[0], label: "Main subject taught 1", shown: s.subjectsTaught || "from subject links" } : null, "Main subject taught 1");
    if (subjects[1]) fields.push({ control: "subTaught2", kind: "ngselect", value: subjects[1], label: "Main subject taught 2", shown: s.subjectsTaught || "from subject links" });
    // The post may have changed since joining (a promotion), so the ERP's
    // joining date is a hint here, not an answer.
    left.push(
      `Date of joining present post${doj ? ` (joined the school ${doj})` : ""}`,
      "Appointed for subject",
      "On deputation from another school? / Also teaching elsewhere?",
    );
  } else {
    left.push(
      "Trained for teaching CWSN?",
      "Trained in computer for teaching?",
      "Training received / needed",
      "NISHTHA training",
      "Working days on non-teaching assignments",
      "Safety & security audit training · Cyber safety · Psycho-social",
      "CWSN early identification training",
      "CTET / STET qualified?",
    );
  }
  return { fields, leftForYou: left };
}

// ─── Adding a teacher the portal does not list ───────────────────────────

/**
 * The portal's "Add New Staff" (#/addNewStaff → Staff Type → Go) opens
 * #/teacherCommonDetails: the SAME General Profile form as editing, but with
 * name, date of birth and Aadhaar still open (studied 7 Oct 2026, read-only).
 * So the plan is the GP plan plus those three.
 *
 * Aadhaar (referenceKey) only when the ERP holds a full 12-digit number whose
 * checksum holds; otherwise it is left blank and said so — unlike Add Student
 * there is no "999999999999" here: nobody has checked that the Teacher module
 * accepts it. "Name as per Aadhaar" is never the ERP name: the ERP does not
 * know how the card spells it.
 */
export function buildTeacherAddPlan(
  s: StaffRecord,
  masters: MastersState,
  academicYearCode: string,
): TeacherFillPlan & { aadhaarFilled: boolean } {
  const gp = buildTeacherFillPlan(s, "gp", masters, academicYearCode);
  const fields: TeacherFillField[] = [];
  const left: string[] = [];
  const name = (s.fullName || "").replace(/\s+/g, " ").trim();
  if (name) fields.push({ control: "empName", kind: "text", value: name.toUpperCase(), label: "Name", shown: name });
  else left.push("Name");
  const dob = portalDate(s.dateOfBirth);
  if (dob) fields.push({ control: "dob", kind: "text", value: dob, label: "Date of birth", shown: dob });
  else left.push("Date of birth");
  const aadhaar = aadhaarDigits(s.aadhaarNo || "");
  const aadhaarFilled = aadhaar.length === 12 && aadhaarChecksumValid(aadhaar);
  if (aadhaarFilled) {
    fields.push({ control: "referenceKey", kind: "text", value: aadhaar, label: "Aadhaar", shown: `********${aadhaar.slice(-4)}` });
  } else {
    left.push(s.aadhaarNo ? "Aadhaar — the ERP's number is not a valid 12-digit Aadhaar" : "Aadhaar — not in the ERP");
  }
  left.push("Name as per Aadhaar");
  return { fields: [...fields, ...gp.fields], leftForYou: [...left, ...gp.leftForYou], aadhaarFilled };
}

// ─── The portal list against the ERP ─────────────────────────────────────

export type TeacherBoardRow = {
  nationalCode: string;
  portalName: string;
  match: "matched" | "unsure" | "none";
  erpStaffId: string;
  erpName: string;
  /** National Code not yet stored on the ERP staff record. */
  codeMissingInErp: boolean;
  /** Where the ERP and the portal disagree (portal values are UIDAI-locked). */
  differences: string[];
};

export type TeacherBoard = {
  rows: TeacherBoardRow[];
  /** Active ERP teaching staff the portal does not list — the add queue. */
  notOnPortal: { staffId: string; name: string; staffType: "teaching" | "non_teaching" }[];
  /**
   * Not matched, yet perhaps already on UDISE+: a candidate of a portal row
   * the matcher could not settle, or a record that already holds a National
   * Code (it was registered somewhere — perhaps on the non-teaching list).
   * Never queued for Add New Staff: a second portal record is worse than none.
   */
  maybeOnPortal: { staffId: string; name: string; why: string }[];
};

/**
 * `nonTeachingRead`: the robot also read the portal's NON-teaching list, so an
 * ERP non-teaching staff member missing from it can be offered for adding too
 * (director, 7 Oct 2026). Without that list, nobody non-teaching is "missing":
 * unread is not absent.
 */
export function buildTeacherBoard(staff: StaffRecord[], portal: PortalTeacher[], opts: { nonTeachingRead?: boolean } = {}): TeacherBoard {
  const active = staff.filter((s) => s.status === "active");
  const seen = new Set<string>();
  const maybe = new Map<string, string>();
  const rows: TeacherBoardRow[] = portal.map((t) => {
    const m = matchPortalTeacher(active, t);
    if (m.kind === "unsure") for (const c of m.candidates) maybe.set(c.id, `may be the portal's ${t.staffName}`);
    if (m.kind !== "matched") {
      return {
        nationalCode: realNationalCode(t.nationalCode),
        portalName: t.staffName,
        match: m.kind,
        erpStaffId: "",
        erpName: m.kind === "unsure" ? m.candidates.map((c) => c.fullName).join(" / ") : "",
        codeMissingInErp: false,
        differences: [],
      };
    }
    const s = m.staff;
    seen.add(s.id);
    const differences: string[] = [];
    const pDob = portalDate(t.dateOfBirth || "");
    const eDob = portalDate(s.dateOfBirth);
    if (pDob && eDob && pDob !== eDob) differences.push(`Date of birth: portal ${pDob}, ERP ${eDob}`);
    const pDoj = portalDate(t.dateOfJoiningInPresentSchool || "");
    const eDoj = portalDate(s.joiningDate);
    if (pDoj && eDoj && pDoj !== eDoj) differences.push(`Joined this school: portal ${pDoj}, ERP ${eDoj}`);
    const pAcad = portalCode(t.academicQualification);
    const eAcad = academicLevelCode(s.qualification);
    if (pAcad && eAcad && pAcad !== eAcad) differences.push(`Academic qualification: portal "${t.academicQualification}", ERP "${s.qualification}"`);
    const pGender = portalCode(t.gender);
    if (pGender && GENDER[s.gender] && pGender !== GENDER[s.gender]) differences.push(`Gender: portal "${t.gender}", ERP ${s.gender}`);
    const code = realNationalCode(t.nationalCode);
    return {
      nationalCode: code,
      portalName: t.staffName,
      match: "matched",
      erpStaffId: s.id,
      erpName: s.fullName,
      // Only a real portal code can be "missing" from the ERP.
      codeMissingInErp: !!code && realNationalCode(s.oasisId) !== code,
      differences,
    };
  });
  const isTeaching = (s: StaffRecord) => s.stream === "teaching";
  const missing = active.filter((s) => !seen.has(s.id) && (isTeaching(s) || opts.nonTeachingRead === true));
  for (const s of missing) {
    const held = realNationalCode(s.oasisId);
    if (!maybe.has(s.id) && held) maybe.set(s.id, `holds National Code ${held}`);
  }
  const notOnPortal = missing
    .filter((s) => !maybe.has(s.id))
    .map((s) => ({ staffId: s.id, name: s.fullName, staffType: isTeaching(s) ? ("teaching" as const) : ("non_teaching" as const) }));
  const maybeOnPortal = missing
    .filter((s) => maybe.has(s.id))
    .map((s) => ({ staffId: s.id, name: s.fullName, why: maybe.get(s.id)! }));
  return { rows, notOnPortal, maybeOnPortal };
}
