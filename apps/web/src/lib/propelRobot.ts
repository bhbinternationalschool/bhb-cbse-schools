/**
 * The Office Robot's Propel panel (director, 12 Oct 2026): what the ERP
 * sends to LEAD's Nucleus portal (nucleus.leadgroup.co.in, school 14624) —
 * holidays, the exam date sheet as "Offline assessment" events, new
 * teachers, and the filled student upload sheet — and what it brings back
 * (Propel's tests and the chapters they cover).
 *
 * Pure: the routes feed it ERP data plus what the robot read from Propel,
 * and it answers with exact portal payloads and a plain-language list of
 * everything it will NOT send and why. The robot shows that list; a person
 * presses Send. Portal facts (studied 12 Oct, read-only): memory
 * propel-nucleus-portal-api.
 */

/** Propel's class ids for this school (calendar masters, 12 Oct 2026). */
export const PROPEL_CLASS_IDS: Record<PropelClassKey, number> = {
  nursery: 1,
  lkg: 154,
  ukg: 155,
  "1": 102,
  "2": 92,
  "3": 93,
  "4": 110,
  "5": 109,
  "6": 114,
  "7": 115,
  "8": 116,
};

export type PropelClassKey = "nursery" | "lkg" | "ukg" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

/** The student sheet's class dropdown spells pre-primary JKG / SKG. */
const SHEET_CLASS: Record<PropelClassKey, string> = {
  nursery: "Nursery",
  lkg: "JKG",
  ukg: "SKG",
  "1": "Class 1",
  "2": "Class 2",
  "3": "Class 3",
  "4": "Class 4",
  "5": "Class 5",
  "6": "Class 6",
  "7": "Class 7",
  "8": "Class 8",
};

const ROMAN: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8" };

/** Which Propel class an ERP class is; "" when Propel has no such class (IX, X, …). */
export function propelClassKey(name: string): PropelClassKey | "" {
  const n = String(name || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!n) return "";
  if (/^(NUR|NURSERY|PRE ?NURSERY|PG|PLAY ?GROUP)$/.test(n)) return "nursery";
  if (/^(LKG|JKG|KG ?1|L\.K\.G\.?)$/.test(n)) return "lkg";
  if (/^(UKG|SKG|KG ?2|U\.K\.G\.?)$/.test(n)) return "ukg";
  const m = n.match(/^(?:CLASS|STD|GRADE)?\s*([IVX]+|\d{1,2})$/);
  if (!m) return "";
  const num = ROMAN[m[1]] ?? m[1];
  return (["1", "2", "3", "4", "5", "6", "7", "8"] as const).find((k) => k === num) ?? "";
}

/** Propel accepts letters, digits and spaces only (^[ a-zA-Z0-9]*$). */
export function propelDescription(text: string): string {
  return String(text || "")
    .replace(/[^ a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

const ymd = (iso: string) => String(iso || "").slice(0, 10);
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Every date from `from` to `to` (inclusive) falling on `weekday` (0 = Sunday). */
function weekdayDates(from: string, to: string, weekday: number, except: Set<string>): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 60) {
    const s = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === weekday && !except.has(s)) out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ─── Calendar ──────────────────────────────────────────────────────────

/** A holiday or event as Propel lists it (GET …/calendar/holiday|event). */
export type PropelCalendarRow = {
  id?: number;
  description?: string;
  startDate?: string;
  endDate?: string;
  eventType?: string;
  subjectId?: number | null;
  selectedClasses?: number[];
  is_active?: boolean;
};

export type PropelHolidayPayload = {
  description: string;
  startDate: string;
  endDate: string;
  applicableTo: number;
  selectedClasses: string[];
  unit: "";
  is_active: true;
};

export type PropelEventPayload = {
  description: string;
  startDate: string;
  endDate: string;
  eventType: string;
  selectedClasses: string[];
  eventCustomId: number | null;
  subjectId: number | null;
  unit: "";
  is_active: true;
};

export type PlanLine = { what: string; why: string };

type ErpClass = { id: string; name: string; groupCode?: string; isActive?: boolean };

type ErpHoliday = {
  id: string;
  academicYearCode: string;
  title: string;
  startsOn: string;
  endsOn: string;
  scope: string;
  groupCode: string;
  classIds: string[];
  appliesTo: string;
  mode: string;
  weekday: number | null;
  exceptionDates: string[];
  workingOverride: boolean;
  isPublished: boolean;
};

const STUDENT_AUDIENCES = new Set(["everyone", "students", "students_and_teaching", "students_and_non_teaching"]);

function classesFor(h: Pick<ErpHoliday, "scope" | "groupCode" | "classIds">, classes: ErpClass[]): number[] {
  const active = classes.filter((c) => c.isActive !== false);
  const picked =
    h.scope === "class"
      ? active.filter((c) => h.classIds.includes(c.id))
      : h.scope === "class_group"
        ? active.filter((c) => c.groupCode === h.groupCode)
        : active;
  const ids = new Set<number>();
  for (const c of picked) {
    const k = propelClassKey(c.name);
    if (k) ids.add(PROPEL_CLASS_IDS[k]);
  }
  return [...ids].sort((a, b) => a - b);
}

const sameDay = (a?: string, b?: string) => ymd(a || "") === ymd(b || "");
const descKey = (s?: string) => propelDescription(s || "").toLowerCase();

/**
 * Holidays to post: published, for students, in this academic year, not
 * yet over, and not already on Propel (same description and dates). A
 * weekly rule becomes one entry per day, as the office posts them now.
 * Propel refuses a start before today, so a holiday under way is skipped.
 */
export function buildPropelHolidayPlan(input: {
  holidays: ErpHoliday[];
  classes: ErpClass[];
  academicYearCode: string;
  ayEnd: string;
  today: string;
  existing: PropelCalendarRow[];
}): { create: PropelHolidayPayload[]; already: number; skipped: PlanLine[] } {
  const create: PropelHolidayPayload[] = [];
  const skipped: PlanLine[] = [];
  let already = 0;
  const onPropel = (desc: string, start: string, end: string) =>
    input.existing.some((e) => e.is_active !== false && descKey(e.description) === descKey(desc) && sameDay(e.startDate, start) && sameDay(e.endDate, end));

  for (const h of input.holidays) {
    if (h.academicYearCode !== input.academicYearCode || !h.isPublished || h.workingOverride) continue;
    const label = h.title || "Holiday";
    if (!STUDENT_AUDIENCES.has(h.appliesTo)) {
      skipped.push({ what: label, why: "a staff-only holiday — Propel's calendar is for classes" });
      continue;
    }
    const description = propelDescription(label);
    if (!description) {
      skipped.push({ what: label, why: "its name has no letters or numbers Propel accepts" });
      continue;
    }
    const selected = classesFor(h, input.classes);
    if (!selected.length) {
      skipped.push({ what: label, why: "none of its classes exist on Propel" });
      continue;
    }
    const applicableTo = h.appliesTo === "students" ? 1 : 2;
    const ranges: [string, string][] =
      h.mode === "weekly" && h.weekday !== null
        ? weekdayDates(
            [ymd(h.startsOn), input.today].filter(isYmd).sort().pop() || input.today,
            isYmd(ymd(h.endsOn)) ? ymd(h.endsOn) : input.ayEnd,
            h.weekday,
            new Set(h.exceptionDates || []),
          ).map((d) => [d, d])
        : [[ymd(h.startsOn), ymd(h.endsOn) || ymd(h.startsOn)]];
    for (const [start, end] of ranges) {
      if (!isYmd(start) || !isYmd(end)) {
        skipped.push({ what: label, why: "its dates are incomplete" });
        continue;
      }
      if (end < input.today) continue; // over: nothing to tell Propel
      if (start < input.today) {
        skipped.push({ what: `${label} (${start})`, why: "already started — Propel refuses a start before today" });
        continue;
      }
      if (onPropel(description, start, end)) {
        already++;
        continue;
      }
      create.push({
        description,
        startDate: start,
        endDate: end,
        applicableTo,
        selectedClasses: selected.map(String),
        unit: "",
        is_active: true,
      });
    }
  }
  return { create, already, skipped };
}

/** Propel's subject list (calendar masters): id, name, the classes it is taught in. */
export type PropelSubject = { id: number; name: string; classes: number[] };

const PRE_PRIMARY_IDS = new Set([1, 154, 155]);

/**
 * The Propel subject an ERP exam subject is, for one Propel class — by
 * meaning, then by the classes Propel teaches it in. 0 = none.
 */
export function propelSubjectFor(subjectName: string, propelClassId: number, subjects: PropelSubject[]): number {
  const n = String(subjectName || "").toLowerCase();
  const pre = PRE_PRIMARY_IDS.has(propelClassId);
  const want: RegExp[] = /english/.test(n)
    ? pre ? [/english literacy/] : [/^propel english$/]
    : /math|numeracy|ganit/.test(n)
      ? pre ? [/numeracy/] : [/math/]
      : /hindi/.test(n)
        ? [/hindi/]
        : /\bevs\b|environment/.test(n)
          ? [/\bevs\b/]
          : /science/.test(n) && !/social|computer/.test(n)
            ? [/^propel science$/]
            : /social|sst|history|geography|civics/.test(n)
              ? [/^propel social science$/, /social science/]
              : /computer|coding|\bict\b|\bit\b/.test(n)
                ? [/computer/]
                : /\bgk\b|general knowledge|know and grow/.test(n)
                  ? [/general knowledge/]
                  : /understanding|our world|\buow\b/.test(n)
                    ? [/understanding our world/]
                    : /rhyme|stories/.test(n)
                      ? [/rhymes/]
                      : [];
  for (const re of want) {
    const hit = subjects.find((s) => re.test(s.name.toLowerCase()) && s.classes.includes(propelClassId));
    if (hit) return hit.id;
  }
  return 0;
}

/** Propel's exam types for an Offline assessment: 1 Unit, 2 Periodic, 3 MOY, 4 EOY. */
export function propelExamType(term: { code?: string; label?: string }): number {
  const t = `${term.code || ""} ${term.label || ""}`.toLowerCase();
  if (/half|\bhy\b|mid|\bmoy\b|term ?1|sa ?1/.test(t)) return 3;
  if (/annual|final|\beoy\b|term ?2|sa ?2|year end/.test(t)) return 4;
  if (/unit|\but\b/.test(t)) return 1;
  return 2;
}

type ErpTerm = { id: string; code: string; label: string; academicYearCode: string; isActive?: boolean };
type ErpExamSubject = { id: string; name: string };
type ErpDateRow = { id: string; academicYearCode: string; examTermId: string; classId: string; subjectId: string; date: string };

/**
 * The date sheet as Propel "Offline assessment" events: one event per exam,
 * subject and day, listing every class sitting it (the way Propel groups
 * classes). A subject Propel does not teach (Sanskrit, Drawing, …) cannot be
 * an Offline assessment there, so it goes as an "Academic Event" — as the
 * office posts it today — and the plan says so.
 */
export function buildPropelExamPlan(input: {
  terms: ErpTerm[];
  subjects: ErpExamSubject[];
  dateSheet: ErpDateRow[];
  classes: ErpClass[];
  academicYearCode: string;
  today: string;
  propelSubjects: PropelSubject[];
  existing: PropelCalendarRow[];
}): { create: PropelEventPayload[]; already: number; skipped: PlanLine[]; asAcademicEvent: number } {
  const term = new Map(input.terms.map((t) => [t.id, t]));
  const subject = new Map(input.subjects.map((s) => [s.id, s]));
  const cls = new Map(input.classes.map((c) => [c.id, c]));
  const skipped: PlanLine[] = [];
  const groups = new Map<string, { payload: PropelEventPayload; classes: Set<number> }>();

  for (const row of input.dateSheet) {
    if (row.academicYearCode !== input.academicYearCode) continue;
    const t = term.get(row.examTermId);
    const s = subject.get(row.subjectId);
    const c = cls.get(row.classId);
    const date = ymd(row.date);
    if (!t || t.isActive === false || !s || !c || !isYmd(date)) continue;
    if (date < input.today) continue; // over, or Propel would refuse it
    const key = propelClassKey(c.name);
    if (!key) {
      skipped.push({ what: `${t.label} ${s.name} · ${c.name}`, why: "Propel has no such class" });
      continue;
    }
    const classId = PROPEL_CLASS_IDS[key];
    const subjectId = propelSubjectFor(s.name, classId, input.propelSubjects);
    const description = propelDescription(subjectId ? `${t.label} ${s.name}` : `${t.label} ${s.name}`);
    const payload: PropelEventPayload = subjectId
      ? {
          description,
          startDate: date,
          endDate: date,
          eventType: "22",
          selectedClasses: [],
          eventCustomId: propelExamType(t),
          subjectId,
          unit: "",
          is_active: true,
        }
      : {
          description,
          startDate: date,
          endDate: date,
          eventType: "4",
          selectedClasses: [],
          eventCustomId: null,
          subjectId: null,
          unit: "",
          is_active: true,
        };
    const gk = [payload.eventType, payload.subjectId ?? description.toLowerCase(), payload.eventCustomId ?? "", date].join("|");
    const g = groups.get(gk) ?? { payload, classes: new Set<number>() };
    g.classes.add(classId);
    groups.set(gk, g);
  }

  const create: PropelEventPayload[] = [];
  let already = 0;
  let asAcademicEvent = 0;
  for (const { payload, classes } of groups.values()) {
    payload.selectedClasses = [...classes].sort((a, b) => a - b).map(String);
    const typeName = payload.eventType === "22" ? "offline assessment" : "academic event";
    const exists = input.existing.some(
      (e) =>
        e.is_active !== false &&
        String(e.eventType || "").toLowerCase() === typeName &&
        sameDay(e.startDate, payload.startDate) &&
        (payload.subjectId ? e.subjectId === payload.subjectId : descKey(e.description) === descKey(payload.description)) &&
        (e.selectedClasses ?? []).some((x) => classes.has(x)),
    );
    if (exists) {
      already++;
      continue;
    }
    if (payload.eventType === "4") asAcademicEvent++;
    create.push(payload);
  }
  create.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.description.localeCompare(b.description));
  return { create, already, skipped, asAcademicEvent };
}

// ─── Teachers ──────────────────────────────────────────────────────────

/** A Propel staff account (GET …/school/getteachers → data.schoolUsers). */
export type PropelTeacher = {
  school_user_id?: number;
  first_name?: string;
  last_name?: string;
  mobile?: string;
  role_id?: number;
  school_user_status?: boolean;
};

export type PropelTeacherPayload = {
  first_name: string;
  last_name: string;
  mobile: string;
  email_id: string;
  role_id: number;
  role_code: string;
  whatsapp_notification: "true";
  allow_assessment_creation: "FULL_ACCESS" | "VIEW_ONLY";
  content_permission: "GENERAL_ACCESS";
};

type ErpStaff = {
  id: string;
  fullName: string;
  stream: string;
  designationId: string | null;
  mobile: string;
  email: string;
  status: string;
};

const ROLE = {
  principal: { role_id: 57, role_code: "SCH21" },
  teacher: { role_id: 58, role_code: "SCH41" },
  coordinator: { role_id: 60, role_code: "SCH31" },
} as const;

const mobile10 = (m: string) => {
  const d = String(m || "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(d) ? d : "";
};

/**
 * Teachers to create on Propel: active ERP teaching staff whose mobile — the
 * Propel login — no Propel account has. The role follows the designation
 * (principal / co-ordinator, else teacher). Staff without a valid mobile
 * cannot log in to Propel, so they are listed, not sent. Propel accounts the
 * ERP does not know are only reported: the robot never deactivates anyone.
 */
export function buildPropelTeacherPlan(input: {
  staff: ErpStaff[];
  designationName: (id: string | null) => string;
  existing: PropelTeacher[];
}): { create: (PropelTeacherPayload & { erpName: string })[]; already: number; skipped: PlanLine[]; onlyOnPropel: string[] } {
  const propelMobiles = new Set(input.existing.map((t) => mobile10(t.mobile || "")).filter(Boolean));
  const create: (PropelTeacherPayload & { erpName: string })[] = [];
  const skipped: PlanLine[] = [];
  let already = 0;
  const erpMobiles = new Set<string>();
  for (const s of input.staff) {
    if (s.status !== "active" || s.stream !== "teaching") continue;
    const m = mobile10(s.mobile);
    if (!m) {
      skipped.push({ what: s.fullName, why: "no valid 10-digit mobile in the ERP — it is the Propel login" });
      continue;
    }
    erpMobiles.add(m);
    if (propelMobiles.has(m)) {
      already++;
      continue;
    }
    const designation = input.designationName(s.designationId).toLowerCase();
    const role = /principal|director|head/.test(designation)
      ? ROLE.principal
      : /co-?ordinator|coordinator/.test(designation)
        ? ROLE.coordinator
        : ROLE.teacher;
    const parts = s.fullName.trim().replace(/\s+/g, " ").split(" ");
    const first = parts.shift() || s.fullName;
    create.push({
      erpName: s.fullName,
      first_name: first,
      last_name: parts.join(" ") || ".",
      mobile: m,
      email_id: /@/.test(s.email || "") ? s.email.trim() : "",
      ...role,
      whatsapp_notification: "true",
      allow_assessment_creation: role === ROLE.teacher ? "VIEW_ONLY" : "FULL_ACCESS",
      content_permission: "GENERAL_ACCESS",
    });
  }
  const onlyOnPropel = input.existing
    .filter((t) => t.school_user_status !== false && !erpMobiles.has(mobile10(t.mobile || "")))
    .map((t) => `${t.first_name || ""} ${t.last_name || ""}`.trim() || "(no name)");
  return { create, already, skipped, onlyOnPropel };
}

// ─── Students (Propel's upload sheet) ──────────────────────────────────

/** The sheet's columns A–W, in order (Propel template, 12 Oct 2026). */
export const PROPEL_STUDENT_COLUMNS = [
  "Student Admission Code",
  "Date of Admission",
  "First Name",
  "Middle Name",
  "Last Name",
  "Gender",
  "Class 2025-2026",
  "Class 2026-2027",
  "Division",
  "Address",
  "City/District",
  "State",
  "Pincode",
  "Father's Name",
  "Father's Phone Number",
  "Father's Email",
  "Mother's Name",
  "Mother's Phone Number",
  "Mother's Email",
  "Guardian's Name",
  "Guardian's Phone Number",
  "Guardian's Email",
  "Guardian's Relationship",
] as const;

type ErpStudent = {
  id: string;
  admissionNo: string;
  fullName: string;
  gender: string;
  status: string;
  classId: string;
  sectionId: string;
  joinedOn: string;
  academicYearCode: string;
  householdId: string;
  fatherName: string;
  motherName: string;
  fatherMobile: string;
  motherMobile: string;
  guardianRelation: string;
};
type ErpHousehold = { id: string; guardianName: string; mobile: string; email: string; address: string; city: string; state: string; pincode: string };
type ErpSection = { id: string; classId: string; name: string };

const dmy = (iso: string) => (isYmd(ymd(iso)) ? `${ymd(iso).slice(8, 10)}/${ymd(iso).slice(5, 7)}/${ymd(iso).slice(0, 4)}` : "");

/**
 * One row per active child in the current year, in Propel's columns. A child
 * the sheet cannot carry (no admission number, a class Propel lacks, no
 * parent with a valid mobile) is left out and listed. Previous-year class is
 * left blank — Propel asks for it only for children it already knew.
 */
export function buildPropelStudentRows(input: {
  students: ErpStudent[];
  households: ErpHousehold[];
  classes: ErpClass[];
  sections: ErpSection[];
  academicYearCode: string;
}): { rows: string[][]; skipped: PlanLine[] } {
  const hh = new Map(input.households.map((h) => [h.id, h]));
  const cls = new Map(input.classes.map((c) => [c.id, c]));
  const sec = new Map(input.sections.map((s) => [s.id, s]));
  const rows: string[][] = [];
  const skipped: PlanLine[] = [];
  const seen = new Set<string>();
  const sorted = [...input.students].sort((a, b) => a.fullName.localeCompare(b.fullName));
  for (const s of sorted) {
    if (s.status !== "active" || s.academicYearCode !== input.academicYearCode) continue;
    const name = s.fullName.trim().replace(/\s+/g, " ");
    const code = String(s.admissionNo || "").trim();
    if (!code) {
      skipped.push({ what: name, why: "no admission number — Propel's student code" });
      continue;
    }
    if (seen.has(code)) {
      skipped.push({ what: name, why: `admission number ${code} is used twice in the ERP` });
      continue;
    }
    const key = propelClassKey(cls.get(s.classId)?.name || "");
    if (!key) {
      skipped.push({ what: name, why: `class ${cls.get(s.classId)?.name || "?"} does not exist on Propel` });
      continue;
    }
    const division = String(sec.get(s.sectionId)?.name || "A").trim().toUpperCase();
    if (!/^[A-Z]$/.test(division)) {
      skipped.push({ what: name, why: `section "${division}" is not a single letter A–Z` });
      continue;
    }
    const h = hh.get(s.householdId);
    const fatherMobile = mobile10(s.fatherMobile);
    const motherMobile = mobile10(s.motherMobile);
    const guardianMobile = mobile10(h?.mobile || "");
    const hasFather = !!(s.fatherName.trim() && fatherMobile);
    const hasMother = !!(s.motherName.trim() && motherMobile);
    const guardianName = (h?.guardianName || "").trim();
    const useGuardian = !hasFather && !hasMother && !!(guardianName && guardianMobile);
    if (!hasFather && !hasMother && !useGuardian) {
      skipped.push({ what: name, why: "no parent or guardian with both a name and a valid mobile" });
      continue;
    }
    seen.add(code);
    const parts = name.split(" ");
    const first = parts.shift() || name;
    const last = parts.length ? parts.pop()! : ".";
    const pin = /^\d{6}$/.test(String(h?.pincode || "").trim()) ? String(h?.pincode).trim() : "";
    rows.push([
      code,
      dmy(s.joinedOn),
      first,
      parts.join(" "),
      last,
      s.gender === "M" ? "Male" : s.gender === "F" ? "Female" : s.gender === "O" ? "Other" : "",
      "",
      SHEET_CLASS[key],
      division,
      (h?.address || "").trim(),
      (h?.city || "").trim(),
      (h?.state || "").trim(),
      pin,
      hasFather ? s.fatherName.trim() : "",
      hasFather ? fatherMobile : "",
      "",
      hasMother ? s.motherName.trim() : "",
      hasMother ? motherMobile : "",
      "",
      useGuardian ? guardianName : "",
      useGuardian ? guardianMobile : "",
      useGuardian && /@/.test(h?.email || "") ? (h?.email || "").trim() : "",
      useGuardian ? (s.guardianRelation || "Guardian").trim() : "",
    ]);
  }
  return { rows, skipped };
}

// ─── Tests & chapters (Propel → ERP) ──────────────────────────────────

/** A Propel question paper (GET …/assessments/recommended → assessmentsList). */
export type PropelAssessment = {
  asmId: number;
  className: string;
  divisionName?: string;
  subjectName: string;
  asmName: string;
  assessmentState?: string;
  finalisedDate?: string | null;
  isMarksEntryStarted?: boolean;
  associatedUnits?: { readableShellAcronym?: string; shellTitle?: string }[];
};

export type PropelTestRecord = {
  asmId: number;
  className: string;
  division: string;
  subject: string;
  name: string;
  state: string;
  finalisedOn: string;
  chapters: string[];
};

/** What the ERP keeps of a Propel paper — no student data (Propel has none). */
export function normalizePropelTests(list: unknown): PropelTestRecord[] {
  if (!Array.isArray(list)) return [];
  const out: PropelTestRecord[] = [];
  for (const raw of list.slice(0, 2000)) {
    const a = raw as PropelAssessment;
    if (!a || typeof a.asmId !== "number") continue;
    out.push({
      asmId: a.asmId,
      className: String(a.className || "").slice(0, 40),
      division: String(a.divisionName || "").slice(0, 4),
      subject: String(a.subjectName || "").slice(0, 80),
      name: String(a.asmName || "").slice(0, 120),
      state: String(a.assessmentState || "").slice(0, 30),
      finalisedOn: ymd(String(a.finalisedDate || "")),
      chapters: (a.associatedUnits ?? [])
        .map((u) => String(u?.shellTitle || "").trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 40),
    });
  }
  return out;
}

const chapterKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Chapters Propel's tests name that the ERP's loaded book for that class and
 * subject does not have — a new or renamed chapter to check (the AI tutor and
 * lesson plans follow the ERP's list). Grouped by class and subject.
 */
export function propelChapterGaps(
  tests: PropelTestRecord[],
  erpChapters: (className: string, subject: string) => string[] | null,
): { className: string; subject: string; missing: string[] }[] {
  const byBook = new Map<string, { className: string; subject: string; names: Set<string> }>();
  for (const t of tests) {
    const k = `${t.className}|${t.subject}`;
    const g = byBook.get(k) ?? { className: t.className, subject: t.subject, names: new Set<string>() };
    for (const c of t.chapters) g.names.add(c);
    byBook.set(k, g);
  }
  const out: { className: string; subject: string; missing: string[] }[] = [];
  for (const g of byBook.values()) {
    const erp = erpChapters(g.className, g.subject);
    if (!erp) continue; // no ERP book for it: nothing to compare against
    const have = new Set(erp.map(chapterKey));
    const missing = [...g.names].filter((n) => !have.has(chapterKey(n)));
    if (missing.length) out.push({ className: g.className, subject: g.subject, missing });
  }
  return out.sort((a, b) => a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject));
}

// ─── Teacher progress (Propel → ERP) ──────────────────────────────────

/** One row of Propel's Teacher Timeliness (…/teacherPerformance/completion). */
export type PropelCompletionRow = {
  teacherId?: number;
  schoolUserId?: number;
  teacherName?: string;
  className?: string;
  divName?: string;
  subjectName?: string;
  total_days?: number;
  required_day_plans_completed?: number;
  current_day_plans_completed?: number;
  progress?: number;
  current_unitno?: number;
  required_unitno?: number;
  dailyDate?: string | null;
};

export type PropelProgressRecord = {
  key: string;
  teacher: string;
  /** ERP staff id when the Propel account's mobile matches an ERP teacher. */
  staffId: string;
  className: string;
  division: string;
  subject: string;
  totalPlans: number;
  requiredPlans: number;
  donePlans: number;
  /** Day plans ahead (+) or behind (−) of Propel's schedule. */
  gap: number;
  unit: number;
  requiredUnit: number;
  lastPlanOn: string;
};

/**
 * Propel's per-teacher, per-class, per-subject course progress, matched to
 * ERP staff by the Propel account's mobile (its login). Sorted furthest
 * behind first. A row with no numbers is dropped, never read as zero.
 */
export function normalizePropelProgress(
  rows: unknown,
  propelTeachers: PropelTeacher[],
  staff: { id: string; mobile: string; status: string }[],
): PropelProgressRecord[] {
  if (!Array.isArray(rows)) return [];
  const mobileByUser = new Map<number, string>();
  for (const t of propelTeachers) if (typeof t.school_user_id === "number") mobileByUser.set(t.school_user_id, mobile10(t.mobile || ""));
  const staffByMobile = new Map<string, string>();
  for (const s of staff) {
    const m = mobile10(s.mobile);
    if (m && s.status === "active") staffByMobile.set(m, s.id);
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out: PropelProgressRecord[] = [];
  for (const raw of rows.slice(0, 1000)) {
    const r = raw as PropelCompletionRow;
    const total = num(r.total_days);
    const required = num(r.required_day_plans_completed);
    const done = num(r.current_day_plans_completed);
    if (!r || total === null || required === null || done === null) continue;
    const user = num(r.schoolUserId) ?? num(r.teacherId);
    const mobile = user !== null ? mobileByUser.get(user) || "" : "";
    const className = String(r.className || "").slice(0, 30);
    const division = String(r.divName || "").slice(0, 4);
    const subject = String(r.subjectName || "").slice(0, 80);
    out.push({
      key: `${className}|${division}|${subject}`,
      teacher: String(r.teacherName || "").trim().slice(0, 80),
      staffId: (mobile && staffByMobile.get(mobile)) || "",
      className,
      division,
      subject,
      totalPlans: total,
      requiredPlans: required,
      donePlans: done,
      gap: num(r.progress) ?? done - required,
      unit: num(r.current_unitno) ?? 0,
      requiredUnit: num(r.required_unitno) ?? 0,
      lastPlanOn: ymd(String(r.dailyDate || "")),
    });
  }
  return out.sort((a, b) => a.gap - b.gap || a.className.localeCompare(b.className));
}

export type PropelProgressSnapshot = { on: string; done: Record<string, number> };

/** Keep one snapshot per day (latest wins), the most recent 60, oldest first. */
export function addProgressSnapshot(
  history: PropelProgressSnapshot[],
  on: string,
  records: PropelProgressRecord[],
): PropelProgressSnapshot[] {
  const done = Object.fromEntries(records.map((r) => [r.key, r.donePlans]));
  const kept = (Array.isArray(history) ? history : []).filter((h) => h && h.on !== on);
  return [...kept, { on, done }].sort((a, b) => a.on.localeCompare(b.on)).slice(-60);
}

// ─── Pre-primary full book check (Propel → ERP) ───────────────────────

/** One class × subject of Propel's unit list (…/reports/unit/master). */
export type PropelUnitMaster = {
  classId?: number;
  subjectId?: number;
  unit?: { shellLabelCode?: string; shellTitle?: string }[];
};

export type PropelBook = { className: string; subject: string; units: string[] };

const PRE_PRIMARY_NAMES: Record<number, string> = { 1: "Nursery", 154: "LKG", 155: "UKG" };

/**
 * Propel's complete pre-primary books — Nursery, LKG, UKG — from its unit
 * list: units (UN) and themes (TH), without the assessment entries the list
 * mixes in. For Classes 1–8 that list holds only assessment groupings
 * (FA 1–4, MOY, EOY), never chapters, so it is not read for them. Subject
 * names come from Propel's own subject list.
 */
export function propelPrePrimaryBooks(master: unknown, subjects: { id: number; name: string }[]): PropelBook[] {
  if (!Array.isArray(master)) return [];
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const out: PropelBook[] = [];
  for (const raw of master.slice(0, 500)) {
    const m = raw as PropelUnitMaster;
    const className = PRE_PRIMARY_NAMES[m?.classId ?? -1];
    if (!className) continue;
    const units = (m.unit ?? [])
      .filter((u) => u && (u.shellLabelCode === "UN" || u.shellLabelCode === "TH"))
      .map((u) => String(u.shellTitle || "").trim())
      .filter((t) => t && !/assessment/i.test(t))
      .map((t) => t.slice(0, 160));
    const subject = subjectName.get(m.subjectId ?? -1) || "";
    if (!units.length || !subject) continue;
    out.push({ className, subject: subject.slice(0, 80), units: units.slice(0, 200) });
  }
  return out.sort((a, b) => a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject));
}

export type BookCheck = {
  className: string;
  subject: string;
  propelUnits: number;
  erpChapters: number;
  /** false when the ERP has no book loaded for this class and subject. */
  erpHasBook: boolean;
  /**
   * Propel lists this book chapter by chapter, as the ERP does (most of its
   * unit names are ERP chapter names) — so the two are compared both ways.
   * Otherwise Propel groups lessons into units (Letters A to D) and a name
   * comparison would call everything different; only counts are shown.
   */
  sameStructure: boolean;
  /** Same structure only: on Propel, not in the ERP's book. */
  missingInErp: string[];
  /** Same structure only: in the ERP's book, not on Propel. */
  notOnPropel: string[];
  /** What Propel changed in this book since the last check; null on the first. */
  changedOnPropel: { added: string[]; removed: string[] } | null;
};

/**
 * The pre-primary books Propel lists in full, against the ERP's loaded books
 * and against Propel's own list from the last check. A book the ERP has not
 * loaded is reported as such, never as "everything missing".
 */
export function propelFullBookCheck(
  books: PropelBook[],
  erpChapters: (className: string, subject: string) => string[] | null,
  previous: PropelBook[] | null,
): BookCheck[] {
  const before = new Map((previous ?? []).map((b) => [`${b.className}|${b.subject}`, b.units]));
  return books.map((b) => {
    const prev = before.get(`${b.className}|${b.subject}`);
    const changedOnPropel = prev
      ? {
          added: b.units.filter((u) => !prev.some((p) => chapterKey(p) === chapterKey(u))),
          removed: prev.filter((p) => !b.units.some((u) => chapterKey(u) === chapterKey(p))),
        }
      : null;
    const erp = erpChapters(b.className, b.subject) ?? [];
    const erpKeys = new Set(erp.map(chapterKey));
    const propelKeys = new Set(b.units.map(chapterKey));
    const matched = b.units.filter((u) => erpKeys.has(chapterKey(u))).length;
    const sameStructure = erp.length > 0 && matched * 2 >= b.units.length;
    return {
      className: b.className,
      subject: b.subject,
      propelUnits: b.units.length,
      erpChapters: erp.length,
      erpHasBook: erp.length > 0,
      sameStructure,
      missingInErp: sameStructure ? b.units.filter((u) => !erpKeys.has(chapterKey(u))) : [],
      notOnPropel: sameStructure ? erp.filter((c) => !propelKeys.has(chapterKey(c))) : [],
      changedOnPropel,
    };
  });
}
