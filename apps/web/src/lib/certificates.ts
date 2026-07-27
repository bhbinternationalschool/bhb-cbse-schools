/**
 * Certificates — TC (CBSE Annexure-I), bonafide, character, fee clearance.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  amountInWordsPaise,
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  tenderModeLabel,
} from "@/lib/fees";
import { checkHold, holdCodeForCertificate } from "@/lib/holds";
import { DEFAULT_AY, loadMasters } from "@/lib/masters";
import {
  loadSis,
  saveSis,
  type SisStudent,
  type StudentCategory,
} from "@/lib/sis";

export type CertificateKind =
  | "tc"
  | "bonafide"
  | "character"
  | "fee_clearance"
  | "fees_paid";

export const CERTIFICATE_KINDS: {
  kind: CertificateKind;
  label: string;
  short: string;
}[] = [
  { kind: "tc", label: "Transfer certificate (TC)", short: "TC" },
  { kind: "bonafide", label: "Bonafide certificate", short: "Bonafide" },
  { kind: "character", label: "Character certificate", short: "Character" },
  {
    kind: "fee_clearance",
    label: "Fee clearance / no-dues",
    short: "Fee clearance",
  },
  {
    kind: "fees_paid",
    label: "Fees paid (reimbursement)",
    short: "Fees paid",
  },
];

/** Receipt lines frozen onto a fees-paid certificate for reimbursement. */
export type FeesPaidReceiptRow = {
  receiptNo: string;
  collectionDate: string;
  modes: string;
  amountPaise: number;
  lineSummary: string;
};

export type FeesPaidDetails = {
  periodFrom: string;
  periodTo: string;
  /** Employer / claim purpose shown on certificate */
  claimFor: string;
  includeSiblings: boolean;
  totalPaidPaise: number;
  academicPaise: number;
  transportPaise: number;
  storePaise: number;
  specialPaise: number;
  otherPaise: number;
  receipts: FeesPaidReceiptRow[];
};

/** CBSE Annexure-I style TC extras (snapshot at issue). */
export type TcDetails = {
  bookNo: string;
  nationality: string;
  category: string;
  /** Class at first admission */
  admissionClass: string;
  lastClassFigures: string;
  lastClassWords: string;
  annualExamResult: string;
  failedOnceTwice: string;
  subjectsStudied: string;
  qualifiedForPromotion: string;
  promotedToFigures: string;
  promotedToWords: string;
  duesPaidUpto: string;
  feeConcession: string;
  workingDays: string;
  daysPresent: string;
  nccScoutGuide: string;
  gamesActivities: string;
  applicationDate: string;
  checkedByName: string;
  checkedByDesignation: string;
};

export type CertificateIssue = {
  id: string;
  kind: CertificateKind;
  certNo: string;
  studentId: string;
  householdId: string;
  academicYearCode: string;
  studentName: string;
  admissionNo: string;
  fatherName: string;
  motherName: string;
  dob: string;
  gender: string;
  classLabel: string;
  rollNo: string;
  /** UDISE+ Permanent Education Number */
  pen: string;
  /** APAAR ID (Automated Permanent Academic Account Registry) */
  apaarId: string;
  admissionDate: string;
  leavingDate: string;
  reasonForLeaving: string;
  lastClassStudied: string;
  promotedTo: string;
  conduct: string;
  remarks: string;
  openBalancePaise: number;
  duesCleared: boolean;
  overrideDues: boolean;
  issuedOn: string;
  issuedBy: string;
  /** Resolved from Staff class-teacher mapping at issue time */
  classTeacherName: string;
  createdAt: string;
  voidedAt: string | null;
  inactivatedStudent: boolean;
  /** Full CBSE TC block — present for kind=tc */
  tc: TcDetails | null;
  /** Fees paid / reimbursement block — present for kind=fees_paid */
  feesPaid: FeesPaidDetails | null;
};

export type CertificatesState = {
  version: 1;
  issues: CertificateIssue[];
};

const STORAGE_KEY = "bhb_certificates_v1";

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function numberToWordsUnder1000(n: number): string {
  if (n < 0 || !Number.isFinite(n)) return "";
  if (n < 20) return ONES[n] || String(n);
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return `${TENS[t]}${o ? `-${ONES[o]}` : ""}`;
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${ONES[h]} Hundred${rest ? ` ${numberToWordsUnder1000(rest)}` : ""}`;
}

/** e.g. 2015 → Two Thousand Fifteen */
export function yearToWords(year: number): string {
  if (year < 1000 || year > 9999) return String(year);
  const thousands = Math.floor(year / 1000);
  const rest = year % 1000;
  if (rest === 0) return `${ONES[thousands]} Thousand`;
  if (rest < 100) {
    return `${ONES[thousands]} Thousand ${numberToWordsUnder1000(rest)}`;
  }
  return `${ONES[thousands]} Thousand ${numberToWordsUnder1000(rest)}`;
}

/** Date of birth in words (Christian Era) — CBSE TC style. */
export function dateToWords(isoDate: string): string {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${numberToWordsUnder1000(day)} ${month} ${yearToWords(year)}`;
}

const CLASS_WORDS: Record<string, string> = {
  Nursery: "Nursery",
  LKG: "Lower Kindergarten",
  UKG: "Upper Kindergarten",
  I: "First",
  II: "Second",
  III: "Third",
  IV: "Fourth",
  V: "Fifth",
  VI: "Sixth",
  VII: "Seventh",
  VIII: "Eighth",
  IX: "Ninth",
  X: "Tenth",
  XI: "Eleventh",
  XII: "Twelfth",
};

export function classToWords(classLabel: string): string {
  if (!classLabel) return "—";
  const base = classLabel.split("-")[0]?.trim() || classLabel;
  const section = classLabel.includes("-")
    ? classLabel.split("-").slice(1).join("-")
    : "";
  const words = CLASS_WORDS[base] || base;
  return section ? `${words} (${section})` : words;
}

export function categoryForTc(category: StudentCategory | string): string {
  if (!category || category === "GEN") return "No";
  if (category === "SC") return "Yes — Schedule Caste";
  if (category === "ST") return "Yes — Schedule Tribe";
  if (category === "OBC") return "Yes — OBC";
  if (category === "EWS") return "EWS";
  return String(category);
}

export function emptyTcDetails(): TcDetails {
  return {
    bookNo: "1",
    nationality: "Indian",
    category: "No",
    admissionClass: "",
    lastClassFigures: "",
    lastClassWords: "",
    annualExamResult: "Studying / Appeared — Result awaited",
    failedOnceTwice: "No",
    subjectsStudied:
      "As per school curriculum for the class (English, Hindi, Mathematics, EVS/Science, Social Science)",
    qualifiedForPromotion: "Yes",
    promotedToFigures: "",
    promotedToWords: "",
    duesPaidUpto: "",
    feeConcession: "No",
    workingDays: "",
    daysPresent: "",
    nccScoutGuide: "No",
    gamesActivities: "",
    applicationDate: "",
    checkedByName: "",
    checkedByDesignation: "Office assistant",
  };
}

export function certificateKindLabel(kind: CertificateKind): string {
  return CERTIFICATE_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

export function emptyCertificatesState(): CertificatesState {
  return { version: 1, issues: [] };
}

export function loadCertificates(): CertificatesState {
  if (typeof window === "undefined") return emptyCertificatesState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCertificatesState();
    const parsed = JSON.parse(raw) as CertificatesState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.issues)) {
      return emptyCertificatesState();
    }
    return {
      version: 1,
      issues: parsed.issues.map(normalizeIssue),
    };
  } catch {
    return emptyCertificatesState();
  }
}

export function saveCertificates(state: CertificatesState) {
  if (!assertModulePermission("certificates", "edit", "saveCertificates")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/certificatesPersistence").then(({ scheduleCertificatesSync }) => {
    scheduleCertificatesSync(state);
  });

}

export function writeCertificatesLocalRaw(state: CertificatesState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function certificatesStateIsEmpty(state: CertificatesState): boolean {
  return (state.issues?.length ?? 0) === 0;
}


function normalizeTc(raw: Partial<TcDetails> | null | undefined): TcDetails {
  const d = emptyTcDetails();
  if (!raw) return d;
  return {
    bookNo: raw.bookNo ?? d.bookNo,
    nationality: raw.nationality ?? d.nationality,
    category: raw.category ?? d.category,
    admissionClass: raw.admissionClass ?? d.admissionClass,
    lastClassFigures: raw.lastClassFigures ?? d.lastClassFigures,
    lastClassWords: raw.lastClassWords ?? d.lastClassWords,
    annualExamResult: raw.annualExamResult ?? d.annualExamResult,
    failedOnceTwice: raw.failedOnceTwice ?? d.failedOnceTwice,
    subjectsStudied: raw.subjectsStudied ?? d.subjectsStudied,
    qualifiedForPromotion:
      raw.qualifiedForPromotion ?? d.qualifiedForPromotion,
    promotedToFigures: raw.promotedToFigures ?? d.promotedToFigures,
    promotedToWords: raw.promotedToWords ?? d.promotedToWords,
    duesPaidUpto: raw.duesPaidUpto ?? d.duesPaidUpto,
    feeConcession: raw.feeConcession ?? d.feeConcession,
    workingDays: raw.workingDays ?? d.workingDays,
    daysPresent: raw.daysPresent ?? d.daysPresent,
    nccScoutGuide: raw.nccScoutGuide ?? d.nccScoutGuide,
    gamesActivities: raw.gamesActivities ?? d.gamesActivities,
    applicationDate: raw.applicationDate ?? d.applicationDate,
    checkedByName: raw.checkedByName ?? d.checkedByName,
    checkedByDesignation:
      raw.checkedByDesignation ?? d.checkedByDesignation,
  };
}

function normalizeIssue(c: CertificateIssue): CertificateIssue {
  const kind = c.kind || "bonafide";
  return {
    id: c.id || id("cert"),
    kind,
    certNo: c.certNo || "",
    studentId: c.studentId || "",
    householdId: c.householdId || "",
    academicYearCode: c.academicYearCode || DEFAULT_AY,
    studentName: c.studentName || "",
    admissionNo: c.admissionNo || "",
    fatherName: c.fatherName || "",
    motherName: c.motherName || "",
    dob: c.dob || "",
    gender: c.gender || "",
    classLabel: c.classLabel || "",
    rollNo: c.rollNo || "",
    pen: c.pen || "",
    apaarId: c.apaarId || "",
    admissionDate: c.admissionDate || "",
    leavingDate: c.leavingDate || "",
    reasonForLeaving: c.reasonForLeaving || "",
    lastClassStudied: c.lastClassStudied || c.classLabel || "",
    promotedTo: c.promotedTo || "",
    conduct: c.conduct || "Good",
    remarks: c.remarks || "",
    openBalancePaise: Math.max(0, Number(c.openBalancePaise) || 0),
    duesCleared: !!c.duesCleared,
    overrideDues: !!c.overrideDues,
    issuedOn: c.issuedOn || todayIso(),
    issuedBy: c.issuedBy || "",
    classTeacherName: c.classTeacherName || "",
    createdAt: c.createdAt || new Date().toISOString(),
    voidedAt: c.voidedAt ?? null,
    inactivatedStudent: !!c.inactivatedStudent,
    tc: kind === "tc" ? normalizeTc(c.tc) : c.tc ? normalizeTc(c.tc) : null,
    feesPaid:
      kind === "fees_paid"
        ? normalizeFeesPaid(c.feesPaid)
        : c.feesPaid
          ? normalizeFeesPaid(c.feesPaid)
          : null,
  };
}

function normalizeFeesPaid(
  raw: Partial<FeesPaidDetails> | null | undefined,
): FeesPaidDetails {
  return {
    periodFrom: raw?.periodFrom || "",
    periodTo: raw?.periodTo || "",
    claimFor: raw?.claimFor || "",
    includeSiblings: !!raw?.includeSiblings,
    totalPaidPaise: Math.max(0, Number(raw?.totalPaidPaise) || 0),
    academicPaise: Math.max(0, Number(raw?.academicPaise) || 0),
    transportPaise: Math.max(0, Number(raw?.transportPaise) || 0),
    storePaise: Math.max(0, Number(raw?.storePaise) || 0),
    specialPaise: Math.max(0, Number(raw?.specialPaise) || 0),
    otherPaise: Math.max(0, Number(raw?.otherPaise) || 0),
    receipts: Array.isArray(raw?.receipts)
      ? raw!.receipts!.map((r) => ({
          receiptNo: r.receiptNo || "",
          collectionDate: r.collectionDate || "",
          modes: r.modes || "",
          amountPaise: Math.max(0, Number(r.amountPaise) || 0),
          lineSummary: r.lineSummary || "",
        }))
      : [],
  };
}

/**
 * Build reimbursement snapshot from non-voided vouchers touching this student
 * (optionally all household siblings) within [from, to] collection dates.
 */
export function buildFeesPaidSnapshot(input: {
  studentId: string;
  householdId: string;
  periodFrom: string;
  periodTo: string;
  includeSiblings?: boolean;
  claimFor?: string;
}): FeesPaidDetails | { error: string } {
  const from = input.periodFrom;
  const to = input.periodTo;
  if (!from || !to) {
    return { error: "Select reimbursement period (from / to dates)" };
  }
  if (from > to) {
    return { error: "Period from date must be on or before to date" };
  }

  const fees = loadFees();
  const sis = loadSis();
  const studentIds = new Set<string>();
  if (input.includeSiblings) {
    for (const s of sis.students) {
      if (s.householdId === input.householdId && s.status === "active") {
        studentIds.add(s.id);
      }
    }
  }
  studentIds.add(input.studentId);

  const vouchers = fees.vouchers
    .filter((v) => {
      if (v.voidedAt) return false;
      if (v.collectionDate < from || v.collectionDate > to) return false;
      return v.lines.some((l) => studentIds.has(l.studentId));
    })
    .sort((a, b) => a.collectionDate.localeCompare(b.collectionDate));

  if (vouchers.length === 0) {
    return {
      error: `No fee receipts found for this student in ${from} → ${to}`,
    };
  }

  let academicPaise = 0;
  let transportPaise = 0;
  let storePaise = 0;
  let specialPaise = 0;
  let otherPaise = 0;
  let totalPaidPaise = 0;
  const receipts: FeesPaidReceiptRow[] = [];

  for (const v of vouchers) {
    const lines = v.lines.filter((l) => studentIds.has(l.studentId));
    const amountPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
    if (amountPaise <= 0) continue;
    totalPaidPaise += amountPaise;
    for (const l of lines) {
      if (l.kind === "academic") academicPaise += l.amountPaise;
      else if (l.kind === "transport") transportPaise += l.amountPaise;
      else if (l.kind === "store") storePaise += l.amountPaise;
      else if (l.kind === "special") specialPaise += l.amountPaise;
      else otherPaise += l.amountPaise;
    }
    receipts.push({
      receiptNo: v.receiptNo,
      collectionDate: v.collectionDate,
      modes: v.tenders.map((t) => tenderModeLabel(t.mode)).join(" + "),
      amountPaise,
      lineSummary: lines
        .map((l) => l.label)
        .slice(0, 4)
        .join("; "),
    });
  }

  if (totalPaidPaise <= 0) {
    return { error: "No paid amount in the selected period" };
  }

  return {
    periodFrom: from,
    periodTo: to,
    claimFor: input.claimFor?.trim() || "Employer / parent reimbursement",
    includeSiblings: !!input.includeSiblings,
    totalPaidPaise,
    academicPaise,
    transportPaise,
    storePaise,
    specialPaise,
    otherPaise,
    receipts,
  };
}

/** Preview helper for the issue form. */
export function previewFeesPaidForStudent(
  student: SisStudent,
  periodFrom: string,
  periodTo: string,
  includeSiblings: boolean,
  claimFor?: string,
): FeesPaidDetails | { error: string } {
  return buildFeesPaidSnapshot({
    studentId: student.id,
    householdId: student.householdId,
    periodFrom,
    periodTo,
    includeSiblings,
    claimFor,
  });
}

export function classLabelForStudent(student: SisStudent): string {
  const masters = loadMasters();
  const c =
    masters.classes.find((x) => x.id === student.classId)?.name ?? "—";
  const sec =
    masters.sections.find((x) => x.id === student.sectionId)?.name ?? "";
  return sec ? `${c}-${sec}` : c;
}

export function studentOpenBalance(student: SisStudent): {
  openBalancePaise: number;
  openDueCount: number;
} {
  const masters = loadMasters();
  const fees = loadFees();
  const dues = computeStudentDues(student, masters, fees, {
    includeFuture: true,
    includeInactive: true,
  });
  const open = openFeeDues(dues);
  return {
    openBalancePaise: open.reduce((s, d) => s + d.balancePaise, 0),
    openDueCount: open.length,
  };
}

export type CertEligibility = {
  openBalancePaise: number;
  openDueCount: number;
  canIssue: boolean;
  requiresOverride: boolean;
  blockers: string[];
  warnings: string[];
};

export function certificateEligibility(
  student: SisStudent,
  kind: CertificateKind,
): CertEligibility {
  const { openBalancePaise, openDueCount } = studentOpenBalance(student);
  const blockers: string[] = [];
  const warnings: string[] = [];
  let canIssue = true;
  let requiresOverride = false;

  if (student.status !== "active" && kind === "tc") {
    warnings.push(
      "Student is already inactive — TC may have been issued earlier",
    );
  }

  if (kind === "tc" && openDueCount > 0) {
    canIssue = false;
    requiresOverride = true;
    blockers.push(
      `Open dues ${formatInr(openBalancePaise)} — settle via Fee Adjustments (leave write-off) or collect before TC`,
    );
  }

  if (kind === "fee_clearance") {
    if (openDueCount > 0) {
      canIssue = false;
      blockers.push(
        `Open dues ${formatInr(openBalancePaise)} — clear fees before issuing no-dues`,
      );
    }
  } else if (kind === "fees_paid") {
    warnings.push(
      "Certificate lists fees actually collected in the selected period — for employer / tax reimbursement.",
    );
  }

  const holdCode = holdCodeForCertificate(kind);
  if (holdCode) {
    const hold = checkHold(student.id, holdCode);
    if (!hold.allowed) {
      canIssue = false;
      requiresOverride = true;
      blockers.push(hold.message);
    } else if (hold.override) {
      warnings.push(
        `Principal override active until ${hold.override.expiresOn}: ${hold.override.reason}`,
      );
    } else if (openDueCount > 0 && kind !== "fees_paid") {
      warnings.push(
        `Open dues ${formatInr(openBalancePaise)} — stage clear of this hold for now`,
      );
    }
  }

  return {
    openBalancePaise,
    openDueCount,
    canIssue,
    requiresOverride,
    blockers,
    warnings,
  };
}

function nextCertNo(
  kind: CertificateKind,
  ay: string,
  state: CertificatesState,
): string {
  const prefix =
    kind === "tc"
      ? "TC"
      : kind === "bonafide"
        ? "BNF"
        : kind === "character"
          ? "CHR"
          : kind === "fees_paid"
            ? "FEE"
            : "ND";
  const ayTag = ay.replace(/[^0-9]/g, "").slice(0, 4) || "AY";
  const existing = state.issues.filter(
    (i) => i.kind === kind && i.academicYearCode === ay && !i.voidedAt,
  ).length;
  return `${prefix}-${ayTag}-${String(existing + 1).padStart(4, "0")}`;
}

function monthNameFromIso(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export type IssueCertificateInput = {
  kind: CertificateKind;
  studentId: string;
  issuedBy: string;
  classTeacherName?: string;
  issuedOn?: string;
  admissionDate?: string;
  leavingDate?: string;
  reasonForLeaving?: string;
  lastClassStudied?: string;
  promotedTo?: string;
  conduct?: string;
  remarks?: string;
  overrideDues?: boolean;
  inactivateOnTc?: boolean;
  /** Override snapshot PEN / APAAR when correcting at issue time */
  pen?: string;
  apaarId?: string;
  tc?: Partial<TcDetails>;
  /** Fees-paid / reimbursement options */
  feesPaidPeriodFrom?: string;
  feesPaidPeriodTo?: string;
  feesPaidClaimFor?: string;
  feesPaidIncludeSiblings?: boolean;
};

export function issueCertificate(
  input: IssueCertificateInput,
):
  | { ok: true; issue: CertificateIssue }
  | { ok: false; error: string } {
  const sis = loadSis();
  const student = sis.students.find((s) => s.id === input.studentId);
  if (!student) return { ok: false, error: "Student not found" };

  const eligibility = certificateEligibility(student, input.kind);
  if (!eligibility.canIssue) {
    return {
      ok: false,
      error:
        eligibility.blockers[0] ||
        "Cannot issue — clear dues or unlock with Principal PIN",
    };
  }
  // Legacy checkbox no longer bypasses holds — override must be granted via PIN
  void input.overrideDues;

  if (input.kind === "tc") {
    if (!input.leavingDate?.trim()) {
      return { ok: false, error: "Leaving date is required for TC" };
    }
    if (!input.reasonForLeaving?.trim()) {
      return { ok: false, error: "Reason for leaving is required for TC" };
    }
    if (!input.admissionDate?.trim()) {
      return {
        ok: false,
        error: "Date of first admission is required for TC (Admission Register)",
      };
    }
  }

  let feesPaid: FeesPaidDetails | null = null;
  if (input.kind === "fees_paid") {
    const snap = buildFeesPaidSnapshot({
      studentId: student.id,
      householdId: student.householdId,
      periodFrom: input.feesPaidPeriodFrom || "",
      periodTo: input.feesPaidPeriodTo || "",
      includeSiblings: input.feesPaidIncludeSiblings,
      claimFor: input.feesPaidClaimFor,
    });
    if ("error" in snap) return { ok: false, error: snap.error };
    feesPaid = snap;
  }

  const state = loadCertificates();
  const ay = student.academicYearCode || DEFAULT_AY;
  const classLabel = classLabelForStudent(student);
  const issuedOn = input.issuedOn || todayIso();
  const duesCleared = eligibility.openDueCount === 0;
  const lastClass = input.lastClassStudied?.trim() || classLabel;
  const promoted = input.promotedTo?.trim() || "";

  let inactivatedStudent = false;
  if (input.kind === "tc" && input.inactivateOnTc !== false) {
    if (student.status === "active") {
      saveSis({
        ...sis,
        students: sis.students.map((s) =>
          s.id === student.id ? { ...s, status: "inactive" as const } : s,
        ),
      });
      inactivatedStudent = true;
    }
  }

  const tcPatch = input.tc ?? {};
  const tc: TcDetails | null =
    input.kind === "tc"
      ? normalizeTc({
          ...emptyTcDetails(),
          bookNo: tcPatch.bookNo || "1",
          nationality:
            tcPatch.nationality || student.nationality || "Indian",
          category:
            tcPatch.category || categoryForTc(student.category),
          admissionClass:
            tcPatch.admissionClass ||
            lastClass.split("-")[0] ||
            lastClass,
          lastClassFigures: tcPatch.lastClassFigures || lastClass,
          lastClassWords:
            tcPatch.lastClassWords || classToWords(lastClass),
          annualExamResult: tcPatch.annualExamResult,
          failedOnceTwice: tcPatch.failedOnceTwice,
          subjectsStudied: tcPatch.subjectsStudied,
          qualifiedForPromotion:
            tcPatch.qualifiedForPromotion ||
            (promoted ? "Yes" : "Yes"),
          promotedToFigures: tcPatch.promotedToFigures || promoted,
          promotedToWords:
            tcPatch.promotedToWords ||
            (promoted ? classToWords(promoted) : ""),
          duesPaidUpto:
            tcPatch.duesPaidUpto ||
            (duesCleared
              ? monthNameFromIso(input.leavingDate || issuedOn)
              : `Outstanding ${formatInr(eligibility.openBalancePaise)}`),
          feeConcession: tcPatch.feeConcession,
          workingDays: tcPatch.workingDays,
          daysPresent: tcPatch.daysPresent,
          nccScoutGuide: tcPatch.nccScoutGuide,
          gamesActivities: tcPatch.gamesActivities,
          applicationDate:
            tcPatch.applicationDate || input.leavingDate || issuedOn,
          checkedByName: tcPatch.checkedByName,
          checkedByDesignation: tcPatch.checkedByDesignation,
        })
      : null;

  const issue = normalizeIssue({
    id: id("cert"),
    kind: input.kind,
    certNo: nextCertNo(input.kind, ay, state),
    studentId: student.id,
    householdId: student.householdId,
    academicYearCode: ay,
    studentName: student.fullName,
    admissionNo: student.admissionNo,
    fatherName: student.fatherName || "",
    motherName: student.motherName || "",
    dob: student.dob || "",
    gender: student.gender || "",
    classLabel,
    rollNo: student.rollNo || "",
    pen: (input.pen ?? student.pen)?.trim() || "",
    apaarId: (input.apaarId ?? student.apaarId)?.trim() || "",
    admissionDate: input.admissionDate?.trim() || "",
    leavingDate: input.leavingDate?.trim() || "",
    reasonForLeaving: input.reasonForLeaving?.trim() || "",
    lastClassStudied: lastClass,
    promotedTo: promoted,
    conduct: input.conduct?.trim() || "Good",
    remarks: input.remarks?.trim() || "",
    openBalancePaise: eligibility.openBalancePaise,
    duesCleared,
    overrideDues: !!input.overrideDues && eligibility.requiresOverride,
    issuedOn,
    issuedBy: input.issuedBy,
    classTeacherName: (input.classTeacherName ?? "").trim(),
    createdAt: new Date().toISOString(),
    voidedAt: null,
    inactivatedStudent,
    tc,
    feesPaid,
  });

  saveCertificates({ version: 1, issues: [issue, ...state.issues] });
  return { ok: true, issue };
}

export function voidCertificate(issueId: string): boolean {
  const state = loadCertificates();
  const issue = state.issues.find((i) => i.id === issueId);
  if (!issue || issue.voidedAt) return false;
  saveCertificates({
    version: 1,
    issues: state.issues.map((i) =>
      i.id === issueId
        ? { ...i, voidedAt: new Date().toISOString() }
        : i,
    ),
  });
  return true;
}

export function listCertificates(state?: CertificatesState): CertificateIssue[] {
  return [...(state ?? loadCertificates()).issues].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function getCertificate(
  issueId: string,
  state?: CertificatesState,
): CertificateIssue | undefined {
  return (state ?? loadCertificates()).issues.find((i) => i.id === issueId);
}

export function formatCertDate(isoDate: string): string {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function genderLabel(g: string): string {
  if (g === "M") return "Male";
  if (g === "F") return "Female";
  if (g === "O") return "Other";
  return g || "—";
}

/** Default subjects hint by class band for TC form. */
export function defaultSubjectsForClass(classLabel: string): string {
  const base = (classLabel.split("-")[0] || "").toUpperCase();
  if (["NURSERY", "LKG", "UKG"].includes(base)) {
    return "English, Hindi, Mathematics, Environmental Studies, Rhymes / Activity";
  }
  if (["I", "II", "III", "IV", "V"].includes(base)) {
    return "English, Hindi, Mathematics, Environmental Studies, General Knowledge";
  }
  if (["VI", "VII", "VIII"].includes(base)) {
    return "English, Hindi, Mathematics, Science, Social Science, Computer / Third Language";
  }
  if (["IX", "X"].includes(base)) {
    return "English, Hindi, Mathematics, Science, Social Science, Additional subject (as opted)";
  }
  if (["XI", "XII"].includes(base)) {
    return "As per stream subjects offered (Science / Commerce / Humanities)";
  }
  return "As per school curriculum for the class";
}
