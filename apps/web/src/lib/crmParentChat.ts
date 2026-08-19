/**
 * CRM parent chatbot — for admission / enquiry parents only.
 * Completely separate from SIS student-parent portal (/parent).
 * Store: bhb_crm_parent_chat_v1
 */

import {
  loadAdmissions,
  publicRegisterAbsoluteUrl,
  type AdmissionLead,
  type AdmissionsState,
} from "@/lib/admissions";
import {
  CRM_BOT_QUICK_PROMPTS,
  crmBotWelcomeText,
  detectCrmBotIntent,
  replyCrmBotIntent,
  stageLabelForBot,
  type CrmBotQuickId,
} from "@/lib/crmAdmissionBotEngine";
import { formatInr } from "@/lib/masters";

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
const STORAGE_KEY = "bhb_crm_parent_chat_v1";

/** Distinguishes this product surface from SIS parent account chats */
export const CRM_CHAT_AUDIENCE = "crm_admission_parent" as const;

export type CrmChatAudience = typeof CRM_CHAT_AUDIENCE;

export type CrmChatRole = "parent" | "bot" | "staff";

export type CrmChatMessage = {
  id: string;
  role: CrmChatRole;
  text: string;
  at: string;
  by: string;
};

export type CrmChatThreadStatus = "open" | "bot" | "needs_staff" | "closed";

export type CrmChatThread = {
  id: string;
  /** Always crm_admission_parent — never SIS parent household */
  audience: CrmChatAudience;
  mobile: string;
  parentName: string;
  leadId: string;
  childName: string;
  status: CrmChatThreadStatus;
  messages: CrmChatMessage[];
  createdAt: string;
  updatedAt: string;
  lastParentAt: string;
  unreadStaff: number;
};

export type CrmParentChatState = {
  version: 1;
  audience: CrmChatAudience;
  threads: CrmChatThread[];
};

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMobile(m: string): string {
  return (m || "").replace(/\D/g, "").slice(0, 10);
}

export function defaultCrmParentChatState(): CrmParentChatState {
  return {
    version: 1,
    audience: CRM_CHAT_AUDIENCE,
    threads: [],
  };
}

function normalizeMessage(raw: Partial<CrmChatMessage>): CrmChatMessage {
  return {
    id: raw.id || nid("ccm"),
    role:
      raw.role === "parent" || raw.role === "staff" || raw.role === "bot"
        ? raw.role
        : "bot",
    text: (raw.text || "").trim(),
    at: raw.at || nowIso(),
    by: raw.by || "",
  };
}

function normalizeThread(raw: Partial<CrmChatThread>): CrmChatThread {
  const t = nowIso();
  return {
    id: raw.id || nid("cct"),
    audience: CRM_CHAT_AUDIENCE,
    mobile: normalizeMobile(raw.mobile || ""),
    parentName: (raw.parentName || "").trim(),
    leadId: raw.leadId || "",
    childName: (raw.childName || "").trim(),
    status:
      raw.status === "open" ||
      raw.status === "bot" ||
      raw.status === "needs_staff" ||
      raw.status === "closed"
        ? raw.status
        : "bot",
    messages: Array.isArray(raw.messages)
      ? raw.messages.map((m) => normalizeMessage(m))
      : [],
    createdAt: raw.createdAt || t,
    updatedAt: raw.updatedAt || t,
    lastParentAt: raw.lastParentAt || "",
    unreadStaff: Math.max(0, Math.round(Number(raw.unreadStaff) || 0)),
  };
}

export function normalizeCrmParentChatState(
  raw: Partial<CrmParentChatState> | null | undefined,
): CrmParentChatState {
  const d = defaultCrmParentChatState();
  if (!raw) return d;
  return {
    version: 1,
    audience: CRM_CHAT_AUDIENCE,
    threads: (Array.isArray(raw.threads) ? raw.threads : [])
      .map((t) => normalizeThread(t))
      .filter((t) => t.audience === CRM_CHAT_AUDIENCE),
  };
}

export function loadCrmParentChat(): CrmParentChatState {
  if (typeof window === "undefined") return defaultCrmParentChatState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCrmParentChatState();
    return normalizeCrmParentChatState(
      JSON.parse(raw) as Partial<CrmParentChatState>,
    );
  } catch {
    return defaultCrmParentChatState();
  }
}

export function saveCrmParentChat(state: CrmParentChatState): void {
  if (!assertModulePermission("admissions", "edit", "saveCrmParentChat")) return;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...state, audience: CRM_CHAT_AUDIENCE }),
  );
  void import("@/lib/localModulesPersistence").then((m) => m.scheduleModuleStateSync("crm_parent_chat", { ...state, audience: CRM_CHAT_AUDIENCE }));
}

/** Hydrate path (module_local_state) — cache write only, no RBAC, no push. */
export function writeCrmParentChatLocalRaw(state: CrmParentChatState): void {
  if (typeof window === "undefined") return;
  try {
    // Never a bare setItem on module state — a full origin must not throw here.
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify({ ...state, audience: CRM_CHAT_AUDIENCE }));
  } catch {
    /* quota — the server copy is the truth anyway */
  }
}

export function findLeadByMobile(
  admissions: AdmissionsState,
  mobile: string,
): AdmissionLead | null {
  const m = normalizeMobile(mobile);
  if (m.length !== 10) return null;
  const hits = admissions.leads.filter(
    (l) =>
      l.stage !== "lost" &&
      l.stage !== "enrolled" &&
      normalizeMobile(l.mobile || l.parentGroupKey) === m,
  );
  hits.sort((a, b) =>
    (b.leadDate || b.createdAt).localeCompare(a.leadDate || a.createdAt),
  );
  return hits[0] || null;
}

export type { CrmBotQuickId };

export function crmBotQuickPrompts(): { id: CrmBotQuickId; label: string }[] {
  return CRM_BOT_QUICK_PROMPTS.map((q) => ({ id: q.id, label: q.label }));
}

export function crmBotWelcome(): string {
  return crmBotWelcomeText();
}

export { detectCrmBotIntent };

function replyForIntent(
  intent: CrmBotQuickId | "unknown",
  ctx: { lead: AdmissionLead | null; registerUrl: string },
): { text: string; escalate: boolean } {
  const lead = ctx.lead
    ? {
        childName: ctx.lead.childName,
        enquiryNo: ctx.lead.enquiryNo,
        applicationNo: ctx.lead.applicationNo,
        stageLabel: stageLabelForBot(ctx.lead.stage),
        feeAmountLabel:
          ctx.lead.registrationFeeAmountPaise > 0
            ? formatInr(ctx.lead.registrationFeeAmountPaise)
            : undefined,
      }
    : null;
  return replyCrmBotIntent(intent, {
    registerUrl: ctx.registerUrl,
    lead,
  });
}

export function openOrCreateCrmThread(
  state: CrmParentChatState,
  input: {
    mobile: string;
    parentName?: string;
    leadId?: string;
    childName?: string;
  },
): { state: CrmParentChatState; thread: CrmChatThread; created: boolean } {
  const mobile = normalizeMobile(input.mobile);
  const existing = state.threads.find(
    (t) => t.mobile === mobile && t.status !== "closed",
  );
  if (existing) {
    return { state, thread: existing, created: false };
  }

  const admissions = loadAdmissions();
  const lead =
    (input.leadId && admissions.leads.find((l) => l.id === input.leadId)) ||
    findLeadByMobile(admissions, mobile);

  const welcome = normalizeMessage({
    role: "bot",
    text: crmBotWelcome(),
    by: "Admissions bot",
  });

  const thread = normalizeThread({
    mobile,
    parentName: input.parentName || lead?.guardianName || "",
    leadId: lead?.id || input.leadId || "",
    childName: input.childName || lead?.childName || "",
    status: "bot",
    messages: [welcome],
  });

  return {
    created: true,
    thread,
    state: {
      ...state,
      audience: CRM_CHAT_AUDIENCE,
      threads: [thread, ...state.threads],
    },
  };
}

export function postCrmParentMessage(
  state: CrmParentChatState,
  threadId: string,
  text: string,
  opts?: { quickId?: CrmBotQuickId },
):
  | { ok: true; state: CrmParentChatState; thread: CrmChatThread }
  | { ok: false; reason: string } {
  const body = text.trim();
  if (!body && !opts?.quickId) {
    return { ok: false, reason: "Enter a message" };
  }

  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return { ok: false, reason: "Chat not found" };
  if (thread.audience !== CRM_CHAT_AUDIENCE) {
    return { ok: false, reason: "Wrong audience — SIS parent chat is separate" };
  }

  const parentMsg = normalizeMessage({
    role: "parent",
    text: body || crmBotQuickPrompts().find((q) => q.id === opts?.quickId)?.label || "",
    by: thread.parentName || "Parent",
  });

  const intent = opts?.quickId || detectCrmBotIntent(parentMsg.text);
  const admissions = loadAdmissions();
  const lead =
    (thread.leadId && admissions.leads.find((l) => l.id === thread.leadId)) ||
    findLeadByMobile(admissions, thread.mobile);
  const registerUrl = publicRegisterAbsoluteUrl("wa_crm_chat");
  const bot = replyForIntent(intent, { lead, registerUrl });

  const botMsg = normalizeMessage({
    role: "bot",
    text: bot.text,
    by: "Admissions bot",
  });

  const nextThread: CrmChatThread = {
    ...thread,
    leadId: lead?.id || thread.leadId,
    childName: lead?.childName || thread.childName,
    parentName: thread.parentName || lead?.guardianName || "",
    status: bot.escalate ? "needs_staff" : thread.status === "closed" ? "bot" : thread.status,
    messages: [...thread.messages, parentMsg, botMsg],
    updatedAt: nowIso(),
    lastParentAt: nowIso(),
    unreadStaff: bot.escalate
      ? thread.unreadStaff + 1
      : thread.unreadStaff,
  };

  return {
    ok: true,
    thread: nextThread,
    state: {
      ...state,
      audience: CRM_CHAT_AUDIENCE,
      threads: state.threads.map((t) =>
        t.id === threadId ? nextThread : t,
      ),
    },
  };
}

export function postCrmStaffReply(
  state: CrmParentChatState,
  threadId: string,
  text: string,
  by: string,
):
  | { ok: true; state: CrmParentChatState; thread: CrmChatThread }
  | { ok: false; reason: string } {
  const body = text.trim();
  if (!body) return { ok: false, reason: "Enter a reply" };
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return { ok: false, reason: "Chat not found" };

  const msg = normalizeMessage({
    role: "staff",
    text: body,
    by: by || "Admissions",
  });

  const nextThread: CrmChatThread = {
    ...thread,
    status: "open",
    messages: [...thread.messages, msg],
    updatedAt: nowIso(),
    unreadStaff: 0,
  };

  return {
    ok: true,
    thread: nextThread,
    state: {
      ...state,
      threads: state.threads.map((t) =>
        t.id === threadId ? nextThread : t,
      ),
    },
  };
}

export function markCrmThreadRead(
  state: CrmParentChatState,
  threadId: string,
): CrmParentChatState {
  return {
    ...state,
    threads: state.threads.map((t) =>
      t.id === threadId ? { ...t, unreadStaff: 0 } : t,
    ),
  };
}

export function closeCrmThread(
  state: CrmParentChatState,
  threadId: string,
): CrmParentChatState {
  return {
    ...state,
    threads: state.threads.map((t) =>
      t.id === threadId
        ? { ...t, status: "closed" as const, updatedAt: nowIso() }
        : t,
    ),
  };
}

export function listCrmThreadsForStaff(
  state: CrmParentChatState,
): CrmChatThread[] {
  return [...state.threads]
    .filter((t) => t.audience === CRM_CHAT_AUDIENCE)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function crmChatUnreadCount(state: CrmParentChatState): number {
  return state.threads.reduce((s, t) => s + (t.unreadStaff || 0), 0);
}
