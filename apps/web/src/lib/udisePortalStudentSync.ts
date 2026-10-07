/**
 * UDISE+ → ERP, child by child: what the portal knows that the ERP is
 * missing, and where the two disagree.
 *
 * Director, 7 Oct 2026: the robot must also FETCH — "data to ERP for existing
 * students which is not present in school ERP or wrong". The robot reads each
 * child's full portal record (General Profile /p1/api/cy/students/<id>,
 * Facility /p1/api/v2/students/facility/<id>, and the Enrolment Profile off
 * the open form) and the ERP keeps that copy (lib/udisePortalStudents.server).
 * This file compares the copy with the child's ERP record.
 *
 * Nothing here writes. Every difference is a suggestion the office ticks:
 *  - bring_into_erp — the ERP is blank and the portal has it (ticked by default);
 *  - differs        — both have a value and they disagree (never pre-ticked:
 *                     either side may be the wrong one);
 *  - check          — shown for the office to look at, never written by the
 *                     robot (mobiles, admission no., roll no., admission date).
 * Unknown must not become fact: a portal blank, "NA" or "Under Investigation"
 * is never a value.
 */

import { BLOOD_GROUPS, isRealPortalId, type Household, type SisStudent } from "@/lib/sis";
import { minorityCode } from "@/lib/udisePortalFill";
import { sameChildEvidence } from "@/lib/udisePortalReconcile";
import { udiseDobIso } from "@/lib/udiseStudentDetails";

// ─── What leaves the portal tab ─────────────────────────────────────────

/** General Profile fields kept — no Aadhaar number (uuid), ever. */
export const PORTAL_GP_FIELDS = [
  "studentId", "studentCodeNat", "studentName", "gender", "dob", "fatherName", "motherName",
  "guardianName", "address", "pincode", "primaryMobile", "secondaryMobile", "email", "socCatId",
  "minorityId", "isBplYN", "aayBplYN", "ewsYN", "cwsnYN", "natIndYN", "ooscYN", "motherTongue",
  "motherTongueDesc", "bloodGroup", "admnNumber", "classId", "classDesc", "sectionDesc", "apaarId",
  "apaarIdStatusDesc", "uuidStatus", "uuidStatusDesc", "formStatus", "profileStatus", "statusDesc",
  "lastModifiedOn",
] as const;

/** Facility Profile fields kept. */
export const PORTAL_FP_FIELDS = [
  "heightInCm", "weightInKg", "distanceFrmSchool", "parentEducation", "facilityYn", "facProvided",
  "centralScholarshipYn", "stateScholarshipYn", "otherScholarshipYn", "scholarshipAmount",
  "facProvidedCwsnYn", "giftedChildrenYn", "mentorProvided", "olympdsNlc", "digitalCapableYn",
  "nccYn", "nssYn", "scoutsYn",
] as const;

/** Enrolment Profile, read off the open form (formcontrolnames). */
export const PORTAL_EP_FIELDS = [
  "admnNumber", "admnStartDate", "rollNumber", "mediumOfInstruction", "enrStatusPY", "classPY",
  "examResultPy", "examMarksPy", "attendancePy",
] as const;

export type PortalStudentCopy = {
  studentId: string;
  pen: string;
  gp: Record<string, unknown>;
  fp: Record<string, unknown>;
  ep?: Record<string, unknown>;
  fetchedAt: string;
  epAt?: string;
};

const keep = (rec: unknown, keys: readonly string[]): Record<string, unknown> => {
  const src = rec && typeof rec === "object" ? (rec as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in src && src[k] !== undefined) out[k] = src[k];
  return out;
};
export const pickGp = (r: unknown) => keep(r, PORTAL_GP_FIELDS);
export const pickFp = (r: unknown) => keep(r, PORTAL_FP_FIELDS);
export const pickEp = (r: unknown) => keep(r, PORTAL_EP_FIELDS);

// ─── Normalising both sides ─────────────────────────────────────────────

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const name = (v: unknown) => s(v).toUpperCase().replace(/[^A-Z\s.]/g, " ").replace(/\s+/g, " ").trim();
const digits = (v: unknown) => s(v).replace(/\D/g, "");

const GENDER: Record<string, SisStudent["gender"]> = { "1": "M", "2": "F", "3": "O" };
const GENDER_LABEL: Record<string, string> = { M: "Male", F: "Female", O: "Transgender / other" };
const CATEGORY: Record<string, string> = { "1": "GEN", "2": "SC", "3": "ST", "4": "OBC" };
const MINORITY_RELIGION: Record<string, string> = {
  "1": "MUSLIM",
  "2": "CHRISTIAN",
  "3": "SIKH",
  "4": "BUDDHIST",
  "5": "PARSI",
  "6": "JAIN",
};
const BLOOD_BY_CODE: Record<string, string> = { "1": "A+", "2": "A-", "3": "B+", "4": "B-", "5": "O+", "6": "O-", "7": "AB+", "8": "AB-" };

/** "B(+)" (the old import's style), "b +ve" → "B+"; "" when not a blood group. */
function bloodKey(raw: string): string {
  const t = (raw || "").toUpperCase().replace(/[\s()]/g, "").replace(/(POSITIVE|POS|\+VE)$/, "+").replace(/(NEGATIVE|NEG|-VE)$/, "-");
  return t && (BLOOD_GROUPS as readonly string[]).includes(t) ? t : "";
}

function number(v: unknown, max: number): string {
  const n = Number(s(v));
  return Number.isFinite(n) && n > 0 && n <= max ? String(Math.round(n * 10) / 10) : "";
}

function mobile10(v: unknown): string {
  const d = digits(v);
  const m = d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
  return /^[6-9]\d{9}$/.test(m) && !/^(\d)\1{9}$/.test(m) ? m : "";
}

// ─── The comparison ─────────────────────────────────────────────────────

export type SyncField =
  | "fullName" | "gender" | "dob" | "fatherName" | "motherName" | "category" | "religion"
  | "motherTongue" | "bloodGroup" | "isCwsn" | "apaarId" | "pen" | "heightCm" | "weightKg"
  | "address" | "pincode" | "mobile" | "admissionNo" | "rollNo" | "admissionDate";

export type SyncAction = "bring_into_erp" | "differs" | "check";

export type FieldDiff = {
  field: SyncField;
  label: string;
  erp: string;
  /** What the office sees. */
  portal: string;
  /** What would be written to the ERP (never set for "check"). */
  value?: string | boolean;
  action: SyncAction;
};

/** Where an appliable field is written. */
export const FIELD_TARGET: Partial<Record<SyncField, { kind: "column" | "profile" | "household"; key: string }>> = {
  fullName: { kind: "column", key: "full_name" },
  gender: { kind: "column", key: "gender" },
  dob: { kind: "column", key: "dob" },
  fatherName: { kind: "column", key: "father_name" },
  motherName: { kind: "column", key: "mother_name" },
  category: { kind: "column", key: "category" },
  religion: { kind: "column", key: "religion" },
  motherTongue: { kind: "column", key: "mother_tongue" },
  bloodGroup: { kind: "column", key: "blood_group" },
  apaarId: { kind: "column", key: "apaar_id" },
  pen: { kind: "column", key: "pen" },
  isCwsn: { kind: "profile", key: "isCwsn" },
  heightCm: { kind: "profile", key: "heightCm" },
  weightKg: { kind: "profile", key: "weightKg" },
  address: { kind: "household", key: "address" },
  pincode: { kind: "household", key: "pincode" },
};

/** The SisStudent / Household property each target key mirrors in memory. */
export const LOCAL_KEY: Partial<Record<SyncField, string>> = {
  fullName: "fullName", gender: "gender", dob: "dob", fatherName: "fatherName", motherName: "motherName",
  category: "category", religion: "religion", motherTongue: "motherTongue", bloodGroup: "bloodGroup",
  apaarId: "apaarId", pen: "pen", isCwsn: "isCwsn", heightCm: "heightCm", weightKg: "weightKg",
  address: "address", pincode: "pincode",
};

function dmy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Every difference between the portal's copy of a child and the ERP record.
 * `hh` is the child's household (address, pincode, mobiles).
 */
export function diffStudent(copy: PortalStudentCopy, st: SisStudent, hh?: Household): FieldDiff[] {
  const out: FieldDiff[] = [];
  const gp = copy.gp;
  const fp = copy.fp;
  const ep = copy.ep || {};

  /** Text field: blank ERP → bring; both set and different → differs. */
  const text = (field: SyncField, label: string, erpRaw: string, portalRaw: string, norm: (v: string) => string, show?: (v: string) => string) => {
    const e = norm(erpRaw);
    const p = norm(portalRaw);
    if (!p || e === p) return;
    const shown = show ? show(p) : p;
    if (!e) out.push({ field, label, erp: "", portal: shown, value: p, action: "bring_into_erp" });
    else out.push({ field, label, erp: show ? show(e) : erpRaw.trim(), portal: shown, value: p, action: "differs" });
  };

  text("fullName", "Name", st.fullName, s(gp.studentName), name);
  const g = GENDER[s(gp.gender)] || "";
  if (g && g !== st.gender) {
    out.push({
      field: "gender",
      label: "Gender",
      erp: st.gender ? GENDER_LABEL[st.gender] || st.gender : "",
      portal: GENDER_LABEL[g] || g,
      value: g,
      action: st.gender ? "differs" : "bring_into_erp",
    });
  }
  text("dob", "Date of birth", st.dob || "", s(gp.dob), (v) => udiseDobIso(v) || "", dmy);
  text("fatherName", "Father's name", st.fatherName, s(gp.fatherName), name);
  text("motherName", "Mother's name", st.motherName, s(gp.motherName), name);
  const cat = CATEGORY[s(gp.socCatId)] || "";
  if (cat && cat !== s(st.category).toUpperCase()) {
    // EWS is a category in the ERP and a separate yes/no on the portal: an
    // ERP "EWS" child is not "different" because the portal says GEN.
    if (!(st.category === "EWS" && cat === "GEN")) {
      out.push({ field: "category", label: "Social category", erp: st.category, portal: cat, value: cat, action: st.category ? "differs" : "bring_into_erp" });
    }
  }
  // Religion: the portal records only the minority group. 7 = "not a
  // minority", which names no religion — it can contradict the ERP, never fill it.
  const pm = s(gp.minorityId);
  const em = minorityCode(st.religion || "");
  if (MINORITY_RELIGION[pm] && em !== pm) {
    out.push({ field: "religion", label: "Religion (minority group)", erp: st.religion, portal: MINORITY_RELIGION[pm]!, value: MINORITY_RELIGION[pm]!, action: st.religion ? "differs" : "bring_into_erp" });
  } else if (pm === "7" && em && em !== "7") {
    out.push({ field: "religion", label: "Religion (minority group)", erp: st.religion, portal: "Not a minority", action: "check" });
  }
  text("motherTongue", "Mother tongue", st.motherTongue, s(gp.motherTongueDesc).replace(/^\d+\s*-\s*/, ""), (v) => v.trim().toUpperCase());
  const bg = BLOOD_BY_CODE[s(gp.bloodGroup)] || "";
  const ebg = bloodKey(st.bloodGroup || "");
  if (bg && bg !== ebg) {
    out.push({ field: "bloodGroup", label: "Blood group", erp: st.bloodGroup, portal: bg, value: bg, action: ebg ? "differs" : "bring_into_erp" });
  }
  // CWSN: the portal's Yes is a fact; its No is not proof against an ERP tick.
  if (s(gp.cwsnYN) === "1" && !st.isCwsn) {
    out.push({ field: "isCwsn", label: "CWSN", erp: "not marked", portal: "Yes", value: true, action: "bring_into_erp" });
  }
  const apaar = digits(gp.apaarId);
  if (/^\d{12}$/.test(apaar) && digits(st.apaarId) !== apaar) {
    out.push({ field: "apaarId", label: "APAAR ID", erp: st.apaarId || "", portal: apaar, value: apaar, action: isRealPortalId(st.apaarId) ? "differs" : "bring_into_erp" });
  }
  const pen = digits(gp.studentCodeNat);
  if (pen.length >= 8 && digits(st.pen) !== pen) {
    out.push({ field: "pen", label: "PEN", erp: st.pen || "", portal: pen, value: pen, action: isRealPortalId(st.pen) ? "differs" : "bring_into_erp" });
  }
  const h = number(fp.heightInCm, 220);
  if (h && number(st.heightCm, 220) !== h) {
    out.push({ field: "heightCm", label: "Height (cm)", erp: st.heightCm, portal: h, value: h, action: number(st.heightCm, 220) ? "differs" : "bring_into_erp" });
  }
  const w = number(fp.weightInKg, 150);
  if (w && number(st.weightKg, 150) !== w) {
    out.push({ field: "weightKg", label: "Weight (kg)", erp: st.weightKg, portal: w, value: w, action: number(st.weightKg, 150) ? "differs" : "bring_into_erp" });
  }
  if (hh) {
    const addr = s(gp.address).replace(/\s+/g, " ");
    if (addr && !s(hh.address)) out.push({ field: "address", label: "Address", erp: "", portal: addr, value: addr.slice(0, 250), action: "bring_into_erp" });
    const pin = digits(gp.pincode);
    if (pin.length === 6 && digits(hh.pincode) !== pin) {
      out.push({ field: "pincode", label: "Pincode", erp: hh.pincode || "", portal: pin, value: pin, action: digits(hh.pincode).length === 6 ? "differs" : "bring_into_erp" });
    }
    // Mobiles are shown, never written: which ERP number (father, mother,
    // WhatsApp) the portal's one stands for is the office's call.
    const known = new Set([st.fatherMobile, st.motherMobile, hh.mobile, hh.whatsappMobile, hh.altMobile].map(mobile10).filter(Boolean));
    const pmob = mobile10(gp.primaryMobile);
    if (pmob && !known.has(pmob)) out.push({ field: "mobile", label: "Mobile on the portal", erp: [...known].join(", "), portal: pmob, action: "check" });
  }
  const adm = s(ep.admnNumber || gp.admnNumber);
  if (adm && st.admissionNo && adm.toUpperCase() !== st.admissionNo.toUpperCase()) {
    out.push({ field: "admissionNo", label: "Admission no.", erp: st.admissionNo, portal: adm, action: "check" });
  }
  const roll = digits(ep.rollNumber);
  if (roll && digits(st.rollNo) !== roll) out.push({ field: "rollNo", label: "Roll no.", erp: st.rollNo, portal: roll, action: "check" });
  const ad = udiseDobIso(s(ep.admnStartDate));
  if (ad) out.push({ field: "admissionDate", label: "Admission date on the portal", erp: st.joinedOn ? dmy(st.joinedOn) : "", portal: dmy(ad), action: "check" });
  return out;
}

/**
 * Is `value` what the CURRENT comparison proposes for `field`? The apply
 * route re-runs the comparison and writes only what it would propose now —
 * a stale screen cannot write a value the portal no longer holds.
 */
export function proposedValue(diffs: FieldDiff[], field: SyncField): FieldDiff | null {
  const d = diffs.find((x) => x.field === field);
  return d && d.action !== "check" && d.value !== undefined && FIELD_TARGET[field] ? d : null;
}

// ─── Which portal copy is which ERP child ───────────────────────────────

export type CopyMatch = { copy: PortalStudentCopy; by: "pen" | "evidence"; why: string };

/**
 * Pair each ERP child (this session's, one row each) with its portal copy:
 * by PEN first; an ERP child with no PEN by the same evidence the reconcile
 * uses (birth date + a parent or the family phone) — and only when exactly
 * one portal child fits, since twins share all of that.
 */
export function matchCopies(
  copies: PortalStudentCopy[],
  students: SisStudent[],
  householdMobiles: (s: SisStudent) => string[] = () => [],
): { matched: Map<string, CopyMatch>; unmatched: PortalStudentCopy[] } {
  const matched = new Map<string, CopyMatch>();
  const used = new Set<PortalStudentCopy>();
  const byPen = new Map(copies.filter((c) => isRealPortalId(c.pen)).map((c) => [digits(c.pen), c]));
  for (const st of students) {
    const c = isRealPortalId(st.pen) ? byPen.get(digits(st.pen)) : undefined;
    if (c) {
      matched.set(st.id, { copy: c, by: "pen", why: "same PEN" });
      used.add(c);
    }
  }
  const free = copies.filter((c) => !used.has(c));
  for (const st of students) {
    if (matched.has(st.id) || isRealPortalId(st.pen)) continue;
    const fits = free
      .map((c) => ({ c, why: sameChildEvidence(c.gp, st, householdMobiles) }))
      .filter((x) => x.why);
    if (fits.length === 1 && !used.has(fits[0]!.c)) {
      matched.set(st.id, { copy: fits[0]!.c, by: "evidence", why: fits[0]!.why });
      used.add(fits[0]!.c);
    }
  }
  return { matched, unmatched: copies.filter((c) => !used.has(c)) };
}
