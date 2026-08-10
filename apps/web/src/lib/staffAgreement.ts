/**
 * Staff employment agreements — templates, consent, signatures, audit trail.
 * Phase 1: in-app only (no e-sign provider, no Aadhaar OTP).
 */

import { normalizeSchoolProfile } from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";
import { assertModulePermission } from "@/lib/rbacGuard";
import {
  persistSeriesUse,
  suggestFromSeriesCode,
} from "@/lib/numberSeries";
import type { StaffRecord } from "@/lib/foundationMasters";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

export type AgreementTemplateId =
  | "appointment_letter"
  | "confidentiality"
  | "policy_acknowledgment"
  | "conduct_rules"
  | "custom";

export type AgreementStatus =
  | "draft"
  | "pending_staff"
  | "signed_staff"
  | "counter_signed"
  | "void";

export const CONSENT_TEXT =
  "I have read and understood the terms of this agreement and agree to abide by them.";

export const CONSENT_TEXT_VERSION = "v1";

export type AgreementAuditEntry = {
  id: string;
  action:
    | "created"
    | "updated"
    | "sent"
    | "signed_staff"
    | "counter_signed"
    | "voided";
  at: string;
  staffId: string;
  actorId: string;
  actorName: string;
  userAgent: string;
  documentHash: string;
  consentTextVersion: string;
};

export type StaffAgreement = {
  id: string;
  /** Formatted agreement number from STAFF_AGREEMENT series */
  agreementNo: string;
  templateId: AgreementTemplateId;
  staffId: string;
  empCode: string;
  staffName: string;
  status: AgreementStatus;
  title: string;
  /** Resolved body text (placeholders filled) */
  body: string;
  consentTextVersion: string;
  consentAccepted: boolean;
  staffSignatureUrl: string;
  staffSignedAt: string;
  counterSignedAt: string;
  counterSignedBy: string;
  /** Locked PDF data URL after staff signs */
  pdfDataUrl: string;
  documentHash: string;
  audit: AgreementAuditEntry[];
  createdBy: string;
  createdAt: string;
  sentAt: string;
};

export type AgreementState = {
  version: 1;
  agreements: StaffAgreement[];
};

export type AgreementTemplate = {
  id: AgreementTemplateId;
  label: string;
  title: string;
  body: string;
};

const STORAGE_KEY = "bhb_staff_agreements_v1";

const TEMPLATE_BODIES: Record<AgreementTemplateId, { title: string; body: string }> = {
  appointment_letter: {
    title: "Appointment Letter",
    body: `Dear {{staffName}},

We are pleased to appoint you as {{designation}} in the {{department}} department at {{schoolName}}, effective from {{joinDate}}.

Your employee code is {{empCode}}. This appointment is subject to the rules, policies, and conduct standards of the institution.

You are expected to discharge your duties with diligence, maintain professional decorum, and comply with all statutory and school-specific requirements.

We welcome you to {{schoolName}} and look forward to a productive association.

Date: {{today}}
{{schoolName}}
{{schoolAddress}}`,
  },
  confidentiality: {
    title: "Confidentiality Agreement",
    body: `CONFIDENTIALITY AND NON-DISCLOSURE AGREEMENT

This agreement is entered into between {{schoolName}} ("the School") and {{staffName}} (Employee Code: {{empCode}}), {{designation}}, {{department}}.

1. The staff member shall not disclose confidential information relating to students, parents, staff, finances, examinations, or internal operations of the School to any unauthorized person.

2. Confidential information includes but is not limited to academic records, fee data, HR records, examination materials, and strategic plans.

3. This obligation continues during employment and after separation from the School.

4. Breach of this agreement may result in disciplinary action including termination and legal remedies as applicable.

Signed at {{schoolName}} on {{today}}.
{{schoolAddress}}`,
  },
  policy_acknowledgment: {
    title: "Policy Acknowledgment",
    body: `POLICY ACKNOWLEDGMENT

Employee: {{staffName}} ({{empCode}})
Designation: {{designation}}
Department: {{department}}
School: {{schoolName}}

I acknowledge that I have received, read, and understood the School's policies including but not limited to:

• Code of conduct and professional ethics
• Child safety and POCSO compliance
• IT and data security policy
• Leave and attendance rules
• Anti-harassment and grievance redressal

I agree to comply with all policies as amended from time to time. Failure to comply may result in disciplinary action.

Date: {{today}}
{{schoolAddress}}`,
  },
  conduct_rules: {
    title: "Conduct Rules",
    body: `STAFF CONDUCT RULES — ACKNOWLEDGMENT

Name: {{staffName}}
Employee Code: {{empCode}}
Designation: {{designation}}
Department: {{department}}
Joining Date: {{joinDate}}

As a member of {{schoolName}}, I agree to:

1. Maintain punctuality, decorum, and respect toward students, parents, colleagues, and visitors.
2. Refrain from conduct that harms the reputation of the School or violates applicable law.
3. Use school property and resources responsibly and only for authorized purposes.
4. Report safety concerns, misconduct, or policy violations to the appropriate authority.
5. Follow dress code, communication norms, and classroom/professional boundaries as prescribed.

I understand that violation of conduct rules may lead to warning, suspension, or termination.

Acknowledged on {{today}} at {{schoolName}}.
{{schoolAddress}}`,
  },
  custom: {
    title: "Employment Agreement",
    body: `EMPLOYMENT AGREEMENT

Employee: {{staffName}} ({{empCode}})
Designation: {{designation}}
Department: {{department}}
School: {{schoolName}}

[Edit this draft or generate with AI before sending to staff.]

Date: {{today}}
{{schoolAddress}}`,
  },
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function agreementTemplates(): AgreementTemplate[] {
  return (Object.keys(TEMPLATE_BODIES) as AgreementTemplateId[]).map((id) => ({
    id,
    label: TEMPLATE_BODIES[id].title,
    title: TEMPLATE_BODIES[id].title,
    body: TEMPLATE_BODIES[id].body,
  }));
}

export function templateLabel(id: AgreementTemplateId): string {
  return TEMPLATE_BODIES[id]?.title ?? id;
}

export function agreementStatusLabel(status: AgreementStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "pending_staff":
      return "Pending staff";
    case "signed_staff":
      return "Signed by staff";
    case "counter_signed":
      return "Counter-signed";
    case "void":
      return "Void";
    default:
      return status;
  }
}

/** Simple deterministic content hash for audit trail. */
export function computeAgreementHash(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = (h * 33) ^ content.charCodeAt(i);
  }
  return `h${(h >>> 0).toString(16)}`;
}

export function resolveAgreementPlaceholders(
  text: string,
  staff: StaffRecord,
  masters: MastersState,
): string {
  const profile = normalizeSchoolProfile(masters.schoolProfile);
  const dep = masters.departments.find((d) => d.id === staff.departmentId);
  const des = masters.designations.find((d) => d.id === staff.designationId);
  const today = new Date().toISOString().slice(0, 10);
  const schoolAddress = [
    profile.address,
    profile.city,
    profile.state,
    profile.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  const map: Record<string, string> = {
    staffName: staff.fullName,
    empCode: staff.empCode,
    designation: des?.name ?? "—",
    department: dep?.name ?? "—",
    joinDate: staff.joiningDate?.slice(0, 10) || "—",
    schoolName: profile.displayName || "School",
    schoolAddress: schoolAddress || "—",
    today,
  };

  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => map[key] ?? `{{${key}}}`);
}

function clientHint(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent?.slice(0, 240) ?? "";
}

function normalizeAudit(a: Partial<AgreementAuditEntry>): AgreementAuditEntry {
  return {
    id: String(a.id || nid("aa")),
    action: (a.action as AgreementAuditEntry["action"]) || "created",
    at: String(a.at || ""),
    staffId: String(a.staffId || ""),
    actorId: String(a.actorId || ""),
    actorName: String(a.actorName || ""),
    userAgent: String(a.userAgent || ""),
    documentHash: String(a.documentHash || ""),
    consentTextVersion: String(a.consentTextVersion || CONSENT_TEXT_VERSION),
  };
}

function normalizeAgreement(a: Partial<StaffAgreement>): StaffAgreement {
  const templateId = (a.templateId as AgreementTemplateId) || "appointment_letter";
  const tpl = TEMPLATE_BODIES[templateId] ?? TEMPLATE_BODIES.appointment_letter;
  const status = (a.status as AgreementStatus) || "draft";
  return {
    id: String(a.id || nid("agr")),
    agreementNo: String(a.agreementNo || ""),
    templateId,
    staffId: String(a.staffId || ""),
    empCode: String(a.empCode || ""),
    staffName: String(a.staffName || ""),
    status,
    title: String(a.title || tpl.title),
    body: String(a.body || tpl.body),
    consentTextVersion: String(a.consentTextVersion || CONSENT_TEXT_VERSION),
    consentAccepted: Boolean(a.consentAccepted),
    staffSignatureUrl: String(a.staffSignatureUrl || ""),
    staffSignedAt: String(a.staffSignedAt || ""),
    counterSignedAt: String(a.counterSignedAt || ""),
    counterSignedBy: String(a.counterSignedBy || ""),
    pdfDataUrl: String(a.pdfDataUrl || ""),
    documentHash: String(a.documentHash || ""),
    audit: Array.isArray(a.audit) ? a.audit.map(normalizeAudit) : [],
    createdBy: String(a.createdBy || ""),
    createdAt: String(a.createdAt || ""),
    sentAt: String(a.sentAt || ""),
  };
}

export function loadAgreements(): AgreementState {
  if (typeof window === "undefined") return { version: 1, agreements: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, agreements: [] };
    const parsed = JSON.parse(raw) as Partial<AgreementState>;
    return {
      version: 1,
      agreements: Array.isArray(parsed.agreements)
        ? parsed.agreements.map(normalizeAgreement)
        : [],
    };
  } catch {
    return { version: 1, agreements: [] };
  }
}

function persistAgreements(state: AgreementState) {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/staffAgreementPersistence").then(
    ({ scheduleStaffAgreementsSync }) => {
      scheduleStaffAgreementsSync(state);
    },
  );
}

export function saveAgreements(state: AgreementState) {
  if (!assertModulePermission("staff", "edit", "saveAgreements")) return;
  persistAgreements(state);
}

export function writeAgreementsLocalRaw(state: AgreementState) {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
}

export function agreementsStateIsEmpty(state: AgreementState): boolean {
  return (state.agreements?.length ?? 0) === 0;
}

export function agreementsForStaff(staffId: string): StaffAgreement[] {
  return loadAgreements()
    .agreements.filter((a) => a.staffId === staffId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function pendingAgreementForStaff(staffId: string): StaffAgreement | null {
  return agreementsForStaff(staffId).find((a) => a.status === "pending_staff") ?? null;
}

function allocateStaffAgreementNumber(masters: MastersState): string {
  const state = loadAgreements();
  const existing = state.agreements.map((a) => a.agreementNo);
  const suggested = suggestFromSeriesCode(
    masters.numberSeries,
    "STAFF_AGREEMENT",
    undefined,
    existing,
  );
  if (suggested) {
    persistSeriesUse("STAFF_AGREEMENT", undefined, suggested);
    return suggested;
  }
  return `AGR-${String(existing.length + 1).padStart(4, "0")}`;
}

function pushAudit(
  agreement: StaffAgreement,
  entry: Omit<AgreementAuditEntry, "id">,
): StaffAgreement {
  return normalizeAgreement({
    ...agreement,
    audit: [...agreement.audit, normalizeAudit({ ...entry, id: nid("aa") })],
  });
}

export function createStaffAgreement(input: {
  masters: MastersState;
  staffId: string;
  templateId: AgreementTemplateId;
  createdBy: string;
  actorStaffId?: string;
  /** Override template title (e.g. from AI) */
  title?: string;
  /** Override template body before placeholder resolution */
  bodyTemplate?: string;
}): { ok: true; agreement: StaffAgreement } | { ok: false; error: string } {
  const staff = (input.masters.staff ?? []).find((s) => s.id === input.staffId);
  if (!staff) return { ok: false, error: "Staff not found" };
  const tpl = TEMPLATE_BODIES[input.templateId];
  const rawBody = input.bodyTemplate?.trim() || tpl.body;
  const title = input.title?.trim() || tpl.title;
  const body = resolveAgreementPlaceholders(rawBody, staff, input.masters);
  const hash = computeAgreementHash(`${title}\n${body}`);

  const agreement = normalizeAgreement({
    id: nid("agr"),
    agreementNo: allocateStaffAgreementNumber(input.masters),
    templateId: input.templateId,
    staffId: staff.id,
    empCode: staff.empCode,
    staffName: staff.fullName,
    status: "draft",
    title,
    body,
    documentHash: hash,
    consentTextVersion: CONSENT_TEXT_VERSION,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    audit: [],
  });

  const withAudit = pushAudit(agreement, {
    action: "created",
    at: agreement.createdAt,
    staffId: staff.id,
    actorId: input.actorStaffId || "",
    actorName: input.createdBy,
    userAgent: clientHint(),
    documentHash: hash,
    consentTextVersion: CONSENT_TEXT_VERSION,
  });

  const state = loadAgreements();
  saveAgreements({
    version: 1,
    agreements: [withAudit, ...state.agreements],
  });
  return { ok: true, agreement: withAudit };
}

export function updateStaffAgreementDraft(
  agreementId: string,
  patch: { title?: string; body?: string },
  actor: { name: string; staffId?: string },
): { ok: true; agreement: StaffAgreement } | { ok: false; error: string } {
  const state = loadAgreements();
  const row = state.agreements.find((a) => a.id === agreementId);
  if (!row) return { ok: false, error: "Agreement not found" };
  if (row.status !== "draft") {
    return { ok: false, error: "Only draft agreements can be edited" };
  }

  const title = patch.title !== undefined ? patch.title.trim() : row.title;
  const body = patch.body !== undefined ? patch.body.trim() : row.body;
  if (!title || !body) {
    return { ok: false, error: "Title and body are required" };
  }

  const hash = computeAgreementHash(`${title}\n${body}`);
  const at = new Date().toISOString();
  let next = normalizeAgreement({
    ...row,
    title,
    body,
    documentHash: hash,
  });
  next = pushAudit(next, {
    action: "updated",
    at,
    staffId: row.staffId,
    actorId: actor.staffId || "",
    actorName: actor.name,
    userAgent: clientHint(),
    documentHash: hash,
    consentTextVersion: row.consentTextVersion,
  });

  const agreements = state.agreements.map((a) =>
    a.id === agreementId ? next : a,
  );
  saveAgreements({ version: 1, agreements });
  return { ok: true, agreement: next };
}

export function sendStaffAgreement(
  agreementId: string,
  actor: { name: string; staffId?: string },
): { ok: true; agreement: StaffAgreement } | { ok: false; error: string } {
  const state = loadAgreements();
  const row = state.agreements.find((a) => a.id === agreementId);
  if (!row) return { ok: false, error: "Agreement not found" };
  if (row.status !== "draft") {
    return { ok: false, error: "Only draft agreements can be sent" };
  }

  const at = new Date().toISOString();
  let next = normalizeAgreement({
    ...row,
    status: "pending_staff",
    sentAt: at,
  });
  next = pushAudit(next, {
    action: "sent",
    at,
    staffId: row.staffId,
    actorId: actor.staffId || "",
    actorName: actor.name,
    userAgent: clientHint(),
    documentHash: row.documentHash,
    consentTextVersion: row.consentTextVersion,
  });

  const agreements = state.agreements.map((a) =>
    a.id === agreementId ? next : a,
  );
  saveAgreements({ version: 1, agreements });
  return { ok: true, agreement: next };
}

export async function signStaffAgreement(input: {
  agreementId: string;
  staffId: string;
  signatureUrl: string;
  consentAccepted: boolean;
  actorName: string;
  masters: MastersState;
}): Promise<
  { ok: true; agreement: StaffAgreement } | { ok: false; error: string }
> {
  if (!input.consentAccepted) {
    return { ok: false, error: "Accept the consent checkbox to sign" };
  }
  if (!input.signatureUrl) {
    return { ok: false, error: "Add your signature" };
  }

  const state = loadAgreements();
  const row = state.agreements.find((a) => a.id === input.agreementId);
  if (!row) return { ok: false, error: "Agreement not found" };
  if (row.staffId !== input.staffId) {
    return { ok: false, error: "You can only sign your own agreement" };
  }
  if (row.status !== "pending_staff") {
    return { ok: false, error: "This agreement is not awaiting your signature" };
  }

  const at = new Date().toISOString();
  let next = normalizeAgreement({
    ...row,
    status: "signed_staff",
    consentAccepted: true,
    staffSignatureUrl: input.signatureUrl,
    staffSignedAt: at,
  });

  const { generateStaffAgreementPdf } = await import("@/lib/staffAgreementPdf");
  const pdfDataUrl = await generateStaffAgreementPdf(next, input.masters, {
    includePrincipalStamp: false,
  });
  next = normalizeAgreement({ ...next, pdfDataUrl });

  next = pushAudit(next, {
    action: "signed_staff",
    at,
    staffId: input.staffId,
    actorId: input.staffId,
    actorName: input.actorName,
    userAgent: clientHint(),
    documentHash: row.documentHash,
    consentTextVersion: CONSENT_TEXT_VERSION,
  });

  const agreements = state.agreements.map((a) =>
    a.id === input.agreementId ? next : a,
  );
  persistAgreements({ version: 1, agreements });
  return { ok: true, agreement: next };
}

export async function counterSignStaffAgreement(input: {
  agreementId: string;
  actorName: string;
  actorStaffId?: string;
  masters: MastersState;
}): Promise<
  { ok: true; agreement: StaffAgreement } | { ok: false; error: string }
> {
  const state = loadAgreements();
  const row = state.agreements.find((a) => a.id === input.agreementId);
  if (!row) return { ok: false, error: "Agreement not found" };
  if (row.status !== "signed_staff") {
    return { ok: false, error: "Staff must sign before counter-sign" };
  }

  const at = new Date().toISOString();
  let next = normalizeAgreement({
    ...row,
    status: "counter_signed",
    counterSignedAt: at,
    counterSignedBy: input.actorName,
  });

  const { generateStaffAgreementPdf } = await import("@/lib/staffAgreementPdf");
  const pdfDataUrl = await generateStaffAgreementPdf(next, input.masters, {
    includePrincipalStamp: true,
  });
  next = normalizeAgreement({ ...next, pdfDataUrl });

  next = pushAudit(next, {
    action: "counter_signed",
    at,
    staffId: row.staffId,
    actorId: input.actorStaffId || "",
    actorName: input.actorName,
    userAgent: clientHint(),
    documentHash: row.documentHash,
    consentTextVersion: row.consentTextVersion,
  });

  const agreements = state.agreements.map((a) =>
    a.id === input.agreementId ? next : a,
  );
  saveAgreements({ version: 1, agreements });
  return { ok: true, agreement: next };
}

export function voidStaffAgreement(
  agreementId: string,
  actor: { name: string; staffId?: string },
): { ok: true } | { ok: false; error: string } {
  const state = loadAgreements();
  const row = state.agreements.find((a) => a.id === agreementId);
  if (!row) return { ok: false, error: "Agreement not found" };
  if (row.status === "void") return { ok: false, error: "Already void" };
  if (row.status === "counter_signed") {
    return { ok: false, error: "Cannot void a counter-signed agreement" };
  }

  const at = new Date().toISOString();
  let next = normalizeAgreement({ ...row, status: "void" });
  next = pushAudit(next, {
    action: "voided",
    at,
    staffId: row.staffId,
    actorId: actor.staffId || "",
    actorName: actor.name,
    userAgent: clientHint(),
    documentHash: row.documentHash,
    consentTextVersion: row.consentTextVersion,
  });

  const agreements = state.agreements.map((a) =>
    a.id === agreementId ? next : a,
  );
  saveAgreements({ version: 1, agreements });
  return { ok: true };
}
