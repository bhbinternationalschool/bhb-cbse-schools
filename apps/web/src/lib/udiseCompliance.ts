/**
 * UDISE+ compliance tracking — gaps (Aadhaar / PEN / APAAR / parent Aadhaar),
 * school reminder settings, WhatsApp parent nudges + Aadhaar enrolment guidance.
 */

import {
  displayAadhaar,
  hasStoredAadhaar,
  householdOf,
  householdWhatsApp,
  isValidMobile,
  loadSis,
  normalizeMobile,
  normalizeStudent,
  saveSis,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { loadMasters, type MastersState } from "@/lib/masters";
import { assertModulePermission } from "@/lib/rbacGuard";
import { TENANT } from "@/lib/types";

const SETTINGS_KEY = "bhb_udise_compliance_v1";

function ayValue(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

/**
 * Active students, one record per child (latest session), optionally scoped
 * to a single academic year. Prevents repeated names across sessions.
 */
function activeStudentsForUdise(
  students: SisStudent[],
  academicYearCode?: string,
): SisStudent[] {
  const scope = academicYearCode ? ayValue(academicYearCode) : "";
  const byChild = new Map<string, SisStudent>();
  for (const s of students) {
    if (s.status !== "active") continue;
    if (scope && ayValue(s.academicYearCode) !== scope) continue;
    const key = s.admissionNo.trim().toUpperCase() || s.id;
    const prev = byChild.get(key);
    if (!prev || ayValue(s.academicYearCode) > ayValue(prev.academicYearCode)) {
      byChild.set(key, s);
    }
  }
  return [...byChild.values()];
}

export type UdiseComplianceSettings = {
  /** Days between parent WhatsApp reminders for missing docs */
  reminderIntervalDays: number;
  /** Area hint for “nearest Aadhaar centre” maps search */
  schoolAreaHint: string;
  /** Extra line appended to WhatsApp (optional) */
  customNote: string;
  /** Require at least one parent Aadhaar for APAAR readiness */
  parentAadhaarRequiredForApaar: boolean;
};

export type UdiseGapCode =
  | "student_aadhaar"
  | "pen"
  | "apaar"
  | "parent_aadhaar"
  | "student_aadhaar_unverified"
  | "mbu_age_below_class"
  | "inbound_transfer";

export type UdiseCallContact = {
  label: string;
  mobile: string;
  /** tel:+91XXXXXXXXXX */
  telHref: string;
};

export type UdiseComplianceRow = {
  student: SisStudent;
  household: Household | null;
  classLabel: string;
  missing: UdiseGapCode[];
  missingLabels: string[];
  priority: number;
  dueForReminder: boolean;
  lastReminded: string;
  whatsappMobile: string;
  /** Best number for office calling (father → mother → guardian → WhatsApp) */
  primaryCallMobile: string;
  primaryCallTelHref: string;
  callContacts: UdiseCallContact[];
  aadhaarDisplay: string;
  fatherAadhaarDisplay: string;
  motherAadhaarDisplay: string;
  nearestCenterMapsUrl: string;
};

/** Indian mobile → tel:+91… for direct dial from phone / softphone. */
export function telHrefForMobile(mobile: string): string {
  const d = normalizeMobile(mobile);
  if (!isValidMobile(d)) return "";
  return `tel:+91${d}`;
}

export function buildUdiseCallContacts(
  student: SisStudent,
  hh: Household | null,
): UdiseCallContact[] {
  const seen = new Set<string>();
  const out: UdiseCallContact[] = [];
  const push = (label: string, raw: string) => {
    const mobile = normalizeMobile(raw);
    if (!isValidMobile(mobile) || seen.has(mobile)) return;
    seen.add(mobile);
    out.push({ label, mobile, telHref: telHrefForMobile(mobile) });
  };
  push("Father", student.fatherMobile);
  push("Mother", student.motherMobile);
  push("Guardian", hh?.mobile || "");
  push("WhatsApp", hh?.whatsappMobile || householdWhatsApp(hh));
  push("Alt", hh?.altMobile || "");
  push("Emergency", student.emergencyMobile);
  return out;
}

function defaultSettings(): UdiseComplianceSettings {
  return {
    reminderIntervalDays: 7,
    schoolAreaHint: "Harhua, Varanasi, Uttar Pradesh",
    customNote: "",
    parentAadhaarRequiredForApaar: true,
  };
}

export function loadUdiseComplianceSettings(): UdiseComplianceSettings {
  if (typeof window === "undefined") return defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const p = JSON.parse(raw) as Partial<UdiseComplianceSettings>;
    return {
      ...defaultSettings(),
      ...p,
      reminderIntervalDays: Math.max(
        1,
        Math.min(90, Number(p.reminderIntervalDays) || 7),
      ),
    };
  } catch {
    return defaultSettings();
  }
}

export function saveUdiseComplianceSettings(
  patch: Partial<UdiseComplianceSettings>,
): UdiseComplianceSettings {
  if (!assertModulePermission("compliance", "edit", "saveUdiseComplianceSettings")) {
    return loadUdiseComplianceSettings();
  }
  const next = { ...loadUdiseComplianceSettings(), ...patch };
  next.reminderIntervalDays = Math.max(
    1,
    Math.min(90, Number(next.reminderIntervalDays) || 7),
  );
  if (typeof window !== "undefined") {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("udise_compliance", { settings: next }));
  }
  return next;
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeUdiseComplianceSettingsLocalRaw(state: { settings: UdiseComplianceSettings }): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
}

export function gapLabel(code: UdiseGapCode): string {
  switch (code) {
    case "student_aadhaar":
      return "Student Aadhaar missing";
    case "pen":
      return "PEN missing";
    case "apaar":
      return "APAAR ID missing";
    case "parent_aadhaar":
      return "Parent Aadhaar missing (needed for APAAR)";
    case "student_aadhaar_unverified":
      return "Student Aadhaar not verified on UDISE+";
    case "mbu_age_below_class":
      return "MBU Pending — age below for class (govt)";
    case "inbound_transfer":
      return "UDISE+ Drop Box / previous-school release pending";
    default:
      return code;
  }
}

function hasPen(s: SisStudent): boolean {
  const pen = (s.pen || "").trim();
  if (!pen || /^na$/i.test(pen) || /^\*+$/.test(pen)) return false;
  // "0" / "000" is a common import placeholder — not a real PEN.
  if (/^0+$/.test(pen)) return false;
  return true;
}

/** True when student has a UDISE+ Student PEN (registered on portal / SDMS). */
export function isRegisteredOnUdise(s: SisStudent): boolean {
  return hasPen(s);
}

/** Aadhaar last 4 (from stored last4 or full number) — for UDISE+ portal search. */
export function udiseAadhaarLast4(s: SisStudent): string {
  const l4 = (s.aadhaarLast4 || "").replace(/\D/g, "").slice(-4);
  if (l4.length === 4) return l4;
  const full = (s.aadhaarNumber || "").replace(/\D/g, "");
  return full.length >= 4 ? full.slice(-4) : "";
}

/** DOB as DD/MM/YYYY for the UDISE+ Global Student Search field. */
export function udisePortalDob(dob: string): string {
  const raw = (dob || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const d = dmy[1]!.padStart(2, "0");
    const mo = dmy[2]!.padStart(2, "0");
    return `${d}/${mo}/${dmy[3]}`;
  }
  return raw;
}

export type UdisePortalSearchRow = {
  student: SisStudent;
  classLabel: string;
  pen: string;
  aadhaarLast4: string;
  dob: string;
  onPortal: boolean;
};

/**
 * Rows formatted for the UDISE+ Global Student Search module — PEN,
 * Name + Aadhaar (last 4), or Name + DOB + Father + Mother.
 * `scope` picks which students to prepare for lookup.
 */
export function listUdisePortalSearchRows(
  sis?: SisState,
  masters?: MastersState,
  academicYearCode?: string,
  scope: "not_on_portal" | "all" = "not_on_portal",
): UdisePortalSearchRow[] {
  const state = sis ?? loadSis();
  const m = masters ?? loadMasters();
  const rows: UdisePortalSearchRow[] = [];
  for (const student of activeStudentsForUdise(state.students, academicYearCode)) {
    const onPortal = isRegisteredOnUdise(student);
    if (scope === "not_on_portal" && onPortal) continue;
    const cls = m.classes.find((c) => c.id === student.classId)?.name || "—";
    const sec = m.sections.find((s) => s.id === student.sectionId)?.name || "";
    rows.push({
      student,
      classLabel: sec ? `${cls}-${sec}` : cls,
      pen: student.pen || "",
      aadhaarLast4: udiseAadhaarLast4(student),
      dob: udisePortalDob(student.dob),
      onPortal,
    });
  }
  return rows.sort((a, b) => {
    const c = a.classLabel.localeCompare(b.classLabel);
    if (c !== 0) return c;
    return a.student.fullName.localeCompare(b.student.fullName);
  });
}

/**
 * Short label for the student's UDISE+ portal entry / registration status,
 * derived from PEN presence + `penStatus`.
 */
export function udiseEntryStatusLabel(s: SisStudent): string {
  if (hasPen(s)) {
    if (s.aadhaarVerification === "verified_udise" && (s.apaarId || "").trim()) {
      return "Entered · verified";
    }
    return "Entered (PEN present)";
  }
  switch (s.penStatus) {
    case "to_register":
      return "To register (fresh UDISE)";
    case "pending_portal":
      return "Pending on portal";
    case "linked":
      return "Linked — PEN awaited";
    default:
      return "Not entered";
  }
}

export type UdiseUnregisteredRow = {
  student: SisStudent;
  household: Household | null;
  classLabel: string;
  reason: string;
  primaryCallMobile: string;
  primaryCallTelHref: string;
  callContacts: UdiseCallContact[];
  whatsappMobile: string;
};

/**
 * Active SIS students not yet registered on UDISE+ (no Student PEN).
 * Separate from the compliance gaps worklist.
 */
export function listUdiseUnregisteredStudents(
  sis?: SisState,
  masters?: MastersState,
  academicYearCode?: string,
): UdiseUnregisteredRow[] {
  const state = sis ?? loadSis();
  const m = masters ?? loadMasters();
  const rows: UdiseUnregisteredRow[] = [];

  for (const student of activeStudentsForUdise(state.students, academicYearCode)) {
    if (isRegisteredOnUdise(student)) continue;
    const hh = householdOf(state, student.householdId) ?? null;
    const cls =
      m.classes.find((c) => c.id === student.classId)?.name || "—";
    const sec =
      m.sections.find((s) => s.id === student.sectionId)?.name || "";
    const callContacts = buildUdiseCallContacts(student, hh);
    const primary = callContacts[0];
    const statusHint =
      student.penStatus === "to_register"
        ? "Marked to register (fresh UDISE)"
        : student.penStatus === "pending_portal"
          ? "Pending on portal"
          : "No Student PEN in SIS";
    rows.push({
      student,
      household: hh,
      classLabel: sec ? `${cls}-${sec}` : cls,
      reason: statusHint,
      primaryCallMobile: primary?.mobile ?? "",
      primaryCallTelHref: primary?.telHref ?? "",
      callContacts,
      whatsappMobile: householdWhatsApp(hh),
    });
  }

  return rows.sort((a, b) => {
    const c = a.classLabel.localeCompare(b.classLabel);
    if (c !== 0) return c;
    return a.student.fullName.localeCompare(b.student.fullName);
  });
}

export function udiseUnregisteredSummary(rows: UdiseUnregisteredRow[]) {
  return {
    total: rows.length,
    withCallNumber: rows.filter((r) => r.primaryCallMobile).length,
    noCallNumber: rows.filter((r) => !r.primaryCallMobile).length,
  };
}

export type UdiseRegisteredRow = {
  student: SisStudent;
  household: Household | null;
  classLabel: string;
  pen: string;
  apaarId: string;
  aadhaarDisplay: string;
  aadhaarVerified: boolean;
  compliant: boolean;
};

/** Active SIS students already registered on UDISE+ (have a Student PEN). */
export function listUdiseRegisteredStudents(
  sis?: SisState,
  masters?: MastersState,
  academicYearCode?: string,
  settings?: UdiseComplianceSettings,
): UdiseRegisteredRow[] {
  const state = sis ?? loadSis();
  const m = masters ?? loadMasters();
  const cfg = settings ?? loadUdiseComplianceSettings();
  const rows: UdiseRegisteredRow[] = [];

  for (const student of activeStudentsForUdise(state.students, academicYearCode)) {
    if (!isRegisteredOnUdise(student)) continue;
    const hh = householdOf(state, student.householdId) ?? null;
    const cls = m.classes.find((c) => c.id === student.classId)?.name || "—";
    const sec = m.sections.find((s) => s.id === student.sectionId)?.name || "";
    rows.push({
      student,
      household: hh,
      classLabel: sec ? `${cls}-${sec}` : cls,
      pen: student.pen || "",
      apaarId: student.apaarId || "",
      aadhaarDisplay: displayAadhaar({
        number: student.aadhaarNumber,
        last4: student.aadhaarLast4,
        verification: student.aadhaarVerification,
      }),
      aadhaarVerified: student.aadhaarVerification === "verified_udise",
      compliant: isUdiseFullyCompliant(student, cfg),
    });
  }

  return rows.sort((a, b) => {
    const c = a.classLabel.localeCompare(b.classLabel);
    if (c !== 0) return c;
    return a.student.fullName.localeCompare(b.student.fullName);
  });
}

export function udiseRegisteredSummary(rows: UdiseRegisteredRow[]) {
  return {
    total: rows.length,
    verified: rows.filter((r) => r.aadhaarVerified).length,
    withApaar: rows.filter((r) => r.apaarId).length,
    compliant: rows.filter((r) => r.compliant).length,
  };
}

function hasApaar(s: SisStudent): boolean {
  const a = (s.apaarId || "").trim();
  if (!a) return false;
  if (/^na$/i.test(a)) return false;
  if (/^\*+$/.test(a)) return false;
  return true;
}

/** Fully compliant — drop from open UDISE+ worklist. */
export function isUdiseFullyCompliant(
  s: SisStudent,
  settings?: UdiseComplianceSettings,
): boolean {
  const cfg = settings ?? loadUdiseComplianceSettings();
  if (s.aadhaarVerification !== "verified_udise") return false;
  if (!hasPen(s)) return false;
  if (!hasApaar(s)) return false;
  if (cfg.parentAadhaarRequiredForApaar && !hasParentAadhaar(s)) return false;
  if (s.udiseInboundTransferPending) return false;
  return true;
}

function hasParentAadhaar(s: SisStudent): boolean {
  return (
    hasStoredAadhaar({
      number: s.fatherAadhaarNumber,
      last4: s.fatherAadhaarLast4,
    }) ||
    hasStoredAadhaar({
      number: s.motherAadhaarNumber,
      last4: s.motherAadhaarLast4,
    })
  );
}

export function computeStudentUdiseGaps(
  s: SisStudent,
  settings?: UdiseComplianceSettings,
): UdiseGapCode[] {
  const cfg = settings ?? loadUdiseComplianceSettings();
  const gaps: UdiseGapCode[] = [];
  if (
    !hasStoredAadhaar({ number: s.aadhaarNumber, last4: s.aadhaarLast4 }) &&
    s.aadhaarVerification !== "verified_udise"
  ) {
    gaps.push("student_aadhaar");
  } else if (
    s.aadhaarVerification !== "verified_udise" &&
    hasStoredAadhaar({ number: s.aadhaarNumber, last4: s.aadhaarLast4 })
  ) {
    gaps.push("student_aadhaar_unverified");
  }
  if (!hasPen(s)) gaps.push("pen");
  if (!hasApaar(s)) gaps.push("apaar");
  if (cfg.parentAadhaarRequiredForApaar && !hasParentAadhaar(s)) {
    gaps.push("parent_aadhaar");
  }
  if (s.udiseAgeBelowClassAlert) {
    gaps.push("mbu_age_below_class");
  }
  if (s.udiseInboundTransferPending) {
    gaps.push("inbound_transfer");
  }
  return gaps;
}

function priorityOf(gaps: UdiseGapCode[]): number {
  let p = 0;
  if (gaps.includes("student_aadhaar")) p += 100;
  if (gaps.includes("mbu_age_below_class")) p += 95;
  if (gaps.includes("inbound_transfer")) p += 92;
  if (gaps.includes("pen")) p += 90;
  if (gaps.includes("apaar")) p += 70;
  if (gaps.includes("parent_aadhaar")) p += 60;
  if (gaps.includes("student_aadhaar_unverified")) p += 40;
  return p;
}

function daysSince(iso: string): number {
  if (!iso) return 9999;
  const t = Date.parse(iso.slice(0, 10));
  if (!Number.isFinite(t)) return 9999;
  return Math.floor((Date.now() - t) / 86400000);
}

export function aadhaarEnrolmentMapsUrl(areaHint: string): string {
  const q = encodeURIComponent(
    `UIDAI Aadhaar enrolment center near ${areaHint || "me"}`,
  );
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function householdAreaHint(
  hh: Household | null,
  schoolHint: string,
): string {
  if (!hh) return schoolHint;
  const parts = [hh.locality, hh.landmark, hh.city, hh.pincode, hh.state]
    .map((x) => (x || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : schoolHint;
}

/** Static guidance for parents (Hindi + English) — used in WhatsApp. */
export function aadhaarEnrolmentGuidelines(areaHint: string): string {
  const maps = aadhaarEnrolmentMapsUrl(areaHint);
  return [
    "How to get a child’s Aadhaar (UIDAI):",
    "1) Visit nearest Aadhaar Enrolment / Update Centre with child.",
    "2) Carry: parent Aadhaar, child’s birth proof (birth certificate/hospital record), address proof if asked.",
    "3) Child below 5 years: biometric of parent linked; 5–15 years: child’s biometrics updated.",
    "4) Keep enrolment slip; Aadhaar letter comes later — share number + copy with school.",
    "5) Online locator: https://appointments.uidai.gov.in (Find Enrolment Centre)",
    "",
    `Nearest centres near you: ${maps}`,
    "",
    "बच्चे का आधार कैसे बनवाएँ:",
    "• नज़दीकी आधार नामांकन केंद्र जाएँ।",
    "• अभिभावक का आधार, जन्म प्रमाण पत्र साथ रखें।",
    "• स्लिप सुरक्षित रखें और स्कूल को आधार नंबर / कॉपी दें।",
  ].join("\n");
}

export function listUdiseComplianceRows(
  sis?: SisState,
  masters?: MastersState,
  settings?: UdiseComplianceSettings,
  academicYearCode?: string,
): UdiseComplianceRow[] {
  const state = sis ?? loadSis();
  const m = masters ?? loadMasters();
  const cfg = settings ?? loadUdiseComplianceSettings();
  const rows: UdiseComplianceRow[] = [];

  for (const student of activeStudentsForUdise(state.students, academicYearCode)) {
    if (isUdiseFullyCompliant(student, cfg)) continue;
    const missing = computeStudentUdiseGaps(student, cfg);
    if (!missing.length) continue;
    const hh = householdOf(state, student.householdId) ?? null;
    const area = householdAreaHint(hh, cfg.schoolAreaHint);
    const cls =
      m.classes.find((c) => c.id === student.classId)?.name || "—";
    const sec =
      m.sections.find((s) => s.id === student.sectionId)?.name || "";
    const lastReminded = student.udiseComplianceRemindedAt || "";
    const callContacts = buildUdiseCallContacts(student, hh);
    const primary = callContacts[0];
    rows.push({
      student,
      household: hh,
      classLabel: sec ? `${cls}-${sec}` : cls,
      missing,
      missingLabels: missing.map(gapLabel),
      priority: priorityOf(missing),
      dueForReminder:
        missing.includes("student_aadhaar") ||
        missing.includes("parent_aadhaar")
          ? daysSince(lastReminded) >= cfg.reminderIntervalDays
          : false,
      lastReminded,
      whatsappMobile: householdWhatsApp(hh),
      primaryCallMobile: primary?.mobile ?? "",
      primaryCallTelHref: primary?.telHref ?? "",
      callContacts,
      aadhaarDisplay: displayAadhaar({
        number: student.aadhaarNumber,
        last4: student.aadhaarLast4,
        verification: student.aadhaarVerification,
      }),
      fatherAadhaarDisplay: displayAadhaar({
        number: student.fatherAadhaarNumber,
        last4: student.fatherAadhaarLast4,
        verification: student.fatherAadhaarVerification,
      }),
      motherAadhaarDisplay: displayAadhaar({
        number: student.motherAadhaarNumber,
        last4: student.motherAadhaarLast4,
        verification: student.motherAadhaarVerification,
      }),
      nearestCenterMapsUrl: aadhaarEnrolmentMapsUrl(area),
    });
  }

  return rows.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.student.fullName.localeCompare(b.student.fullName);
  });
}

export function udiseComplianceSummary(rows: UdiseComplianceRow[]) {
  return {
    totalOpen: rows.length,
    missingAadhaar: rows.filter((r) =>
      r.missing.includes("student_aadhaar"),
    ).length,
    missingPen: rows.filter((r) => r.missing.includes("pen")).length,
    missingApaar: rows.filter((r) => r.missing.includes("apaar")).length,
    missingParentAadhaar: rows.filter((r) =>
      r.missing.includes("parent_aadhaar"),
    ).length,
    dueReminders: rows.filter((r) => r.dueForReminder).length,
    highPriority: rows.filter((r) => r.priority >= 90).length,
    withCallNumber: rows.filter((r) => r.primaryCallMobile).length,
    noCallNumber: rows.filter((r) => !r.primaryCallMobile).length,
  };
}

export function composeUdiseComplianceWhatsApp(input: {
  student: SisStudent;
  household: Household | null;
  missing: UdiseGapCode[];
  settings?: UdiseComplianceSettings;
}): string {
  const cfg = input.settings ?? loadUdiseComplianceSettings();
  const area = householdAreaHint(input.household, cfg.schoolAreaHint);
  const guardian =
    input.household?.guardianName ||
    input.student.fatherName ||
    "Parent";
  const lines: string[] = [
    `Namaste ${guardian},`,
    "",
    `School: ${TENANT.name}`,
    `Student: ${input.student.fullName} (${input.student.admissionNo || "—"})`,
    "",
    "UDISE+ compliance — kindly update the following on priority:",
  ];
  for (const g of input.missing) {
    lines.push(`• ${gapLabel(g)}`);
  }
  lines.push("");

  if (
    input.missing.includes("student_aadhaar") ||
    input.missing.includes("parent_aadhaar")
  ) {
    lines.push(
      "Without student Aadhaar (and a parent Aadhaar for APAAR), UDISE+ / APAAR cannot be completed.",
    );
    lines.push("");
    lines.push(aadhaarEnrolmentGuidelines(area));
    lines.push("");
  }

  if (input.missing.includes("pen") || input.missing.includes("apaar")) {
    lines.push(
      "Please share Aadhaar details with the school office so we can update PEN / APAAR on UDISE+.",
    );
    lines.push("");
  }

  if (input.missing.includes("inbound_transfer")) {
    lines.push(
      "Office note: student has a previous-school PEN — import from UDISE+ Drop Box or request release from previous school on the portal.",
    );
    lines.push("");
  }

  if (cfg.customNote.trim()) {
    lines.push(cfg.customNote.trim());
    lines.push("");
  }

  lines.push("Thank you.");
  lines.push(TENANT.name);
  return lines.join("\n");
}

export function markUdiseComplianceReminded(
  studentIds: string[],
): SisState {
  const sis = loadSis();
  const today = new Date().toISOString().slice(0, 10);
  const idSet = new Set(studentIds);
  const students = sis.students.map((s) =>
    idSet.has(s.id)
      ? normalizeStudent({ ...s, udiseComplianceRemindedAt: today })
      : s,
  );
  const next = { ...sis, students };
  saveSis(next);
  return next;
}

/** Official UIDAI appointment / locator links for UI. */
export const UIDAI_LINKS = {
  findCentre: "https://appointments.uidai.gov.in",
  myAadhaar: "https://myaadhaar.uidai.gov.in",
  downloads: "https://uidai.gov.in",
} as const;
