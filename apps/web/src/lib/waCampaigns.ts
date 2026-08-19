/**
 * WhatsApp campaign CRM — audience lists, multi-campaign scheduling,
 * message queue. Auto-broadcast needs BSP + worker; until then dispatch
 * stubs enqueue and support open-wa.me for small batches.
 */

import {
  campaignGuardianName,
  captureYear,
  createRegistrationUpiLink,
  publicRegisterAbsoluteUrl,
  registrationBalancePaise,
  registrationPayAbsoluteUrl,
  type AdmissionLead,
  type AdmissionStage,
  type AdmissionsState,
  type RegistrationFeePayment,
} from "@/lib/admissions";
import { formatInr } from "@/lib/fees";
import { TENANT } from "@/lib/types";

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
const STORAGE_KEY = "bhb_wa_campaigns_v1";
export const WA_ME_BATCH_CAP = 20;

/** Concrete fee statuses (empty array in filters = any) */
export type AudienceFeeFilterValue =
  | "unpaid"
  | "partial"
  | "paid"
  | "waived"
  | "pending";

/** @deprecated use AudienceFeeFilterValue — kept for old localStorage */
export type AudienceFeeFilter = AudienceFeeFilterValue | "any";

export type AudienceListFilters = {
  stages: AdmissionStage[];
  /** Multi: empty = any fee status */
  feeStatuses: AudienceFeeFilterValue[];
  /** Multi academic session codes e.g. 2025-26 */
  academicYearCodes: string[];
  /** Multi calendar capture years from enquiry leadDate e.g. 2026 */
  captureYears: string[];
  /** Multi class ids */
  classSoughtIds: string[];
  /** Multi admission sources */
  sources: string[];
  localityContains: string;
  includeLeadIds: string[];
  excludeLeadIds: string[];
};

export type AudienceList = {
  id: string;
  name: string;
  filters: AudienceListFilters;
  leadIds: string[];
  count: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type CampaignTemplateKey =
  | "registration_invite"
  | "fee_reminder"
  | "open_day"
  | "custom";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "done";

export type WaCampaign = {
  id: string;
  name: string;
  listId: string;
  templateKey: CampaignTemplateKey;
  body: string;
  status: CampaignStatus;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  note: string;
  /** Masters WhatsApp template registry id (approved Meta template) */
  registryTemplateId: string;
  /** Meta template name when using registry */
  registryMetaName: string;
  registryLanguage: string;
  /** Set when this campaign is one step of a nurture sequence */
  sequenceId: string;
  /** 1-based step number within the sequence */
  sequenceStep: number;
};

/* ─── Nurture sequences (drip) ───────────────────────────────────────── */

export type WaSequenceStep = {
  id: string;
  /** Days relative to the anchor date (negative = before, e.g. −7 before an event) */
  dayOffset: number;
  /** HH:MM IST send time */
  time: string;
  label: string;
  templateKey: CampaignTemplateKey;
  body: string;
};

export type WaSequenceStatus = "draft" | "started" | "stopped";

export type WaSequence = {
  id: string;
  name: string;
  listId: string;
  /** What the offsets are relative to: "start" = the day it is started, "event" = an event date */
  anchor: "start" | "event";
  /** YYYY-MM-DD event date when anchor = event */
  eventDate: string;
  steps: WaSequenceStep[];
  status: WaSequenceStatus;
  startedAt: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  note: string;
};

export type CampaignMessageStatus =
  | "queued"
  | "sent"
  | "failed"
  | "skipped";

export type CampaignMessage = {
  id: string;
  campaignId: string;
  leadId: string;
  mobile: string;
  childName: string;
  body: string;
  status: CampaignMessageStatus;
  sentAt: string;
  error: string;
  waMeUrl: string;
};

export type WaCampaignsState = {
  version: 1;
  lists: AudienceList[];
  campaigns: WaCampaign[];
  messages: CampaignMessage[];
  sequences: WaSequence[];
  nextListSeq: number;
  nextCampaignSeq: number;
};

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultAudienceFilters(): AudienceListFilters {
  return {
    stages: [],
    feeStatuses: [],
    academicYearCodes: [],
    captureYears: [],
    classSoughtIds: [],
    sources: [],
    localityContains: "",
    includeLeadIds: [],
    excludeLeadIds: [],
  };
}

export function defaultWaCampaignsState(): WaCampaignsState {
  return {
    version: 1,
    lists: [],
    campaigns: [],
    messages: [],
    sequences: [],
    nextListSeq: 1,
    nextCampaignSeq: 1,
  };
}

const FEE_VALUES: AudienceFeeFilterValue[] = [
  "unpaid",
  "partial",
  "paid",
  "waived",
  "pending",
];

function asFeeValues(raw: unknown): AudienceFeeFilterValue[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is AudienceFeeFilterValue =>
      FEE_VALUES.includes(x as AudienceFeeFilterValue),
    );
  }
  if (typeof raw === "string" && FEE_VALUES.includes(raw as AudienceFeeFilterValue)) {
    return [raw as AudienceFeeFilterValue];
  }
  return [];
}

function asStringList(raw: unknown, legacySingle?: string): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map((s) => s.trim()).filter(Boolean);
  }
  const single = (legacySingle || "").trim();
  return single ? [single] : [];
}

function normalizeFilters(
  raw: Partial<AudienceListFilters> & {
    feeStatus?: AudienceFeeFilter;
    academicYearCode?: string;
    classSoughtId?: string;
    source?: string;
  } | null | undefined,
): AudienceListFilters {
  const d = defaultAudienceFilters();
  if (!raw) return d;

  let feeStatuses = asFeeValues(
    (raw as { feeStatuses?: unknown }).feeStatuses,
  );
  if (
    feeStatuses.length === 0 &&
    raw.feeStatus &&
    raw.feeStatus !== "any" &&
    FEE_VALUES.includes(raw.feeStatus as AudienceFeeFilterValue)
  ) {
    feeStatuses = [raw.feeStatus as AudienceFeeFilterValue];
  }

  return {
    stages: Array.isArray(raw.stages)
      ? (raw.stages.filter(Boolean) as AdmissionStage[])
      : d.stages,
    feeStatuses,
    academicYearCodes: asStringList(
      (raw as { academicYearCodes?: unknown }).academicYearCodes,
      raw.academicYearCode,
    ),
    captureYears: asStringList(
      (raw as { captureYears?: unknown }).captureYears,
    ),
    classSoughtIds: asStringList(
      (raw as { classSoughtIds?: unknown }).classSoughtIds,
      raw.classSoughtId,
    ),
    sources: asStringList(
      (raw as { sources?: unknown }).sources,
      raw.source,
    ),
    localityContains: (raw.localityContains || "").trim(),
    includeLeadIds: Array.isArray(raw.includeLeadIds)
      ? raw.includeLeadIds.filter(Boolean)
      : [],
    excludeLeadIds: Array.isArray(raw.excludeLeadIds)
      ? raw.excludeLeadIds.filter(Boolean)
      : [],
  };
}

function normalizeList(raw: Partial<AudienceList>): AudienceList {
  const t = nowIso();
  return {
    id: raw.id || nid("wal"),
    name: (raw.name || "Untitled list").trim(),
    filters: normalizeFilters(raw.filters),
    leadIds: Array.isArray(raw.leadIds) ? raw.leadIds.filter(Boolean) : [],
    count: Math.max(0, Math.round(Number(raw.count) || 0)),
    note: raw.note || "",
    createdAt: raw.createdAt || t,
    updatedAt: raw.updatedAt || t,
    createdBy: raw.createdBy || "",
  };
}

function normalizeCampaign(raw: Partial<WaCampaign>): WaCampaign {
  const t = nowIso();
  const key = raw.templateKey;
  return {
    id: raw.id || nid("wac"),
    name: (raw.name || "Untitled campaign").trim(),
    listId: raw.listId || "",
    templateKey:
      key === "fee_reminder" ||
      key === "open_day" ||
      key === "custom" ||
      key === "registration_invite"
        ? key
        : "registration_invite",
    body: raw.body || defaultTemplateBody("registration_invite"),
    status:
      raw.status === "scheduled" ||
      raw.status === "running" ||
      raw.status === "paused" ||
      raw.status === "done" ||
      raw.status === "draft"
        ? raw.status
        : "draft",
    scheduledAt: (raw.scheduledAt || "").slice(0, 16),
    createdAt: raw.createdAt || t,
    updatedAt: raw.updatedAt || t,
    createdBy: raw.createdBy || "",
    note: raw.note || "",
    registryTemplateId: String(raw.registryTemplateId || ""),
    registryMetaName: String(raw.registryMetaName || ""),
    registryLanguage: String(raw.registryLanguage || ""),
    sequenceId: String(raw.sequenceId || ""),
    sequenceStep: Math.max(0, Math.round(Number(raw.sequenceStep) || 0)),
  };
}

function validHhmm(t: string): boolean {
  const m = t.match(/^(\d{2}):(\d{2})$/);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function normalizeTemplateKey(key: unknown): CampaignTemplateKey {
  return key === "fee_reminder" || key === "open_day" || key === "custom" || key === "registration_invite"
    ? key
    : "custom";
}

function normalizeSequence(raw: Partial<WaSequence>): WaSequence {
  const t = nowIso();
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((st) => {
      const x = (st ?? {}) as Partial<WaSequenceStep>;
      const body = String(x.body || "").trim();
      return {
        id: x.id || nid("seq_step"),
        dayOffset: Math.max(-60, Math.min(120, Math.round(Number(x.dayOffset) || 0))),
        time: validHhmm(String(x.time || "")) ? String(x.time) : "10:00",
        label: String(x.label || "").trim().slice(0, 80),
        templateKey: normalizeTemplateKey(x.templateKey),
        body,
      };
    })
    .slice(0, 12);
  return {
    id: raw.id || nid("seq"),
    name: String(raw.name || "Untitled sequence").trim().slice(0, 120),
    listId: String(raw.listId || ""),
    anchor: raw.anchor === "event" ? "event" : "start",
    eventDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.eventDate || "")) ? String(raw.eventDate) : "",
    steps,
    status: raw.status === "started" || raw.status === "stopped" ? raw.status : "draft",
    startedAt: String(raw.startedAt || ""),
    createdAt: raw.createdAt || t,
    updatedAt: raw.updatedAt || t,
    createdBy: String(raw.createdBy || ""),
    note: String(raw.note || "").slice(0, 400),
  };
}

function normalizeMessage(raw: Partial<CampaignMessage>): CampaignMessage {
  return {
    id: raw.id || nid("wam"),
    campaignId: raw.campaignId || "",
    leadId: raw.leadId || "",
    mobile: (raw.mobile || "").replace(/\D/g, "").slice(0, 10),
    childName: raw.childName || "",
    body: raw.body || "",
    status:
      raw.status === "sent" ||
      raw.status === "failed" ||
      raw.status === "skipped" ||
      raw.status === "queued"
        ? raw.status
        : "queued",
    sentAt: raw.sentAt || "",
    error: raw.error || "",
    waMeUrl: raw.waMeUrl || "",
  };
}

export function normalizeWaCampaignsState(
  raw: Partial<WaCampaignsState> | null | undefined,
): WaCampaignsState {
  const d = defaultWaCampaignsState();
  if (!raw) return d;
  return {
    version: 1,
    lists: (Array.isArray(raw.lists) ? raw.lists : []).map((l) =>
      normalizeList(l),
    ),
    campaigns: (Array.isArray(raw.campaigns) ? raw.campaigns : []).map((c) =>
      normalizeCampaign(c),
    ),
    messages: (Array.isArray(raw.messages) ? raw.messages : []).map((m) =>
      normalizeMessage(m),
    ),
    sequences: (Array.isArray(raw.sequences) ? raw.sequences : []).map((q) =>
      normalizeSequence(q),
    ),
    nextListSeq:
      Number.isFinite(Number(raw.nextListSeq)) && Number(raw.nextListSeq) > 0
        ? Math.round(Number(raw.nextListSeq))
        : d.nextListSeq,
    nextCampaignSeq:
      Number.isFinite(Number(raw.nextCampaignSeq)) &&
      Number(raw.nextCampaignSeq) > 0
        ? Math.round(Number(raw.nextCampaignSeq))
        : d.nextCampaignSeq,
  };
}

export function loadWaCampaigns(): WaCampaignsState {
  if (typeof window === "undefined") return defaultWaCampaignsState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultWaCampaignsState();
    return normalizeWaCampaignsState(
      JSON.parse(raw) as Partial<WaCampaignsState>,
    );
  } catch {
    return defaultWaCampaignsState();
  }
}

export function saveWaCampaigns(state: WaCampaignsState): void {
  if (!assertModulePermission("admissions", "edit", "saveWaCampaigns")) return;
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("wa_campaigns", state));
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeWaCampaignsLocalRaw(state: WaCampaignsState): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
}

export function feeStatusOfLead(
  admissions: AdmissionsState,
  lead: AdmissionLead,
): AudienceFeeFilterValue | "any" {
  if (lead.registrationPaymentStatus === "waived") return "waived";
  if (lead.registrationPaymentStatus === "paid" || lead.registrationFeePaid) {
    return "paid";
  }
  if (lead.registrationPaymentStatus === "partial") return "partial";
  if (lead.registrationPaymentStatus === "pending") return "pending";
  const bal = registrationBalancePaise(admissions, lead);
  if (bal > 0 && bal < lead.registrationFeeAmountPaise) return "partial";
  if (lead.registrationFeeAmountPaise > 0 && bal > 0) return "unpaid";
  if (lead.registrationFeeAmountPaise > 0 && bal <= 0) return "paid";
  return "any";
}

/** CRM enquiry priority: newer capture year first, then newer leadDate. */
export function compareLeadsByEnquiryPriority(
  a: AdmissionLead,
  b: AdmissionLead,
): number {
  const ya = captureYear(a);
  const yb = captureYear(b);
  if (ya !== yb) return yb.localeCompare(ya);
  const da = (a.leadDate || a.createdAt || "").slice(0, 10);
  const db = (b.leadDate || b.createdAt || "").slice(0, 10);
  if (da !== db) return db.localeCompare(da);
  const stageRank = (s: AdmissionStage) =>
    s === "enquiry" ? 0 : s === "applied" ? 1 : s === "verified" ? 2 : 3;
  const sr = stageRank(a.stage) - stageRank(b.stage);
  if (sr !== 0) return sr;
  return (b.createdAt || "").localeCompare(a.createdAt || "");
}

export function resolveAudienceLeads(
  admissions: AdmissionsState,
  filters: AudienceListFilters,
): AdmissionLead[] {
  const f = normalizeFilters(filters);
  let leads = admissions.leads.filter((l) => l.stage !== "lost");

  if (f.stages.length > 0) {
    leads = leads.filter((l) => f.stages.includes(l.stage));
  }
  if (f.academicYearCodes.length > 0) {
    const set = new Set(f.academicYearCodes);
    leads = leads.filter((l) => set.has(l.academicYearCode));
  }
  if (f.captureYears.length > 0) {
    const set = new Set(f.captureYears);
    leads = leads.filter((l) => set.has(captureYear(l)));
  }
  if (f.classSoughtIds.length > 0) {
    const set = new Set(f.classSoughtIds);
    leads = leads.filter(
      (l) => set.has(l.classSoughtId) || set.has(l.classAdmittedId),
    );
  }
  if (f.localityContains) {
    const q = f.localityContains.toLowerCase();
    leads = leads.filter(
      (l) =>
        (l.locality || "").toLowerCase().includes(q) ||
        (l.address || "").toLowerCase().includes(q) ||
        (l.campaignNote || "").toLowerCase().includes(q),
    );
  }
  if (f.sources.length > 0) {
    const set = new Set(f.sources);
    leads = leads.filter((l) => set.has(l.source));
  }
  if (f.feeStatuses.length > 0) {
    leads = leads.filter((l) => {
      const st = feeStatusOfLead(admissions, l);
      return st !== "any" && f.feeStatuses.includes(st);
    });
  }
  if (f.excludeLeadIds.length) {
    const ex = new Set(f.excludeLeadIds);
    leads = leads.filter((l) => !ex.has(l.id));
  }
  if (f.includeLeadIds.length) {
    const inc = new Set(f.includeLeadIds);
    const extras = admissions.leads.filter(
      (l) => inc.has(l.id) && l.stage !== "lost",
    );
    const map = new Map(leads.map((l) => [l.id, l]));
    for (const e of extras) map.set(e.id, e);
    leads = [...map.values()];
  }

  return [...leads].sort(compareLeadsByEnquiryPriority);
}

export function refreshListCounts(
  state: WaCampaignsState,
  admissions: AdmissionsState,
): WaCampaignsState {
  return {
    ...state,
    lists: state.lists.map((list) => {
      const leads = resolveAudienceLeads(admissions, list.filters);
      return {
        ...list,
        leadIds: leads.map((l) => l.id),
        count: leads.length,
        updatedAt: nowIso(),
      };
    }),
  };
}

export function createAudienceList(
  state: WaCampaignsState,
  input: {
    name: string;
    filters: AudienceListFilters;
    note?: string;
  },
  by: string,
  admissions: AdmissionsState,
): { state: WaCampaignsState; list: AudienceList } {
  const leads = resolveAudienceLeads(admissions, input.filters);
  const list = normalizeList({
    id: nid("wal"),
    name: input.name,
    filters: input.filters,
    leadIds: leads.map((l) => l.id),
    count: leads.length,
    note: input.note || "",
    createdBy: by,
  });
  return {
    list,
    state: {
      ...state,
      nextListSeq: state.nextListSeq + 1,
      lists: [list, ...state.lists],
    },
  };
}

export function updateAudienceList(
  state: WaCampaignsState,
  listId: string,
  patch: Partial<Pick<AudienceList, "name" | "filters" | "note">>,
  admissions: AdmissionsState,
): WaCampaignsState {
  return {
    ...state,
    lists: state.lists.map((list) => {
      if (list.id !== listId) return list;
      const filters = patch.filters
        ? normalizeFilters(patch.filters)
        : list.filters;
      const leads = resolveAudienceLeads(admissions, filters);
      return {
        ...list,
        name: patch.name != null ? patch.name.trim() || list.name : list.name,
        note: patch.note != null ? patch.note : list.note,
        filters,
        leadIds: leads.map((l) => l.id),
        count: leads.length,
        updatedAt: nowIso(),
      };
    }),
  };
}

export function deleteAudienceList(
  state: WaCampaignsState,
  listId: string,
): WaCampaignsState {
  return {
    ...state,
    lists: state.lists.filter((l) => l.id !== listId),
  };
}

export const CAMPAIGN_TEMPLATES: {
  key: CampaignTemplateKey;
  label: string;
  body: string;
}[] = [
  {
    key: "registration_invite",
    label: "Registration invite",
    body: `*{{schoolName}}*
Namaste {{guardianName}},

Please complete registration for *{{childName}}*.

Register & pay online:
{{registerLink}}

Thank you.`,
  },
  {
    key: "fee_reminder",
    label: "Registration fee reminder",
    body: `*{{schoolName}}*
Dear {{guardianName}},

Registration fee for *{{childName}}* is due: *{{feeDue}}*.

Pay here:
{{payLink}}

Or register siblings:
{{registerLink}}

— Admissions desk`,
  },
  {
    key: "open_day",
    label: "Open day / visit",
    body: `*{{schoolName}}*
Dear {{guardianName}},

You are invited to visit campus for *{{childName}}* admission counselling.

Register online:
{{registerLink}}

We look forward to meeting you.`,
  },
  {
    key: "custom",
    label: "Custom",
    body: `*{{schoolName}}*
Dear {{guardianName}},

{{childName}}

{{registerLink}}`,
  },
];

export function defaultTemplateBody(key: CampaignTemplateKey): string {
  return (
    CAMPAIGN_TEMPLATES.find((t) => t.key === key)?.body ||
    CAMPAIGN_TEMPLATES[0]!.body
  );
}

export function publicRegisterUrlForMessage(campaignId?: string): string {
  return publicRegisterAbsoluteUrl(
    campaignId ? `wa_${campaignId}` : undefined,
  );
}

export function publicRegisterUrl(campaignId?: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin.replace(/\/$/, "");
    const q = campaignId
      ? `?src=${encodeURIComponent(`wa_${campaignId}`)}`
      : "";
    return `${origin}/register${q}`;
  }
  return publicRegisterUrlForMessage(campaignId);
}

export type MessageVars = {
  childName: string;
  guardianName: string;
  feeDue: string;
  registerLink: string;
  payLink: string;
  schoolName: string;
};

export function renderCampaignBody(
  template: string,
  vars: MessageVars,
): string {
  return template
    .replace(/\{\{childName\}\}/g, vars.childName || "—")
    .replace(/\{\{guardianName\}\}/g, vars.guardianName || "Parent")
    .replace(/\{\{feeDue\}\}/g, vars.feeDue || "—")
    .replace(/\{\{registerLink\}\}/g, vars.registerLink || "")
    .replace(/\{\{payLink\}\}/g, vars.payLink || vars.registerLink || "")
    .replace(/\{\{schoolName\}\}/g, vars.schoolName || TENANT.nameDisplay);
}

function waMe(mobile: string, text: string): string {
  const digits = mobile.replace(/\D/g, "");
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function ensurePayLinkForLead(
  admissions: AdmissionsState,
  lead: AdmissionLead,
  by: string,
): {
  admissions: AdmissionsState;
  payUrl: string;
  payment?: RegistrationFeePayment;
} {
  const bal = registrationBalancePaise(admissions, lead);
  if (bal <= 0 || lead.registrationFeeAmountPaise <= 0) {
    return { admissions, payUrl: publicRegisterUrlForMessage() };
  }
  const open = (admissions.registrationPayments || []).find(
    (p) => p.leadId === lead.id && p.status === "open",
  );
  if (open) {
    return {
      admissions,
      payUrl: registrationPayAbsoluteUrl(
        `https://${TENANT.publicPortal}`,
        open,
      ),
      payment: open,
    };
  }
  const r = createRegistrationUpiLink(
    admissions,
    lead.id,
    by,
    "Registration fee",
    bal,
  );
  if (!r.ok) {
    return { admissions, payUrl: publicRegisterUrlForMessage() };
  }
  return {
    admissions: r.state,
    payUrl: registrationPayAbsoluteUrl(
      `https://${TENANT.publicPortal}`,
      r.payment,
    ),
    payment: r.payment,
  };
}

export function buildVarsForLead(
  admissions: AdmissionsState,
  lead: AdmissionLead,
  campaignId: string,
  by: string,
): { admissions: AdmissionsState; vars: MessageVars } {
  let next = admissions;
  const pay = ensurePayLinkForLead(next, lead, by);
  next = pay.admissions;
  const bal = registrationBalancePaise(next, lead);
  return {
    admissions: next,
    vars: {
      childName: lead.childName,
      guardianName: campaignGuardianName(lead),
      feeDue:
        bal > 0
          ? formatInr(bal)
          : lead.registrationFeeAmountPaise > 0
            ? formatInr(lead.registrationFeeAmountPaise)
            : "—",
      registerLink: publicRegisterUrlForMessage(campaignId),
      payLink: pay.payUrl,
      schoolName: TENANT.nameDisplay,
    },
  };
}

export function createCampaign(
  state: WaCampaignsState,
  input: {
    name: string;
    listId: string;
    templateKey: CampaignTemplateKey;
    body?: string;
    scheduledAt?: string;
    note?: string;
    registryTemplateId?: string;
    registryMetaName?: string;
    registryLanguage?: string;
  },
  by: string,
):
  | { ok: true; state: WaCampaignsState; campaign: WaCampaign }
  | { ok: false; reason: string } {
  if (!input.listId) return { ok: false, reason: "Choose an audience list" };
  if (!state.lists.some((l) => l.id === input.listId)) {
    return { ok: false, reason: "Audience list not found" };
  }
  const campaign = normalizeCampaign({
    id: nid("wac"),
    name: input.name,
    listId: input.listId,
    templateKey: input.templateKey,
    body: input.body || defaultTemplateBody(input.templateKey),
    status: input.scheduledAt ? "scheduled" : "draft",
    scheduledAt: input.scheduledAt || "",
    createdBy: by,
    note: input.note || "",
    registryTemplateId: input.registryTemplateId || "",
    registryMetaName: input.registryMetaName || "",
    registryLanguage: input.registryLanguage || "",
  });
  return {
    ok: true,
    campaign,
    state: {
      ...state,
      nextCampaignSeq: state.nextCampaignSeq + 1,
      campaigns: [campaign, ...state.campaigns],
    },
  };
}

export function updateCampaign(
  state: WaCampaignsState,
  campaignId: string,
  patch: Partial<
    Pick<
      WaCampaign,
      | "name"
      | "listId"
      | "templateKey"
      | "body"
      | "scheduledAt"
      | "status"
      | "note"
      | "registryTemplateId"
      | "registryMetaName"
      | "registryLanguage"
      | "sequenceId"
      | "sequenceStep"
    >
  >,
): WaCampaignsState {
  return {
    ...state,
    campaigns: state.campaigns.map((c) => {
      if (c.id !== campaignId) return c;
      const next = normalizeCampaign({ ...c, ...patch, id: c.id });
      return { ...next, updatedAt: nowIso() };
    }),
  };
}

export function deleteCampaign(
  state: WaCampaignsState,
  campaignId: string,
): WaCampaignsState {
  return {
    ...state,
    campaigns: state.campaigns.filter((c) => c.id !== campaignId),
    messages: state.messages.filter((m) => m.campaignId !== campaignId),
  };
}

export function enqueueCampaignMessages(
  wa: WaCampaignsState,
  campaignId: string,
  admissions: AdmissionsState,
  by: string,
):
  | {
      ok: true;
      wa: WaCampaignsState;
      admissions: AdmissionsState;
      queued: number;
    }
  | { ok: false; reason: string } {
  const campaign = wa.campaigns.find((c) => c.id === campaignId);
  if (!campaign) return { ok: false, reason: "Campaign not found" };
  const list = wa.lists.find((l) => l.id === campaign.listId);
  if (!list) return { ok: false, reason: "Audience list missing" };

  const leads = resolveAudienceLeads(admissions, list.filters);
  let nextAdm = admissions;
  const messages: CampaignMessage[] = [];

  for (const lead of leads) {
    const mobile = (lead.mobile || lead.parentGroupKey || "").replace(/\D/g, "");
    if (mobile.length !== 10) {
      messages.push(
        normalizeMessage({
          campaignId,
          leadId: lead.id,
          mobile,
          childName: lead.childName,
          body: "",
          status: "skipped",
          error: "Invalid mobile",
        }),
      );
      continue;
    }
    const built = buildVarsForLead(nextAdm, lead, campaignId, by);
    nextAdm = built.admissions;
    const body = renderCampaignBody(campaign.body, built.vars);
    messages.push(
      normalizeMessage({
        campaignId,
        leadId: lead.id,
        mobile,
        childName: lead.childName,
        body,
        status: "queued",
        waMeUrl: waMe(mobile, body),
      }),
    );
  }

  const withoutOld = wa.messages.filter((m) => m.campaignId !== campaignId);
  return {
    ok: true,
    queued: messages.filter((m) => m.status === "queued").length,
    admissions: nextAdm,
    wa: {
      ...wa,
      messages: [...messages, ...withoutOld],
      campaigns: wa.campaigns.map((c) =>
        c.id === campaignId
          ? {
              ...c,
              status: c.status === "draft" ? "scheduled" : c.status,
              updatedAt: nowIso(),
            }
          : c,
      ),
    },
  };
}

export function scheduleCampaign(
  wa: WaCampaignsState,
  campaignId: string,
  scheduledAt: string,
  admissions: AdmissionsState,
  by: string,
):
  | {
      ok: true;
      wa: WaCampaignsState;
      admissions: AdmissionsState;
      queued: number;
    }
  | { ok: false; reason: string } {
  if (!scheduledAt) return { ok: false, reason: "Pick schedule date & time" };
  const next = updateCampaign(wa, campaignId, {
    scheduledAt,
    status: "scheduled",
  });
  return enqueueCampaignMessages(next, campaignId, admissions, by);
}

export function dispatchDueCampaigns(
  wa: WaCampaignsState,
  opts?: {
    openWaMe?: boolean;
    asOf?: Date;
    /** Mark queued → sent without live API (demo only). */
    stubMarkSent?: boolean;
  },
): {
  wa: WaCampaignsState;
  opened: string[];
  markedSent: number;
  dueCampaigns: string[];
  note: string;
  /** Queued messages ready for /api/wa/dispatch (not yet marked sent). */
  pending: {
    id: string;
    mobile: string;
    body: string;
    campaignId: string;
    templateName?: string;
    templateLanguage?: string;
  }[];
} {
  const asOf = opts?.asOf ?? new Date();
  const asOfMs = asOf.getTime();
  const due = wa.campaigns.filter((c) => {
    if (c.status !== "scheduled" && c.status !== "running") return false;
    if (!c.scheduledAt) return c.status === "running";
    const t = new Date(c.scheduledAt).getTime();
    return Number.isFinite(t) && t <= asOfMs;
  });

  const next = { ...wa, messages: [...wa.messages], campaigns: [...wa.campaigns] };
  const opened: string[] = [];
  let markedSent = 0;
  const pending: {
    id: string;
    mobile: string;
    body: string;
    campaignId: string;
    templateName?: string;
    templateLanguage?: string;
  }[] = [];
  const markLocal = opts?.openWaMe === true || opts?.stubMarkSent === true;

  for (const campaign of due) {
    next.campaigns = next.campaigns.map((c) =>
      c.id === campaign.id
        ? { ...c, status: "running" as const, updatedAt: nowIso() }
        : c,
    );
    const queued = next.messages.filter(
      (m) => m.campaignId === campaign.id && m.status === "queued",
    );
    for (const msg of queued) {
      pending.push({
        id: msg.id,
        mobile: msg.mobile,
        body: msg.body,
        campaignId: campaign.id,
        templateName: campaign.registryMetaName || undefined,
        templateLanguage: campaign.registryLanguage || undefined,
      });
      if (opts?.openWaMe && opened.length < WA_ME_BATCH_CAP && msg.waMeUrl) {
        opened.push(msg.waMeUrl);
      }
      if (markLocal) {
        next.messages = next.messages.map((m) =>
          m.id === msg.id
            ? {
                ...m,
                status: "sent" as const,
                sentAt: nowIso(),
                error: opts?.openWaMe
                  ? ""
                  : "Marked sent (stub — configure WhatsApp API for auto-send)",
              }
            : m,
        );
        markedSent += 1;
      }
    }
    if (markLocal) {
      const stillQueued = next.messages.some(
        (m) => m.campaignId === campaign.id && m.status === "queued",
      );
      if (!stillQueued) {
        next.campaigns = next.campaigns.map((c) =>
          c.id === campaign.id
            ? { ...c, status: "done" as const, updatedAt: nowIso() }
            : c,
        );
      }
    }
  }

  return {
    wa: next,
    opened,
    markedSent,
    dueCampaigns: due.map((c) => c.id),
    pending,
    note:
      due.length === 0
        ? "No campaigns due yet"
        : opts?.openWaMe
          ? `Marked ${markedSent} · opened ${opened.length} WhatsApp tabs (cap ${WA_ME_BATCH_CAP}).`
          : opts?.stubMarkSent
            ? `Marked ${markedSent} as sent (stub). Prefer Live dispatch when Meta/BSP is configured.`
            : `${pending.length} queued — call Live dispatch to send via Meta/BSP.`,
  };
}

/** Apply /api/wa/dispatch results onto campaign messages. */
export function applyCampaignDispatchResults(
  wa: WaCampaignsState,
  results: {
    messageId?: string;
    status: "sent" | "failed" | string;
    error?: string;
  }[],
): WaCampaignsState {
  const next = { ...wa, messages: [...wa.messages], campaigns: [...wa.campaigns] };
  const byId = new Map(
    results
      .filter((r) => r.messageId)
      .map((r) => [r.messageId as string, r] as const),
  );
  const touchedCampaigns = new Set<string>();

  next.messages = next.messages.map((m) => {
    const r = byId.get(m.id);
    if (!r) return m;
    touchedCampaigns.add(m.campaignId);
    if (r.status === "sent") {
      return {
        ...m,
        status: "sent" as const,
        sentAt: nowIso(),
        error: "",
      };
    }
    if (r.status === "deferred") {
      // Family quiet hours — stays queued so the next dispatch picks it up.
      return { ...m, status: "queued" as const, error: r.error || "Deferred (quiet hours)" };
    }
    return {
      ...m,
      status: "failed" as const,
      error: r.error || "Dispatch failed",
    };
  });

  for (const campaignId of touchedCampaigns) {
    const stillQueued = next.messages.some(
      (m) => m.campaignId === campaignId && m.status === "queued",
    );
    if (!stillQueued) {
      next.campaigns = next.campaigns.map((c) =>
        c.id === campaignId
          ? { ...c, status: "done" as const, updatedAt: nowIso() }
          : c,
      );
    } else {
      next.campaigns = next.campaigns.map((c) =>
        c.id === campaignId
          ? { ...c, status: "running" as const, updatedAt: nowIso() }
          : c,
      );
    }
  }

  return next;
}

export function campaignMessagesOf(
  wa: WaCampaignsState,
  campaignId: string,
): CampaignMessage[] {
  return wa.messages.filter((m) => m.campaignId === campaignId);
}

export function previewCampaignSample(
  campaign: WaCampaign,
  sample?: Partial<MessageVars>,
): string {
  return renderCampaignBody(campaign.body, {
    childName: sample?.childName || "Aarav",
    guardianName: sample?.guardianName || "Parent",
    feeDue: sample?.feeDue || "₹500",
    registerLink:
      sample?.registerLink || publicRegisterUrlForMessage(campaign.id),
    payLink: sample?.payLink || publicRegisterUrlForMessage(campaign.id),
    schoolName: sample?.schoolName || TENANT.nameDisplay,
  });
}

export function unpaidRegistrationFilters(): AudienceListFilters {
  return {
    ...defaultAudienceFilters(),
    stages: ["applied", "verified"],
    feeStatuses: ["unpaid"],
  };
}

export function unpaidPartialFilters(): AudienceListFilters {
  return {
    ...defaultAudienceFilters(),
    stages: ["applied", "verified"],
    feeStatuses: ["partial"],
  };
}

export function openEnquiryFilters(): AudienceListFilters {
  return {
    ...defaultAudienceFilters(),
    stages: ["enquiry"],
  };
}

/* ─── Sequence ops ───────────────────────────────────────────────────── */

export function createSequence(
  state: WaCampaignsState,
  input: Partial<WaSequence> & { name: string; listId: string },
  by: string,
): { ok: true; state: WaCampaignsState; sequence: WaSequence } | { ok: false; reason: string } {
  if (!input.listId || !state.lists.some((l) => l.id === input.listId)) return { ok: false, reason: "Choose an audience list" };
  if (!input.name.trim()) return { ok: false, reason: "Name the sequence" };
  const seq = normalizeSequence({ ...input, id: undefined, status: "draft", createdBy: by, startedAt: "" });
  if (seq.steps.length === 0) return { ok: false, reason: "Add at least one step" };
  return { ok: true, sequence: seq, state: { ...state, sequences: [...state.sequences, seq] } };
}

export function updateSequence(state: WaCampaignsState, id: string, patch: Partial<WaSequence>): WaCampaignsState {
  return {
    ...state,
    sequences: state.sequences.map((q) => (q.id === id ? normalizeSequence({ ...q, ...patch, id, updatedAt: nowIso() }) : q)),
  };
}

export function deleteSequence(state: WaCampaignsState, id: string): WaCampaignsState {
  const seq = state.sequences.find((q) => q.id === id);
  if (!seq) return state;
  if (seq.status === "started") return state; // stop first
  return { ...state, sequences: state.sequences.filter((q) => q.id !== id) };
}

/** "YYYY-MM-DDTHH:MM" local for anchor + offset days at the step's time. */
export function sequenceStepWhen(anchorYmd: string, step: Pick<WaSequenceStep, "dayOffset" | "time">): string {
  const d = new Date(`${anchorYmd}T00:00:00`);
  d.setDate(d.getDate() + step.dayOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T${step.time}`;
}

/**
 * Start a sequence: one scheduled campaign per step (messages queued now
 * for the list as it stands), anchored on today or the event date. Steps
 * whose time is already past are still created (due immediately) — the
 * office sees them in the queue and can pause.
 */
export function startSequence(
  wa: WaCampaignsState,
  sequenceId: string,
  admissions: AdmissionsState,
  by: string,
  opts?: { today?: string },
): { ok: true; wa: WaCampaignsState; admissions: AdmissionsState; campaigns: number; queued: number } | { ok: false; reason: string } {
  const seq = wa.sequences.find((q) => q.id === sequenceId);
  if (!seq) return { ok: false, reason: "Sequence not found" };
  if (seq.status === "started") return { ok: false, reason: "Already started — stop it to restart" };
  if (!wa.lists.some((l) => l.id === seq.listId)) return { ok: false, reason: "Audience list missing" };
  if (seq.steps.some((st) => !st.body.trim())) return { ok: false, reason: "Every step needs a message body" };
  const anchor = seq.anchor === "event" ? seq.eventDate : opts?.today || new Date().toISOString().slice(0, 10);
  if (!anchor) return { ok: false, reason: "Set the event date" };
  let next = wa;
  let adm = admissions;
  let queued = 0;
  let created = 0;
  seq.steps.forEach((step, i) => {
    const c = createCampaign(
      next,
      {
        name: `${seq.name} · ${i + 1}/${seq.steps.length}${step.label ? ` · ${step.label}` : ""}`,
        listId: seq.listId,
        templateKey: step.templateKey,
        body: step.body,
        note: `Sequence step ${i + 1} (${step.dayOffset >= 0 ? "+" : ""}${step.dayOffset} d)`,
      },
      by,
    );
    if (!c.ok) return;
    next = updateCampaign(c.state, c.campaign.id, { sequenceId: seq.id, sequenceStep: i + 1 });
    const sch = scheduleCampaign(next, c.campaign.id, sequenceStepWhen(anchor, step), adm, by);
    if (!sch.ok) return;
    next = sch.wa;
    adm = sch.admissions;
    queued += sch.queued;
    created += 1;
  });
  next = updateSequence(next, seq.id, { status: "started", startedAt: nowIso() });
  return { ok: true, wa: next, admissions: adm, campaigns: created, queued };
}

/** Stop: pause not-yet-done step campaigns and skip their queued messages. */
export function stopSequence(wa: WaCampaignsState, sequenceId: string): WaCampaignsState {
  const ids = new Set(wa.campaigns.filter((c) => c.sequenceId === sequenceId && c.status !== "done").map((c) => c.id));
  return updateSequence(
    {
      ...wa,
      campaigns: wa.campaigns.map((c) => (ids.has(c.id) ? { ...c, status: "paused" as const, updatedAt: nowIso() } : c)),
      messages: wa.messages.map((m) =>
        ids.has(m.campaignId) && m.status === "queued" ? { ...m, status: "skipped" as const, error: "Sequence stopped" } : m,
      ),
    },
    sequenceId,
    { status: "stopped" },
  );
}

/**
 * Before dispatch: drop queued sequence messages for families that moved on
 * — enrolled, lost, or last outcome "not interested". STOP opt-outs are
 * enforced at send time (waSend); this is the funnel-stage half.
 */
export function pruneSequenceQueue(wa: WaCampaignsState, admissions: AdmissionsState): { wa: WaCampaignsState; skipped: number } {
  const seqCampaigns = new Set(wa.campaigns.filter((c) => c.sequenceId).map((c) => c.id));
  if (seqCampaigns.size === 0) return { wa, skipped: 0 };
  const leads = new Map(admissions.leads.map((l) => [l.id, l]));
  let skipped = 0;
  const messages = wa.messages.map((m) => {
    if (!seqCampaigns.has(m.campaignId) || m.status !== "queued") return m;
    const lead = leads.get(m.leadId);
    if (!lead) return m;
    const lastOutcome = (lead.followUps || []).slice(-1)[0]?.outcome;
    const reason =
      lead.stage === "enrolled" ? "Enrolled — sequence no longer applies"
      : lead.stage === "lost" ? "Marked lost"
      : lastOutcome === "not_interested" ? "Family said not interested"
      : lastOutcome === "wrong_number" ? "Wrong number"
      : "";
    if (!reason) return m;
    skipped += 1;
    return { ...m, status: "skipped" as const, error: reason };
  });
  return { wa: skipped ? { ...wa, messages } : wa, skipped };
}

/** Event-driven presets (offsets relative to the event date). Bodies are drafted by the office / AI. */
export const SEQUENCE_PRESETS: { id: string; label: string; anchor: "start" | "event"; steps: Omit<WaSequenceStep, "id" | "body">[] }[] = [
  {
    id: "open_house",
    label: "Open house / school tour",
    anchor: "event",
    steps: [
      { dayOffset: -7, time: "10:00", label: "Invitation", templateKey: "open_day" },
      { dayOffset: -1, time: "17:00", label: "Reminder", templateKey: "custom" },
      { dayOffset: 1, time: "10:00", label: "Thank you + next step", templateKey: "custom" },
    ],
  },
  {
    id: "nurture_3",
    label: "Enquiry nurture (3 touches)",
    anchor: "start",
    steps: [
      { dayOffset: 0, time: "11:00", label: "Welcome + what to expect", templateKey: "custom" },
      { dayOffset: 4, time: "11:00", label: "A day at school / results", templateKey: "custom" },
      { dayOffset: 9, time: "11:00", label: "Visit or register", templateKey: "registration_invite" },
    ],
  },
  {
    id: "result_day",
    label: "Result-season announcement",
    anchor: "event",
    steps: [
      { dayOffset: 0, time: "12:00", label: "Result announcement", templateKey: "custom" },
      { dayOffset: 3, time: "11:00", label: "Admissions open + CTA", templateKey: "registration_invite" },
    ],
  },
  {
    id: "festival",
    label: "Festival / occasion greeting",
    anchor: "event",
    steps: [{ dayOffset: 0, time: "09:00", label: "Greeting", templateKey: "custom" }],
  },
];

