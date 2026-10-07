/**
 * UDISE+ Teacher module → ERP Staff: what the portal knows that the ERP does
 * not, and where the two disagree — for the office to review and apply.
 *
 * Director, 7 Oct 2026: two-way UDISE+ ↔ ERP sync, teachers part. The robot
 * reads every teacher on the portal (teaching AND non-teaching lists, then
 * each one's General Profile / Appointment / Training forms) on a click and
 * sends a whitelisted copy here (module_local_state "udise_portal_teachers").
 * This file lines that copy up with ERP Staff, field by field:
 *
 *   bring_into_erp — the ERP is blank and the portal has it (ticked by default)
 *   differs        — both have it and they disagree (unticked by default)
 *
 * Nothing reaches sis_staff until a person ticks it and presses Apply
 * (POST /api/v1/udise/robot/teacher-details/apply), and the server re-runs
 * this comparison against the fresh row first, so a stale screen cannot
 * write a value nobody saw.
 *
 * Unknown must not become fact: a portal code is turned into an ERP value only
 * where the meaning is one-to-one (gender, social category, a contract
 * appointment, a designation that is the only one of its portal post).
 * "Regular" could be Confirmed or Probation, "Assistant teacher" could be
 * TGT or PRT, classes taught live in the ERP as class/subject links — those
 * are SHOWN, with no tick box, for a person to change by hand.
 *
 * Aadhaar never enters the snapshot: referenceKey / aadhaar / empNamePerUid
 * are not in the whitelist (and the portal masks them anyway).
 */

import type { MastersState } from "@/lib/masters";
import type { StaffCasteCategory, StaffGender, StaffRecord } from "@/lib/foundationMasters";
import {
  academicLevelCode,
  classesTaughtCode,
  matchPortalTeacher,
  pickPortalTeacher,
  portalCode,
  portalDate,
  professionalQualCode,
  subjectCode,
  teacherTypeCode,
  teachingGroups,
  type PortalTeacher,
} from "@/lib/udiseTeacherFill";

export const UDISE_PORTAL_TEACHERS_KEY = "udise_portal_teachers";

// ─── The snapshot the robot sends ────────────────────────────────────────

/**
 * The form answers that may leave the portal tab, by form. Keys are the
 * forms' own formcontrolnames (read off the live forms 6–7 Oct 2026); the
 * form1/2/3 JSON is assumed to use the same names — a form whose answer
 * carries none of them is reported as "read, but no known fields", never
 * as "blank". No Aadhaar (referenceKey / aadhaar), no name-as-per-Aadhaar.
 */
export const PORTAL_FORM_FIELDS = {
  gp: [
    "empName", "gender", "dob", "empCodeState", "socialCat", "qualAcad", "trade",
    "mathUpto", "scienceUpto", "englishUpto", "socStudyUpto", "langStudyUpto",
    "qualProf", "mobile", "email", "disabilityType",
  ],
  at: [
    "natureOfAppt", "dojService", "dojPs", "tchType", "docPh", "classTaught",
    "appointedLevel", "apptSub", "subTaught1", "subTaught2",
  ],
  td: ["trainedCwsn", "trainedComp", "trgNishtha", "isCtetStet", "nontchDays", "trngRcvd", "trngNeeded"],
} as const;

export type PortalFormKey = keyof typeof PORTAL_FORM_FIELDS;

export type PortalTeacherSnapshotRow = {
  staffType: "teaching" | "non_teaching";
  list: PortalTeacher;
  /** null = the form was not read (request failed); {} = read, nothing known in it. */
  gp: Record<string, string> | null;
  at: Record<string, string> | null;
  td: Record<string, string> | null;
};

export type PortalTeacherSnapshot = {
  fetchedAt: string;
  fetchedBy: string;
  /** Which portal lists came back. A list not read says nothing about who is missing. */
  listsRead: { teaching: boolean; non_teaching: boolean };
  teachers: PortalTeacherSnapshotRow[];
};

/** A form answer value as a plain string: codes stay codes; objects give their id. */
function scalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["id", "code", "value"]) if (o[k] !== undefined && typeof o[k] !== "object") return scalar(o[k]);
  }
  return "";
}

/** Only whitelisted keys, as strings; anything else is dropped. */
export function pickPortalForm(form: PortalFormKey, raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of PORTAL_FORM_FIELDS[form]) {
    if (!(k in src)) continue;
    const v = scalar(src[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** Server copy of the whitelist: a drifted extension can only ever send less. */
export function normalizePortalTeacherSnapshot(raw: unknown, fetchedBy: string, fetchedAt: string): PortalTeacherSnapshot {
  const rows = Array.isArray((raw as { teachers?: unknown })?.teachers) ? ((raw as { teachers: unknown[] }).teachers) : [];
  const teachers: PortalTeacherSnapshotRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (!o.list || typeof o.list !== "object") continue;
    const list = pickPortalTeacher(o.list as Record<string, unknown>);
    if (!String(list.staffName || "").trim() && !String(list.nationalCode || "").trim()) continue;
    teachers.push({
      staffType: o.staffType === "non_teaching" ? "non_teaching" : "teaching",
      list,
      gp: pickPortalForm("gp", o.gp),
      at: pickPortalForm("at", o.at),
      td: pickPortalForm("td", o.td),
    });
  }
  const lr = (raw as { listsRead?: Record<string, unknown> })?.listsRead || {};
  return { fetchedAt, fetchedBy, listsRead: { teaching: lr.teaching === true, non_teaching: lr.non_teaching === true }, teachers };
}

// ─── Portal codes → the ERP's own values ─────────────────────────────────

const GENDER_FROM_PORTAL: Record<string, Exclude<StaffGender, "">> = { "1": "M", "2": "F", "3": "O" };
const SOCIAL_FROM_PORTAL: Record<string, Exclude<StaffCasteCategory, "" | "OTHER">> = { "1": "GENERAL", "2": "SC", "3": "ST", "4": "OBC" };

/** Labels the portal printed on its option lists (6 Oct 2026). */
const ACAD_LABEL: Record<string, string> = {
  "1": "Below Secondary", "2": "Secondary", "3": "Higher Secondary", "4": "Graduate",
  "5": "Post Graduate", "6": "M.Phil.", "7": "Ph.D.", "8": "Post-Doctoral",
};
const PROF_LABEL: Record<string, string> = {
  "1": "D.El.Ed / BTC (2 years or more)", "3": "B.Ed", "4": "M.Ed", "5": "Others", "6": "None",
  "10": "D.El.Ed", "11": "NTT / ECCE", "12": "B.Ed (Nursery)", "13": "B.P.Ed", "14": "M.P.Ed",
};
const APPT_LABEL: Record<string, string> = { "1": "Regular", "2": "Contract", "3": "Guest / part-time" };
const POST_LABEL: Record<string, string> = {
  "1": "Head teacher", "2": "Acting head teacher", "3": "Assistant teacher", "6": "Principal", "7": "Vice principal", "8": "Lecturer",
};
const CLASSES_LABEL: Record<string, string> = {
  "1": "Primary only", "2": "Upper primary only", "3": "Primary & upper primary", "10": "Pre-primary only", "11": "Pre-primary & primary",
};
const SUBJECT_LABEL: Record<string, string> = {
  "1": "All subjects", "3": "Mathematics", "4": "EVS", "6": "Music", "7": "Science", "8": "Social Studies",
  "18": "Geography", "19": "History", "41": "Hindi", "43": "Sanskrit", "45": "Urdu", "46": "English",
  "91": "Art Education", "92": "Health & Physical Education", "93": "Work Education",
};

/** A code from a form answer ("5", 5) or a list label ("5-Post Graduate"). */
export function codeOf(v: string | undefined | null): string {
  const s = String(v ?? "").trim();
  if (/^-?\d+$/.test(s)) return s;
  return portalCode(s);
}

/** The text of a "5-Post Graduate" label, else the known label for the code. */
function labelOf(table: Record<string, string>, code: string, listLabel?: string): string {
  const m = String(listLabel ?? "").match(/^\s*-?\d+\s*-\s*(.+)$/);
  if (m && codeOf(listLabel) === code) return m[1]!.trim();
  return table[code] || "";
}

function genderCode(form: string | undefined, list: string | undefined): string {
  const c = codeOf(form) || codeOf(list);
  if (c) return c;
  const w = String(list ?? "").trim().toLowerCase();
  if (/^male\b/.test(w)) return "1";
  if (/^female\b/.test(w)) return "2";
  if (/^trans/.test(w)) return "3";
  return "";
}

function socialCode(form: string | undefined, list: string | undefined): string {
  const c = codeOf(form) || codeOf(list);
  if (c) return c;
  const w = String(list ?? "").trim().toUpperCase();
  if (/^GEN/.test(w)) return "1";
  if (w === "SC") return "2";
  if (w === "ST") return "3";
  if (w === "OBC") return "4";
  return "";
}

/** DD/MM/YYYY (or ISO) → the ERP's YYYY-MM-DD; "" when not a date. */
export function isoDate(v: string | undefined | null): string {
  const p = portalDate(String(v ?? ""));
  const m = p.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const [, d, mo, y] = m;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d) || dt.getUTCMonth() + 1 !== Number(mo)) return "";
  return `${y}-${mo}-${d}`;
}

const nameKey = (s: string) => (s || "").toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
const tidy = (s: string) => (s || "").replace(/\s+/g, " ").trim();

function mobile10(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  const m = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(m) ? m : "";
}
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** ERP free-text subjects → portal codes; null when any word is not a subject. */
function erpSubjectCodes(text: string): Set<string> | null {
  const parts = (text || "").split(/[,/&;+]|\band\b/i).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out = new Set<string>();
  for (const p of parts) {
    const c = subjectCode(p, p);
    if (!c) return null;
    out.add(c);
  }
  return out;
}

// ─── The comparison ──────────────────────────────────────────────────────

export type TeacherSyncField =
  | "name"
  | "gender"
  | "dob"
  | "socialCat"
  | "qualification"
  | "mobile"
  | "email"
  | "nationalCode"
  | "natureOfAppt"
  | "dojPs"
  | "post"
  | "classTaught"
  | "subjects";

/** The StaffRecord property each field writes, when it can be written at all. */
export const SYNC_FIELD_TO_STAFF: Partial<Record<TeacherSyncField, keyof StaffRecord>> = {
  name: "fullName",
  gender: "gender",
  dob: "dateOfBirth",
  socialCat: "casteCategory",
  qualification: "qualification",
  mobile: "mobile",
  email: "email",
  nationalCode: "oasisId",
  natureOfAppt: "jobType",
  dojPs: "joiningDate",
  post: "designationId",
  subjects: "subjectsTaught",
};

export type TeacherSyncItem = {
  field: TeacherSyncField;
  label: string;
  /** What the ERP holds, as shown. */
  erp: string;
  /** What the portal holds, as shown. */
  portal: string;
  action: "bring_into_erp" | "differs";
  /** The exact ERP value Apply would write; null = shown only, change it by hand. */
  apply: { value: string } | null;
  /** Why there is no tick box, or what Apply will do. */
  note?: string;
};

export type TeacherSyncRow = {
  /** Stable per portal teacher: the portal's own empStaffId. */
  portalKey: string;
  staffType: "teaching" | "non_teaching";
  nationalCode: string;
  portalName: string;
  match: "matched" | "unsure" | "none";
  matchedBy: "" | "national_code" | "name_dob";
  erpStaffId: string;
  erpName: string;
  /** sis_staff.updated_at at review time — Apply is conditional on it. */
  erpRevision: string;
  /** ERP staff it might be, when not settled. */
  candidates: string[];
  items: TeacherSyncItem[];
  /** Forms that could not be read, or were read with none of the known fields. */
  unread: string[];
};

export type TeacherSyncReview = {
  rows: TeacherSyncRow[];
  /** Active ERP staff no portal list names — only for lists that were read. */
  notOnPortal: { staffId: string; name: string; stream: string }[];
};

const LABELS: Record<TeacherSyncField, string> = {
  name: "Name",
  gender: "Gender",
  dob: "Date of birth",
  socialCat: "Social category",
  qualification: "Highest academic & professional qualification",
  mobile: "Mobile",
  email: "Email",
  nationalCode: "National Code (Staff → OASIS / UDISE id)",
  natureOfAppt: "Nature of appointment",
  dojPs: "Date of joining this school",
  post: "Post held (type of teacher)",
  classTaught: "Classes taught",
  subjects: "Subjects taught",
};

/** One teacher, portal against ERP. Pure; `others` = every other ERP staff member. */
export function compareTeacher(
  t: PortalTeacherSnapshotRow,
  s: StaffRecord,
  others: StaffRecord[],
  masters: MastersState,
  academicYearCode: string,
): TeacherSyncItem[] {
  const items: TeacherSyncItem[] = [];
  const gp = t.gp || {};
  const at = t.at || {};
  const L = t.list;
  const push = (field: TeacherSyncField, erp: string, portal: string, action: TeacherSyncItem["action"], value: string | null, note?: string) =>
    items.push({ field, label: LABELS[field], erp, portal, action, apply: value === null ? null : { value }, ...(note ? { note } : {}) });

  // Name — the portal's is UIDAI-verified; spelling only, never case.
  const pName = tidy(gp.empName || L.staffName || "");
  if (pName) {
    if (!tidy(s.fullName)) push("name", "", pName, "bring_into_erp", pName);
    else if (nameKey(pName) !== nameKey(s.fullName)) push("name", s.fullName, pName, "differs", pName);
  }

  const pG = genderCode(gp.gender, L.gender);
  if (pG) {
    const v = GENDER_FROM_PORTAL[pG];
    const shown = v ?? `portal code ${pG}`;
    if (!s.gender) push("gender", "", shown, "bring_into_erp", v ?? null, v ? undefined : "Not a value the ERP uses — set it by hand.");
    else if (v !== s.gender) push("gender", s.gender, shown, "differs", v ?? null, v ? undefined : "Not a value the ERP uses — set it by hand.");
  }

  const pDob = isoDate(gp.dob || L.dateOfBirth);
  if (pDob) {
    const eDob = isoDate(s.dateOfBirth);
    if (!s.dateOfBirth.trim()) push("dob", "", pDob, "bring_into_erp", pDob);
    else if (eDob !== pDob) push("dob", s.dateOfBirth, pDob, "differs", pDob);
  }

  const pS = socialCode(gp.socialCat, L.socialCategory);
  if (pS) {
    const v = SOCIAL_FROM_PORTAL[pS];
    const shown = v ?? (labelOf({}, pS, L.socialCategory) || `portal code ${pS}`);
    const note = v ? undefined : "No matching ERP category — set it by hand.";
    if (!s.casteCategory) push("socialCat", "", shown, "bring_into_erp", v ?? null, note);
    else if (v !== s.casteCategory) push("socialCat", s.casteCategory, shown, "differs", v ?? null, note);
  }

  // Qualification — one free-text field in the ERP, two codes on the portal.
  const pA = codeOf(gp.qualAcad) || codeOf(L.academicQualification);
  const pP = codeOf(gp.qualProf) || codeOf(L.professionalQualification);
  const aLabel = pA ? labelOf(ACAD_LABEL, pA, L.academicQualification) : "";
  const pLabel = pP ? labelOf(PROF_LABEL, pP, L.professionalQualification) : "";
  const portalQual = [aLabel, pLabel].filter(Boolean).join("; ");
  const knownParts = (!pA || aLabel) && (!pP || pLabel);
  if (pA || pP) {
    const shown = portalQual || [pA && `academic code ${pA}`, pP && `professional code ${pP}`].filter(Boolean).join(", ");
    const eText = tidy(s.qualification);
    if (!eText) {
      push("qualification", "", shown, "bring_into_erp", knownParts && portalQual ? portalQual : null, knownParts ? undefined : "The portal code has no known label — type it by hand.");
    } else {
      const eA = academicLevelCode(eText);
      const eP = professionalQualCode(eText);
      const acadDiffers = !!(pA && eA && pA !== eA);
      // "Others" / "None" on the portal cannot be checked against ERP wording.
      const profDiffers = !!(pP && eP && pP !== eP && pP !== "5" && pP !== "6");
      if (acadDiffers || profDiffers) {
        push("qualification", eText, shown, "differs", knownParts && portalQual ? portalQual : null,
          knownParts ? "Apply replaces the ERP wording with the portal's." : "The portal code has no known label — type it by hand.");
      } else if (pP && !eP && pLabel && pP !== "5" && pP !== "6") {
        // The ERP names a degree but no teacher training; the portal names one.
        push("qualification", eText, shown, "bring_into_erp", `${eText}; ${pLabel}`, `Apply adds "${pLabel}" to the ERP wording.`);
      }
    }
  }

  const pM = mobile10(gp.mobile || "");
  if (pM) {
    const eM = mobile10(s.mobile);
    const clash = others.find((o) => mobile10(o.mobile) === pM);
    // The mobile is what staff OTP login resolves on: one number, one person.
    const value = clash ? null : pM;
    const note = clash ? `That number is on ${clash.fullName}'s ERP record — sort it out by hand.` : undefined;
    if (!s.mobile.trim()) push("mobile", "", pM, "bring_into_erp", value, note);
    else if (eM !== pM) push("mobile", s.mobile, pM, "differs", value, note);
  }

  const pE = (gp.email || L.email || "").trim().toLowerCase();
  if (pE && emailOk(pE)) {
    if (!s.email.trim()) push("email", "", pE, "bring_into_erp", pE);
    else if (s.email.trim().toLowerCase() !== pE) push("email", s.email, pE, "differs", pE);
  }

  const pC = String(L.nationalCode || "").trim().toUpperCase();
  if (pC) {
    const holder = others.find((o) => (o.oasisId || "").trim().toUpperCase() === pC);
    const value = holder ? null : pC;
    const note = holder ? `That code is on ${holder.fullName}'s ERP record — sort it out by hand.` : undefined;
    if (!s.oasisId.trim()) push("nationalCode", "", pC, "bring_into_erp", value, note);
    else if (s.oasisId.trim().toUpperCase() !== pC) push("nationalCode", s.oasisId, pC, "differs", value, note);
  }

  // Nature of appointment — only "Contract" is one ERP value; "Regular" is
  // Confirmed OR Probation, and the ERP's Temporary is not on the portal scale.
  const pN = codeOf(at.natureOfAppt) || codeOf(L.natureOfAppointment);
  if (pN) {
    const shown = labelOf(APPT_LABEL, pN, L.natureOfAppointment) || `portal code ${pN}`;
    const eN = s.jobType === "confirmed" || s.jobType === "probation" ? "1" : s.jobType === "contract" ? "2" : "";
    const value = pN === "2" ? "contract" : null;
    const note = value ? undefined : pN === "1" ? "Regular is Confirmed or Probation in the ERP — choose on the staff record." : "No matching ERP job type — set it by hand.";
    if (!s.jobType) push("natureOfAppt", "", shown, "bring_into_erp", value, note);
    else if (eN && eN !== pN) push("natureOfAppt", s.jobType, shown, "differs", value, note);
  }

  const pJ = isoDate(at.dojPs || L.dateOfJoiningInPresentSchool);
  if (pJ) {
    if (!s.joiningDate.trim()) push("dojPs", "", pJ, "bring_into_erp", pJ);
    else if (isoDate(s.joiningDate) !== pJ) push("dojPs", s.joiningDate, pJ, "differs", pJ);
  }

  // Post — a designation id only when exactly one active designation is that post.
  const pT = codeOf(at.tchType) || codeOf(L.typeOfTeacher);
  if (pT) {
    const shown = labelOf(POST_LABEL, pT, L.typeOfTeacher) || `portal code ${pT}`;
    const desig = masters.designations.find((d) => d.id === s.designationId);
    const eT = desig ? teacherTypeCode(desig.name) : "";
    const fits = masters.designations.filter((d) => d.isActive !== false && teacherTypeCode(d.name) === pT);
    const value = fits.length === 1 ? fits[0]!.id : null;
    const note = value
      ? `Apply sets the designation to "${fits[0]!.name}".`
      : fits.length > 1
        ? `More than one ERP designation is this post (${fits.map((d) => d.name).join(", ")}) — choose on the staff record.`
        : "No ERP designation is this post — set it by hand.";
    if (!s.designationId) push("post", "", shown, "bring_into_erp", value, note);
    else if (eT && eT !== pT) push("post", desig?.name || "", shown, "differs", value, note);
  }

  // Classes taught — the ERP keeps them as this year's class/subject links.
  const pK = codeOf(at.classTaught) || codeOf(L.classTaught);
  if (pK) {
    const shown = labelOf(CLASSES_LABEL, pK, L.classTaught) || `portal code ${pK}`;
    const eK = classesTaughtCode(teachingGroups(masters, s, academicYearCode));
    const linked = s.classTeacherLinks.length + s.subjectTeachingLinks.length > 0;
    const note = "The ERP keeps this as class & subject links — change them in Staff.";
    if (!linked) push("classTaught", "", shown, "bring_into_erp", null, note);
    else if (eK && eK !== pK) push("classTaught", CLASSES_LABEL[eK] || eK, shown, "differs", null, note);
  }

  // Subjects — the ERP's free text, read word by word.
  const pSubs = [at.subTaught1, at.subTaught2].map(codeOf).filter(Boolean);
  if (!pSubs.length) {
    const c = codeOf(L.mainSubject1);
    if (c) pSubs.push(c);
  }
  if (pSubs.length) {
    const labels = pSubs.map((c, i) => (i === 0 && !at.subTaught1 ? labelOf(SUBJECT_LABEL, c, L.mainSubject1) : SUBJECT_LABEL[c] || ""));
    const allKnown = labels.every(Boolean);
    const shown = pSubs.map((c, i) => labels[i] || `code ${c}`).join(", ");
    const eText = tidy(s.subjectsTaught);
    if (!eText) {
      push("subjects", "", shown, "bring_into_erp", allKnown ? labels.join(", ") : null, allKnown ? undefined : "A portal subject code has no known label — type it by hand.");
    } else {
      const eCodes = erpSubjectCodes(eText);
      if (eCodes) {
        const missing = pSubs.filter((c) => !eCodes.has(c) && c !== "1");
        if (missing.length) {
          const add = missing.map((c) => labels[pSubs.indexOf(c)]);
          const ok = add.every(Boolean);
          push("subjects", eText, shown, "differs", ok ? `${eText}, ${add.join(", ")}` : null,
            ok ? `Apply adds ${add.join(", ")} to the ERP list.` : "A portal subject code has no known label — type it by hand.");
        }
      }
    }
  }

  return items;
}

/**
 * Every portal teacher against ERP Staff. Matching is the teacher board's
 * own (National Code, else name AND date of birth) over ACTIVE staff, so the
 * robot and this review never disagree about who is who.
 */
export function buildTeacherSyncReview(
  snapshot: PortalTeacherSnapshot,
  staff: StaffRecord[],
  masters: MastersState,
  academicYearCode: string,
  revisions: Record<string, string> = {},
): TeacherSyncReview {
  const active = staff.filter((s) => s.status === "active");
  const seen = new Set<string>();
  const rows: TeacherSyncRow[] = snapshot.teachers.map((t) => {
    const gp = t.gp || {};
    const probe: PortalTeacher = {
      ...t.list,
      staffName: t.list.staffName || gp.empName || "",
      dateOfBirth: t.list.dateOfBirth || gp.dob || "",
    };
    const unread: string[] = [];
    for (const f of ["gp", "at", "td"] as const) {
      const name = { gp: "General Profile", at: "Appointment", td: "Training" }[f];
      if (t[f] === null) unread.push(`${name}: not read`);
      else if (!Object.keys(t[f]!).length) unread.push(`${name}: read, no known fields`);
    }
    const base = {
      portalKey: String(t.list.empStaffId ?? ""),
      staffType: t.staffType,
      nationalCode: String(t.list.nationalCode || ""),
      portalName: probe.staffName,
      unread,
    };
    const m = matchPortalTeacher(active, probe);
    if (m.kind !== "matched") {
      return {
        ...base,
        match: m.kind,
        matchedBy: "" as const,
        erpStaffId: "",
        erpName: "",
        erpRevision: "",
        candidates: m.kind === "unsure" ? m.candidates.map((c) => c.fullName) : [],
        items: [],
      };
    }
    seen.add(m.staff.id);
    const others = staff.filter((o) => o.id !== m.staff.id);
    return {
      ...base,
      match: "matched" as const,
      matchedBy: m.by,
      erpStaffId: m.staff.id,
      erpName: m.staff.fullName,
      erpRevision: revisions[m.staff.id] || "",
      candidates: [],
      items: compareTeacher(t, m.staff, others, masters, academicYearCode),
    };
  });
  const notOnPortal = active
    .filter((s) => snapshot.listsRead[s.stream] && !seen.has(s.id))
    .map((s) => ({ staffId: s.id, name: s.fullName, stream: s.stream }));
  return { rows, notOnPortal };
}

/** A tick from the review screen: the field and the exact value it showed. */
export type TeacherSyncTick = { staffId: string; field: TeacherSyncField; value: string };

/**
 * The ticked changes for ONE staff member, checked against a fresh review.
 * A tick whose item is gone or whose value changed since the screen was
 * drawn is refused (stale), never re-aimed at the new value.
 */
export function planStaffPatch(
  row: TeacherSyncRow,
  ticks: TeacherSyncTick[],
): { patch: Partial<Record<keyof StaffRecord, string>>; applied: TeacherSyncItem[]; stale: TeacherSyncTick[] } {
  const patch: Partial<Record<keyof StaffRecord, string>> = {};
  const applied: TeacherSyncItem[] = [];
  const stale: TeacherSyncTick[] = [];
  for (const t of ticks) {
    const item = row.items.find((i) => i.field === t.field);
    const key = SYNC_FIELD_TO_STAFF[t.field];
    if (!item || !item.apply || !key || item.apply.value !== t.value) {
      stale.push(t);
      continue;
    }
    patch[key] = item.apply.value;
    applied.push(item);
  }
  return { patch, applied, stale };
}

/** Review defaults: missing in the ERP ticked; disagreements left for a person. */
export function defaultTicked(item: TeacherSyncItem): boolean {
  return !!item.apply && item.action === "bring_into_erp";
}
