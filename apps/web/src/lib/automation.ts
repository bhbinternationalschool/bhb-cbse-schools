/**
 * Whole-ERP automation catalog — approval-first by default.
 *
 * Pure rule/approval/run logic shared by the server engine
 * (automationEngine.server.ts) and the Masters screen. The server's copy in
 * Supabase (desk slice `automation`, blob `automation_state`) is the source
 * of truth; the localStorage helpers below are a legacy cache only.
 */

import type { WaTemplateLanguage } from "@/lib/waTemplates";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { findAudiencePresetBySummary } from "@/lib/automationAudience";
import { isValidCronExpr, nextCronRun } from "@/lib/automationSchedule";

const STORAGE_KEY = "bhb_automation_v1";

export type AutomationModule =
  | "admissions"
  | "fees"
  | "attendance"
  | "homework"
  | "exams"
  | "ptm"
  | "leave"
  | "vault"
  | "comms"
  | "store"
  | "transport"
  | "certificates"
  | "rte"
  | "field"
  | "staff"
  | "campaigns"
  | "general";

export type AutomationTriggerType = "schedule" | "interval" | "event";

export type AutomationActionType =
  | "whatsapp_template"
  | "in_app_notification"
  | "enqueue_campaign";

export type AutomationExecutionMode = "approval_first" | "auto";

export type AutomationApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "snoozed"
  | "dispatched"
  | "failed";

export type QuietHours = {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
};

export type AutomationRule = {
  id: string;
  name: string;
  description: string;
  module: AutomationModule;
  enabled: boolean;
  triggerType: AutomationTriggerType;
  /** Cron-like: "0 9 * * 1-5" or empty */
  cronExpr: string;
  /** Interval minutes when triggerType=interval */
  intervalMinutes: number;
  nextRunAt: string;
  lastRunAt: string;
  /** Event key e.g. attendance.absent_marked */
  eventKey: string;
  actionType: AutomationActionType;
  templateFamilyKey: string;
  templateLanguage: WaTemplateLanguage;
  audienceSummary: string;
  /**
   * Which audience resolver builds the recipient list on the server
   * (a preset id from automationAudience.ts, e.g. "fee_overdue"). Derived
   * from audienceSummary for rules saved before this field existed.
   */
  audienceKey: string;
  /** A family is not messaged again by this rule within this many days (0 = no cap). */
  minDaysBetween: number;
  /** Safety cap on recipients per run. */
  maxPerRun: number;
  quietHours: QuietHours;
  executionMode: AutomationExecutionMode;
  testedAt: string;
  createdAt: string;
  updatedAt: string;
};

/** One family / contact an automation run will message. */
export type AutomationRecipient = {
  mobile: string;
  fallbackMobile?: string;
  householdId?: string;
  studentId?: string;
  studentName?: string;
  classLabel?: string;
  amountPaise?: number;
  /** The family's own template language. */
  language?: string;
  /** Plain-text rendering, for the approval card and the text fallback. */
  body: string;
  templateName?: string;
  templateLanguage?: string;
  /** Ordered variable keys of the template, so the body component positions match. */
  variableKeys?: string[];
  variables?: Record<string, string>;
};

export type AutomationSkipNote = { reason: string; count: number };

export type AutomationSendResult = {
  mobile: string;
  householdId?: string;
  ok: boolean;
  error?: string;
  providerId?: string;
};

/**
 * What the server's audience resolver found for a rule at tick time. The
 * pure evaluator turns this into an approval (or a failed run when the
 * audience cannot be built) — it never invents recipients itself.
 */
export type AudiencePreview = {
  supported: boolean;
  /** Why the audience could not be built (unsupported preset, data read failed…). */
  reason?: string;
  templateReady: boolean;
  templateError?: string;
  previewBody: string;
  recipients: AutomationRecipient[];
  skipped: AutomationSkipNote[];
  /** Human line for the approval card, e.g. "12 families · 3 reminded this week". */
  audienceNote: string;
};

export type AutomationApprovalItem = {
  id: string;
  ruleId: string;
  ruleName: string;
  status: AutomationApprovalStatus;
  createdAt: string;
  decidedAt: string;
  decidedBy: string;
  snoozeUntil: string;
  templateFamilyKey: string;
  templateLanguage: WaTemplateLanguage;
  previewBody: string;
  audienceCount: number;
  sampleRecipients: string[];
  dispatchPayload: AutomationRecipient[];
  audienceNote: string;
  skipped: AutomationSkipNote[];
  /** Filled after dispatch. */
  results: AutomationSendResult[];
  sentCount: number;
  failedCount: number;
  dispatchedAt: string;
  error: string;
};

export type AutomationRun = {
  id: string;
  ruleId: string;
  status: "proposed" | "running" | "completed" | "failed" | "cancelled";
  scheduledFor: string;
  startedAt: string;
  finishedAt: string;
  approvalId: string;
  stats: { proposed: number; approved: number; dispatched: number; failed: number };
  /** What happened, in one line — "12 families · 2 reminded this week". */
  notes: string;
  error: string;
};

export type AutomationState = {
  version: 1;
  rules: AutomationRule[];
  approvals: AutomationApprovalItem[];
  runs: AutomationRun[];
  lastTickAt: string;
};

/**
 * History caps. An approval carries its full recipient list, so 500 of
 * them would be megabytes in one desk slice; sent/decided ones are kept
 * for a while as an audit trail and then fall off.
 */
const MAX_APPROVALS = 120;
const MAX_RUNS = 200;

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultQuietHours(): QuietHours {
  return {
    enabled: true,
    startHour: 20,
    endHour: 8,
    timezone: "Asia/Kolkata",
  };
}

type SeedRule = Omit<
  AutomationRule,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "lastRunAt"
  | "nextRunAt"
  | "testedAt"
  | "audienceKey"
  | "minDaysBetween"
  | "maxPerRun"
> & { id: string };

const SEED_RULES: SeedRule[] = [
  {
    id: "auto_fee_stage_reminder",
    name: "Fee stage reminders",
    description:
      "Propose WhatsApp fee overdue reminders by recovery stage (approval-first).",
    module: "fees",
    enabled: false,
    triggerType: "schedule",
    cronExpr: "0 10 * * 1-6",
    intervalMinutes: 0,
    eventKey: "",
    actionType: "whatsapp_template",
    templateFamilyKey: "fees_stage_reminder",
    templateLanguage: "en",
    audienceSummary: "Households with overdue fees (stages S1–S4)",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_fee_soft_reminder",
    name: "Fee soft reminder (due soon)",
    description: "Soft reminder before due date.",
    module: "fees",
    enabled: false,
    triggerType: "schedule",
    cronExpr: "30 9 * * 1-5",
    intervalMinutes: 0,
    eventKey: "",
    actionType: "whatsapp_template",
    templateFamilyKey: "fees_soft_reminder",
    templateLanguage: "en",
    audienceSummary: "Dues within next 3 days",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_admission_followup",
    name: "Admission overdue follow-ups",
    description: "Propose follow-ups when nextFollowUpAt is past.",
    module: "admissions",
    enabled: false,
    triggerType: "interval",
    cronExpr: "",
    intervalMinutes: 240,
    eventKey: "",
    actionType: "whatsapp_template",
    templateFamilyKey: "admissions_followup",
    templateLanguage: "en",
    audienceSummary: "Open leads with overdue follow-up",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_registration_fee_nudge",
    name: "Unpaid registration fee nudge",
    description: "Nudge unpaid / partial registration fees.",
    module: "admissions",
    enabled: false,
    triggerType: "schedule",
    cronExpr: "0 11 * * 1-6",
    intervalMinutes: 0,
    eventKey: "",
    actionType: "whatsapp_template",
    templateFamilyKey: "admissions_fee_reminder",
    templateLanguage: "en",
    audienceSummary: "Leads with unpaid/partial registration fee",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_campaign_due",
    name: "Dispatch due WA campaigns",
    description: "Enqueue due scheduled admissions campaigns for approval/dispatch.",
    module: "campaigns",
    enabled: false,
    triggerType: "interval",
    cronExpr: "",
    intervalMinutes: 15,
    eventKey: "campaign.due",
    actionType: "enqueue_campaign",
    templateFamilyKey: "",
    templateLanguage: "en",
    audienceSummary: "Queued campaign messages due now",
    quietHours: { ...defaultQuietHours(), enabled: false },
    executionMode: "approval_first",
  },
  {
    id: "auto_attendance_absent",
    name: "Absent WhatsApp after cutoff",
    description: "Propose absent alerts after morning cutoff.",
    module: "attendance",
    enabled: false,
    triggerType: "event",
    cronExpr: "",
    intervalMinutes: 0,
    eventKey: "attendance.absent_marked",
    actionType: "whatsapp_template",
    templateFamilyKey: "attendance_absent",
    templateLanguage: "en",
    audienceSummary: "Parents of students marked absent today",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_homework_published",
    name: "Homework published notify",
    description: "Notify class channel when homework is published.",
    module: "homework",
    enabled: false,
    triggerType: "event",
    cronExpr: "",
    intervalMinutes: 0,
    eventKey: "homework.published",
    actionType: "whatsapp_template",
    templateFamilyKey: "homework_published",
    templateLanguage: "en",
    audienceSummary: "Class parents",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_exam_datesheet",
    name: "Exam datesheet broadcast",
    description: "Propose datesheet WhatsApp when exam schedule is published.",
    module: "exams",
    enabled: false,
    triggerType: "event",
    cronExpr: "",
    intervalMinutes: 0,
    eventKey: "exams.datesheet_published",
    actionType: "whatsapp_template",
    templateFamilyKey: "exams_datesheet",
    templateLanguage: "en",
    audienceSummary: "Exam cohort parents",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_ptm_invite",
    name: "PTM invite",
    description: "Invite parents when a PTM event opens for booking.",
    module: "ptm",
    enabled: false,
    triggerType: "event",
    cronExpr: "",
    intervalMinutes: 0,
    eventKey: "ptm.opened",
    actionType: "whatsapp_template",
    templateFamilyKey: "ptm_invite",
    templateLanguage: "en",
    audienceSummary: "PTM eligible parents",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_leave_decision",
    name: "Leave decision notify",
    description: "Notify guardian/staff when leave is approved/rejected.",
    module: "leave",
    enabled: false,
    triggerType: "event",
    cronExpr: "",
    intervalMinutes: 0,
    eventKey: "leave.decided",
    actionType: "whatsapp_template",
    templateFamilyKey: "leave_student_status",
    templateLanguage: "en",
    audienceSummary: "Leave requester / guardian",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_vault_expiry",
    name: "Vault document expiry",
    description: "Daily scan for documents expiring in 30 days.",
    module: "vault",
    enabled: false,
    triggerType: "schedule",
    cronExpr: "0 8 * * *",
    intervalMinutes: 0,
    eventKey: "",
    actionType: "whatsapp_template",
    templateFamilyKey: "vault_expiry",
    templateLanguage: "en",
    audienceSummary: "Document owners / office",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
  {
    id: "auto_comms_notice",
    name: "Published notice WA",
    description: "Optional WA when a school notice is published.",
    module: "comms",
    enabled: false,
    triggerType: "event",
    cronExpr: "",
    intervalMinutes: 0,
    eventKey: "comms.notice_published",
    actionType: "whatsapp_template",
    templateFamilyKey: "comms_notice",
    templateLanguage: "en",
    audienceSummary: "Notice audience",
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
  },
];

function normalizeQuiet(raw: Partial<QuietHours> | null | undefined): QuietHours {
  const d = defaultQuietHours();
  if (!raw) return d;
  return {
    enabled: raw.enabled !== false,
    startHour: Number.isFinite(raw.startHour) ? Number(raw.startHour) : d.startHour,
    endHour: Number.isFinite(raw.endHour) ? Number(raw.endHour) : d.endHour,
    timezone: String(raw.timezone || d.timezone),
  };
}

export const DEFAULT_MAX_PER_RUN = 300;

/** Fees reminders default to once a week per family; other modules uncapped. */
export function defaultMinDaysBetween(module: AutomationModule): number {
  return module === "fees" ? 7 : 0;
}

function deriveAudienceKey(raw: Partial<AutomationRule>): string {
  if (raw.audienceKey) return String(raw.audienceKey);
  const preset = findAudiencePresetBySummary(String(raw.audienceSummary || ""));
  return preset ? preset.id : "";
}

function normalizeRule(raw: Partial<AutomationRule> | null): AutomationRule | null {
  if (!raw || !raw.id) return null;
  const now = nowIso();
  const moduleId = (raw.module as AutomationModule) || "general";
  return {
    id: String(raw.id),
    name: String(raw.name || raw.id),
    description: String(raw.description || ""),
    module: moduleId,
    enabled: !!raw.enabled,
    triggerType: (raw.triggerType as AutomationTriggerType) || "schedule",
    cronExpr: String(raw.cronExpr || ""),
    intervalMinutes: Math.max(0, Number(raw.intervalMinutes) || 0),
    nextRunAt: String(raw.nextRunAt || ""),
    lastRunAt: String(raw.lastRunAt || ""),
    eventKey: String(raw.eventKey || ""),
    actionType: (raw.actionType as AutomationActionType) || "whatsapp_template",
    templateFamilyKey: String(raw.templateFamilyKey || ""),
    templateLanguage: raw.templateLanguage === "hi" ? "hi" : "en",
    audienceSummary: String(raw.audienceSummary || ""),
    audienceKey: deriveAudienceKey(raw),
    minDaysBetween:
      raw.minDaysBetween == null || !Number.isFinite(Number(raw.minDaysBetween))
        ? defaultMinDaysBetween(moduleId)
        : Math.max(0, Math.round(Number(raw.minDaysBetween))),
    maxPerRun:
      raw.maxPerRun == null || !Number.isFinite(Number(raw.maxPerRun))
        ? DEFAULT_MAX_PER_RUN
        : Math.max(1, Math.round(Number(raw.maxPerRun))),
    quietHours: normalizeQuiet(raw.quietHours),
    executionMode:
      raw.executionMode === "auto" && raw.testedAt
        ? "auto"
        : "approval_first",
    testedAt: String(raw.testedAt || ""),
    createdAt: String(raw.createdAt || now),
    updatedAt: String(raw.updatedAt || now),
  };
}

function normalizeApproval(raw: Partial<AutomationApprovalItem>): AutomationApprovalItem | null {
  if (!raw || !raw.id) return null;
  return {
    id: String(raw.id),
    ruleId: String(raw.ruleId || ""),
    ruleName: String(raw.ruleName || ""),
    status: (raw.status as AutomationApprovalStatus) || "pending",
    createdAt: String(raw.createdAt || ""),
    decidedAt: String(raw.decidedAt || ""),
    decidedBy: String(raw.decidedBy || ""),
    snoozeUntil: String(raw.snoozeUntil || ""),
    templateFamilyKey: String(raw.templateFamilyKey || ""),
    templateLanguage: raw.templateLanguage === "hi" ? "hi" : "en",
    previewBody: String(raw.previewBody || ""),
    audienceCount: Number(raw.audienceCount) || 0,
    sampleRecipients: Array.isArray(raw.sampleRecipients) ? raw.sampleRecipients.map(String) : [],
    dispatchPayload: Array.isArray(raw.dispatchPayload) ? raw.dispatchPayload : [],
    audienceNote: String(raw.audienceNote || ""),
    skipped: Array.isArray(raw.skipped) ? raw.skipped : [],
    results: Array.isArray(raw.results) ? raw.results : [],
    sentCount: Number(raw.sentCount) || 0,
    failedCount: Number(raw.failedCount) || 0,
    dispatchedAt: String(raw.dispatchedAt || ""),
    error: String(raw.error || ""),
  };
}

function normalizeRun(raw: Partial<AutomationRun>): AutomationRun | null {
  if (!raw || !raw.id) return null;
  return {
    id: String(raw.id),
    ruleId: String(raw.ruleId || ""),
    status: (raw.status as AutomationRun["status"]) || "proposed",
    scheduledFor: String(raw.scheduledFor || ""),
    startedAt: String(raw.startedAt || ""),
    finishedAt: String(raw.finishedAt || ""),
    approvalId: String(raw.approvalId || ""),
    stats: {
      proposed: Number(raw.stats?.proposed) || 0,
      approved: Number(raw.stats?.approved) || 0,
      dispatched: Number(raw.stats?.dispatched) || 0,
      failed: Number(raw.stats?.failed) || 0,
    },
    notes: String(raw.notes || ""),
    error: String(raw.error || ""),
  };
}

export function seedAutomationRules(): AutomationRule[] {
  const now = nowIso();
  return SEED_RULES.map((r) =>
    normalizeRule({
      ...r,
      nextRunAt: "",
      lastRunAt: "",
      testedAt: "",
      createdAt: now,
      updatedAt: now,
    })!,
  );
}

export function emptyAutomation(): AutomationState {
  return {
    version: 1,
    rules: seedAutomationRules(),
    approvals: [],
    runs: [],
    lastTickAt: "",
  };
}

export function normalizeAutomationState(
  raw: Partial<AutomationState> | null,
): AutomationState {
  const seeded = seedAutomationRules();
  if (!raw) return emptyAutomation();
  const parsed = Array.isArray(raw.rules)
    ? raw.rules
        .map((r) => normalizeRule(r as Partial<AutomationRule>))
        .filter((r): r is AutomationRule => !!r)
    : [];
  const byId = new Map(parsed.map((r) => [r.id, r]));
  for (const s of seeded) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }
  return {
    version: 1,
    rules: [...byId.values()],
    approvals: Array.isArray(raw.approvals)
      ? (raw.approvals as Partial<AutomationApprovalItem>[])
          .map(normalizeApproval)
          .filter((a): a is AutomationApprovalItem => !!a)
          .slice(0, MAX_APPROVALS)
      : [],
    runs: Array.isArray(raw.runs)
      ? (raw.runs as Partial<AutomationRun>[])
          .map(normalizeRun)
          .filter((r): r is AutomationRun => !!r)
          .slice(0, MAX_RUNS)
      : [],
    lastTickAt: String(raw.lastTickAt || ""),
  };
}

export function loadAutomation(): AutomationState {
  if (typeof window === "undefined") return emptyAutomation();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = emptyAutomation();
      writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return normalizeAutomationState(JSON.parse(raw) as Partial<AutomationState>);
  } catch {
    return emptyAutomation();
  }
}

export function writeAutomationLocalRaw(state: AutomationState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(normalizeAutomationState(state)),
  );
  window.dispatchEvent(new CustomEvent("bhb-automation"));
}

export function automationIsEmpty(state: AutomationState): boolean {
  return (state.rules?.length ?? 0) === 0;
}

export function saveAutomation(state: AutomationState): void {
  if (typeof window === "undefined") return;
  const next = normalizeAutomationState(state);
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("bhb-automation"));
  void import("@/lib/automationPersistence").then(({ scheduleAutomationSync }) => {
    scheduleAutomationSync(next);
  });
}

/* ─── Schedule maths ────────────────────────────────────────────────── */

/**
 * When a rule should next fire, from `from`. Schedules follow their cron in
 * the rule's timezone; intervals add their minutes. An invalid cron returns
 * "" — the rule is then reported as misconfigured rather than fired at an
 * arbitrary moment.
 */
export function computeNextRun(rule: AutomationRule, from: Date): string {
  if (rule.triggerType === "interval") {
    const mins = rule.intervalMinutes > 0 ? rule.intervalMinutes : 60;
    return new Date(from.getTime() + mins * 60_000).toISOString();
  }
  if (rule.triggerType === "schedule") {
    if (!rule.cronExpr.trim() || !isValidCronExpr(rule.cronExpr)) return "";
    return nextCronRun(rule.cronExpr, from, rule.quietHours.timezone) || "";
  }
  return "";
}

/** Human explanation of why a rule will not fire, or "" when it can. */
export function ruleConfigProblem(rule: AutomationRule): string {
  if (rule.triggerType === "schedule") {
    if (!rule.cronExpr.trim()) return "No schedule time set";
    if (!isValidCronExpr(rule.cronExpr)) return `Schedule "${rule.cronExpr}" is not valid`;
  }
  if (rule.triggerType === "interval" && rule.intervalMinutes <= 0) {
    return "Interval must be at least 1 minute";
  }
  if (rule.triggerType === "event") {
    return "Event-driven rules are raised by their module, not by the scheduler";
  }
  if (rule.actionType === "whatsapp_template" && !rule.templateFamilyKey) {
    return "No WhatsApp template family linked";
  }
  if (!rule.audienceKey) {
    return "Audience is not one the server can build — pick a preset audience";
  }
  return "";
}

function withRecomputedNextRun(rule: AutomationRule, now = new Date()): AutomationRule {
  return { ...rule, nextRunAt: rule.enabled ? computeNextRun(rule, now) : "" };
}

/* ─── Rule edits ────────────────────────────────────────────────────── */

export function setRuleEnabled(
  state: AutomationState,
  ruleId: string,
  enabled: boolean,
): AutomationState {
  return {
    ...state,
    rules: state.rules.map((r) =>
      r.id === ruleId
        ? withRecomputedNextRun({ ...r, enabled, updatedAt: nowIso() })
        : r,
    ),
  };
}

export function setRuleExecutionMode(
  state: AutomationState,
  ruleId: string,
  mode: AutomationExecutionMode,
): { ok: true; state: AutomationState } | { ok: false; reason: string } {
  const rule = state.rules.find((r) => r.id === ruleId);
  if (!rule) return { ok: false, reason: "Rule not found" };
  if (mode === "auto" && !rule.testedAt) {
    return {
      ok: false,
      reason: "Mark the rule as tested before enabling auto-run",
    };
  }
  return {
    ok: true,
    state: {
      ...state,
      rules: state.rules.map((r) =>
        r.id === ruleId
          ? { ...r, executionMode: mode, updatedAt: nowIso() }
          : r,
      ),
    },
  };
}

export function markRuleTested(
  state: AutomationState,
  ruleId: string,
): AutomationState {
  return {
    ...state,
    rules: state.rules.map((r) =>
      r.id === ruleId ? { ...r, testedAt: nowIso(), updatedAt: nowIso() } : r,
    ),
  };
}

export type AutomationRulePatch = Partial<
  Pick<
    AutomationRule,
    | "name"
    | "description"
    | "module"
    | "triggerType"
    | "cronExpr"
    | "intervalMinutes"
    | "eventKey"
    | "actionType"
    | "templateFamilyKey"
    | "templateLanguage"
    | "audienceSummary"
    | "audienceKey"
    | "minDaysBetween"
    | "maxPerRun"
    | "quietHours"
    | "enabled"
  >
>;

/** Apply a patch to one rule; the next run is recomputed when the schedule changed. */
export function updateAutomationRule(
  state: AutomationState,
  ruleId: string,
  patch: AutomationRulePatch,
): AutomationState {
  return {
    ...state,
    rules: state.rules.map((r) => {
      if (r.id !== ruleId) return r;
      const merged = normalizeRule({
        ...r,
        ...patch,
        // A changed audience summary re-derives the key unless one was given.
        audienceKey:
          patch.audienceKey != null
            ? patch.audienceKey
            : patch.audienceSummary != null && patch.audienceSummary !== r.audienceSummary
              ? ""
              : r.audienceKey,
        quietHours: patch.quietHours ? normalizeQuiet(patch.quietHours) : r.quietHours,
        updatedAt: nowIso(),
      })!;
      const scheduleChanged =
        patch.cronExpr != null ||
        patch.intervalMinutes != null ||
        patch.triggerType != null ||
        patch.quietHours != null ||
        patch.enabled != null;
      return scheduleChanged ? withRecomputedNextRun(merged) : merged;
    }),
  };
}

/** @deprecated use updateAutomationRule — kept for the older edit screens. */
export function updateRuleSchedule(
  state: AutomationState,
  ruleId: string,
  patch: AutomationRulePatch,
): AutomationState {
  return updateAutomationRule(state, ruleId, patch);
}

export type CreateAutomationRuleOpts = {
  name: string;
  description?: string;
  module: AutomationModule;
  triggerType: AutomationTriggerType;
  cronExpr?: string;
  intervalMinutes?: number;
  eventKey?: string;
  actionType: AutomationActionType;
  templateFamilyKey?: string;
  templateLanguage?: WaTemplateLanguage;
  audienceSummary?: string;
  audienceKey?: string;
  minDaysBetween?: number;
  maxPerRun?: number;
  enabled?: boolean;
};

export function createAutomationRule(
  state: AutomationState,
  opts: CreateAutomationRuleOpts,
): { state: AutomationState; rule: AutomationRule } {
  const now = nowIso();
  const id = nid("auto");
  const rule = withRecomputedNextRun(
    normalizeRule({
      id,
      name: opts.name.trim() || "New rule",
      description: opts.description?.trim() || "",
      module: opts.module,
      enabled: !!opts.enabled,
      triggerType: opts.triggerType,
      cronExpr: opts.cronExpr || "",
      intervalMinutes: Math.max(0, opts.intervalMinutes || 0),
      eventKey: opts.eventKey || "",
      actionType: opts.actionType,
      templateFamilyKey: opts.templateFamilyKey || "",
      templateLanguage: opts.templateLanguage || "en",
      audienceSummary: opts.audienceSummary || "",
      audienceKey: opts.audienceKey || "",
      minDaysBetween: opts.minDaysBetween,
      maxPerRun: opts.maxPerRun,
      quietHours: defaultQuietHours(),
      executionMode: "approval_first",
      nextRunAt: "",
      lastRunAt: "",
      testedAt: "",
      createdAt: now,
      updatedAt: now,
    })!,
  );
  return {
    state: { ...state, rules: [...state.rules, rule] },
    rule,
  };
}

export function isSeedRuleId(ruleId: string): boolean {
  return SEED_RULES.some((s) => s.id === ruleId);
}

/** Seed rules can only be paused; a rule the school created can be removed. */
export function deleteAutomationRule(
  state: AutomationState,
  ruleId: string,
): { ok: true; state: AutomationState } | { ok: false; reason: string } {
  if (isSeedRuleId(ruleId)) {
    return { ok: false, reason: "Built-in rules can be disabled but not deleted" };
  }
  if (!state.rules.some((r) => r.id === ruleId)) {
    return { ok: false, reason: "Rule not found" };
  }
  return {
    ok: true,
    state: {
      ...state,
      rules: state.rules.filter((r) => r.id !== ruleId),
      approvals: state.approvals.filter(
        (a) => a.ruleId !== ruleId || a.status !== "pending",
      ),
    },
  };
}

/* ─── Tick evaluation ───────────────────────────────────────────────── */

export function isInQuietHours(qh: QuietHours, at = new Date()): boolean {
  if (!qh.enabled) return false;
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        hour12: false,
        timeZone: qh.timezone || "Asia/Kolkata",
      }).format(at),
    );
    const start = qh.startHour;
    const end = qh.endHour;
    if (start === end) return false;
    if (start > end) {
      // e.g. 20 → 8
      return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
  } catch {
    return false;
  }
}

export type RuleDueState =
  | { due: true }
  | { due: false; why: "disabled" | "event" | "misconfigured" | "quiet_hours" | "not_yet" | "first_run_scheduled" };

/**
 * Is the rule due at `now`? A schedule rule with no nextRunAt yet is NOT
 * fired on the spot — its first run is the next cron occurrence, which is
 * what the person who set "10:00 Mon–Sat" expects. Interval rules run on
 * their first tick.
 */
export function ruleDueState(rule: AutomationRule, now: Date): RuleDueState {
  if (!rule.enabled) return { due: false, why: "disabled" };
  if (rule.triggerType === "event") return { due: false, why: "event" };
  if (ruleConfigProblem(rule)) return { due: false, why: "misconfigured" };
  if (!rule.nextRunAt) {
    if (rule.triggerType === "interval") return { due: true };
    return { due: false, why: "first_run_scheduled" };
  }
  const at = new Date(rule.nextRunAt).getTime();
  if (!Number.isFinite(at) || at > now.getTime()) return { due: false, why: "not_yet" };
  // Due, but inside quiet hours: hold it (nextRunAt stays) so it goes out
  // at the first tick after the window, rather than being dropped.
  if (isInQuietHours(rule.quietHours, now)) return { due: false, why: "quiet_hours" };
  return { due: true };
}

/** Rules the next tick would act on, so the caller can resolve their audiences first. */
export function dueRuleIds(
  state: AutomationState,
  opts?: { forceRuleIds?: string[]; now?: Date },
): string[] {
  const now = opts?.now || new Date();
  return state.rules
    .filter((r) => opts?.forceRuleIds?.includes(r.id) || ruleDueState(r, now).due)
    .map((r) => r.id);
}

function snoozedUntil(state: AutomationState, ruleId: string, now: Date): string {
  const s = state.approvals.find(
    (a) =>
      a.ruleId === ruleId &&
      a.status === "snoozed" &&
      a.snoozeUntil &&
      new Date(a.snoozeUntil).getTime() > now.getTime(),
  );
  return s?.snoozeUntil || "";
}

export type AutomationTickOutcome = {
  state: AutomationState;
  /** Approvals auto-approved this tick — the server dispatches these. */
  autoApprovalIds: string[];
  /** Approvals raised for a person to decide. */
  pendingApprovalIds: string[];
  /** One line per rule touched, for logs and the response. */
  notes: string[];
};

/**
 * Evaluate due rules against the audiences the server resolved for them.
 *
 * Pure: no I/O. `previews` must hold an entry for every due (or forced)
 * rule; a rule with no preview is recorded as a failed run, never sent to
 * an invented list. Auto-mode rules get an approved item back in
 * `autoApprovalIds`; the caller sends those and records the result with
 * `markApprovalDispatched`.
 */
export function runAutomationTick(
  state: AutomationState,
  opts: {
    forceRuleIds?: string[];
    now?: Date;
    previews: Record<string, AudiencePreview | undefined>;
  },
): AutomationTickOutcome {
  const now = opts.now || new Date();
  const nowStr = now.toISOString();
  const rules = [...state.rules];
  let approvals = [...state.approvals];
  let runs = [...state.runs];
  const autoApprovalIds: string[] = [];
  const pendingApprovalIds: string[] = [];
  const notes: string[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    const forced = !!opts.forceRuleIds?.includes(rule.id);
    if (!forced && !ruleDueState(rule, now).due) continue;

    const runId = nid("run");
    const preview = opts.previews[rule.id];
    const advance = () => {
      rules[i] = {
        ...rule,
        lastRunAt: nowStr,
        nextRunAt: computeNextRun(rule, now),
        updatedAt: nowStr,
      };
    };
    const failRun = (error: string) => {
      runs = [
        {
          id: runId,
          ruleId: rule.id,
          status: "failed",
          scheduledFor: rule.nextRunAt || nowStr,
          startedAt: nowStr,
          finishedAt: nowStr,
          approvalId: "",
          stats: { proposed: 0, approved: 0, dispatched: 0, failed: 0 },
          notes: "",
          error,
        },
        ...runs,
      ];
      notes.push(`${rule.name}: ${error}`);
      advance();
    };

    const problem = ruleConfigProblem(rule);
    if (problem && rule.triggerType !== "event") {
      failRun(problem);
      continue;
    }
    if (!preview) {
      failRun("No audience was resolved for this rule on this tick");
      continue;
    }
    if (!preview.supported) {
      failRun(preview.reason || "This audience cannot be built automatically yet");
      continue;
    }
    if (!preview.templateReady) {
      failRun(preview.templateError || "WhatsApp template is not approved");
      continue;
    }

    const snoozed = snoozedUntil(state, rule.id, now);
    if (snoozed && !forced) {
      runs = [
        {
          id: runId,
          ruleId: rule.id,
          status: "cancelled",
          scheduledFor: rule.nextRunAt || nowStr,
          startedAt: nowStr,
          finishedAt: nowStr,
          approvalId: "",
          stats: { proposed: preview.recipients.length, approved: 0, dispatched: 0, failed: 0 },
          notes: `Snoozed until ${snoozed}`,
          error: "",
        },
        ...runs,
      ];
      notes.push(`${rule.name}: snoozed until ${snoozed}`);
      advance();
      continue;
    }

    const skippedNote = preview.skipped
      .filter((s) => s.count > 0)
      .map((s) => `${s.count} ${s.reason}`)
      .join(" · ");

    if (preview.recipients.length === 0) {
      runs = [
        {
          id: runId,
          ruleId: rule.id,
          status: "completed",
          scheduledFor: rule.nextRunAt || nowStr,
          startedAt: nowStr,
          finishedAt: nowStr,
          approvalId: "",
          stats: { proposed: 0, approved: 0, dispatched: 0, failed: 0 },
          notes: preview.audienceNote || (skippedNote ? `Nobody to message · ${skippedNote}` : "Nobody to message today"),
          error: "",
        },
        ...runs,
      ];
      notes.push(`${rule.name}: nobody to message${skippedNote ? ` (${skippedNote})` : ""}`);
      advance();
      continue;
    }

    const hasPending = approvals.some(
      (a) => a.ruleId === rule.id && a.status === "pending",
    );
    if (hasPending && !forced && rule.executionMode !== "auto") {
      // A card is already waiting; raising a second one for the same rule
      // just doubles the queue. The schedule still advances.
      notes.push(`${rule.name}: approval already pending`);
      advance();
      continue;
    }
    if (hasPending && forced) {
      // "Run now" replaces yesterday's card with today's list rather than
      // stacking two cards whose recipients overlap.
      approvals = approvals.map((a) =>
        a.ruleId === rule.id && a.status === "pending"
          ? { ...a, status: "rejected" as const, decidedAt: nowStr, decidedBy: "superseded" }
          : a,
      );
      runs = runs.map((r) =>
        r.ruleId === rule.id && r.status === "proposed"
          ? { ...r, status: "cancelled" as const, finishedAt: nowStr, notes: "Superseded by a newer run" }
          : r,
      );
    }

    const approvalId = nid("appr");
    const auto = rule.executionMode === "auto" && !!rule.testedAt;
    const item: AutomationApprovalItem = {
      id: approvalId,
      ruleId: rule.id,
      ruleName: rule.name,
      status: auto ? "approved" : "pending",
      createdAt: nowStr,
      decidedAt: auto ? nowStr : "",
      decidedBy: auto ? "auto" : "",
      snoozeUntil: "",
      templateFamilyKey: rule.templateFamilyKey,
      templateLanguage: rule.templateLanguage,
      previewBody: preview.previewBody,
      audienceCount: preview.recipients.length,
      sampleRecipients: preview.recipients
        .slice(0, 5)
        .map((r) => r.studentName || r.mobile),
      dispatchPayload: preview.recipients,
      audienceNote: preview.audienceNote,
      skipped: preview.skipped,
      results: [],
      sentCount: 0,
      failedCount: 0,
      dispatchedAt: "",
      error: "",
    };
    approvals = [item, ...approvals];
    runs = [
      {
        id: runId,
        ruleId: rule.id,
        status: auto ? "running" : "proposed",
        scheduledFor: rule.nextRunAt || nowStr,
        startedAt: nowStr,
        finishedAt: "",
        approvalId,
        stats: {
          proposed: preview.recipients.length,
          approved: auto ? preview.recipients.length : 0,
          dispatched: 0,
          failed: 0,
        },
        notes: preview.audienceNote,
        error: "",
      },
      ...runs,
    ];
    if (auto) autoApprovalIds.push(approvalId);
    else pendingApprovalIds.push(approvalId);
    notes.push(
      `${rule.name}: ${preview.recipients.length} recipient(s) ${auto ? "auto-approved" : "waiting for approval"}`,
    );
    advance();
  }

  return {
    state: {
      ...state,
      rules,
      approvals: approvals.slice(0, MAX_APPROVALS),
      runs: runs.slice(0, MAX_RUNS),
      lastTickAt: nowStr,
    },
    autoApprovalIds,
    pendingApprovalIds,
    notes,
  };
}

/** Compatibility wrapper around runAutomationTick. */
export function evaluateAutomationTick(
  state: AutomationState,
  opts?: {
    forceRuleIds?: string[];
    now?: Date;
    previews?: Record<string, AudiencePreview | undefined>;
  },
): AutomationState {
  return runAutomationTick(state, {
    forceRuleIds: opts?.forceRuleIds,
    now: opts?.now,
    previews: opts?.previews ?? {},
  }).state;
}

/* ─── Approvals ─────────────────────────────────────────────────────── */

export function decideApproval(
  state: AutomationState,
  approvalId: string,
  decision: "approved" | "rejected" | "snoozed",
  by: string,
  snoozeHours = 24,
): AutomationState {
  const approvals = state.approvals.map((a) => {
    if (a.id !== approvalId) return a;
    return {
      ...a,
      status: decision,
      decidedAt: nowIso(),
      decidedBy: by,
      snoozeUntil:
        decision === "snoozed"
          ? new Date(Date.now() + snoozeHours * 3600_000).toISOString()
          : "",
    };
  });
  const runs = state.runs.map((r) => {
    if (r.approvalId !== approvalId) return r;
    if (decision === "approved") return { ...r, status: "running" as const, stats: { ...r.stats, approved: r.stats.proposed } };
    return {
      ...r,
      status: "cancelled" as const,
      finishedAt: nowIso(),
      notes: decision === "rejected" ? `Rejected by ${by}` : `Snoozed by ${by}`,
    };
  });
  return { ...state, approvals, runs };
}

export type DispatchOutcome = {
  ok: boolean;
  error?: string;
  sent: number;
  failed: number;
  /** Not attempted (family quiet hours, opted out at send time…). */
  skipped: number;
  results: AutomationSendResult[];
  note?: string;
};

export function markApprovalDispatched(
  state: AutomationState,
  approvalId: string,
  outcome: DispatchOutcome | boolean,
  legacyError = "",
): AutomationState {
  const o: DispatchOutcome =
    typeof outcome === "boolean"
      ? { ok: outcome, error: legacyError, sent: 0, failed: 0, skipped: 0, results: [] }
      : outcome;
  const finishedAt = nowIso();
  return {
    ...state,
    approvals: state.approvals.map((a) =>
      a.id === approvalId
        ? {
            ...a,
            status: o.ok ? "dispatched" : "failed",
            error: o.ok ? "" : o.error || "Dispatch failed",
            decidedAt: a.decidedAt || finishedAt,
            dispatchedAt: finishedAt,
            results: o.results,
            sentCount: o.sent,
            failedCount: o.failed,
          }
        : a,
    ),
    runs: state.runs.map((r) =>
      r.approvalId === approvalId
        ? {
            ...r,
            status: o.ok ? "completed" : "failed",
            finishedAt,
            stats: {
              ...r.stats,
              approved: r.stats.proposed,
              dispatched: o.sent,
              failed: o.failed,
            },
            notes: [r.notes, o.note].filter(Boolean).join(" · "),
            error: o.ok ? "" : o.error || "Dispatch failed",
          }
        : r,
    ),
  };
}

export function pendingApprovals(
  state: AutomationState,
): AutomationApprovalItem[] {
  return state.approvals.filter((a) => a.status === "pending");
}

export function moduleLabelAuto(m: AutomationModule): string {
  return m.charAt(0).toUpperCase() + m.slice(1);
}
