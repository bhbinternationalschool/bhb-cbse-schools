/**
 * Admissions CRM — enquiry → registration → verified → enrolled (§3i).
 * Household model: one OTP-key mobile can hold many guardians + many child leads.
 * Demo store: localStorage `bhb_admissions_v1`.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { normalizePhotoConsent, type PhotoConsent } from "@/lib/photoConsent";
import { sanitizeStoredMediaUrl } from "@/lib/media";
import { normalizeHouseholdLanguage } from "@/lib/householdPrefs";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import {
  currentAcademicYearCode,
  DEFAULT_AY,
  loadMasters,
  resolveFeeGroupId,
  suggestFeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  getSchoolMirrorSync,
  scheduleClientSchoolMirrorSync,
  setMirrorSlice,
} from "@/lib/schoolDataMirror";
import {
  cleanRepeatedName,
  loadSis,
  newSisId,
  normalizeHousehold,
  normalizeMobile,
  normalizeStudent,
  saveSis,
  suggestAdmissionNo,
  suggestSrn,
  type SisStudent,
} from "@/lib/sis";
import { ensureRteEwsTagIds } from "@/lib/studentTags";
import { TENANT } from "@/lib/types";
import { syncLeadRegistrationToLedger } from "@/lib/registrationFeeLedger";
import {
  TENDER_MODES,
  tenderModeLabel,
  type TenderMode,
} from "@/lib/fees";

export type AdmissionStage =
  | "enquiry"
  | "applied"
  | "verified"
  | "enrolled"
  | "lost";

export type AdmissionSource =
  | "walk_in"
  | "website"
  | "referral"
  | "field_survey"
  | "social"
  | "google"
  | "phone"
  | "whatsapp"
  | "other";

export type TransportInterest = "yes" | "no" | "undecided";

export type AdmissionKind = "new" | "transfer" | "readmission";

export type GuardianRelation =
  | "father"
  | "mother"
  | "guardian"
  | "uncle"
  | "aunt"
  | "grandfather"
  | "grandmother"
  | "other";

export type AdmissionGuardian = {
  id: string;
  fullName: string;
  relation: GuardianRelation;
  mobile: string;
  whatsapp: string;
  email: string;
  occupation: string;
  /** Primary for fee / WhatsApp / login */
  isPrimary: boolean;
};

export type AdmissionHousehold = {
  id: string;
  code: string;
  /** OTP / merge key — usually primary guardian mobile */
  primaryMobile: string;
  whatsapp: string;
  email: string;
  locality: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  guardians: AdmissionGuardian[];
  /** Set on first child enroll — siblings reuse this SIS household */
  sisHouseholdId: string;
  /**
   * Whether this family agreed to photographs being published.
   * "" = never asked, which is NOT agreement. See lib/photoConsent.ts.
   */
  photoConsent?: PhotoConsent;
  note: string;
  createdAt: string;
  updatedAt: string;
};

/** How the counsellor / calling agent contacted the family */
export type FollowUpChannel =
  | "call"
  | "whatsapp"
  | "visit"
  | "sms"
  | "email"
  | "other";

/** Call / visit disposition logged by counsellor */
export type FollowUpOutcome =
  | "connected"
  | "no_answer"
  | "busy"
  | "callback"
  | "interested"
  | "not_interested"
  | "visit_scheduled"
  | "wrong_number"
  /** One-way message sent (WhatsApp / SMS / email) — no reply yet */
  | "message_sent";

export type AdmissionFollowUp = {
  id: string;
  /** When the attempt was logged (ISO) */
  at: string;
  channel: FollowUpChannel;
  outcome: FollowUpOutcome;
  note: string;
  /** Next promised call / visit date (YYYY-MM-DD) */
  nextFollowUpAt: string;
  by: string;
};

export type AdmissionLead = {
  id: string;
  /** Links siblings under one family card */
  householdId: string;
  enquiryNo: string;
  applicationNo: string;
  stage: AdmissionStage;
  academicYearCode: string;
  source: AdmissionSource;
  childName: string;
  dob: string;
  /**
   * Age in whole years as the parent stated it, when no birth date was given.
   *
   * Kept SEPARATE from `dob` and never converted into one. At a doorstep a
   * parent says "chaar saal ka hai", not a date; deriving 2022-08-24 from
   * that would turn an approximation into a fact the office would later read
   * off a form as though the family had confirmed it. 0 means not stated.
   */
  ageYearsApprox: number;
  gender: string;
  classSoughtId: string;
  classAdmittedId: string;
  sectionId: string;
  medium: string;
  admissionKind: AdmissionKind;
  /** Denormalized from household primary (fast list views) */
  guardianName: string;
  motherName: string;
  mobile: string;
  whatsappSame: boolean;
  whatsapp: string;
  email: string;
  fatherOccupation: string;
  category: string;
  locality: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  previousSchool: string;
  previousTcNo: string;
  transportInterest: TransportInterest;
  siblingInSchool: boolean;
  referredByStaffId: string;
  campaignNote: string;
  /** Ad-platform campaign id (Google lead form campaign_id, UTM campaign) — "" = unknown */
  campaignId: string;
  /** Family's preferred language for school messages (HouseholdLanguage code); "" = not asked */
  preferredLanguage: string;
  /** Board of the previous school for Class VI+ enquiries; "" = not asked */
  previousBoard: string;
  /** What the family said matters most (transport, fees, academics…) — drives follow-up drafts */
  concerns: string[];
  /** Enrolled household that referred this family (parent referral); "" = none */
  referredByHouseholdId: string;
  /** Referral code as typed / on the link (resolved to referredByHouseholdId by the CRM); "" = none */
  referralCode: string;
  declarationAccepted: boolean;
  registrationFeePaid: boolean;
  registrationFeeNote: string;
  docsBirthCert: boolean;
  docsPhoto: boolean;
  docsAadhaar: boolean;
  docsTc: boolean;
  docsCategory: boolean;
  admissionDate: string;
  admissionNo: string;
  studentId: string;
  /** SIS register check: confirmed admitted or suspected match */
  sisMatch: "" | "admitted" | "suspected";
  /** Matched / suspected SIS student id */
  sisStudentId: string;
  /** Matched student status at last check (active / inactive / left…) */
  sisStudentStatus: string;
  /** Display line: student name · Adm no · session */
  sisStudentInfo: string;
  /** How the SIS hit was scored (mobile+name, name-only, family mobile…) */
  sisMatchKind: string;
  /** Human-readable mismatch lines vs the suspected / matched SIS student */
  sisMismatchNotes: string[];
  /**
   * Counsellor review of a suspected SIS hit:
   * keep_open = cleared tag, still working; closed_not_match = closed/lost;
   * verified = confirmed and updated from SIS.
   */
  sisReviewStatus: "" | "keep_open" | "closed_not_match" | "verified";
  /** SIS student id the counsellor dismissed / kept-open against (avoid re-tag) */
  sisDismissedStudentId: string;
  /**
   * WhatsApp profile / push name from live contacts check (or inbound webhook).
   * Campaigns prefer this over guardianName for {{guardianName}}.
   */
  whatsappDisplayName: string;
  /** WhatsApp wa_id from contacts check (E.164 digits, no +) */
  whatsappWaId: string;
  feeGroupId: string;
  rte: boolean;
  /** Official RTE portal / govt list application number */
  rteGovtApplicationNo: string;
  penStatus: string;
  note: string;
  lostReason: string;
  /** Counsellor / calling agent owning this lead */
  assignedTo: string;
  /** Denormalized next follow-up date (YYYY-MM-DD) for CRM filters */
  nextFollowUpAt: string;
  lastFollowUpAt: string;
  followUps: AdmissionFollowUp[];
  /**
   * Enquiry / lead capture date (YYYY-MM-DD). Survives across academic sessions;
   * use with captureYear() for year filters.
   */
  leadDate: string;
  /** When moved to Registered (YYYY-MM-DD) */
  registrationDate: string;
  /** Fee head chosen at Registration desk */
  registrationFeeHeadId: string;
  registrationFeeAmountPaise: number;
  registrationPaymentId: string;
  registrationPaymentStatus: RegistrationPaymentStatus;
  /** Parent group key = guardian mobile — siblings with same parent share SIS HH */
  parentGroupKey: string;
  /** Field survey beat id (from beat master) */
  surveyBeatId: string;
  /** Compressed photo from tablet capture (data URL) */
  /**
   * URL of the survey photo, never the image itself.
   *
   * This was `surveyPhotoDataUrl` and held base64. At ~200 KB a photo it
   * would have put a single lead well past the size of the entire 919-lead
   * list, inside `lead_json`, which every admissions read carried. The field
   * was never populated in production — 0 of 919 rows — so it was changed
   * before it could cost anything. sanitizeSurveyPhotoUrl() refuses a data:
   * URL so it cannot regress by accident.
   */
  surveyPhotoUrl: string;
  parentConsentAt: string;
  parentConsentBy: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type SurveyBeat = {
  id: string;
  code: string;
  name: string;
  area: string;
  targetHouseholds: number;
  isActive: boolean;
  note: string;
  createdAt: string;
};

export type SurveyAttendance = {
  id: string;
  date: string;
  agentName: string;
  checkInAt: string;
  checkOutAt: string;
  beatId: string;
  note: string;
};

/** Outside hire used only for field survey (not on school staff master). */
export type SurveyExternalAgent = {
  id: string;
  fullName: string;
  mobile: string;
  note: string;
  createdAt: string;
};

/**
 * Survey crew member — school staff or external.
 * assigned=true → agent app shows Start survey; false → hidden.
 */
export type SurveyTeamMember = {
  id: string;
  kind: "staff" | "external";
  staffId: string;
  externalId: string;
  fullName: string;
  mobile: string;
  empCode: string;
  role: "leader" | "agent";
  /** When true, member sees Survey Start on their app */
  assigned: boolean;
  createdAt: string;
};

export type SurveyGeoPoint = {
  lat: number;
  lng: number;
  accuracyM: number;
  at: string;
};

export type SurveyBreak = {
  id: string;
  startedAt: string;
  endedAt: string;
  startGeo: SurveyGeoPoint | null;
  endGeo: SurveyGeoPoint | null;
};

/** One day field run: start (with location) → optional breaks → end (with location). */
export type SurveyWorkSession = {
  id: string;
  date: string;
  memberId: string;
  agentName: string;
  staffId: string;
  beatId: string;
  startedAt: string;
  endedAt: string;
  startGeo: SurveyGeoPoint | null;
  endGeo: SurveyGeoPoint | null;
  breaks: SurveyBreak[];
  status: "active" | "on_break" | "ended";
};

export type RegistrationPaymentStatus =
  | "none"
  | "pending"
  | "partial"
  | "paid"
  | "waived";

export type RegistrationTender = {
  mode: TenderMode;
  amountPaise: number;
  ref: string;
  bankName: string;
  instrumentDate: string;
  /**
   * Set only when a payment gateway captured this money. It settles a cycle
   * later, net of fees, so the ledger holds it in clearing rather than
   * claiming a bank balance that does not exist yet.
   */
  gatewayProvider?: string;
};

export type RegistrationFeePayment = {
  id: string;
  code: string;
  leadId: string;
  feeHeadId: string;
  feeHeadName: string;
  amountPaise: number;
  status: "open" | "paid" | "cancelled" | "waived";
  /** counter / upi_link / waived = CRM flow; TenderMode = desk collect */
  mode: "counter" | "upi_link" | "waived" | TenderMode;
  tenders: RegistrationTender[];
  mobile: string;
  childName: string;
  createdAt: string;
  paidAt: string;
  upiRef: string;
  createdBy: string;
  note: string;
  /** Fee Take / student ledger CollectionVoucher id after post (R-series) */
  feeVoucherId: string;
  feeReceiptNo: string;
  ledgerDueKey: string;
  ledgerPostedAt: string;
};

export type AdmissionsState = {
  version: 1;
  households: AdmissionHousehold[];
  leads: AdmissionLead[];
  registrationPayments: RegistrationFeePayment[];
  surveyBeats: SurveyBeat[];
  surveyAttendance: SurveyAttendance[];
  surveyExternals: SurveyExternalAgent[];
  surveyTeam: SurveyTeamMember[];
  surveySessions: SurveyWorkSession[];
  /** Staff ids assigned to lead calling — only they see lead/admission lists on staff app */
  leadCallerStaffIds: string[];
  nextEnquirySeq: number;
  nextApplicationSeq: number;
  nextHouseholdSeq: number;
  nextRegPaySeq: number;
  nextBeatSeq: number;
};

const STORAGE_KEY = "bhb_admissions_v1";

let serverAdmissionsCache: AdmissionsState | null = null;

export const ADMISSION_STAGES: {
  value: AdmissionStage;
  label: string;
}[] = [
  { value: "enquiry", label: "Open" },
  { value: "applied", label: "Registered" },
  { value: "verified", label: "Verified" },
  { value: "enrolled", label: "Admitted" },
  { value: "lost", label: "Lost" },
];

/** Chip colours for CRM list / tags */
export function stageTagClass(stage: AdmissionStage): string {
  switch (stage) {
    case "enquiry":
      return "bg-[rgba(71,85,105,0.14)] text-[#334155]";
    case "applied":
      return "bg-[rgba(21,128,61,0.16)] text-[#15803d]";
    case "verified":
      return "bg-[rgba(21,128,61,0.16)] text-[#15803d]";
    case "enrolled":
      return "bg-[rgba(21,128,61,0.22)] text-[#166534]";
    case "lost":
      return "bg-[rgba(180,35,24,0.12)] text-[var(--danger)]";
    default:
      return "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]";
  }
}

/**
 * Admitted leads are display-only (green, not openable for CRM work).
 * Registered / Verified stay openable so office can still Verify → Admit.
 */
export function isConvertedShowOnly(stage: AdmissionStage): boolean {
  return stage === "enrolled";
}

/** Soft green row background for registered / verified / admitted */
export function convertedLeadRowClass(stage: AdmissionStage): string {
  if (stage === "enrolled") {
    return "bg-[rgba(21,128,61,0.14)] text-[#14532d]";
  }
  if (stage === "applied" || stage === "verified") {
    return "bg-[rgba(21,128,61,0.08)] text-[#166534]";
  }
  return "";
}

export function sourceTagClass(source: AdmissionSource): string {
  switch (source) {
    case "walk_in":
      return "bg-[rgba(15,118,110,0.12)] text-[#0f766e]";
    case "field_survey":
      return "bg-[rgba(180,83,9,0.12)] text-[#9a3412]";
    case "website":
      return "bg-[rgba(30,64,175,0.1)] text-[#1e40af]";
    case "google":
      return "bg-[rgba(66,133,244,0.14)] text-[#1a73e8]";
    case "referral":
      return "bg-[rgba(21,128,61,0.12)] text-[#15803d]";
    case "social":
      return "bg-[rgba(126,34,206,0.1)] text-[#7e22ce]";
    case "phone":
      return "bg-[rgba(71,85,105,0.14)] text-[#334155]";
    case "whatsapp":
      return "bg-[rgba(37,211,102,0.14)] text-[#128c7e]";
    default:
      return "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]";
  }
}

export const FOLLOW_UP_CHANNELS: {
  value: FollowUpChannel;
  label: string;
}[] = [
  { value: "call", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "visit", label: "Campus visit" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "other", label: "Other" },
];

export const FOLLOW_UP_OUTCOMES: {
  value: FollowUpOutcome;
  label: string;
}[] = [
  { value: "connected", label: "Connected" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy / cut" },
  { value: "callback", label: "Callback requested" },
  { value: "interested", label: "Interested" },
  { value: "visit_scheduled", label: "School visit scheduled" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "message_sent", label: "Message sent" },
];

export function followUpChannelLabel(c: FollowUpChannel): string {
  return FOLLOW_UP_CHANNELS.find((x) => x.value === c)?.label || c;
}

export function followUpOutcomeLabel(o: FollowUpOutcome): string {
  return FOLLOW_UP_OUTCOMES.find((x) => x.value === o)?.label || o;
}

/** Local calendar day YYYY-MM-DD */
export function todayYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type LeadFollowUpBucket = "overdue" | "due_today" | "scheduled" | "none";

export function leadFollowUpBucket(lead: AdmissionLead): LeadFollowUpBucket {
  if (lead.stage === "enrolled" || lead.stage === "lost") return "none";
  const next = (lead.nextFollowUpAt || "").slice(0, 10);
  if (!next) return "none";
  const today = todayYmd();
  if (next < today) return "overdue";
  if (next === today) return "due_today";
  return "scheduled";
}

export function followUpBucketClass(bucket: LeadFollowUpBucket): string {
  switch (bucket) {
    case "overdue":
      return "bg-[rgba(180,35,24,0.12)] text-[var(--danger)]";
    case "due_today":
      return "bg-[rgba(180,83,9,0.14)] text-[#9a3412]";
    case "scheduled":
      return "bg-[rgba(15,118,110,0.12)] text-[#0f766e]";
    default:
      return "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]";
  }
}

export function emptyFollowUp(
  partial?: Partial<AdmissionFollowUp>,
): AdmissionFollowUp {
  return {
    id: partial?.id || nid("afu"),
    at: partial?.at || new Date().toISOString(),
    channel: partial?.channel || "call",
    outcome: partial?.outcome || "connected",
    note: (partial?.note || "").trim(),
    nextFollowUpAt: (partial?.nextFollowUpAt || "").slice(0, 10),
    by: (partial?.by || "").trim(),
  };
}

export const ADMISSION_SOURCES: {
  value: AdmissionSource;
  label: string;
}[] = [
  { value: "walk_in", label: "Walk-in" },
  { value: "website", label: "Website" },
  { value: "google", label: "Google" },
  { value: "social", label: "Social / ads" },
  { value: "field_survey", label: "Field survey" },
  { value: "referral", label: "Referral" },
  { value: "phone", label: "Phone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "other", label: "Other" },
];

/** Sources that use public form link + QR (not office walk-in desk) */
export const DIGITAL_CAPTURE_SOURCES: AdmissionSource[] = [
  "website",
  "google",
  "social",
  "field_survey",
];

export function isDigitalCaptureSource(s: AdmissionSource): boolean {
  return DIGITAL_CAPTURE_SOURCES.includes(s);
}

/** Build shareable public enquiry URL for a channel */
export function publicEnquiryPath(source: AdmissionSource): string {
  const src = isDigitalCaptureSource(source) ? source : "website";
  return `/apply?src=${encodeURIComponent(src)}`;
}

/** Always https://bhbinternational.school (public portal, not ERP / localhost) */
export function publicPortalOrigin(): string {
  const host = (TENANT.publicPortal || "bhbinternational.school").replace(
    /^https?:\/\//,
    "",
  );
  return `https://${host.replace(/\/$/, "")}`;
}

export function publicEnquiryAbsoluteUrl(
  source: AdmissionSource,
  origin?: string,
): string {
  const base = (origin || publicPortalOrigin()).replace(/\/$/, "");
  return `${base}${publicEnquiryPath(source)}`;
}

/** Parent self-registration (multi-sibling + fee pay) */
export function publicRegisterPath(src?: string): string {
  const cleaned = (src || "").trim();
  if (!cleaned) return "/register";
  return `/register?src=${encodeURIComponent(cleaned)}`;
}

export function publicRegisterAbsoluteUrl(
  src?: string,
  origin?: string,
): string {
  const base = (origin || publicPortalOrigin()).replace(/\/$/, "");
  return `${base}${publicRegisterPath(src)}`;
}

export const GUARDIAN_RELATIONS: {
  value: GuardianRelation;
  label: string;
}[] = [
  { value: "father", label: "Father" },
  { value: "mother", label: "Mother" },
  { value: "guardian", label: "Guardian" },
  { value: "uncle", label: "Uncle" },
  { value: "aunt", label: "Aunt" },
  { value: "grandfather", label: "Grandfather" },
  { value: "grandmother", label: "Grandmother" },
  { value: "other", label: "Other" },
];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ayCode() {
  try {
    return currentAcademicYearCode() || DEFAULT_AY;
  } catch {
    return DEFAULT_AY;
  }
}

export function emptyGuardian(
  partial?: Partial<AdmissionGuardian>,
): AdmissionGuardian {
  return {
    id: partial?.id || nid("agr"),
    fullName: (partial?.fullName || "").trim(),
    relation: partial?.relation || "father",
    mobile: normalizeMobile(partial?.mobile || ""),
    whatsapp: normalizeMobile(partial?.whatsapp || ""),
    email: partial?.email || "",
    occupation: partial?.occupation || "",
    isPrimary: !!partial?.isPrimary,
  };
}

export function emptyAdmissionHousehold(
  partial?: Partial<AdmissionHousehold>,
): AdmissionHousehold {
  const now = new Date().toISOString();
  const rawGuardians = Array.isArray(partial?.guardians)
    ? partial!.guardians.map((g) => emptyGuardian(g))
    : [];
  const seenGuardians = new Set<string>();
  const guardians: AdmissionGuardian[] = [];
  for (const g of rawGuardians) {
    const name = (g.fullName || "").trim();
    if (!name) continue;
    const key = `${name.toLowerCase()}:${(g.relation || "other").toLowerCase()}`;
    if (seenGuardians.has(key)) continue;
    seenGuardians.add(key);
    guardians.push(g);
  }
  return {
    id: partial?.id || nid("ahh"),
    code: partial?.code || "",
    primaryMobile: normalizeMobile(partial?.primaryMobile || ""),
    whatsapp: normalizeMobile(partial?.whatsapp || ""),
    email: partial?.email || "",
    locality: partial?.locality || "",
    address: partial?.address || "",
    city: partial?.city || "Varanasi",
    state: partial?.state || "Uttar Pradesh",
    pincode: (partial?.pincode || "").replace(/\D/g, "").slice(0, 6),
    guardians,
    sisHouseholdId: partial?.sisHouseholdId || "",
    note: partial?.note || "",
    createdAt: partial?.createdAt || now,
    updatedAt: partial?.updatedAt || now,
  };
}

export function emptyAdmissionLead(
  partial?: Partial<AdmissionLead>,
): AdmissionLead {
  const now = new Date().toISOString();
  return {
    id: partial?.id || nid("adm"),
    householdId: partial?.householdId || "",
    enquiryNo: partial?.enquiryNo || "",
    applicationNo: partial?.applicationNo || "",
    stage: partial?.stage || "enquiry",
    academicYearCode: partial?.academicYearCode || ayCode(),
    source: partial?.source || "walk_in",
    childName: cleanRepeatedName(partial?.childName || ""),
    dob: partial?.dob || "",
    ageYearsApprox: (() => {
      const n = Number(partial?.ageYearsApprox ?? 0);
      // A child's stated age above 25 is a typo or the parent's own age.
      return Number.isFinite(n) && n > 0 && n <= 25 ? Math.round(n * 10) / 10 : 0;
    })(),
    gender: partial?.gender || "",
    classSoughtId: partial?.classSoughtId || "",
    classAdmittedId: partial?.classAdmittedId || "",
    sectionId: partial?.sectionId || "",
    medium: partial?.medium || "English",
    admissionKind: partial?.admissionKind || "new",
    guardianName: cleanRepeatedName(partial?.guardianName || ""),
    motherName: cleanRepeatedName(partial?.motherName || ""),
    mobile: normalizeMobile(partial?.mobile || ""),
    whatsappSame: partial?.whatsappSame !== false,
    whatsapp: normalizeMobile(partial?.whatsapp || ""),
    email: partial?.email || "",
    fatherOccupation: partial?.fatherOccupation || "",
    category: partial?.category || "",
    locality: partial?.locality || "",
    address: partial?.address || "",
    city: partial?.city || "Varanasi",
    state: partial?.state || "Uttar Pradesh",
    pincode: (partial?.pincode || "").replace(/\D/g, "").slice(0, 6),
    previousSchool: partial?.previousSchool || "",
    previousTcNo: partial?.previousTcNo || "",
    transportInterest: partial?.transportInterest || "undecided",
    siblingInSchool: !!partial?.siblingInSchool,
    referredByStaffId: partial?.referredByStaffId || "",
    campaignNote: partial?.campaignNote || "",
    campaignId: String(partial?.campaignId || "").trim().slice(0, 80),
    preferredLanguage: normalizeHouseholdLanguage(partial?.preferredLanguage),
    previousBoard: String(partial?.previousBoard || "").trim().slice(0, 40),
    concerns: Array.isArray(partial?.concerns)
      ? Array.from(
          new Set(
            partial!.concerns.map((c) => String(c || "").trim().toLowerCase().slice(0, 40)).filter(Boolean),
          ),
        ).slice(0, 12)
      : [],
    referredByHouseholdId: String(partial?.referredByHouseholdId || "").trim().slice(0, 40),
    referralCode: String(partial?.referralCode || "").trim().toUpperCase().slice(0, 20),
    declarationAccepted: !!partial?.declarationAccepted,
    registrationFeePaid: !!partial?.registrationFeePaid,
    registrationFeeNote: partial?.registrationFeeNote || "",
    docsBirthCert: !!partial?.docsBirthCert,
    docsPhoto: !!partial?.docsPhoto,
    docsAadhaar: !!partial?.docsAadhaar,
    docsTc: !!partial?.docsTc,
    docsCategory: !!partial?.docsCategory,
    admissionDate: partial?.admissionDate || "",
    admissionNo: partial?.admissionNo || "",
    studentId: partial?.studentId || "",
    sisMatch:
      partial?.sisMatch === "admitted" || partial?.sisMatch === "suspected"
        ? partial.sisMatch
        : "",
    sisStudentId: partial?.sisStudentId || "",
    sisStudentStatus: partial?.sisStudentStatus || "",
    sisStudentInfo: partial?.sisStudentInfo || "",
    sisMatchKind: partial?.sisMatchKind || "",
    sisMismatchNotes: Array.isArray(partial?.sisMismatchNotes)
      ? partial!.sisMismatchNotes.map((n) => String(n || "").trim()).filter(Boolean)
      : [],
    sisReviewStatus:
      partial?.sisReviewStatus === "keep_open" ||
      partial?.sisReviewStatus === "closed_not_match" ||
      partial?.sisReviewStatus === "verified"
        ? partial.sisReviewStatus
        : "",
    sisDismissedStudentId: partial?.sisDismissedStudentId || "",
    whatsappDisplayName: (partial?.whatsappDisplayName || "").trim(),
    whatsappWaId: (partial?.whatsappWaId || "").replace(/\D/g, ""),
    feeGroupId: partial?.feeGroupId || "",
    rte: !!partial?.rte,
    rteGovtApplicationNo: (partial?.rteGovtApplicationNo || "").trim(),
    penStatus: partial?.penStatus || "to_register",
    note: partial?.note || "",
    lostReason: partial?.lostReason || "",
    assignedTo: (partial?.assignedTo || "").trim(),
    nextFollowUpAt: (partial?.nextFollowUpAt || "").slice(0, 10),
    lastFollowUpAt: partial?.lastFollowUpAt || "",
    followUps: Array.isArray(partial?.followUps)
      ? partial!.followUps.map((f) => emptyFollowUp(f))
      : [],
    leadDate:
      (partial?.leadDate || "").slice(0, 10) ||
      (partial?.createdAt || now).slice(0, 10),
    registrationDate: (partial?.registrationDate || "").slice(0, 10),
    registrationFeeHeadId: partial?.registrationFeeHeadId || "",
    registrationFeeAmountPaise: Math.max(
      0,
      Math.round(Number(partial?.registrationFeeAmountPaise) || 0),
    ),
    registrationPaymentId: partial?.registrationPaymentId || "",
    registrationPaymentStatus:
      partial?.registrationPaymentStatus === "pending" ||
      partial?.registrationPaymentStatus === "partial" ||
      partial?.registrationPaymentStatus === "paid" ||
      partial?.registrationPaymentStatus === "waived"
        ? partial.registrationPaymentStatus
        : partial?.registrationFeePaid
          ? "paid"
          : "none",
    parentGroupKey:
      normalizeMobile(partial?.parentGroupKey || partial?.mobile || "") ||
      "",
    surveyBeatId: partial?.surveyBeatId || "",
    surveyPhotoUrl: sanitizeSurveyPhotoUrl(partial?.surveyPhotoUrl),
    parentConsentAt: partial?.parentConsentAt || "",
    parentConsentBy: partial?.parentConsentBy || "",
    createdAt: partial?.createdAt || now,
    updatedAt: partial?.updatedAt || now,
    createdBy: partial?.createdBy || "",
  };
}

export function normalizeAdmissionLead(
  raw: Partial<AdmissionLead> | null | undefined,
): AdmissionLead {
  const lead = emptyAdmissionLead(raw || undefined);

  // Carry the provenance marker through normalization.
  //
  // emptyAdmissionLead builds a fresh object literal field by field — it never
  // spreads `...raw` — so every key it does not name is dropped. `__partial`
  // is not a data field, so it was being silently discarded here, and that
  // quietly disabled the entire projection safety net:
  //
  //   projected list  -> lead marked __partial
  //   user saves      -> normalizeAdmissionsState strips the marker
  //   push            -> server sees no stub, merges nothing
  //   result          -> the stub overwrites the record, 59 fields blanked
  //                      on every lead
  //
  // The marker has to survive exactly as far as the write path that reads it.
  // Found before the flag was ever turned on, by walking the components rather
  // than trusting that the guard would fire.
  if ((raw as { __partial?: boolean } | null | undefined)?.__partial) {
    (lead as { __partial?: boolean }).__partial = true;
  }
  return lead;
}

export function normalizeAdmissionHousehold(
  raw: Partial<AdmissionHousehold> | null | undefined,
): AdmissionHousehold {
  return emptyAdmissionHousehold(raw || undefined);
}

export function defaultAdmissionsState(): AdmissionsState {
  return {
    version: 1,
    households: [],
    leads: [],
    registrationPayments: [],
    surveyBeats: seedSurveyBeats(),
    surveyAttendance: [],
    surveyExternals: [],
    surveyTeam: [],
    surveySessions: [],
    leadCallerStaffIds: [],
    nextEnquirySeq: 1,
    nextApplicationSeq: 1,
    nextHouseholdSeq: 1,
    nextRegPaySeq: 1,
    nextBeatSeq: 5,
  };
}

function emptySurveyBeat(partial?: Partial<SurveyBeat>): SurveyBeat {
  const now = new Date().toISOString();
  return {
    id: partial?.id || nid("sbt"),
    code: partial?.code || "",
    name: (partial?.name || "").trim(),
    area: (partial?.area || "").trim(),
    targetHouseholds: Math.max(
      0,
      Math.round(Number(partial?.targetHouseholds) || 0),
    ),
    isActive: partial?.isActive !== false,
    note: partial?.note || "",
    createdAt: partial?.createdAt || now,
  };
}

function emptySurveyAttendance(
  partial?: Partial<SurveyAttendance>,
): SurveyAttendance {
  return {
    id: partial?.id || nid("sat"),
    date: (partial?.date || today()).slice(0, 10),
    agentName: (partial?.agentName || "").trim(),
    checkInAt: partial?.checkInAt || "",
    checkOutAt: partial?.checkOutAt || "",
    beatId: partial?.beatId || "",
    note: partial?.note || "",
  };
}

function emptySurveyExternal(
  partial?: Partial<SurveyExternalAgent>,
): SurveyExternalAgent {
  return {
    id: partial?.id || nid("sve"),
    fullName: (partial?.fullName || "").trim(),
    mobile: (partial?.mobile || "").replace(/\D/g, "").slice(0, 10),
    note: partial?.note || "",
    createdAt: partial?.createdAt || new Date().toISOString(),
  };
}

function emptySurveyTeamMember(
  partial?: Partial<SurveyTeamMember>,
): SurveyTeamMember {
  const kind = partial?.kind === "external" ? "external" : "staff";
  return {
    id: partial?.id || nid("stm"),
    kind,
    staffId: kind === "staff" ? partial?.staffId || "" : "",
    externalId: kind === "external" ? partial?.externalId || "" : "",
    fullName: (partial?.fullName || "").trim(),
    mobile: (partial?.mobile || "").replace(/\D/g, "").slice(0, 10),
    empCode: partial?.empCode || "",
    role: partial?.role === "leader" ? "leader" : "agent",
    assigned: partial?.assigned !== false,
    createdAt: partial?.createdAt || new Date().toISOString(),
  };
}

function emptySurveyGeo(
  partial?: Partial<SurveyGeoPoint> | null,
): SurveyGeoPoint | null {
  if (!partial || !Number.isFinite(Number(partial.lat)) || !Number.isFinite(Number(partial.lng))) {
    return null;
  }
  return {
    lat: Number(partial.lat),
    lng: Number(partial.lng),
    accuracyM: Math.max(0, Math.round(Number(partial.accuracyM) || 0)),
    at: partial.at || new Date().toISOString(),
  };
}

function emptySurveyBreak(partial?: Partial<SurveyBreak>): SurveyBreak {
  return {
    id: partial?.id || nid("sbk"),
    startedAt: partial?.startedAt || "",
    endedAt: partial?.endedAt || "",
    startGeo: emptySurveyGeo(partial?.startGeo),
    endGeo: emptySurveyGeo(partial?.endGeo),
  };
}

function emptySurveyWorkSession(
  partial?: Partial<SurveyWorkSession>,
): SurveyWorkSession {
  const status =
    partial?.status === "ended" || partial?.status === "on_break"
      ? partial.status
      : "active";
  return {
    id: partial?.id || nid("sws"),
    date: (partial?.date || today()).slice(0, 10),
    memberId: partial?.memberId || "",
    agentName: (partial?.agentName || "").trim(),
    staffId: partial?.staffId || "",
    beatId: partial?.beatId || "",
    startedAt: partial?.startedAt || "",
    endedAt: partial?.endedAt || "",
    startGeo: emptySurveyGeo(partial?.startGeo),
    endGeo: emptySurveyGeo(partial?.endGeo),
    breaks: (Array.isArray(partial?.breaks) ? partial!.breaks : []).map((b) =>
      emptySurveyBreak(b),
    ),
    status,
  };
}

function seedSurveyBeats(): SurveyBeat[] {
  const now = new Date().toISOString();
  return [
    { code: "BT-01", name: "Murdaha", area: "West Varanasi", target: 80 },
    { code: "BT-02", name: "Lanka", area: "BHU side", target: 60 },
    { code: "BT-03", name: "Sigra", area: "Central", target: 50 },
    { code: "BT-04", name: "Cantt", area: "Cantonment", target: 40 },
  ].map((s, i) =>
    emptySurveyBeat({
      id: `sbt_seed_${i + 1}`,
      code: s.code,
      name: s.name,
      area: s.area,
      targetHouseholds: s.target,
      createdAt: now,
    }),
  );
}

/** Backfill households from legacy leads that only had mobile+guardian fields. */
function backfillHouseholds(state: AdmissionsState): AdmissionsState {
  const households = [...state.households];
  let nextHh = state.nextHouseholdSeq;
  const leads = state.leads.map((lead) => {
    if (lead.householdId && households.some((h) => h.id === lead.householdId)) {
      return lead;
    }
    const mobile = normalizeMobile(lead.mobile);
    let hh = mobile
      ? households.find((h) => h.primaryMobile === mobile)
      : undefined;
    if (!hh && mobile) {
      const now = new Date().toISOString();
      const code = `AHH-${String(nextHh).padStart(4, "0")}`;
      nextHh += 1;
      const guardians: AdmissionGuardian[] = [];
      if (lead.guardianName.trim()) {
        guardians.push(
          emptyGuardian({
            fullName: lead.guardianName,
            relation: "father",
            mobile,
            whatsapp: lead.whatsapp || mobile,
            email: lead.email,
            occupation: lead.fatherOccupation,
            isPrimary: true,
          }),
        );
      }
      if (lead.motherName.trim()) {
        guardians.push(
          emptyGuardian({
            fullName: lead.motherName,
            relation: "mother",
            mobile: "",
            isPrimary: false,
          }),
        );
      }
      hh = emptyAdmissionHousehold({
        id: nid("ahh"),
        code,
        primaryMobile: mobile,
        whatsapp: lead.whatsapp || mobile,
        email: lead.email,
        locality: lead.locality,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        pincode: lead.pincode,
        guardians,
        createdAt: lead.createdAt || now,
        updatedAt: now,
      });
      households.push(hh);
    }
    return hh
      ? normalizeAdmissionLead({ ...lead, householdId: hh.id })
      : lead;
  });
  return {
    ...state,
    households,
    leads,
    nextHouseholdSeq: nextHh,
  };
}

export function normalizeAdmissionsState(
  raw?: Partial<AdmissionsState> | null,
): AdmissionsState {
  const d = defaultAdmissionsState();
  if (!raw) return d;
  let surveyBeats = (
    Array.isArray(raw.surveyBeats) ? raw.surveyBeats : []
  ).map((b) => emptySurveyBeat(b));
  if (surveyBeats.length === 0) surveyBeats = seedSurveyBeats();
  const surveyAttendance = (
    Array.isArray(raw.surveyAttendance) ? raw.surveyAttendance : []
  ).map((a) => emptySurveyAttendance(a));
  const surveyExternals = (
    Array.isArray(raw.surveyExternals) ? raw.surveyExternals : []
  ).map((e) => emptySurveyExternal(e));
  const surveyTeam = (
    Array.isArray(raw.surveyTeam) ? raw.surveyTeam : []
  ).map((m) => emptySurveyTeamMember(m));
  const surveySessions = (
    Array.isArray(raw.surveySessions) ? raw.surveySessions : []
  ).map((s) => emptySurveyWorkSession(s));
  const base: AdmissionsState = {
    version: 1,
    households: (Array.isArray(raw.households) ? raw.households : []).map(
      (h) => normalizeAdmissionHousehold(h),
    ),
    leads: (Array.isArray(raw.leads) ? raw.leads : []).map((l) =>
      normalizeAdmissionLead(l),
    ),
    registrationPayments: (
      Array.isArray(raw.registrationPayments) ? raw.registrationPayments : []
    ).map((p) => normalizeRegistrationPayment(p)),
    surveyBeats,
    surveyAttendance,
    surveyExternals,
    surveyTeam,
    surveySessions,
    leadCallerStaffIds: (
      Array.isArray(raw.leadCallerStaffIds) ? raw.leadCallerStaffIds : []
    )
      .map((id) => String(id || "").trim())
      .filter(Boolean),
    nextEnquirySeq:
      Number.isFinite(Number(raw.nextEnquirySeq)) && Number(raw.nextEnquirySeq) > 0
        ? Math.round(Number(raw.nextEnquirySeq))
        : d.nextEnquirySeq,
    nextApplicationSeq:
      Number.isFinite(Number(raw.nextApplicationSeq)) &&
      Number(raw.nextApplicationSeq) > 0
        ? Math.round(Number(raw.nextApplicationSeq))
        : d.nextApplicationSeq,
    nextHouseholdSeq:
      Number.isFinite(Number(raw.nextHouseholdSeq)) &&
      Number(raw.nextHouseholdSeq) > 0
        ? Math.round(Number(raw.nextHouseholdSeq))
        : d.nextHouseholdSeq,
    nextRegPaySeq:
      Number.isFinite(Number(raw.nextRegPaySeq)) && Number(raw.nextRegPaySeq) > 0
        ? Math.round(Number(raw.nextRegPaySeq))
        : d.nextRegPaySeq,
    nextBeatSeq:
      Number.isFinite(Number(raw.nextBeatSeq)) && Number(raw.nextBeatSeq) > 0
        ? Math.round(Number(raw.nextBeatSeq))
        : Math.max(d.nextBeatSeq, surveyBeats.length + 1),
  };
  return backfillHouseholds(base);
}

function isTenderMode(v: string | undefined | null): v is TenderMode {
  return TENDER_MODES.some((m) => m.value === v);
}

function normalizeRegistrationTender(
  raw: Partial<RegistrationTender> | null | undefined,
): RegistrationTender {
  return {
    mode: isTenderMode(raw?.mode) ? raw!.mode : "cash",
    amountPaise: Math.max(0, Math.round(Number(raw?.amountPaise) || 0)),
    ref: (raw?.ref || "").trim(),
    bankName: (raw?.bankName || "").trim(),
    instrumentDate: (raw?.instrumentDate || "").slice(0, 10),
  };
}

export function normalizeRegistrationPayment(
  raw: Partial<RegistrationFeePayment> | null | undefined,
): RegistrationFeePayment {
  const now = new Date().toISOString();
  const modeRaw = raw?.mode;
  const mode: RegistrationFeePayment["mode"] =
    modeRaw === "upi_link" ||
    modeRaw === "waived" ||
    modeRaw === "counter" ||
    isTenderMode(modeRaw)
      ? modeRaw
      : "counter";
  const tenders = Array.isArray(raw?.tenders)
    ? raw!.tenders.map((t) => normalizeRegistrationTender(t))
    : [];
  return {
    id: raw?.id || nid("rfp"),
    code: raw?.code || "",
    leadId: raw?.leadId || "",
    feeHeadId: raw?.feeHeadId || "",
    feeHeadName: raw?.feeHeadName || "",
    amountPaise: Math.max(0, Math.round(Number(raw?.amountPaise) || 0)),
    status:
      raw?.status === "paid" ||
      raw?.status === "cancelled" ||
      raw?.status === "waived"
        ? raw.status
        : "open",
    mode,
    tenders,
    mobile: normalizeMobile(raw?.mobile || ""),
    childName: (raw?.childName || "").trim(),
    createdAt: raw?.createdAt || now,
    paidAt: raw?.paidAt || "",
    upiRef: raw?.upiRef || "",
    createdBy: raw?.createdBy || "",
    note: raw?.note || "",
    feeVoucherId: raw?.feeVoucherId || "",
    feeReceiptNo: raw?.feeReceiptNo || "",
    ledgerDueKey: raw?.ledgerDueKey || "",
    ledgerPostedAt: raw?.ledgerPostedAt || "",
  };
}

/** Sum of paid installment rows for a lead (excludes open / waived). */
export function registrationCollectedPaise(
  state: AdmissionsState,
  leadId: string,
): number {
  return (state.registrationPayments || [])
    .filter((p) => p.leadId === leadId && p.status === "paid")
    .reduce((s, p) => s + p.amountPaise, 0);
}

export function registrationBalancePaise(
  state: AdmissionsState,
  lead: Pick<AdmissionLead, "id" | "registrationFeeAmountPaise">,
): number {
  return Math.max(
    0,
    lead.registrationFeeAmountPaise - registrationCollectedPaise(state, lead.id),
  );
}

export function listLeadRegistrationPayments(
  state: AdmissionsState,
  leadId: string,
): RegistrationFeePayment[] {
  return (state.registrationPayments || [])
    .filter((p) => p.leadId === leadId)
    .sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt));
}

function refreshLeadRegistrationPaymentStatus(
  state: AdmissionsState,
  leadId: string,
  note?: string,
): AdmissionsState {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return state;
  const waived = (state.registrationPayments || []).some(
    (p) => p.leadId === leadId && p.status === "waived",
  );
  if (waived) {
    return updateLead(state, leadId, {
      registrationFeePaid: true,
      registrationPaymentStatus: "waived",
      ...(note != null ? { registrationFeeNote: note } : {}),
    });
  }
  const collected = registrationCollectedPaise(state, leadId);
  const total = lead.registrationFeeAmountPaise;
  const pendingOpen = (state.registrationPayments || []).some(
    (p) => p.leadId === leadId && p.status === "open",
  );
  if (total > 0 && collected >= total) {
    return updateLead(state, leadId, {
      registrationFeePaid: true,
      registrationPaymentStatus: "paid",
      ...(note != null ? { registrationFeeNote: note } : {}),
    });
  }
  if (collected > 0) {
    return updateLead(state, leadId, {
      registrationFeePaid: false,
      registrationPaymentStatus: "partial",
      ...(note != null ? { registrationFeeNote: note } : {}),
    });
  }
  if (pendingOpen) {
    return updateLead(state, leadId, {
      registrationFeePaid: false,
      registrationPaymentStatus: "pending",
      ...(note != null ? { registrationFeeNote: note } : {}),
    });
  }
  return updateLead(state, leadId, {
    registrationFeePaid: false,
    registrationPaymentStatus: "none",
    ...(note != null ? { registrationFeeNote: note } : {}),
  });
}

/**
 * Admissions, held in memory, independent of localStorage.
 *
 * The same rule SIS needed, and admissions needed it MORE: at 2.37 MB it is
 * the largest module in the app. A browser caps an origin at roughly 5 MB, so
 * the cache write can simply fail — and then loadAdmissions() read
 * localStorage, found nothing, and returned zero leads while the database
 * held 919 and the server was sending every one of them.
 *
 * This was fixed for SIS on 2026-08-10 and not for admissions in the same
 * change, so the blank screen moved from one module to the other instead of
 * going away. The two modules are the only large ones; both need it.
 *
 * Memory is the record for the session. localStorage is a best-effort copy
 * for the next page load, and losing it must cost a reload, never the data.
 */
let memoryAdmissionsState: AdmissionsState | null = null;

export function loadAdmissions(): AdmissionsState {
  if (typeof window === "undefined") {
    if (serverAdmissionsCache) return serverAdmissionsCache;
    const mirrored = getSchoolMirrorSync().admissions as
      | Partial<AdmissionsState>
      | null;
    if (mirrored && Array.isArray(mirrored.leads)) {
      return normalizeAdmissionsState(mirrored);
    }
    return defaultAdmissionsState();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // A cache too small to hold 2.37 MB must not read as "no leads".
    if (!raw) return memoryAdmissionsState ?? defaultAdmissionsState();
    return normalizeAdmissionsState(
      JSON.parse(raw) as Partial<AdmissionsState>,
    );
  } catch {
    return memoryAdmissionsState ?? defaultAdmissionsState();
  }
}

/**
 * Keep image data out of lead rows.
 *
 * A survey photo belongs in object storage with a URL on the lead. A `data:`
 * URL is the image itself — roughly 200 KB of base64 for one compressed
 * photo, which is more than the entire 919-lead list projection, carried
 * inside `lead_json` on every admissions read and every localStorage write.
 *
 * objectStorage.uploadSchoolObject has a `local` mode that RETURNS a data URL
 * when no bucket is configured. That is fine for an on-screen preview and
 * must never be persisted, so the check is here at the boundary rather than
 * trusting each caller to remember which mode it got back.
 */
/**
 * Refuse to overwrite a complete lead with a projected one.
 *
 * Stage 6 replaces the 2.37 MB whole-table read with a projection: only the
 * ~20 promoted columns, not `lead_json`. rowToLead() already rebuilds a lead
 * from those columns when lead_json is absent — but AdmissionLead has 79
 * fields and 59 of them live ONLY in lead_json: dob, gender, address,
 * motherName, email, the document checklist, the admission details.
 *
 * So a projected lead is a stub. Saving one back would blank 59 fields on a
 * real child's record. That is the same shape as the failure that orphaned
 * 711 students today — a partial value overwriting a complete one — and it is
 * the reason the projection cannot simply be switched on.
 *
 * This lands BEFORE detail-on-demand, deliberately. Nothing produces partial
 * leads yet, so today it changes nothing; it means the read-path work can
 * proceed without the possibility of silently destroying records.
 */
/**
 * Get the complete lead before editing it.
 *
 * The admissions list is projected — 20 of 79 fields — so a lead taken
 * straight from it is a stub. Anything that opens a lead for editing must
 * call this first, or the form shows blank dob, address, documents and 55
 * other fields, and the user "corrects" them by filling in nothing.
 *
 * Returns the lead unchanged when it is already complete, so this is safe to
 * call unconditionally and costs one request only when it is needed.
 *
 * Throws on a read failure rather than returning the stub. Editing a record
 * you could not read is how fields get blanked — the server-side merge in
 * restorePartialLeads is the backstop, but the user should not be shown empty
 * fields and asked to trust them.
 */
export async function ensureFullLead(
  lead: AdmissionLead,
): Promise<AdmissionLead> {
  if (!isPartialLead(lead)) return lead;

  const res = await fetch(
    `/api/school-data/admissions-desk?leadId=${encodeURIComponent(lead.id)}`,
    { cache: "no-store" },
  );
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    lead?: AdmissionLead;
    error?: string;
  } | null;

  if (!res.ok || !body?.ok || !body.lead) {
    throw new Error(
      body?.error ??
        `Could not load the full record for this lead (${res.status}).`,
    );
  }
  return body.lead;
}

export function isPartialLead(lead: unknown): boolean {
  return !!(lead as { __partial?: boolean })?.__partial;
}

/**
 * Merge a projected lead over the copy already held, keeping every field the
 * projection did not carry. Returns the existing record untouched when the
 * incoming one is a stub and nothing is known to be newer.
 */
export function mergeProjectedLead(
  existing: AdmissionLead | undefined,
  incoming: AdmissionLead,
): AdmissionLead {
  if (!existing) return incoming;
  if (!isPartialLead(incoming)) return incoming;
  // Projection wins only for the columns it actually carries; everything else
  // is preserved from the full record.
  const merged = { ...existing } as Record<string, unknown>;
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "__partial") continue;
    if (v !== undefined && v !== null && v !== "") merged[k] = v;
  }
  return merged as AdmissionLead;
}

export function sanitizeSurveyPhotoUrl(value?: string | null): string {
  // One rule for every stored image in the app; see lib/media.ts.
  return sanitizeStoredMediaUrl(value, "admissions survey photo");
}

export function saveAdmissions(state: AdmissionsState): void {
  const normalized = normalizeAdmissionsState(state);

  if (typeof window !== "undefined") {
    if (!assertModulePermission("admissions", "edit", "saveAdmissions")) return;
  }

  if (typeof window === "undefined") {
    writeAdmissionsLocalRaw(normalized);
    void import("@/lib/admissionsPersistence").then(({ scheduleAdmissionsSync }) => {
      scheduleAdmissionsSync(normalized);
    });
    return;
  }
  // The database write is scheduled FIRST, and never depends on the cache.
  //
  // These three lines used to run in the opposite order, and on a phone that
  // silently cost the save: writeAdmissionsLocalRaw threw QuotaExceededError
  // on a 2.37 MB payload, so neither sync below ever ran. A full cache stopped
  // the record from being written at all. See lib/browserStorage.ts.
  scheduleClientSchoolMirrorSync({ admissions: normalized });
  void import("@/lib/admissionsPersistence").then(({ scheduleAdmissionsSync }) => {
    scheduleAdmissionsSync(normalized);
  });
  writeAdmissionsLocalRaw(normalized);
}

/** Hydrate path — localStorage only, no cloud schedule. */
export function writeAdmissionsLocalRaw(state: AdmissionsState): void {
  const normalized = normalizeAdmissionsState(state);
  if (typeof window === "undefined") {
    serverAdmissionsCache = normalized;
    setMirrorSlice("admissions", normalized);
    return;
  }
  // Caching only. A browser that cannot hold 2.37 MB drops the entry and the
  // module re-reads from the database — which is the intended behaviour under
  // the no-offline decision anyway. It must not throw: this is called from
  // saveAdmissions, and an exception here used to abort the save.
  // Memory first and unconditionally, so a cache that cannot hold this
  // still leaves the leads readable for the rest of the session.
  memoryAdmissionsState = normalized;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(normalized));
}

export function admissionsStateIsEmpty(state: AdmissionsState): boolean {
  return (state.leads?.length ?? 0) === 0 && (state.households?.length ?? 0) === 0;
}

const ADMISSIONS_MIRROR_META = "bhb_admissions_mirror_meta_v1";

function readAdmissionsMirrorMeta(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(ADMISSIONS_MIRROR_META);
    if (!raw) return "";
    return String((JSON.parse(raw) as { updatedAt?: string }).updatedAt || "");
  } catch {
    return "";
  }
}

function writeAdmissionsMirrorMeta(iso: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMISSIONS_MIRROR_META, JSON.stringify({ updatedAt: iso }));
}

export function hydrateAdmissionsFromMirror(
  raw: unknown,
  remoteAt: string,
  remoteIsNewer: boolean,
): boolean {
  if (!raw || typeof raw !== "object") return false;
  const local = loadAdmissions();
  const localAt = readAdmissionsMirrorMeta();
  const remoteLeads = (raw as AdmissionsState).leads?.length ?? 0;
  const localLeads = local.leads?.length ?? 0;
  const takeRemote =
    remoteIsNewer ||
    admissionsStateIsEmpty(local) ||
    (remoteLeads > localLeads && remoteLeads > 0) ||
    !localAt ||
    (remoteAt && remoteAt > localAt);
  if (!takeRemote) return false;
  writeAdmissionsLocalRaw(raw as AdmissionsState);
  writeAdmissionsMirrorMeta(remoteAt || new Date().toISOString());
  scheduleClientSchoolMirrorSync({ admissions: raw });
  return true;
}

function padSeq(n: number) {
  return String(n).padStart(4, "0");
}

export function allocateEnquiryNo(
  state: AdmissionsState,
  captureYear?: string,
): {
  no: string;
  next: number;
} {
  const year = (captureYear || ayCode()).slice(0, 4);
  const seq = state.nextEnquirySeq;
  return { no: `ENQ-${year}-${padSeq(seq)}`, next: seq + 1 };
}

export function allocateApplicationNo(state: AdmissionsState): {
  no: string;
  next: number;
} {
  const year = ayCode().slice(0, 4);
  const seq = state.nextApplicationSeq;
  return { no: `APP-${year}-${padSeq(seq)}`, next: seq + 1 };
}

export function householdOf(
  state: AdmissionsState,
  householdId: string,
): AdmissionHousehold | undefined {
  return state.households.find((h) => h.id === householdId);
}

export function findHouseholdByMobile(
  state: AdmissionsState,
  mobile: string,
): AdmissionHousehold | undefined {
  const m = normalizeMobile(mobile);
  if (m.length !== 10) return undefined;
  return state.households.find(
    (h) =>
      h.primaryMobile === m ||
      h.guardians.some((g) => g.mobile === m || g.whatsapp === m),
  );
}

export function siblingsOfHousehold(
  state: AdmissionsState,
  householdId: string,
  exceptLeadId?: string,
): AdmissionLead[] {
  return state.leads.filter(
    (l) =>
      l.householdId === householdId &&
      l.id !== exceptLeadId &&
      l.stage !== "lost",
  );
}

function primaryGuardian(hh: AdmissionHousehold): AdmissionGuardian | undefined {
  return hh.guardians.find((g) => g.isPrimary) || hh.guardians[0];
}

function motherFromHousehold(hh: AdmissionHousehold): AdmissionGuardian | undefined {
  return hh.guardians.find((g) => g.relation === "mother");
}

function syncLeadFromHousehold(
  lead: AdmissionLead,
  hh: AdmissionHousehold,
): AdmissionLead {
  const primary = primaryGuardian(hh);
  const mother = motherFromHousehold(hh);
  return normalizeAdmissionLead({
    ...lead,
    householdId: hh.id,
    guardianName: primary?.fullName || lead.guardianName,
    motherName: mother?.fullName || lead.motherName,
    mobile: hh.primaryMobile || primary?.mobile || lead.mobile,
    whatsapp: hh.whatsapp || primary?.whatsapp || lead.whatsapp,
    email: hh.email || primary?.email || lead.email,
    fatherOccupation:
      primary?.occupation ||
      hh.guardians.find((g) => g.relation === "father")?.occupation ||
      lead.fatherOccupation,
    locality: hh.locality || lead.locality,
    address: hh.address || lead.address,
    city: hh.city || lead.city,
    state: hh.state || lead.state,
    pincode: hh.pincode || lead.pincode,
  });
}

function ensureGuardiansFromDraft(
  existing: AdmissionGuardian[],
  draft: Partial<AdmissionLead>,
): AdmissionGuardian[] {
  const guardians = [...existing];
  const mobile = normalizeMobile(draft.mobile || "");
  const fatherName = (draft.guardianName || "").trim();
  const motherName = (draft.motherName || "").trim();

  if (fatherName) {
    const idx = guardians.findIndex(
      (g) =>
        g.relation === "father" ||
        (g.isPrimary && g.fullName.toLowerCase() === fatherName.toLowerCase()),
    );
    if (idx >= 0) {
      guardians[idx] = emptyGuardian({
        ...guardians[idx],
        fullName: fatherName,
        mobile: mobile || guardians[idx]!.mobile,
        whatsapp:
          draft.whatsappSame !== false
            ? mobile || guardians[idx]!.whatsapp
            : normalizeMobile(draft.whatsapp || "") || guardians[idx]!.whatsapp,
        email: draft.email || guardians[idx]!.email,
        occupation: draft.fatherOccupation || guardians[idx]!.occupation,
        isPrimary: true,
      });
    } else {
      guardians.push(
        emptyGuardian({
          fullName: fatherName,
          relation: "father",
          mobile,
          whatsapp:
            draft.whatsappSame !== false
              ? mobile
              : normalizeMobile(draft.whatsapp || ""),
          email: draft.email || "",
          occupation: draft.fatherOccupation || "",
          isPrimary: true,
        }),
      );
    }
  }

  if (motherName) {
    const idx = guardians.findIndex((g) => g.relation === "mother");
    if (idx >= 0) {
      guardians[idx] = emptyGuardian({
        ...guardians[idx],
        fullName: motherName,
      });
    } else {
      guardians.push(
        emptyGuardian({
          fullName: motherName,
          relation: "mother",
          isPrimary: false,
        }),
      );
    }
  }

  // Exactly one primary
  if (guardians.length && !guardians.some((g) => g.isPrimary)) {
    guardians[0] = { ...guardians[0]!, isPrimary: true };
  }
  return guardians;
}

export function createEnquiry(
  state: AdmissionsState,
  draft: Partial<AdmissionLead>,
  by: string,
  opts?: { allowMissingClass?: boolean; publicSubmit?: boolean },
):
  | { ok: true; state: AdmissionsState; lead: AdmissionLead; household: AdmissionHousehold; linkedExisting: boolean }
  | { ok: false; reason: string } {
  const childName = (draft.childName || "").trim();
  const guardianName = (draft.guardianName || "").trim();
  const mobile = normalizeMobile(draft.mobile || "");
  if (!childName) return { ok: false, reason: "Child name is required" };
  if (!guardianName) return { ok: false, reason: "Guardian name is required" };
  if (mobile.length !== 10) {
    return { ok: false, reason: "Guardian mobile must be 10 digits" };
  }
  if (!draft.classSoughtId && !opts?.allowMissingClass) {
    return { ok: false, reason: "Class sought is required" };
  }

  const dob = (draft.dob || "").slice(0, 10);
  if (dob) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutIso = cutoff.toISOString();
    const dup = state.leads.find(
      (l) =>
        l.stage !== "lost" &&
        l.childName.trim().toLowerCase() === childName.toLowerCase() &&
        l.dob === dob &&
        l.classSoughtId === draft.classSoughtId &&
        l.createdAt >= cutIso,
    );
    if (dup) {
      return {
        ok: false,
        reason: `Possible duplicate of ${dup.enquiryNo} (${dup.childName}) — use Add sibling on that household if same family`,
      };
    }
  }

  let households = [...state.households];
  let nextHh = state.nextHouseholdSeq;
  let linkedExisting = false;
  let hh = findHouseholdByMobile(state, mobile);

  if (hh) {
    linkedExisting = true;
    const guardians = ensureGuardiansFromDraft(hh.guardians, draft);
    hh = emptyAdmissionHousehold({
      ...hh,
      guardians,
      locality: draft.locality || hh.locality,
      address: draft.address || hh.address,
      city: draft.city || hh.city,
      state: draft.state || hh.state,
      pincode: draft.pincode || hh.pincode,
      whatsapp:
        draft.whatsappSame !== false
          ? mobile
          : normalizeMobile(draft.whatsapp || "") || hh.whatsapp,
      email: draft.email || hh.email,
      updatedAt: new Date().toISOString(),
    });
    households = households.map((h) => (h.id === hh!.id ? hh! : h));
  } else {
    const code = `AHH-${padSeq(nextHh)}`;
    nextHh += 1;
    hh = emptyAdmissionHousehold({
      id: nid("ahh"),
      code,
      primaryMobile: mobile,
      whatsapp:
        draft.whatsappSame !== false
          ? mobile
          : normalizeMobile(draft.whatsapp || ""),
      email: draft.email || "",
      locality: draft.locality || "",
      address: draft.address || "",
      city: draft.city || "Varanasi",
      state: draft.state || "Uttar Pradesh",
      pincode: draft.pincode || "",
      guardians: ensureGuardiansFromDraft([], draft),
    });
    households = [hh, ...households];
  }

  const leadDate =
    (draft.leadDate || "").slice(0, 10) || today();
  const academicYearCode = draft.academicYearCode || ayCode();
  const { no, next } = allocateEnquiryNo(state, academicYearCode);
  const now = new Date().toISOString();
  const digital = isDigitalCaptureSource(
    (draft.source as AdmissionSource) || "walk_in",
  );
  let lead = emptyAdmissionLead({
    ...draft,
    id: nid("adm"),
    enquiryNo: no,
    stage: draft.stage || "enquiry",
    academicYearCode,
    leadDate,
    childName,
    guardianName,
    mobile,
    householdId: hh.id,
    whatsapp: draft.whatsappSame !== false ? mobile : normalizeMobile(draft.whatsapp || ""),
    nextFollowUpAt:
      draft.nextFollowUpAt ||
      (digital || opts?.publicSubmit ? leadDate : draft.nextFollowUpAt || ""),
    createdAt: draft.createdAt || now,
    updatedAt: now,
    createdBy: by || (opts?.publicSubmit ? "Public form" : ""),
    siblingInSchool: linkedExisting || !!draft.siblingInSchool,
  });
  lead = syncLeadFromHousehold(lead, hh);

  return {
    ok: true,
    lead,
    household: hh,
    linkedExisting,
    state: {
      ...state,
      households,
      nextHouseholdSeq: nextHh,
      nextEnquirySeq: next,
      leads: [lead, ...state.leads],
    },
  };
}

/**
 * Add another child under an existing household — parents already on file.
 */
export function addSiblingEnquiry(
  state: AdmissionsState,
  householdId: string,
  child: {
    childName: string;
    dob?: string;
    /** Parent-stated age in years when no birth date is known. */
    ageYearsApprox?: number;
    gender?: string;
    classSoughtId: string;
    previousSchool?: string;
    transportInterest?: TransportInterest;
    source?: AdmissionSource;
    campaignNote?: string;
  },
  by: string,
):
  | { ok: true; state: AdmissionsState; lead: AdmissionLead }
  | { ok: false; reason: string } {
  const hh = householdOf(state, householdId);
  if (!hh) return { ok: false, reason: "Household not found" };
  const childName = child.childName.trim();
  if (!childName) return { ok: false, reason: "Child name is required" };
  if (!child.classSoughtId) {
    return { ok: false, reason: "Class sought is required" };
  }

  const { no, next } = allocateEnquiryNo(state);
  const now = new Date().toISOString();
  const primary = primaryGuardian(hh);
  let lead = emptyAdmissionLead({
    id: nid("adm"),
    householdId: hh.id,
    enquiryNo: no,
    stage: "enquiry",
    academicYearCode: ayCode(),
    leadDate: today(),
    source: child.source || "walk_in",
    childName,
    dob: child.dob || "",
    ageYearsApprox: child.ageYearsApprox || 0,
    gender: child.gender || "",
    classSoughtId: child.classSoughtId,
    previousSchool: child.previousSchool || "",
    transportInterest: child.transportInterest || "undecided",
    campaignNote: child.campaignNote || "",
    siblingInSchool: true,
    guardianName: primary?.fullName || "",
    motherName: motherFromHousehold(hh)?.fullName || "",
    mobile: hh.primaryMobile,
    createdAt: now,
    updatedAt: now,
    createdBy: by || "",
  });
  lead = syncLeadFromHousehold(lead, hh);

  return {
    ok: true,
    lead,
    state: {
      ...state,
      nextEnquirySeq: next,
      leads: [lead, ...state.leads],
    },
  };
}

export function addGuardian(
  state: AdmissionsState,
  householdId: string,
  guardian: Partial<AdmissionGuardian>,
):
  | { ok: true; state: AdmissionsState }
  | { ok: false; reason: string } {
  const hh = householdOf(state, householdId);
  if (!hh) return { ok: false, reason: "Household not found" };
  const name = (guardian.fullName || "").trim();
  if (!name) return { ok: false, reason: "Guardian name is required" };

  let guardians = [...hh.guardians];
  const makePrimary = !!guardian.isPrimary || guardians.length === 0;
  if (makePrimary) {
    guardians = guardians.map((g) => ({ ...g, isPrimary: false }));
  }
  const nameLower = name.toLowerCase();
  const existingIdx = guardians.findIndex(
    (g) => g.fullName.trim().toLowerCase() === nameLower,
  );
  if (existingIdx >= 0) {
    guardians[existingIdx] = emptyGuardian({
      ...guardians[existingIdx],
      ...guardian,
      fullName: name,
      isPrimary: makePrimary || guardians[existingIdx].isPrimary,
    });
  } else {
    guardians.push(
      emptyGuardian({
        ...guardian,
        fullName: name,
        isPrimary: makePrimary,
      }),
    );
  }

  const nextHh = emptyAdmissionHousehold({
    ...hh,
    guardians,
    primaryMobile:
      makePrimary && guardian.mobile
        ? normalizeMobile(guardian.mobile)
        : hh.primaryMobile,
    updatedAt: new Date().toISOString(),
  });

  const leads = state.leads.map((l) =>
    l.householdId === householdId ? syncLeadFromHousehold(l, nextHh) : l,
  );

  return {
    ok: true,
    state: {
      ...state,
      households: state.households.map((h) =>
        h.id === householdId ? nextHh : h,
      ),
      leads,
    },
  };
}

export function updateHousehold(
  state: AdmissionsState,
  householdId: string,
  patch: Partial<AdmissionHousehold>,
): AdmissionsState {
  const hh = householdOf(state, householdId);
  if (!hh) return state;
  const nextHh = emptyAdmissionHousehold({
    ...hh,
    ...patch,
    id: hh.id,
    code: hh.code,
    guardians: Array.isArray(patch.guardians)
      ? patch.guardians.map((g) => emptyGuardian(g))
      : hh.guardians,
    updatedAt: new Date().toISOString(),
  });
  return {
    ...state,
    households: state.households.map((h) =>
      h.id === householdId ? nextHh : h,
    ),
    leads: state.leads.map((l) =>
      l.householdId === householdId ? syncLeadFromHousehold(l, nextHh) : l,
    ),
  };
}

export function updateLead(
  state: AdmissionsState,
  leadId: string,
  patch: Partial<AdmissionLead>,
): AdmissionsState {
  return {
    ...state,
    leads: state.leads.map((l) =>
      l.id === leadId
        ? normalizeAdmissionLead({
            ...l,
            ...patch,
            id: l.id,
            enquiryNo: l.enquiryNo,
            householdId: patch.householdId || l.householdId,
            followUps: patch.followUps ?? l.followUps,
            updatedAt: new Date().toISOString(),
          })
        : l,
    ),
  };
}

/** Assign counsellor / calling agent ownership */
export function assignCounsellor(
  state: AdmissionsState,
  leadId: string,
  assignedTo: string,
): AdmissionsState {
  return updateLead(state, leadId, { assignedTo: assignedTo.trim() });
}

/**
 * Log a counsellor call / WhatsApp / visit and schedule the next follow-up.
 * Updates denormalized nextFollowUpAt + lastFollowUpAt for CRM filters.
 */
export function logFollowUp(
  state: AdmissionsState,
  leadId: string,
  input: {
    channel: FollowUpChannel;
    outcome: FollowUpOutcome;
    note: string;
    nextFollowUpAt: string;
    assignToSelf?: boolean;
  },
  by: string,
): { ok: true; state: AdmissionsState } | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.stage === "enrolled" || lead.stage === "lost") {
    return { ok: false, reason: "Cannot follow up closed leads" };
  }
  const nextDate = (input.nextFollowUpAt || "").slice(0, 10);
  const entry = emptyFollowUp({
    channel: input.channel,
    outcome: input.outcome,
    note: input.note,
    nextFollowUpAt: nextDate,
    by: by.trim() || "Counsellor",
  });
  const assignedTo =
    input.assignToSelf && by.trim()
      ? by.trim()
      : lead.assignedTo || by.trim();
  return {
    ok: true,
    state: updateLead(state, leadId, {
      followUps: [entry, ...(lead.followUps || [])],
      nextFollowUpAt: nextDate,
      lastFollowUpAt: entry.at,
      assignedTo,
    }),
  };
}

export function followUpCounts(state: AdmissionsState): {
  overdue: number;
  dueToday: number;
  unassigned: number;
} {
  let overdue = 0;
  let dueToday = 0;
  let unassigned = 0;
  for (const l of state.leads) {
    if (l.stage === "enrolled" || l.stage === "lost") continue;
    const bucket = leadFollowUpBucket(l);
    if (bucket === "overdue") overdue += 1;
    if (bucket === "due_today") dueToday += 1;
    if (!l.assignedTo.trim()) unassigned += 1;
  }
  return { overdue, dueToday, unassigned };
}

export function promoteToRegistration(
  state: AdmissionsState,
  leadId: string,
): { ok: true; state: AdmissionsState } | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.stage !== "enquiry" && lead.stage !== "applied") {
    return { ok: false, reason: "Only enquiry can move to registration" };
  }
  const hh = householdOf(state, lead.householdId);
  const mother =
    lead.motherName.trim() ||
    motherFromHousehold(hh || emptyAdmissionHousehold())?.fullName ||
    "";
  if (!mother.trim()) {
    return {
      ok: false,
      reason: "Add mother (or mother-relation guardian) on the household before registration",
    };
  }
  if (!lead.declarationAccepted) {
    return { ok: false, reason: "Parent declaration must be accepted" };
  }
  if (!lead.docsBirthCert || !lead.docsPhoto) {
    return {
      ok: false,
      reason: "Birth certificate and photo checklist must be marked",
    };
  }

  let nextState = state;
  let applicationNo = lead.applicationNo;
  let nextApp = state.nextApplicationSeq;
  if (!applicationNo) {
    const a = allocateApplicationNo(state);
    applicationNo = a.no;
    nextApp = a.next;
  }

  nextState = {
    ...nextState,
    nextApplicationSeq: nextApp,
  };
  nextState = updateLead(nextState, leadId, {
    stage: "applied",
    applicationNo,
    motherName: mother,
    classAdmittedId: lead.classAdmittedId || lead.classSoughtId,
    registrationDate: lead.registrationDate || today(),
  });
  return { ok: true, state: nextState };
}

export function markVerified(
  state: AdmissionsState,
  leadId: string,
): { ok: true; state: AdmissionsState } | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.stage !== "applied" && lead.stage !== "verified") {
    return { ok: false, reason: "Register the application first" };
  }
  if (!lead.registrationFeePaid) {
    return { ok: false, reason: "Mark registration fee paid (or note a waiver)" };
  }
  return {
    ok: true,
    state: updateLead(state, leadId, { stage: "verified" }),
  };
}

export function markLost(
  state: AdmissionsState,
  leadId: string,
  reason: string,
): AdmissionsState {
  return updateLead(state, leadId, {
    stage: "lost",
    lostReason: reason.trim() || "Withdrawn",
  });
}

/**
 * Merge several leads that share one mobile into a single open lead.
 * - Keeps the strongest lead (enrolled > verified > applied > enquiry; then earliest date)
 * - Combines unique child names into that lead's childName
 * - Records alternate guardian names in the note
 * - Moves survivors onto the keeper's household
 * - Marks the other leads Lost with a merge reason
 */
export function mergeLeadsSameMobile(
  state: AdmissionsState,
  leadIds: string[],
):
  | {
      ok: true;
      state: AdmissionsState;
      keeper: AdmissionLead;
      mergedCount: number;
      childNames: string[];
    }
  | { ok: false; reason: string } {
  const ids = [...new Set(leadIds.filter(Boolean))];
  const leads = ids
    .map((id) => state.leads.find((l) => l.id === id))
    .filter((l): l is AdmissionLead => !!l && l.stage !== "lost");

  if (leads.length < 2) {
    return { ok: false, reason: "Need at least two open leads to merge" };
  }

  const mobiles = [
    ...new Set(leads.map((l) => normalizeMobile(l.mobile)).filter(Boolean)),
  ];
  if (mobiles.length !== 1 || mobiles[0]!.length !== 10) {
    return {
      ok: false,
      reason: "All leads must share the same 10-digit mobile to merge",
    };
  }

  const stageRank = (s: AdmissionStage) => {
    switch (s) {
      case "enrolled":
        return 4;
      case "verified":
        return 3;
      case "applied":
        return 2;
      case "enquiry":
        return 1;
      default:
        return 0;
    }
  };

  const sorted = [...leads].sort((a, b) => {
    const ra = stageRank(a.stage);
    const rb = stageRank(b.stage);
    if (rb !== ra) return rb - ra;
    const da = (a.leadDate || a.createdAt || "").slice(0, 10);
    const db = (b.leadDate || b.createdAt || "").slice(0, 10);
    if (da !== db) return da.localeCompare(db);
    return a.enquiryNo.localeCompare(b.enquiryNo);
  });
  const keeper = sorted[0]!;
  const others = sorted.slice(1);

  // Unique child names (preserve order: keeper first, then others)
  const childNames: string[] = [];
  const seenChild = new Set<string>();
  for (const l of sorted) {
    for (const part of String(l.childName || "")
      .split(/[,;/|&]+/)
      .map((p) => p.trim())
      .filter(Boolean)) {
      const key = part.toLowerCase();
      if (seenChild.has(key)) continue;
      seenChild.add(key);
      childNames.push(part);
    }
  }

  const guardianNames = [
    ...new Set(
      sorted.map((l) => l.guardianName.trim()).filter(Boolean),
    ),
  ];
  // Prefer the longest guardian name as the display name (usually fuller spelling)
  const primaryGuardianName =
    [...guardianNames].sort((a, b) => b.length - a.length)[0] ||
    keeper.guardianName;

  const altGuardians = guardianNames.filter(
    (n) => n.toLowerCase() !== primaryGuardianName.toLowerCase(),
  );

  const mergedChildLabel = childNames.join(", ");
  const mergeNote = [
    `Merged ${others.length + 1} leads on ${mobiles[0]} into ${keeper.enquiryNo}`,
    `Children: ${mergedChildLabel}`,
    altGuardians.length
      ? `Alt guardian names: ${altGuardians.join(" · ")}`
      : "",
    `Closed: ${others.map((o) => o.enquiryNo).join(", ")}`,
  ]
    .filter(Boolean)
    .join(" · ");

  let next = updateLead(state, keeper.id, {
    childName: mergedChildLabel,
    guardianName: primaryGuardianName,
    siblingInSchool: childNames.length > 1 || keeper.siblingInSchool,
    note: [keeper.note, mergeNote].filter(Boolean).join(" · "),
  });

  // Point other leads' households' open siblings stays; mark others lost
  for (const o of others) {
    next = updateLead(next, o.id, {
      stage: "lost",
      lostReason: `Merged into ${keeper.enquiryNo} — children combined`,
      householdId: keeper.householdId || o.householdId,
      note: [
        o.note,
        `Merged into ${keeper.enquiryNo} (${mergedChildLabel})`,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  // Ensure keeper household mobile is the shared number
  if (keeper.householdId) {
    const hh = householdOf(next, keeper.householdId);
    if (hh && hh.primaryMobile !== mobiles[0]) {
      next = updateHousehold(next, keeper.householdId, {
        primaryMobile: mobiles[0],
      });
    }
  }

  const updatedKeeper = next.leads.find((l) => l.id === keeper.id)!;
  return {
    ok: true,
    state: next,
    keeper: updatedKeeper,
    mergedCount: others.length,
    childNames,
  };
}

/**
 * Apply WhatsApp profile names (from live contacts check) onto leads that share
 * that mobile. Optionally also overwrite guardianName so desk lists match campaigns.
 */
export function applyWhatsAppNamesToLeads(
  state: AdmissionsState,
  updates: {
    mobile: string;
    displayName: string;
    waId?: string;
  }[],
  opts?: { alsoUpdateGuardianName?: boolean },
): {
  state: AdmissionsState;
  updated: number;
  skippedNoName: number;
} {
  const byMobile = new Map<
    string,
    { displayName: string; waId: string }
  >();
  for (const u of updates) {
    const m = normalizeMobile(u.mobile);
    const name = (u.displayName || "").trim();
    if (m.length !== 10 || !name) continue;
    byMobile.set(m, {
      displayName: name,
      waId: (u.waId || "").replace(/\D/g, ""),
    });
  }

  let updated = 0;
  let skippedNoName = 0;
  const alsoGuardian = opts?.alsoUpdateGuardianName !== false;

  const leads = state.leads.map((lead) => {
    if (lead.stage === "lost") return lead;
    const m =
      normalizeMobile(
        lead.whatsappSame !== false
          ? lead.mobile
          : lead.whatsapp || lead.mobile,
      ) || normalizeMobile(lead.mobile);
    const hit = byMobile.get(m);
    if (!hit) return lead;

    const sameName =
      lead.whatsappDisplayName.trim().toLowerCase() ===
        hit.displayName.toLowerCase() &&
      (!alsoGuardian ||
        lead.guardianName.trim().toLowerCase() ===
          hit.displayName.toLowerCase()) &&
      (!hit.waId || lead.whatsappWaId === hit.waId);
    if (sameName) {
      skippedNoName += 1;
      return lead;
    }

    updated += 1;
    const prevGuardian = lead.guardianName.trim();
    const noteExtra =
      alsoGuardian &&
      prevGuardian &&
      prevGuardian.toLowerCase() !== hit.displayName.toLowerCase()
        ? `WA name applied: “${hit.displayName}” (was guardian “${prevGuardian}”)`
        : `WA display name set: “${hit.displayName}”`;

    return normalizeAdmissionLead({
      ...lead,
      whatsappDisplayName: hit.displayName,
      whatsappWaId: hit.waId || lead.whatsappWaId,
      guardianName: alsoGuardian ? hit.displayName : lead.guardianName,
      note: [lead.note, noteExtra].filter(Boolean).join(" · "),
      updatedAt: new Date().toISOString(),
    });
  });

  return {
    state: { ...state, leads },
    updated,
    skippedNoName,
  };
}

/** Name used in WhatsApp campaign {{guardianName}} personalisation. */
export function campaignGuardianName(lead: AdmissionLead): string {
  return (
    (lead.whatsappDisplayName || "").trim() ||
    (lead.guardianName || "").trim() ||
    "Parent"
  );
}

export type EnrollResult =
  | {
      ok: true;
      state: AdmissionsState;
      student: SisStudent;
      admissionNo: string;
      srn: string;
      admissionDate: string;
    }
  | { ok: false; reason: string };

/**
 * Confirm admission → create SIS student.
 * Siblings share the same SIS household (by admission HH or matching mobile).
 */
export function enrollLead(
  state: AdmissionsState,
  leadId: string,
  by: string,
  masters?: MastersState,
): EnrollResult {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.stage === "enrolled" && lead.studentId) {
    return { ok: false, reason: "Already enrolled in SIS" };
  }
  if (lead.stage !== "verified" && lead.stage !== "applied") {
    return {
      ok: false,
      reason: "Verify documents (or complete registration) before enrollment",
    };
  }

  const m = masters ?? loadMasters();
  const classId = lead.classAdmittedId || lead.classSoughtId;
  if (!classId) return { ok: false, reason: "Class admitted is required" };

  let sectionId = lead.sectionId;
  if (!sectionId) {
    sectionId =
      m.sections.find((s) => s.classId === classId && s.isActive)?.id || "";
  }
  if (!sectionId) {
    return { ok: false, reason: "Assign a section before enrollment" };
  }

  const admissionDate = today(); // date sent to SIS
  const sis = loadSis();
  const admissionNo = lead.admissionNo || suggestAdmissionNo(sis.students);
  if (sis.students.some((s) => s.admissionNo === admissionNo)) {
    return { ok: false, reason: `Admission no. ${admissionNo} already exists` };
  }
  const srn = suggestSrn(sis.students);
  if (sis.students.some((s) => (s.srn || "").toUpperCase() === srn.toUpperCase())) {
    return { ok: false, reason: `SRN ${srn} already exists` };
  }

  const studentType = suggestFeeStudentType(
    admissionDate,
    lead.academicYearCode || DEFAULT_AY,
    lead.rte ? "RTE" : "NEW",
  );
  if (lead.rte && !lead.rteGovtApplicationNo.trim()) {
    return {
      ok: false,
      reason:
        "RTE/EWS require Govt application number from the official list before sending to SIS",
    };
  }
  const feeGroupId =
    lead.feeGroupId ||
    resolveFeeGroupId(m, {
      studentType,
      classId,
      academicYearCode: lead.academicYearCode || DEFAULT_AY,
      preferPublished: true,
    }) ||
    "";

  const campusId =
    m.campuses.find((c) => c.isPrimary)?.id || m.campuses[0]?.id || "";

  const admHh = householdOf(state, lead.householdId);
  const primary = admHh ? primaryGuardian(admHh) : undefined;
  const mother = admHh ? motherFromHousehold(admHh) : undefined;
  /** Parent-wise: each guardian mobile is its own SIS household */
  const parentMobile =
    normalizeMobile(lead.parentGroupKey || lead.mobile) ||
    normalizeMobile(admHh?.primaryMobile || "");

  let sisHouseholdId = "";
  let households = [...sis.households];

  // Same parent already admitted → reuse that SIS household
  const sameParentLead = state.leads.find(
    (l) =>
      l.id !== lead.id &&
      l.stage === "enrolled" &&
      l.studentId &&
      normalizeMobile(l.parentGroupKey || l.mobile) === parentMobile,
  );
  if (sameParentLead?.studentId) {
    const sibStu = sis.students.find((s) => s.id === sameParentLead.studentId);
    if (sibStu?.householdId) sisHouseholdId = sibStu.householdId;
  }

  if (!sisHouseholdId && parentMobile) {
    const existing = households.find(
      (h) => normalizeMobile(h.mobile) === parentMobile,
    );
    if (existing) sisHouseholdId = existing.id;
  }

  // Only reuse admission HH → SIS link if that HH mobile matches this parent
  if (
    !sisHouseholdId &&
    admHh?.sisHouseholdId &&
    households.some((h) => h.id === admHh.sisHouseholdId) &&
    normalizeMobile(admHh.primaryMobile) === parentMobile
  ) {
    sisHouseholdId = admHh.sisHouseholdId;
  }

  if (!sisHouseholdId) {
    const hh = normalizeHousehold({
      id: newSisId("hh"),
      code: `HH-${sis.households.length + households.length + 1}`,
      guardianName: lead.guardianName || primary?.fullName || "",
      mobile: parentMobile,
      whatsappMobile:
        (lead.whatsappSame ? lead.mobile : lead.whatsapp) ||
        admHh?.whatsapp ||
        primary?.whatsapp ||
        parentMobile,
      email: lead.email || admHh?.email || primary?.email || "",
      address: lead.address || admHh?.address || "",
      locality: lead.locality || admHh?.locality || "",
      city: lead.city || admHh?.city || "",
      state: lead.state || admHh?.state || "",
      pincode: lead.pincode || admHh?.pincode || "",
      altMobile:
        admHh?.guardians.find((g) => !g.isPrimary && g.mobile)?.mobile || "",
      // Carried across from registration, where the family was actually
      // asked. Losing it here would silently downgrade a "yes" to
      // "never asked" the moment the child enrolled — and the website reads
      // the SIS household, not this one.
      photoConsent: normalizePhotoConsent(admHh?.photoConsent),
    });
    households = [...households, hh];
    sisHouseholdId = hh.id;
  }

  const father =
    admHh?.guardians.find((g) => g.relation === "father") || primary;
  const motherG =
    mother || admHh?.guardians.find((g) => g.relation === "mother");

  const rteTagIds = lead.rte
    ? ensureRteEwsTagIds({
        type: lead.category === "EWS" ? "EWS" : "RTE",
        category: lead.category,
      })
    : [];

  const student = normalizeStudent({
    id: newSisId("stu"),
    admissionNo,
    srn,
    fullName: lead.childName,
    gender:
      lead.gender === "M" || lead.gender === "F" || lead.gender === "O"
        ? lead.gender
        : "",
    dob: lead.dob,
    status: "active",
    campusId,
    classId,
    sectionId,
    academicYearCode: lead.academicYearCode || DEFAULT_AY,
    studentType,
    feeGroupId: feeGroupId || null,
    joinedOn: admissionDate,
    fatherName: father?.fullName || lead.guardianName,
    motherName: motherG?.fullName || lead.motherName,
    fatherMobile: father?.mobile || parentMobile,
    motherMobile: motherG?.mobile || "",
    householdId: sisHouseholdId,
    category: (["GEN", "OBC", "SC", "ST", "EWS"].includes(lead.category)
      ? lead.category
      : "") as "" | "GEN" | "OBC" | "SC" | "ST" | "EWS",
    previousSchool: lead.previousSchool,
    previousTcNo: lead.previousTcNo,
    penStatus: (lead.penStatus as SisStudent["penStatus"]) || "to_register",
    tagIds: rteTagIds,
    notes: lead.rte
      ? `RTE/EWS govt app ${lead.rteGovtApplicationNo}`
      : "",
  });

  saveSis({
    ...sis,
    households,
    students: [...sis.students, student],
  });

  let next = state;
  if (
    admHh &&
    (!admHh.sisHouseholdId ||
      normalizeMobile(admHh.primaryMobile) === parentMobile)
  ) {
    next = updateHousehold(next, admHh.id, { sisHouseholdId });
  }
  next = updateLead(next, leadId, {
    stage: "enrolled",
    admissionDate,
    admissionNo,
    studentId: student.id,
    classAdmittedId: classId,
    sectionId,
    feeGroupId: feeGroupId || "",
    parentGroupKey: parentMobile,
    note: [
      lead.note,
      `Sent to SIS ${admissionDate} · Adm ${admissionNo} · ${srn} · by ${by}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  // Registration paid/waived → student ledger so Fee Take won't re-demand that head
  next = applyRegistrationLedgerSync(next, leadId, by);

  return { ok: true, state: next, student, admissionNo, srn, admissionDate };
}

export function funnelCounts(state: AdmissionsState): Record<AdmissionStage, number> {
  const counts: Record<AdmissionStage, number> = {
    enquiry: 0,
    applied: 0,
    verified: 0,
    enrolled: 0,
    lost: 0,
  };
  for (const l of state.leads) {
    counts[l.stage] = (counts[l.stage] || 0) + 1;
  }
  return counts;
}

/** Lead counts by acquisition channel (walk-in, survey, website…). */
export function sourceCounts(
  state: AdmissionsState,
): Record<AdmissionSource, number> {
  const counts = Object.fromEntries(
    ADMISSION_SOURCES.map((s) => [s.value, 0]),
  ) as Record<AdmissionSource, number>;
  for (const l of state.leads) {
    if (l.stage === "lost") continue;
    const key = ADMISSION_SOURCES.some((s) => s.value === l.source)
      ? l.source
      : "other";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function sourceLabel(s: AdmissionSource): string {
  return ADMISSION_SOURCES.find((x) => x.value === s)?.label || s;
}

export function stageLabel(s: AdmissionStage): string {
  return ADMISSION_STAGES.find((x) => x.value === s)?.label || s;
}

/** Match CRM lead by guardian / WhatsApp mobile (10-digit). */
export function findAdmissionLeadByMobile(
  state: AdmissionsState,
  mobile10: string,
): AdmissionLead | null {
  const m = normalizeMobile(mobile10);
  if (m.length !== 10) return null;
  const leads = state.leads.filter((l) => {
    const primary = normalizeMobile(l.mobile);
    const wa = normalizeMobile(l.whatsappSame ? l.mobile : l.whatsapp);
    return primary === m || wa === m;
  });
  if (!leads.length) return null;
  return (
    leads.find((l) => l.stage !== "lost" && l.stage !== "enrolled") ||
    leads[0]
  );
}

export function relationLabel(r: GuardianRelation): string {
  return GUARDIAN_RELATIONS.find((x) => x.value === r)?.label || r;
}

/** Calendar capture year from leadDate (fallback createdAt / AY) — e.g. "2025" */
/**
 * Admission year from enquiry date: enquiries from Oct (Y-1) through Sep (Y)
 * belong to admission year Y (session "Y-(Y+1)").
 * e.g. Oct 2024 – Jul 2025 → 2025-26; Oct 2025 onwards → 2026-27.
 */
export function admissionYearForEnquiryDate(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec((dateIso || "").slice(0, 10));
  if (!m) return ayCode();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || !mo) return ayCode();
  const startYear = mo >= 10 ? y + 1 : y;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function captureYear(lead: AdmissionLead): string {
  const d = (lead.leadDate || lead.createdAt || "").slice(0, 4);
  if (/^\d{4}$/.test(d)) return d;
  const ay = (lead.academicYearCode || "").slice(0, 4);
  return /^\d{4}$/.test(ay) ? ay : today().slice(0, 4);
}

/** All capture years present in CRM (newest first) — leads stay across sessions */
export function listCaptureYears(state: AdmissionsState): string[] {
  const set = new Set<string>();
  for (const l of state.leads) set.add(captureYear(l));
  return [...set].sort((a, b) => b.localeCompare(a));
}

export function listAcademicYearCodes(state: AdmissionsState): string[] {
  const set = new Set<string>();
  for (const l of state.leads) {
    if (l.academicYearCode) set.add(l.academicYearCode);
  }
  set.add(ayCode());
  return [...set].sort((a, b) => b.localeCompare(a));
}

export type ImportLeadRow = {
  childName: string;
  guardianName: string;
  mobile: string;
  motherName?: string;
  classSoughtId?: string;
  className?: string;
  locality?: string;
  address?: string;
  note?: string;
  campaignNote?: string;
  leadDate?: string;
  dob?: string;
  gender?: string;
  source?: AdmissionSource;
  stage?: AdmissionStage;
  academicYearCode?: string;
  enquiryNo?: string;
};

/**
 * Bulk-upload older / offline leads with chosen default tags (source, stage, year).
 */
export function importLeads(
  state: AdmissionsState,
  rows: ImportLeadRow[],
  defaults: {
    source: AdmissionSource;
    stage: AdmissionStage;
    academicYearCode: string;
    leadDate?: string;
  },
  by: string,
  resolveClassId: (name: string) => string | undefined,
): {
  ok: true;
  state: AdmissionsState;
  imported: number;
  skipped: number;
  errors: string[];
  leads: AdmissionLead[];
} {
  let next = state;
  const errors: string[] = [];
  const leads: AdmissionLead[] = [];
  let imported = 0;
  let skipped = 0;

  rows.forEach((row, i) => {
    const line = i + 1;
    const childName = (row.childName || "").trim();
    const guardianName = (row.guardianName || "").trim();
    const mobile = normalizeMobile(row.mobile || "");
    if (!childName || !guardianName || mobile.length !== 10) {
      skipped += 1;
      errors.push(
        `Row ${line}: need child, guardian, 10-digit mobile — skipped`,
      );
      return;
    }
    const classSoughtId =
      row.classSoughtId ||
      (row.className ? resolveClassId(row.className) : "") ||
      "";
    const source = row.source || defaults.source;
    const stage = row.stage || defaults.stage;
    const leadDate =
      (row.leadDate || defaults.leadDate || "").slice(0, 10) || today();
    // Admission year follows the enquiry date (Oct Y-1 … Sep Y → year Y)
    const academicYearCode =
      row.academicYearCode ||
      admissionYearForEnquiryDate(leadDate) ||
      defaults.academicYearCode ||
      ayCode();

    const r = createEnquiry(
      next,
      {
        childName,
        guardianName,
        motherName: row.motherName || "",
        mobile,
        classSoughtId,
        locality: row.locality || "",
        address: row.address || "",
        note: row.note || "",
        campaignNote: row.campaignNote || "Imported lead",
        dob: row.dob || "",
        gender: row.gender || "",
        source,
        stage: "enquiry",
        academicYearCode,
        leadDate,
        enquiryNo: row.enquiryNo || "",
      },
      by || "Import",
      { allowMissingClass: true },
    );
    if (!r.ok) {
      skipped += 1;
      errors.push(`Row ${line}: ${r.reason}`);
      return;
    }
    next = r.state;
    let lead = r.lead;
    // Preserve historical enquiry no if provided
    if (row.enquiryNo?.trim()) {
      next = updateLead(next, lead.id, { enquiryNo: row.enquiryNo.trim() });
      lead = { ...lead, enquiryNo: row.enquiryNo.trim() };
    }
    if (stage !== "enquiry") {
      const patch: Partial<AdmissionLead> = { stage };
      if (stage === "applied" || stage === "verified" || stage === "enrolled") {
        patch.registrationDate = leadDate;
        if (!lead.applicationNo) {
          const a = allocateApplicationNo(next);
          patch.applicationNo = a.no;
          next = { ...next, nextApplicationSeq: a.next };
        }
      }
      if (stage === "lost") {
        patch.lostReason = row.note || "Imported as lost";
      }
      next = updateLead(next, lead.id, patch);
      lead = normalizeAdmissionLead({ ...lead, ...patch });
    }
    leads.push(lead);
    imported += 1;
  });

  return { ok: true, state: next, imported, skipped, errors, leads };
}

/** Parse simple CSV (header row required) into import rows */
export function parseLeadsCsv(text: string): ImportLeadRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!).map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, ""),
  );
  const idx = (aliases: string[]) =>
    headers.findIndex((h) => aliases.includes(h));

  const iChild = idx(["childname", "child", "student", "name"]);
  const iGuardian = idx(["guardianname", "guardian", "father", "parent"]);
  const iMobile = idx(["mobile", "phone", "mobileno", "contact"]);
  const iMother = idx(["mothername", "mother"]);
  const iClass = idx(["classname", "class", "classsought"]);
  const iDate = idx(["leaddate", "enquirydate", "date", "capturedate"]);
  const iLocality = idx(["locality", "area"]);
  const iAddress = idx(["address"]);
  const iNote = idx(["note", "notes", "remark"]);
  const iSource = idx(["source"]);
  const iStage = idx(["stage", "status", "tag"]);
  const iEnq = idx(["enquiryno", "leadno", "leadnumber", "ref"]);
  const iAy = idx(["academicyear", "academicyearcode", "session", "ay"]);

  const rows: ImportLeadRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]!);
    const get = (i: number) => (i >= 0 ? (cols[i] || "").trim() : "");
    const sourceRaw = get(iSource).toLowerCase().replace(/[\s/-]+/g, "_");
    const stageRaw = get(iStage).toLowerCase();
    const source = ADMISSION_SOURCES.find(
      (s) =>
        s.value === sourceRaw ||
        s.label.toLowerCase().replace(/[\s/-]+/g, "_") === sourceRaw,
    )?.value;
    let stage: AdmissionStage | undefined;
    if (stageRaw) {
      stage =
        ADMISSION_STAGES.find(
          (s) =>
            s.value === stageRaw ||
            s.label.toLowerCase() === stageRaw ||
            (stageRaw === "open" && s.value === "enquiry") ||
            (stageRaw === "registered" && s.value === "applied") ||
            (stageRaw === "admitted" && s.value === "enrolled"),
        )?.value || undefined;
    }
    rows.push({
      childName: get(iChild),
      guardianName: get(iGuardian),
      mobile: get(iMobile),
      motherName: get(iMother),
      className: get(iClass),
      leadDate: get(iDate),
      locality: get(iLocality),
      address: get(iAddress),
      note: get(iNote),
      source,
      stage,
      enquiryNo: get(iEnq),
      academicYearCode: get(iAy),
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export const LEADS_IMPORT_SAMPLE_CSV = `leadDate,childName,guardianName,mobile,motherName,className,source,stage,locality,note
2024-06-15,Aarav Singh,Ramesh Singh,9876543210,Sita Singh,Nursery,field_survey,enquiry,Murdaha,Old survey sheet
2025-01-10,Ananya Verma,Suresh Verma,9876501234,Pooja Verma,I,website,enquiry,Lanka,Website dump
`;

/** Leads sent from CRM for registration desk (Registered / Verified, not yet admitted) */
export function listRegistrationQueue(state: AdmissionsState): AdmissionLead[] {
  return state.leads
    .filter((l) => l.stage === "applied" || l.stage === "verified")
    .sort((a, b) =>
      (b.registrationDate || b.leadDate).localeCompare(
        a.registrationDate || a.leadDate,
      ),
    );
}

/**
 * Bifurcate household enquiries by parent (guardian mobile).
 * Same house, different parents → separate groups for SIS sibling linking.
 */
export function groupLeadsByParent(
  state: AdmissionsState,
  householdId: string,
): { parentKey: string; guardianName: string; mobile: string; leads: AdmissionLead[] }[] {
  const leads = state.leads.filter(
    (l) =>
      l.householdId === householdId &&
      l.stage !== "lost" &&
      l.stage !== "enrolled",
  );
  const map = new Map<
    string,
    { parentKey: string; guardianName: string; mobile: string; leads: AdmissionLead[] }
  >();
  for (const l of leads) {
    const mobile = normalizeMobile(l.parentGroupKey || l.mobile);
    const key = mobile || l.guardianName.trim().toLowerCase() || l.id;
    const cur = map.get(key);
    if (cur) {
      cur.leads.push(l);
    } else {
      map.set(key, {
        parentKey: key,
        guardianName: l.guardianName,
        mobile,
        leads: [l],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.guardianName.localeCompare(b.guardianName),
  );
}

/** One-time fee heads suitable for registration (admission / one_time) */
export function registrationFeeHeads(masters: MastersState): {
  id: string;
  code: string;
  name: string;
}[] {
  return (masters.feeHeads || [])
    .filter(
      (h) =>
        h.isActive &&
        (h.frequency === "one_time" ||
          h.code === "ADMISSION" ||
          /registr|admission/i.test(h.nameEn || "") ||
          h.category === "admission"),
    )
    .map((h) => ({
      id: h.id,
      code: h.code,
      name: h.nameEn || h.code,
    }));
}

/** Field survey leads only (source = field_survey) */
export function listFieldSurveyLeads(state: AdmissionsState): AdmissionLead[] {
  return state.leads
    .filter((l) => l.source === "field_survey" && l.stage !== "lost")
    .sort((a, b) =>
      (b.leadDate || b.createdAt).localeCompare(a.leadDate || a.createdAt),
    );
}

/** Distinct beats from master + capture funnel counts */
export function listSurveyBeats(state: AdmissionsState): {
  beat: string;
  beatId: string;
  count: number;
  open: number;
  registered: number;
  admitted: number;
  target: number;
}[] {
  const map = new Map<
    string,
    {
      beat: string;
      beatId: string;
      count: number;
      open: number;
      registered: number;
      admitted: number;
      target: number;
    }
  >();

  for (const b of state.surveyBeats || []) {
    if (!b.isActive && !state.leads.some((l) => l.surveyBeatId === b.id)) {
      continue;
    }
    map.set(b.id, {
      beat: b.name,
      beatId: b.id,
      count: 0,
      open: 0,
      registered: 0,
      admitted: 0,
      target: b.targetHouseholds,
    });
  }

  for (const l of listFieldSurveyLeads(state)) {
    const beatId = l.surveyBeatId || "";
    const beatName =
      (beatId && state.surveyBeats?.find((b) => b.id === beatId)?.name) ||
      (l.campaignNote || "").trim() ||
      (l.locality || "").trim() ||
      "Unassigned beat";
    const key = beatId || `name:${beatName}`;
    const cur = map.get(key) || {
      beat: beatName,
      beatId,
      count: 0,
      open: 0,
      registered: 0,
      admitted: 0,
      target: 0,
    };
    cur.count += 1;
    if (l.stage === "enquiry") cur.open += 1;
    if (l.stage === "applied" || l.stage === "verified") cur.registered += 1;
    if (l.stage === "enrolled") cur.admitted += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.beat.localeCompare(b.beat),
  );
}

export function fieldSurveyStats(state: AdmissionsState): {
  total: number;
  open: number;
  registered: number;
  admitted: number;
  today: number;
  beats: number;
  queuedOffline: number;
} {
  const leads = listFieldSurveyLeads(state);
  const today = todayYmd();
  return {
    total: leads.length,
    open: leads.filter((l) => l.stage === "enquiry").length,
    registered: leads.filter(
      (l) => l.stage === "applied" || l.stage === "verified",
    ).length,
    admitted: leads.filter((l) => l.stage === "enrolled").length,
    today: leads.filter((l) => (l.leadDate || "").slice(0, 10) === today)
      .length,
    beats: (state.surveyBeats || []).filter((b) => b.isActive).length ||
      listSurveyBeats(state).length,
    queuedOffline: 0,
  };
}

/**
 * Field agent quick capture → Open lead in CRM (source locked field_survey).
 */
export function createFieldSurveyEnquiry(
  state: AdmissionsState,
  draft: Partial<AdmissionLead> & { beat?: string; beatId?: string },
  by: string,
):
  | { ok: true; state: AdmissionsState; lead: AdmissionLead }
  | { ok: false; reason: string } {
  const beat = (draft.beat || draft.campaignNote || draft.locality || "").trim();
  const r = createEnquiry(
    state,
    {
      ...draft,
      source: "field_survey",
      stage: "enquiry",
      campaignNote: beat || draft.campaignNote || "",
      locality: draft.locality || beat,
      surveyBeatId: draft.beatId || draft.surveyBeatId || "",
      leadDate: draft.leadDate || today(),
      parentGroupKey: normalizeMobile(draft.mobile || ""),
      nextFollowUpAt: today(),
      assignedTo: by,
    },
    by || "Field survey",
    // Deliberately optional: a surveyor walking a beat often does not know
    // the class yet, and losing the lead is worse than losing the class.
    // Spelled as a literal, not `!draft.classSoughtId` — deriving the flag
    // from the condition it guards makes the check unable to ever fire.
    { allowMissingClass: true, publicSubmit: false },
  );
  if (!r.ok) return r;
  return { ok: true, state: r.state, lead: r.lead };
}

/**
 * Desk: new registration (also creates/updates Lead CRM as Registered).
 */
export function createRegistrationFromDesk(
  state: AdmissionsState,
  draft: Partial<AdmissionLead> & {
    feeHeadId: string;
    feeHeadName: string;
    feeAmountPaise: number;
  },
  by: string,
):
  | { ok: true; state: AdmissionsState; lead: AdmissionLead }
  | { ok: false; reason: string } {
  const created = createEnquiry(
    state,
    {
      ...draft,
      source: draft.source || "walk_in",
      stage: "enquiry",
      parentGroupKey: normalizeMobile(draft.mobile || ""),
      leadDate: draft.leadDate || today(),
    },
    by,
    // A paid registration always has a class: the only caller,
    // createFamilyRegistrationsFromDesk, refuses the whole family first
    // ("Class required for child N"). Enforced here too so the invariant
    // survives a future second caller.
    { allowMissingClass: false },
  );
  if (!created.ok) return created;

  return applyRegistrationToLead(created.state, created.lead.id, draft);
}

/**
 * Promote an existing lead to a registration: checklist, fee head and
 * amount, application number, stage.
 *
 * Split out of createRegistrationFromDesk so a lead that already exists —
 * a WhatsApp enquiry the parent is now converting through the registration
 * link — travels the identical path instead of being filed a second time
 * under a new id. Registering twice is not a harmless duplicate: each copy
 * carries its own registration fee, so the family shows a second amount
 * due and the desk queue lists the same child twice.
 */
export function applyRegistrationToLead(
  state: AdmissionsState,
  leadId: string,
  draft: Partial<AdmissionLead> & {
    feeHeadId: string;
    feeHeadName: string;
    feeAmountPaise: number;
  },
):
  | { ok: true; state: AdmissionsState; lead: AdmissionLead }
  | { ok: false; reason: string } {
  let next = state;
  let lead = next.leads.find((l) => l.id === leadId) || null;
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.stage === "enrolled") {
    return {
      ok: false,
      reason: "This child is already enrolled — contact the school office",
    };
  }

  // Soft-complete checklist for desk registration if provided
  next = updateLead(next, lead.id, {
    declarationAccepted: true,
    docsBirthCert: draft.docsBirthCert ?? true,
    docsPhoto: draft.docsPhoto ?? true,
    motherName: draft.motherName || lead.motherName || "—",
    classSoughtId: draft.classSoughtId || lead.classSoughtId,
    registrationFeeHeadId: draft.feeHeadId,
    registrationFeeAmountPaise: draft.feeAmountPaise,
    parentGroupKey: normalizeMobile(draft.mobile || lead.mobile),
  });
  lead = next.leads.find((l) => l.id === leadId)!;

  const promo = promoteToRegistration(next, lead.id);
  if (!promo.ok) {
    // Force applied if mother placeholder used
    next = updateLead(next, lead.id, {
      stage: "applied",
      registrationDate: today(),
      applicationNo:
        lead.applicationNo ||
        allocateApplicationNo(next).no,
      classAdmittedId: lead.classAdmittedId || lead.classSoughtId,
      registrationFeeHeadId: draft.feeHeadId,
      registrationFeeAmountPaise: draft.feeAmountPaise,
      parentGroupKey: normalizeMobile(draft.mobile || lead.mobile),
    });
    if (!lead.applicationNo) {
      const a = allocateApplicationNo(next);
      next = {
        ...next,
        nextApplicationSeq: a.next,
        leads: next.leads.map((l) =>
          l.id === lead.id ? { ...l, applicationNo: a.no } : l,
        ),
      };
    }
  } else {
    next = promo.state;
    next = updateLead(next, lead.id, {
      registrationFeeHeadId: draft.feeHeadId,
      registrationFeeAmountPaise: draft.feeAmountPaise,
      parentGroupKey: normalizeMobile(draft.mobile || lead.mobile),
    });
  }

  const registered = next.leads.find((l) => l.id === leadId);
  if (!registered) return { ok: false, reason: "Lead lost during registration" };
  return { ok: true, state: next, lead: registered };
}

/**
 * Register a family that already has enquiries on file — the path behind
 * the registration link the WhatsApp bot sends an existing lead.
 *
 * Each submitted child is matched to an existing lead in this household
 * by name and converted in place; only a genuinely new sibling creates a
 * new lead. Nothing here files a second record for a child the school
 * already knows about, which is the whole point of sending a tokenised
 * link rather than a bare /register URL.
 */
export function registerExistingFamily(
  state: AdmissionsState,
  input: {
    householdId: string;
    guardianName: string;
    motherName?: string;
    mobile: string;
    children: FamilyRegistrationChildDraft[];
    feeHeadName?: string;
    campaignNote?: string;
  },
  by: string,
):
  | { ok: true; state: AdmissionsState; leads: AdmissionLead[] }
  | { ok: false; reason: string } {
  const household = householdOf(state, input.householdId);
  if (!household) return { ok: false, reason: "Family record not found" };

  const guardianName = (input.guardianName || "").trim();
  if (!guardianName) {
    return { ok: false, reason: "Parent / guardian name is required" };
  }
  const mobile = normalizeMobile(input.mobile || "");
  if (mobile.length !== 10) {
    return { ok: false, reason: "Parent mobile must be 10 digits" };
  }

  const children = (input.children || [])
    .map((c) => ({
      ...c,
      childName: (c.childName || "").trim(),
      classSoughtId: c.classSoughtId || "",
      feeHeadId: c.feeHeadId || "",
      feeAmountPaise: Math.max(0, Math.round(Number(c.feeAmountPaise) || 0)),
    }))
    .filter((c) => c.childName);
  if (children.length === 0) return { ok: false, reason: "Add at least one child" };

  const names = children.map((c) => c.childName.toLowerCase());
  if (new Set(names).size !== names.length) {
    return { ok: false, reason: "Sibling names must be unique in this family" };
  }
  for (const c of children) {
    if (!c.classSoughtId) {
      return { ok: false, reason: `Class required for ${c.childName}` };
    }
    if (!c.feeHeadId) {
      return { ok: false, reason: `Fee head required for ${c.childName}` };
    }
  }

  const feeHeadName = input.feeHeadName || "Registration fee";
  const note = input.campaignNote || "Parent self-register · WhatsApp link";
  let next = state;
  const out: AdmissionLead[] = [];
  // A lead already claimed by one submitted child must not be matched
  // again by the next one.
  const claimed = new Set<string>();

  for (const child of children) {
    const existing = next.leads.find(
      (l) =>
        l.householdId === input.householdId &&
        !claimed.has(l.id) &&
        l.stage !== "lost" &&
        l.childName.trim().toLowerCase() === child.childName.toLowerCase(),
    );

    let leadId: string;
    if (existing) {
      leadId = existing.id;
    } else {
      const sib = addSiblingEnquiry(
        next,
        input.householdId,
        {
          childName: child.childName,
          classSoughtId: child.classSoughtId,
          dob: child.dob,
          gender: child.gender,
          campaignNote: note,
        },
        by,
      );
      if (!sib.ok) return sib;
      next = sib.state;
      leadId = sib.lead.id;
    }
    claimed.add(leadId);

    const applied = applyRegistrationToLead(next, leadId, {
      guardianName,
      motherName: input.motherName,
      mobile,
      classSoughtId: child.classSoughtId,
      dob: child.dob,
      gender: child.gender,
      feeHeadId: child.feeHeadId,
      feeHeadName,
      feeAmountPaise: child.feeAmountPaise,
    });
    if (!applied.ok) return applied;
    next = applied.state;
    next = updateLead(next, leadId, {
      campaignNote: [applied.lead.campaignNote, note]
        .filter(Boolean)
        .join(" · "),
    });
    out.push(next.leads.find((l) => l.id === leadId)!);
  }

  return { ok: true, state: next, leads: out };
}

export type FamilyRegistrationChildDraft = {
  childName: string;
  classSoughtId: string;
  dob?: string;
  gender?: string;
  feeHeadId: string;
  feeAmountPaise: number;
};

/**
 * Desk: one parent registers multiple siblings — each child becomes a
 * Registered lead with its own registration fee (per student).
 */
export function createFamilyRegistrationsFromDesk(
  state: AdmissionsState,
  input: {
    guardianName: string;
    motherName?: string;
    mobile: string;
    source?: AdmissionSource;
    children: FamilyRegistrationChildDraft[];
    /** Default fee head name for CRM notes */
    feeHeadName?: string;
  },
  by: string,
):
  | {
      ok: true;
      state: AdmissionsState;
      leads: AdmissionLead[];
      householdId: string;
      totalFeePaise: number;
    }
  | { ok: false; reason: string } {
  const guardianName = (input.guardianName || "").trim();
  const mobile = normalizeMobile(input.mobile || "");
  const motherName = (input.motherName || "").trim() || "—";
  if (!guardianName) {
    return { ok: false, reason: "Parent / guardian name is required" };
  }
  if (mobile.length !== 10) {
    return { ok: false, reason: "Parent mobile must be 10 digits" };
  }
  const children = (input.children || [])
    .map((c) => ({
      ...c,
      childName: (c.childName || "").trim(),
      classSoughtId: c.classSoughtId || "",
      feeHeadId: c.feeHeadId || "",
      feeAmountPaise: Math.max(0, Math.round(Number(c.feeAmountPaise) || 0)),
    }))
    .filter((c) => c.childName);

  if (children.length === 0) {
    return { ok: false, reason: "Add at least one child" };
  }
  for (let i = 0; i < children.length; i++) {
    const c = children[i]!;
    if (!c.classSoughtId) {
      return {
        ok: false,
        reason: `Class required for child ${i + 1} (${c.childName})`,
      };
    }
    if (!c.feeHeadId) {
      return {
        ok: false,
        reason: `Fee head required for ${c.childName}`,
      };
    }
    if (c.feeAmountPaise < 0) {
      return { ok: false, reason: `Invalid fee for ${c.childName}` };
    }
  }
  const names = children.map((c) => c.childName.toLowerCase());
  if (new Set(names).size !== names.length) {
    return { ok: false, reason: "Sibling names must be unique in this family" };
  }

  let next = state;
  const leads: AdmissionLead[] = [];
  const feeHeadName = input.feeHeadName || "Registration fee";

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (i === 0) {
      const r = createRegistrationFromDesk(
        next,
        {
          childName: child.childName,
          guardianName,
          motherName,
          mobile,
          classSoughtId: child.classSoughtId,
          dob: child.dob,
          gender: child.gender,
          source: input.source || "walk_in",
          siblingInSchool: children.length > 1,
          feeHeadId: child.feeHeadId,
          feeHeadName,
          feeAmountPaise: child.feeAmountPaise,
          campaignNote:
            children.length > 1
              ? `Family registration · ${children.length} siblings`
              : "",
        },
        by,
      );
      if (!r.ok) return r;
      next = r.state;
      leads.push(r.lead);
      continue;
    }

    const householdId = leads[0]!.householdId;
    if (!householdId) {
      return { ok: false, reason: "Household missing after first child" };
    }
    const sib = addSiblingEnquiry(
      next,
      householdId,
      {
        childName: child.childName,
        classSoughtId: child.classSoughtId,
        dob: child.dob,
        gender: child.gender,
        source: input.source || "walk_in",
        campaignNote: `Sibling of ${leads[0]!.childName} · family desk registration`,
      },
      by,
    );
    if (!sib.ok) return sib;
    next = sib.state;
    // Copy parent names onto sibling lead (guardian already synced from HH)
    next = updateLead(next, sib.lead.id, {
      motherName,
      guardianName,
      siblingInSchool: true,
    });
    const send = sendLeadToRegistration(next, sib.lead.id, {
      feeHeadId: child.feeHeadId,
      feeHeadName,
      feeAmountPaise: child.feeAmountPaise,
    });
    if (!send.ok) return send;
    next = send.state;
    const lead = next.leads.find((l) => l.id === sib.lead.id);
    if (!lead) return { ok: false, reason: "Sibling lead missing after save" };
    leads.push(lead);
  }

  // Mark first child siblingInSchool when multiple
  if (children.length > 1 && leads[0]) {
    next = updateLead(next, leads[0].id, { siblingInSchool: true });
    leads[0] = next.leads.find((l) => l.id === leads[0]!.id)!;
  }

  const totalFeePaise = children.reduce((s, c) => s + c.feeAmountPaise, 0);
  return {
    ok: true,
    state: next,
    leads,
    householdId: leads[0]!.householdId,
    totalFeePaise,
  };
}

/**
 * Parent self-registration (public /register) — same as desk family flow
 * with digital source attribution from campaign / portal.
 */
export function createFamilyRegistrationsFromPublic(
  state: AdmissionsState,
  input: {
    guardianName: string;
    motherName?: string;
    mobile: string;
    children: FamilyRegistrationChildDraft[];
    feeHeadName?: string;
    campaignSrc?: string;
    /** Parent ticked the DPDP consent box */
    consent?: boolean;
    /**
     * Parent ticked the SEPARATE, optional photographs box. `false` here is a
     * real answer — they were asked and declined — and is recorded as such,
     * not left blank. Blank is reserved for families nobody has asked.
     */
    photoConsent?: boolean;
    preferredLanguage?: string;
  },
  by = "Parent self-register",
):
  | {
      ok: true;
      state: AdmissionsState;
      leads: AdmissionLead[];
      householdId: string;
      totalFeePaise: number;
    }
  | { ok: false; reason: string } {
  const srcRaw = (input.campaignSrc || "").toLowerCase();
  const source: AdmissionSource =
    srcRaw.startsWith("wa_") || srcRaw.includes("whatsapp")
      ? "social"
      : srcRaw.includes("google")
        ? "google"
        : srcRaw.includes("field")
          ? "field_survey"
          : srcRaw.includes("social")
            ? "social"
            : "website";
  const r = createFamilyRegistrationsFromDesk(
    state,
    {
      guardianName: input.guardianName,
      motherName: input.motherName,
      mobile: input.mobile,
      source,
      children: input.children,
      feeHeadName: input.feeHeadName,
    },
    by,
  );
  if (!r.ok) return r;
  let next = r.state;
  const note = input.campaignSrc
    ? `Parent self-register · ${input.campaignSrc}`
    : "Parent self-register · /register";
  const consentAt = input.consent ? new Date().toISOString() : "";
  for (const lead of r.leads) {
    next = updateLead(next, lead.id, {
      campaignNote: [lead.campaignNote, note].filter(Boolean).join(" · "),
      source,
      ...(consentAt ? { declarationAccepted: true, parentConsentAt: consentAt, parentConsentBy: "parent (public register)" } : {}),
      ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
    });
  }
  // The family was asked, so their answer is recorded either way — a tick is
  // "granted", an untouched box is "refused". Neither is left blank: blank
  // means nobody asked, and that distinction is the whole point of opt-in.
  next = {
    ...next,
    households: next.households.map((h) =>
      h.id === r.householdId
        ? {
            ...h,
            photoConsent: (input.photoConsent ? "granted" : "refused") as PhotoConsent,
            updatedAt: new Date().toISOString(),
          }
        : h,
    ),
  };

  return {
    ok: true,
    state: next,
    leads: r.leads.map((l) => next.leads.find((x) => x.id === l.id)!),
    householdId: r.householdId,
    totalFeePaise: r.totalFeePaise,
  };
}

/**
 * Push an Open CRM lead into Registration queue (applied) with fee selection.
 */
export function sendLeadToRegistration(
  state: AdmissionsState,
  leadId: string,
  fee: { feeHeadId: string; feeHeadName: string; feeAmountPaise: number },
): { ok: true; state: AdmissionsState } | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.stage === "enrolled") {
    return { ok: false, reason: "Already admitted" };
  }
  let next = updateLead(state, leadId, {
    registrationFeeHeadId: fee.feeHeadId,
    registrationFeeAmountPaise: fee.feeAmountPaise,
    parentGroupKey: normalizeMobile(lead.parentGroupKey || lead.mobile),
    declarationAccepted: lead.declarationAccepted || true,
    docsBirthCert: lead.docsBirthCert || true,
    docsPhoto: lead.docsPhoto || true,
    motherName: lead.motherName || "—",
  });
  if (lead.stage === "enquiry") {
    const promo = promoteToRegistration(next, leadId);
    if (!promo.ok) {
      next = updateLead(next, leadId, {
        stage: "applied",
        registrationDate: today(),
        applicationNo: lead.applicationNo || allocateApplicationNo(next).no,
      });
      if (!lead.applicationNo) {
        const a = allocateApplicationNo(next);
        next = { ...next, nextApplicationSeq: a.next };
        next = updateLead(next, leadId, { applicationNo: a.no });
      }
    } else {
      next = promo.state;
    }
  }
  return { ok: true, state: next };
}

export function takeRegistrationPayment(
  state: AdmissionsState,
  leadId: string,
  by: string,
  input: {
    amountPaise: number;
    tenders: {
      mode: TenderMode;
      amountPaise: number;
      ref?: string;
      bankName?: string;
      instrumentDate?: string;
    }[];
    /** The date the money was actually received; today when absent. */
    paidOn?: string;
    note?: string;
    feeHeadName?: string;
  },
):
  | { ok: true; state: AdmissionsState; payment: RegistrationFeePayment }
  | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (lead.registrationFeeAmountPaise <= 0) {
    return { ok: false, reason: "Set registration fee amount first" };
  }
  if (lead.registrationPaymentStatus === "waived") {
    return { ok: false, reason: "Registration fee already waived" };
  }

  const balance = registrationBalancePaise(state, lead);
  if (balance <= 0) {
    return { ok: false, reason: "Registration fee already fully paid" };
  }

  const amount = Math.max(0, Math.round(input.amountPaise || 0));
  if (amount <= 0) return { ok: false, reason: "Enter an amount to collect" };
  if (amount > balance) {
    return {
      ok: false,
      reason: `Amount exceeds balance due (${(balance / 100).toFixed(0)})`,
    };
  }

  const tenders = (input.tenders || [])
    .map((t) =>
      normalizeRegistrationTender({
        mode: t.mode,
        amountPaise: t.amountPaise,
        ref: t.ref,
        bankName: t.bankName,
        instrumentDate: t.instrumentDate,
      }),
    )
    .filter((t) => t.amountPaise > 0);

  if (tenders.length === 0) {
    return { ok: false, reason: "Add at least one payment mode" };
  }
  const tenderSum = tenders.reduce((s, t) => s + t.amountPaise, 0);
  if (tenderSum !== amount) {
    return {
      ok: false,
      reason: `Modes total ${(tenderSum / 100).toFixed(0)} must equal collect amount ${(amount / 100).toFixed(0)}`,
    };
  }

  const primary = tenders[0]!;
  const refs = tenders
    .map((t) => t.ref)
    .filter(Boolean)
    .join(" · ");
  const modeLabels = tenders
    .map((t) => `${tenderModeLabel(t.mode)} ${(t.amountPaise / 100).toFixed(0)}`)
    .join(" + ");

  const seq = state.nextRegPaySeq || 1;
  const payment = normalizeRegistrationPayment({
    id: nid("rfp"),
    code: `RF-${padSeq(seq)}`,
    leadId,
    feeHeadId: lead.registrationFeeHeadId,
    feeHeadName: input.feeHeadName || "Registration fee",
    amountPaise: amount,
    status: "paid",
    mode: primary.mode,
    tenders,
    mobile: lead.mobile,
    childName: lead.childName,
    createdBy: by,
    paidAt: input.paidOn
      ? new Date(`${input.paidOn}T12:00:00`).toISOString()
      : new Date().toISOString(),
    upiRef:
      refs ||
      `${primary.mode.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
    note:
      input.note ||
      `Collected ${modeLabels}${amount < balance ? " · partial" : ""}`,
  });

  let next: AdmissionsState = {
    ...state,
    nextRegPaySeq: seq + 1,
    registrationPayments: [payment, ...(state.registrationPayments || [])],
  };
  next = updateLead(next, leadId, {
    registrationPaymentId: payment.id,
  });
  const collectedAfter = registrationCollectedPaise(next, leadId);
  const fullyPaid = collectedAfter >= lead.registrationFeeAmountPaise;
  next = refreshLeadRegistrationPaymentStatus(
    next,
    leadId,
    fullyPaid
      ? `Paid in full · ${payment.code} · ${payment.upiRef}`
      : `Partial ${payment.code} · ${(collectedAfter / 100).toFixed(0)}/${(lead.registrationFeeAmountPaise / 100).toFixed(0)} · bal ${(Math.max(0, lead.registrationFeeAmountPaise - collectedAfter) / 100).toFixed(0)}`,
  );
  next = applyRegistrationLedgerSync(next, leadId, by, payment.id);
  return {
    ok: true,
    state: next,
    payment: next.registrationPayments.find((p) => p.id === payment.id)!,
  };
}

/** Full remaining balance as cash (legacy counter button). */
export function takeRegistrationFeeCounter(
  state: AdmissionsState,
  leadId: string,
  by: string,
  upiRef?: string,
):
  | { ok: true; state: AdmissionsState; payment: RegistrationFeePayment }
  | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  const amount = registrationBalancePaise(state, lead);
  if (amount <= 0) {
    if (lead.registrationFeeAmountPaise <= 0) {
      return { ok: false, reason: "Set registration fee amount first" };
    }
    return { ok: false, reason: "Registration fee already fully paid" };
  }
  return takeRegistrationPayment(state, leadId, by, {
    amountPaise: amount,
    tenders: [
      {
        mode: "cash",
        amountPaise: amount,
        ref: upiRef || `CASH-${Date.now().toString(36).toUpperCase()}`,
      },
    ],
    note: "Collected at registration counter (cash)",
  });
}

function applyRegistrationLedgerSync(
  state: AdmissionsState,
  leadId: string,
  by: string,
  paymentId?: string,
): AdmissionsState {
  const sync = syncLeadRegistrationToLedger(state, leadId, by, paymentId);
  let next = sync.state;
  const lead = next.leads.find((l) => l.id === leadId);
  if (sync.result?.voucher) {
    const bal = lead ? registrationBalancePaise(next, lead) : 0;
    next = updateLead(next, leadId, {
      registrationFeeNote: [
        lead?.registrationFeeNote,
        `R receipt ${sync.result.voucher.receiptNo}`,
        bal > 0 ? `bal due ₹${(bal / 100).toFixed(0)}` : "fully paid",
      ]
        .filter(Boolean)
        .join(" · "),
    });
  } else if (sync.result?.cleared === "waived") {
    next = updateLead(next, leadId, {
      registrationFeeNote: `Waived · cleared on Fee Take ledger`,
    });
  }
  return next;
}

export function createRegistrationUpiLink(
  state: AdmissionsState,
  leadId: string,
  by: string,
  feeHeadName: string,
  amountPaise?: number,
):
  | { ok: true; state: AdmissionsState; payment: RegistrationFeePayment }
  | { ok: false; reason: string } {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, reason: "Lead not found" };
  const balance = registrationBalancePaise(state, lead);
  if (lead.registrationFeeAmountPaise <= 0) {
    return { ok: false, reason: "Set registration fee amount first" };
  }
  if (balance <= 0) {
    return { ok: false, reason: "Registration fee already fully paid" };
  }
  const amount = Math.max(
    0,
    Math.round(amountPaise != null ? amountPaise : balance),
  );
  if (amount <= 0) return { ok: false, reason: "Enter a link amount" };
  if (amount > balance) {
    return {
      ok: false,
      reason: `Link amount exceeds balance due (₹${(balance / 100).toFixed(0)})`,
    };
  }

  const seq = state.nextRegPaySeq || 1;
  const payment = normalizeRegistrationPayment({
    id: nid("rfp"),
    code: `RF-${padSeq(seq)}`,
    leadId,
    feeHeadId: lead.registrationFeeHeadId,
    feeHeadName: feeHeadName || "Registration fee",
    amountPaise: amount,
    status: "open",
    mode: "upi_link",
    tenders: [
      {
        mode: "upi",
        amountPaise: amount,
        ref: "",
        bankName: "",
        instrumentDate: "",
      },
    ],
    mobile: lead.mobile,
    childName: lead.childName,
    createdBy: by,
    note:
      amount < balance
        ? `UPI link · partial ₹${(amount / 100).toFixed(0)}`
        : "UPI / WhatsApp payment link",
  });

  let next: AdmissionsState = {
    ...state,
    nextRegPaySeq: seq + 1,
    registrationPayments: [payment, ...(state.registrationPayments || [])],
  };
  next = updateLead(next, leadId, {
    registrationPaymentId: payment.id,
    registrationPaymentStatus: "pending",
    registrationFeeNote: `Link ${payment.code} · ₹${(amount / 100).toFixed(0)}`,
  });
  return { ok: true, state: next, payment };
}

export function captureRegistrationPayment(
  state: AdmissionsState,
  paymentId: string,
  upiRef: string,
  /**
   * The gateway that captured it, when one did. Most callers are counter
   * collection — a clerk taking cash or a UPI into the school's own QR — and
   * that money really is in the bank, so the default is empty and only the
   * gateway webhook passes a provider.
   */
  gatewayProvider = "",
):
  | { ok: true; state: AdmissionsState; payment: RegistrationFeePayment }
  | { ok: false; reason: string } {
  const payment = (state.registrationPayments || []).find(
    (p) => p.id === paymentId,
  );
  if (!payment) return { ok: false, reason: "Payment not found" };
  if (payment.status === "paid") {
    return { ok: false, reason: "Already paid" };
  }
  if (payment.status === "waived" || payment.status === "cancelled") {
    return { ok: false, reason: "Payment cannot be captured" };
  }
  const ref = upiRef.trim() || `UPI-${payment.code}`;
  const tenders =
    payment.tenders.length > 0
      ? payment.tenders.map((t) => ({
          ...t,
          mode: (t.mode || "upi") as TenderMode,
          ref: t.ref || ref,
          instrumentDate: t.instrumentDate || new Date().toISOString().slice(0, 10),
          gatewayProvider: gatewayProvider || t.gatewayProvider || "",
        }))
      : [
          {
            ...normalizeRegistrationTender({
              mode: "upi",
              amountPaise: payment.amountPaise,
              ref,
              instrumentDate: new Date().toISOString().slice(0, 10),
            }),
            gatewayProvider,
          },
        ];
  const updated: RegistrationFeePayment = {
    ...payment,
    status: "paid",
    mode: payment.mode === "upi_link" ? "upi" : payment.mode,
    tenders,
    paidAt: new Date().toISOString(),
    upiRef: ref,
  };
  let next: AdmissionsState = {
    ...state,
    registrationPayments: (state.registrationPayments || []).map((p) =>
      p.id === paymentId ? updated : p,
    ),
  };
  next = updateLead(next, payment.leadId, {
    registrationPaymentId: payment.id,
  });
  const lead = next.leads.find((l) => l.id === payment.leadId);
  const collectedAfter = registrationCollectedPaise(next, payment.leadId);
  const total = lead?.registrationFeeAmountPaise || 0;
  const fullyPaid = total > 0 && collectedAfter >= total;
  next = refreshLeadRegistrationPaymentStatus(
    next,
    payment.leadId,
    fullyPaid
      ? `Paid ${updated.code} · ${updated.upiRef}`
      : `Partial ${updated.code} · ₹${(collectedAfter / 100).toFixed(0)}/₹${(total / 100).toFixed(0)}`,
  );
  next = applyRegistrationLedgerSync(
    next,
    payment.leadId,
    updated.createdBy || "Registration",
    paymentId,
  );
  return {
    ok: true,
    state: next,
    payment: next.registrationPayments.find((p) => p.id === paymentId)!,
  };
}

export function waiveRegistrationFee(
  state: AdmissionsState,
  leadId: string,
  reason: string,
  by: string,
): AdmissionsState {
  const seq = state.nextRegPaySeq || 1;
  const lead = state.leads.find((l) => l.id === leadId);
  const payment = normalizeRegistrationPayment({
    id: nid("rfp"),
    code: `RF-${padSeq(seq)}`,
    leadId,
    feeHeadId: lead?.registrationFeeHeadId || "",
    feeHeadName: "Waived",
    amountPaise: 0,
    status: "waived",
    mode: "waived",
    mobile: lead?.mobile || "",
    childName: lead?.childName || "",
    createdBy: by,
    paidAt: new Date().toISOString(),
    note: reason || "Fee waived",
  });
  const next: AdmissionsState = {
    ...state,
    nextRegPaySeq: seq + 1,
    registrationPayments: [payment, ...(state.registrationPayments || [])],
  };
  let out = updateLead(next, leadId, {
    registrationFeePaid: true,
    registrationPaymentId: payment.id,
    registrationPaymentStatus: "waived",
    registrationFeeNote: reason || "Waived",
  });
  out = applyRegistrationLedgerSync(out, leadId, by, payment.id);
  return out;
}

/**
 * Fee Take voided an R-series receipt — the CRM must stop saying "paid".
 * Looks the payment up by its posted fee voucher id; reopens it and
 * refreshes the lead's registration status. Safe to call for any voided
 * voucher: a non-registration receipt simply finds no payment.
 */
export function revertRegistrationPaymentForVoidedReceipt(
  feeVoucherId: string,
): boolean {
  if (!feeVoucherId) return false;
  const state = loadAdmissions();
  const payment = (state.registrationPayments || []).find(
    (p) => p.feeVoucherId === feeVoucherId && p.status === "paid",
  );
  if (!payment) return false;
  let next: AdmissionsState = {
    ...state,
    registrationPayments: (state.registrationPayments || []).map((p) =>
      p.id === payment.id
        ? {
            ...p,
            status: "open" as const,
            paidAt: "",
            note: [
              p.note,
              `R receipt ${p.feeReceiptNo || ""} voided at Fee Take`.trim(),
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : p,
    ),
  };
  next = refreshLeadRegistrationPaymentStatus(
    next,
    payment.leadId,
    `R receipt ${payment.feeReceiptNo || payment.code} voided — balance reopened`,
  );
  saveAdmissions(next);
  return true;
}

export type RegistrationPaySharePayload = {
  v: 1;
  paymentId: string;
  code: string;
  amountPaise: number;
  childName: string;
  leadId: string;
};

export function buildRegistrationPayPayload(
  payment: RegistrationFeePayment,
): RegistrationPaySharePayload {
  return {
    v: 1,
    paymentId: payment.id,
    code: payment.code,
    amountPaise: payment.amountPaise,
    childName: payment.childName,
    leadId: payment.leadId,
  };
}

export function encodeRegistrationPayPayload(
  payload: RegistrationPaySharePayload,
): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeRegistrationPayPayload(
  encoded: string,
): RegistrationPaySharePayload | null {
  try {
    const json = decodeURIComponent(
      escape(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))),
    );
    const parsed = JSON.parse(json) as RegistrationPaySharePayload;
    if (parsed?.v !== 1 || !parsed.paymentId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function registrationPayAbsoluteUrl(
  origin: string,
  payment: RegistrationFeePayment,
): string {
  const base = (origin || publicPortalOrigin()).replace(/\/$/, "");
  const hash = encodeRegistrationPayPayload(
    buildRegistrationPayPayload(payment),
  );
  return `${base}/registration/pay#${hash}`;
}

export function composeRegistrationWhatsAppMessage(
  payment: RegistrationFeePayment,
  payUrl: string,
  schoolName: string,
): string {
  const amt = (payment.amountPaise / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  return [
    `*${schoolName}*`,
    `Registration fee · ${payment.code}`,
    "",
    `${payment.childName}`,
    `Amount: *${amt}*`,
    "",
    "Pay online:",
    payUrl,
    "",
    "Or pay at school counter and share UTR.",
  ].join("\n");
}

/** Post-payment receipt for parent WhatsApp. */
export function composeRegistrationReceiptWhatsApp(
  payment: RegistrationFeePayment,
  schoolName: string,
  collectedBy: string,
): string {
  const amt = (payment.amountPaise / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  const paidAt = payment.paidAt
    ? new Date(payment.paidAt).toLocaleString("en-IN")
    : "—";
  const lines = [
    `*${schoolName}*`,
    `Registration fee receipt · ${payment.code}`,
    "",
    `Child: ${payment.childName}`,
    `Amount paid: *${amt}*`,
    `UTR / ref: ${payment.upiRef || "—"}`,
    `Paid at: ${paidAt}`,
  ];
  if (payment.feeReceiptNo) {
    lines.push(`Receipt (R): *${payment.feeReceiptNo}*`);
    lines.push("(Posted to student ledger — registration series)");
  } else {
    lines.push(
      "(Ledger posts with R-series receipt when the student is admitted to SIS)",
    );
  }
  if (collectedBy) lines.push(`Collected by: ${collectedBy}`);
  lines.push("", "Thank you. Keep this message as your receipt.");
  return lines.join("\n");
}

export function whatsAppUrl(mobile: string, message: string): string {
  const digits = mobile.replace(/\D/g, "");
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/** School collections UPI deep link for QR / intent. */
export function buildSchoolUpiPayUri(opts: {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  note: string;
}): string {
  const pa = (opts.vpa || "bhbschool@upi").trim();
  const pn = encodeURIComponent(opts.payeeName || "School");
  const am = (Math.max(0, opts.amountPaise) / 100).toFixed(2);
  const tn = encodeURIComponent((opts.note || "Registration").slice(0, 80));
  return `upi://pay?pa=${encodeURIComponent(pa)}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
}

export function resolveSchoolCollectionsUpi(masters?: {
  schoolProfile?: { collectionsUpiVpa?: string; displayName?: string };
}): { vpa: string; payeeName: string } {
  const vpa =
    (masters?.schoolProfile?.collectionsUpiVpa || "bhbschool@upi").trim() ||
    "bhbschool@upi";
  const payeeName =
    masters?.schoolProfile?.displayName?.trim() || "BHB International School";
  return { vpa, payeeName };
}

export function isLeadCaller(
  state: AdmissionsState,
  staffId: string | undefined | null,
): boolean {
  if (!staffId) return false;
  return (state.leadCallerStaffIds || []).includes(staffId);
}

export function setLeadCallerAssigned(
  state: AdmissionsState,
  staffId: string,
  assigned: boolean,
): AdmissionsState {
  const id = staffId.trim();
  if (!id) return state;
  const set = new Set(state.leadCallerStaffIds || []);
  if (assigned) set.add(id);
  else set.delete(id);
  return { ...state, leadCallerStaffIds: [...set] };
}

/**
 * Staff mobile capture from anywhere — no survey beat.
 * Source walk_in with campaign note marking staff mobile.
 */
export function createStaffMobileEnquiry(
  state: AdmissionsState,
  draft: Partial<AdmissionLead>,
  by: string,
):
  | {
      ok: true;
      state: AdmissionsState;
      lead: AdmissionLead;
      household: AdmissionHousehold;
      linkedExisting: boolean;
    }
  | { ok: false; reason: string } {
  return createEnquiry(
    state,
    {
      ...draft,
      source: draft.source || "walk_in",
      campaignNote:
        draft.campaignNote ||
        `Staff mobile · ${by}`.trim(),
      leadDate: draft.leadDate || today(),
      assignedTo: by,
      nextFollowUpAt: draft.nextFollowUpAt || today(),
    },
    by,
    // Staff capturing a lead on their phone: the class picker is labelled
    // "Class (optional)", so blank is a supported answer, not an accident.
    // Literal rather than `!draft.classSoughtId` — see createFieldSurveyEnquiry.
    { allowMissingClass: true },
  );
}

export function setLeadRegistrationFee(
  state: AdmissionsState,
  leadId: string,
  feeHeadId: string,
  feeAmountPaise: number,
): AdmissionsState {
  return updateLead(state, leadId, {
    registrationFeeHeadId: feeHeadId,
    registrationFeeAmountPaise: Math.max(0, Math.round(feeAmountPaise)),
  });
}

function normParentName(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(shri|smt|mr|mrs|ms)\.?\s+/i, "");
}

export type SisParentMatchReason =
  | "father_mobile"
  | "mother_mobile"
  | "household_mobile"
  | "father_name"
  | "mother_name"
  | "guardian_name";

export const SIS_PARENT_MATCH_LABELS: Record<SisParentMatchReason, string> = {
  father_mobile: "Father mobile match",
  mother_mobile: "Mother mobile match",
  household_mobile: "SIS household mobile match",
  father_name: "Father name match",
  mother_name: "Mother name match",
  guardian_name: "Guardian name match",
};

export type SisParentMatch = {
  householdId: string;
  householdCode: string;
  guardianName: string;
  mobile: string;
  score: number;
  reasons: SisParentMatchReason[];
  students: {
    id: string;
    fullName: string;
    admissionNo: string;
    srn: string;
    classId: string;
  }[];
};

/**
 * Suggest existing SIS families by parent/guardian name + mobile
 * (for CRM enquiry / Registration desk).
 */
export function suggestSisFamiliesByParent(input: {
  guardianName?: string;
  motherName?: string;
  mobile?: string;
  limit?: number;
}): SisParentMatch[] {
  const mobile = normalizeMobile(input.mobile || "");
  const fatherN = normParentName(input.guardianName || "");
  const motherN = normParentName(input.motherName || "");
  if (mobile.length !== 10 && fatherN.length < 3 && motherN.length < 3) {
    return [];
  }

  const sis = loadSis();
  const byHh = new Map<string, SisParentMatch>();

  for (const s of sis.students) {
    if (s.status !== "active") continue;
    const hh = sis.households.find((h) => h.id === s.householdId);
    const reasons: SisParentMatchReason[] = [];
    let score = 0;

    const fMob = normalizeMobile(s.fatherMobile);
    const mMob = normalizeMobile(s.motherMobile);
    const hMob = normalizeMobile(hh?.mobile || "");

    if (mobile.length === 10) {
      if (fMob === mobile) {
        reasons.push("father_mobile");
        score += 50;
      }
      if (mMob === mobile) {
        reasons.push("mother_mobile");
        score += 50;
      }
      if (hMob === mobile && !reasons.includes("father_mobile")) {
        reasons.push("household_mobile");
        score += 45;
      }
    }

    if (fatherN.length >= 3) {
      if (normParentName(s.fatherName) === fatherN) {
        reasons.push("father_name");
        score += 20;
      }
      if (
        hh &&
        normParentName(hh.guardianName) === fatherN &&
        !reasons.includes("father_name")
      ) {
        reasons.push("guardian_name");
        score += 15;
      }
    }

    if (motherN.length >= 3 && normParentName(s.motherName) === motherN) {
      reasons.push("mother_name");
      score += 18;
    }

    // Need mobile hit OR (name + another signal)
    const strong =
      reasons.includes("father_mobile") ||
      reasons.includes("mother_mobile") ||
      reasons.includes("household_mobile");
    const nameHit =
      reasons.includes("father_name") ||
      reasons.includes("mother_name") ||
      reasons.includes("guardian_name");
    if (!strong && !(nameHit && (fatherN.length >= 3 || motherN.length >= 3))) {
      continue;
    }
    if (!strong && nameHit && score < 20) continue;
    if (reasons.length === 0) continue;

    const hhId = s.householdId || s.id;
    const cur = byHh.get(hhId);
    const stu = {
      id: s.id,
      fullName: s.fullName,
      admissionNo: s.admissionNo,
      srn: s.srn,
      classId: s.classId,
    };
    if (cur) {
      cur.score = Math.max(cur.score, score);
      cur.reasons = [...new Set([...cur.reasons, ...reasons])];
      if (!cur.students.some((x) => x.id === s.id)) cur.students.push(stu);
    } else {
      byHh.set(hhId, {
        householdId: hhId,
        householdCode: hh?.code || "—",
        guardianName: hh?.guardianName || s.fatherName || "",
        mobile: hMob || fMob || mMob,
        score,
        reasons,
        students: [stu],
      });
    }
  }

  return [...byHh.values()]
    .sort((a, b) => b.score - a.score || a.guardianName.localeCompare(b.guardianName))
    .slice(0, input.limit ?? 5);
}
