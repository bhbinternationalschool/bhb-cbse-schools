/**
 * Whole-ERP automation catalog — approval-first by default.
 * Store: localStorage `bhb_automation_v1` + Supabase blob `automation_state`.
 */

import type { WaTemplateLanguage } from "@/lib/waTemplates";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

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
  quietHours: QuietHours;
  executionMode: AutomationExecutionMode;
  testedAt: string;
  createdAt: string;
  updatedAt: string;
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
  dispatchPayload: {
    mobile: string;
    body: string;
    templateName?: string;
    templateLanguage?: string;
    variables?: Record<string, string>;
  }[];
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
  error: string;
};

export type AutomationState = {
  version: 1;
  rules: AutomationRule[];
  approvals: AutomationApprovalItem[];
  runs: AutomationRun[];
  lastTickAt: string;
};

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
  "id" | "createdAt" | "updatedAt" | "lastRunAt" | "nextRunAt" | "testedAt"
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

function normalizeRule(raw: Partial<AutomationRule> | null): AutomationRule | null {
  if (!raw || !raw.id) return null;
  const now = nowIso();
  return {
    id: String(raw.id),
    name: String(raw.name || raw.id),
    description: String(raw.description || ""),
    module: (raw.module as AutomationModule) || "general",
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
      ? (raw.approvals as AutomationApprovalItem[]).slice(0, 500)
      : [],
    runs: Array.isArray(raw.runs) ? (raw.runs as AutomationRun[]).slice(0, 200) : [],
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

export function setRuleEnabled(
  state: AutomationState,
  ruleId: string,
  enabled: boolean,
): AutomationState {
  return {
    ...state,
    rules: state.rules.map((r) =>
      r.id === ruleId ? { ...r, enabled, updatedAt: nowIso() } : r,
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

export function updateRuleSchedule(
  state: AutomationState,
  ruleId: string,
  patch: Partial<
    Pick<
      AutomationRule,
      | "cronExpr"
      | "intervalMinutes"
      | "nextRunAt"
      | "triggerType"
      | "eventKey"
      | "templateFamilyKey"
      | "templateLanguage"
      | "quietHours"
      | "audienceSummary"
      | "enabled"
    >
  >,
): AutomationState {
  return {
    ...state,
    rules: state.rules.map((r) =>
      r.id === ruleId
        ? {
            ...r,
            ...patch,
            quietHours: patch.quietHours
              ? normalizeQuiet(patch.quietHours)
              : r.quietHours,
            updatedAt: nowIso(),
          }
        : r,
    ),
  };
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
  enabled?: boolean;
};

export function createAutomationRule(
  state: AutomationState,
  opts: CreateAutomationRuleOpts,
): { state: AutomationState; rule: AutomationRule } {
  const now = nowIso();
  const id = nid("auto");
  const rule = normalizeRule({
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
    quietHours: defaultQuietHours(),
    executionMode: "approval_first",
    nextRunAt: "",
    lastRunAt: "",
    testedAt: "",
    createdAt: now,
    updatedAt: now,
  })!;
  return {
    state: { ...state, rules: [...state.rules, rule] },
    rule,
  };
}

export function updateAutomationRule(
  state: AutomationState,
  ruleId: string,
  patch: Partial<
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
      | "quietHours"
      | "enabled"
    >
  >,
): AutomationState {
  return {
    ...state,
    rules: state.rules.map((r) =>
      r.id === ruleId
        ? {
            ...r,
            ...patch,
            quietHours: patch.quietHours
              ? normalizeQuiet(patch.quietHours)
              : r.quietHours,
            updatedAt: nowIso(),
          }
        : r,
    ),
  };
}

function isInQuietHours(qh: QuietHours, at = new Date()): boolean {
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

function ruleIsDue(rule: AutomationRule, now: Date): boolean {
  if (!rule.enabled) return false;
  if (rule.triggerType === "event") return false; // event-driven separately
  if (isInQuietHours(rule.quietHours, now)) return false;
  if (rule.nextRunAt) {
    return new Date(rule.nextRunAt).getTime() <= now.getTime();
  }
  // Never run → due on first tick so operators see a sample approval
  return true;
}

function computeNextRun(rule: AutomationRule, from: Date): string {
  if (rule.triggerType === "interval" && rule.intervalMinutes > 0) {
    return new Date(
      from.getTime() + rule.intervalMinutes * 60_000,
    ).toISOString();
  }
  // Default: next calendar day 10:00 IST approx (+24h)
  return new Date(from.getTime() + 24 * 60 * 60_000).toISOString();
}

function demoPreviewForRule(rule: AutomationRule): {
  previewBody: string;
  audienceCount: number;
  sampleRecipients: string[];
  dispatchPayload: AutomationApprovalItem["dispatchPayload"];
} {
  const previewBody = `[Automation] ${rule.name} → template ${rule.templateFamilyKey || "(campaign)"} (${rule.templateLanguage}). Audience: ${rule.audienceSummary}`;
  const samples = ["9876543210", "9123456780"];
  return {
    previewBody,
    audienceCount: samples.length,
    sampleRecipients: samples,
    dispatchPayload: samples.map((mobile) => ({
      mobile,
      body: previewBody,
      templateName: rule.templateFamilyKey
        ? rule.templateFamilyKey.replace(/_/g, "_")
        : undefined,
      templateLanguage: rule.templateLanguage,
      variables: {
        guardianName: "Parent",
        childName: "Student",
        schoolName: "School",
      },
    })),
  };
}

/**
 * Evaluate due rules and create approval items (or auto-dispatch markers).
 * Client and tick API both use this pure function.
 */
export function evaluateAutomationTick(
  state: AutomationState,
  opts?: { forceRuleIds?: string[]; now?: Date },
): AutomationState {
  const now = opts?.now || new Date();
  const rules = [...state.rules];
  let approvals = [...state.approvals];
  let runs = [...state.runs];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    const forced = opts?.forceRuleIds?.includes(rule.id);
    if (!forced && !ruleIsDue(rule, now)) continue;
    if (!forced && !rule.enabled) continue;

    const preview = demoPreviewForRule(rule);
    const runId = nid("run");
    const approvalId = nid("appr");

    if (rule.executionMode === "auto" && rule.testedAt) {
      approvals = [
        {
          id: approvalId,
          ruleId: rule.id,
          ruleName: rule.name,
          status: "approved",
          createdAt: nowIso(),
          decidedAt: nowIso(),
          decidedBy: "auto",
          snoozeUntil: "",
          templateFamilyKey: rule.templateFamilyKey,
          templateLanguage: rule.templateLanguage,
          ...preview,
          error: "",
        },
        ...approvals,
      ];
      runs = [
        {
          id: runId,
          ruleId: rule.id,
          status: "completed",
          scheduledFor: now.toISOString(),
          startedAt: now.toISOString(),
          finishedAt: now.toISOString(),
          approvalId,
          stats: {
            proposed: preview.audienceCount,
            approved: preview.audienceCount,
            dispatched: 0,
            failed: 0,
          },
          error: "",
        },
        ...runs,
      ];
    } else {
      // Skip if pending approval already exists for this rule
      const hasPending = approvals.some(
        (a) => a.ruleId === rule.id && a.status === "pending",
      );
      if (!hasPending || forced) {
        approvals = [
          {
            id: approvalId,
            ruleId: rule.id,
            ruleName: rule.name,
            status: "pending",
            createdAt: nowIso(),
            decidedAt: "",
            decidedBy: "",
            snoozeUntil: "",
            templateFamilyKey: rule.templateFamilyKey,
            templateLanguage: rule.templateLanguage,
            ...preview,
            error: "",
          },
          ...approvals,
        ];
        runs = [
          {
            id: runId,
            ruleId: rule.id,
            status: "proposed",
            scheduledFor: now.toISOString(),
            startedAt: now.toISOString(),
            finishedAt: "",
            approvalId,
            stats: {
              proposed: preview.audienceCount,
              approved: 0,
              dispatched: 0,
              failed: 0,
            },
            error: "",
          },
          ...runs,
        ];
      }
    }

    rules[i] = {
      ...rule,
      lastRunAt: now.toISOString(),
      nextRunAt: computeNextRun(rule, now),
      updatedAt: nowIso(),
    };
  }

  return {
    ...state,
    rules,
    approvals: approvals.slice(0, 500),
    runs: runs.slice(0, 200),
    lastTickAt: now.toISOString(),
  };
}

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
  return { ...state, approvals };
}

export function markApprovalDispatched(
  state: AutomationState,
  approvalId: string,
  ok: boolean,
  error = "",
): AutomationState {
  return {
    ...state,
    approvals: state.approvals.map((a) =>
      a.id === approvalId
        ? {
            ...a,
            status: ok ? "dispatched" : "failed",
            error: ok ? "" : error,
            decidedAt: a.decidedAt || nowIso(),
          }
        : a,
    ),
    runs: state.runs.map((r) =>
      r.approvalId === approvalId
        ? {
            ...r,
            status: ok ? "completed" : "failed",
            finishedAt: nowIso(),
            stats: {
              ...r.stats,
              approved: r.stats.proposed,
              dispatched: ok ? r.stats.proposed : 0,
              failed: ok ? 0 : r.stats.proposed,
            },
            error: ok ? "" : error,
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
