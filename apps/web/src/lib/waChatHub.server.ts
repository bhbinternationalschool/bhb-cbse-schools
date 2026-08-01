/**
 * WhatsApp chat hub — unified thread index by category (parents, staff, vendors, etc.).
 */

import {
  audienceToWaCategory,
  type WaChatCategory,
  visitorPurposeToCategory,
  waCategoryLabel,
} from "@/lib/waChatCategories";
import { waNormalizeLocal10 } from "@/lib/waSend";

export type WaHubMsgRole = "contact" | "bot" | "staff";

export type WaHubMessage = {
  id: string;
  direction: "in" | "out";
  role: WaHubMsgRole;
  text: string;
  at: string;
  by: string;
  waMessageId?: string;
  interactiveId?: string;
  cannedId?: string;
};

export type WaHubThread = {
  id: string;
  mobile: string;
  displayName: string;
  category: WaChatCategory;
  categoryLabel: string;
  source: string;
  status: string;
  unreadStaff: number;
  messages: WaHubMessage[];
  updatedAt: string;
  lastInText: string;
  lastOutText: string;
};

export type WaHubStats = {
  totalThreads: number;
  unreadTotal: number;
  byCategory: Record<WaChatCategory, { threads: number; unread: number }>;
};

type HubStore = {
  version: 1;
  threads: Record<string, WaHubThread>;
};

let memory: HubStore = { version: 1, threads: {} };

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function readHubStore(): Promise<HubStore> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<HubStore>("hub", memory);
  if (remote?.version === 1 && remote.threads) {
    memory = remote;
    return remote;
  }
  return memory;
}

async function writeHubStore(store: HubStore): Promise<void> {
  memory = store;
  const { saveWaBotSlice } = await import("@/lib/waBotStore.server");
  await saveWaBotSlice("hub", store);
}

function mapRole(
  role: string,
  direction: "in" | "out",
): WaHubMsgRole {
  if (direction === "in") return "contact";
  if (role === "staff") return "staff";
  return "bot";
}

function threadKey(mobile10: string, category: WaChatCategory): string {
  return `${category}:${mobile10}`;
}

/** Log inbound/outbound for hub-indexed categories (visitors + unified). */
export async function appendWaHubExchange(opts: {
  mobile10: string;
  displayName: string;
  category: WaChatCategory;
  source: string;
  status?: string;
  inbound?: {
    text: string;
    by?: string;
    waMessageId?: string;
    interactiveId?: string;
  };
  outbound?: {
    text: string;
    by?: string;
    waMessageId?: string;
    cannedId?: string;
    role?: WaHubMsgRole;
  };
  unreadDelta?: number;
}): Promise<void> {
  const mobile10 = opts.mobile10.replace(/\D/g, "").slice(-10);
  if (mobile10.length !== 10) return;

  let store = await readHubStore();
  const key = threadKey(mobile10, opts.category);
  const existing = store.threads[key];
  const messages = [...(existing?.messages ?? [])];

  if (opts.inbound) {
    messages.push({
      id: nid("whm"),
      direction: "in",
      role: "contact",
      text: opts.inbound.text,
      at: nowIso(),
      by: opts.inbound.by || opts.displayName || mobile10,
      waMessageId: opts.inbound.waMessageId,
      interactiveId: opts.inbound.interactiveId,
    });
  }
  if (opts.outbound) {
    messages.push({
      id: nid("whm"),
      direction: "out",
      role: opts.outbound.role || "bot",
      text: opts.outbound.text,
      at: nowIso(),
      by: opts.outbound.by || "School bot",
      waMessageId: opts.outbound.waMessageId,
      cannedId: opts.outbound.cannedId,
    });
  }

  const lastIn =
    [...messages].reverse().find((m) => m.direction === "in")?.text || "";
  const lastOut =
    [...messages].reverse().find((m) => m.direction === "out")?.text || "";

  const thread: WaHubThread = {
    id: existing?.id || nid("wht"),
    mobile: mobile10,
    displayName: opts.displayName || existing?.displayName || "",
    category: opts.category,
    categoryLabel: waCategoryLabel(opts.category),
    source: opts.source,
    status: opts.status || existing?.status || "open",
    unreadStaff: Math.max(
      0,
      (existing?.unreadStaff || 0) + (opts.unreadDelta ?? (opts.inbound ? 1 : 0)),
    ),
    messages: messages.slice(-120),
    updatedAt: nowIso(),
    lastInText: lastIn,
    lastOutText: lastOut,
  };

  store = {
    ...store,
    threads: { ...store.threads, [key]: thread },
  };
  await writeHubStore(store);
}

function crmToHub(thread: {
  id: string;
  mobile: string;
  parentName: string;
  status: string;
  unreadStaff: number;
  messages: { id: string; role: string; text: string; at: string; by: string }[];
  updatedAt: string;
}): WaHubThread {
  const category: WaChatCategory = "admission_enquiry";
  const messages: WaHubMessage[] = thread.messages.map((m) => ({
    id: m.id,
    direction: m.role === "parent" ? "in" : "out",
    role: mapRole(m.role, m.role === "parent" ? "in" : "out"),
    text: m.text,
    at: m.at,
    by: m.by,
  }));
  const lastIn =
    [...messages].reverse().find((m) => m.direction === "in")?.text || "";
  const lastOut =
    [...messages].reverse().find((m) => m.direction === "out")?.text || "";
  return {
    id: thread.id,
    mobile: thread.mobile,
    displayName: thread.parentName,
    category,
    categoryLabel: waCategoryLabel(category),
    source: "crm_bot",
    status: thread.status,
    unreadStaff: thread.unreadStaff,
    messages,
    updatedAt: thread.updatedAt,
    lastInText: lastIn,
    lastOutText: lastOut,
  };
}

function genericToHub(
  thread: {
    id: string;
    mobile: string;
    parentName?: string;
    status: string;
    unreadStaff: number;
    messages: { id: string; role: string; text: string; at: string; by: string }[];
    updatedAt: string;
  },
  category: WaChatCategory,
  source: string,
): WaHubThread {
  const messages: WaHubMessage[] = thread.messages.map((m) => ({
    id: m.id,
    direction: m.role === "parent" || m.role === "teacher" ? "in" : "out",
    role: mapRole(
      m.role,
      m.role === "parent" || m.role === "teacher" ? "in" : "out",
    ),
    text: m.text,
    at: m.at,
    by: m.by,
  }));
  const lastIn =
    [...messages].reverse().find((m) => m.direction === "in")?.text || "";
  const lastOut =
    [...messages].reverse().find((m) => m.direction === "out")?.text || "";
  return {
    id: thread.id,
    mobile: thread.mobile,
    displayName: thread.parentName || "",
    category,
    categoryLabel: waCategoryLabel(category),
    source,
    status: thread.status,
    unreadStaff: thread.unreadStaff,
    messages,
    updatedAt: thread.updatedAt,
    lastInText: lastIn,
    lastOutText: lastOut,
  };
}

/** Aggregate all bot stores + hub into categorized thread list. */
export async function listWaHubThreads(opts?: {
  category?: WaChatCategory | "all";
  limit?: number;
}): Promise<{ threads: WaHubThread[]; stats: WaHubStats }> {
  const limit = opts?.limit ?? 200;
  const byKey = new Map<string, WaHubThread>();

  const { listWaCrmBotThreads } = await import("@/lib/waCrmBotServer");
  const crm = await listWaCrmBotThreads();
  for (const t of crm) {
    byKey.set(threadKey(t.mobile, "admission_enquiry"), crmToHub(t));
  }

  try {
    const { listWaSisBotThreads } = await import("@/lib/waSisBotServer");
    const sis = await listWaSisBotThreads();
    for (const t of sis) {
      byKey.set(threadKey(t.mobile, "parent"), genericToHub(t, "parent", "sis_bot"));
    }
  } catch {
    /* optional */
  }

  try {
    const { listWaSurveyBotThreads } = await import("@/lib/waSurveyBotServer");
    const survey = await listWaSurveyBotThreads();
    for (const t of survey) {
      byKey.set(
        threadKey(t.mobile, "field_survey"),
        genericToHub(t, "field_survey", "survey_bot"),
      );
    }
  } catch {
    /* optional */
  }

  const hubStore = await readHubStore();
  for (const t of Object.values(hubStore.threads)) {
    const key = threadKey(t.mobile, t.category);
    const prev = byKey.get(key);
    if (!prev || t.updatedAt > prev.updatedAt) {
      byKey.set(key, t);
    } else if (prev) {
      byKey.set(key, {
        ...prev,
        messages: [...prev.messages, ...t.messages]
          .sort((a, b) => a.at.localeCompare(b.at))
          .slice(-120),
        unreadStaff: prev.unreadStaff + t.unreadStaff,
      });
    }
  }

  let threads = [...byKey.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  if (opts?.category && opts.category !== "all") {
    threads = threads.filter((t) => t.category === opts.category);
  }

  const stats: WaHubStats = {
    totalThreads: threads.length,
    unreadTotal: threads.reduce((n, t) => n + t.unreadStaff, 0),
    byCategory: {} as WaHubStats["byCategory"],
  };
  for (const c of [
    "parent",
    "staff",
    "admission_enquiry",
    "job_enquiry",
    "vendor_enquiry",
    "transport",
    "fee_enquiry",
    "meeting",
    "field_survey",
    "class_teacher",
    "general",
  ] as WaChatCategory[]) {
    const rows = threads.filter((t) => t.category === c);
    stats.byCategory[c] = {
      threads: rows.length,
      unread: rows.reduce((n, t) => n + t.unreadStaff, 0),
    };
  }

  return { threads: threads.slice(0, limit), stats };
}

export async function markWaHubThreadRead(
  mobile10: string,
  category: WaChatCategory,
): Promise<void> {
  const m = waNormalizeLocal10(mobile10);
  const store = await readHubStore();
  const key = threadKey(m, category);
  const t = store.threads[key];
  if (!t) return;
  store.threads[key] = { ...t, unreadStaff: 0, updatedAt: nowIso() };
  await writeHubStore(store);
}

export function categoryForUnifiedAudience(
  audience: string,
  flow?: string | null,
): WaChatCategory {
  if (flow && ["job", "vendor", "transport", "fee", "meeting", "other"].includes(flow)) {
    return visitorPurposeToCategory(flow);
  }
  return audienceToWaCategory(audience, flow);
}

async function findHubThreadById(threadId: string): Promise<WaHubThread | null> {
  const { threads } = await listWaHubThreads({ limit: 500 });
  return threads.find((t) => t.id === threadId) || null;
}

async function staffReplyWaHubGeneric(opts: {
  thread: WaHubThread;
  text: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = opts.text.trim();
  if (!body) return { ok: false, reason: "Empty reply" };

  const { sendWhatsAppText } = await import("@/lib/waSend");
  const send = await sendWhatsAppText({
    toMobile: opts.thread.mobile,
    body,
  });
  if (!send.ok && send.mode !== "stub") {
    return { ok: false, reason: send.error || "Send failed" };
  }

  await appendWaHubExchange({
    mobile10: opts.thread.mobile,
    displayName: opts.thread.displayName,
    category: opts.thread.category,
    source: opts.thread.source || "hub_staff",
    status: opts.thread.status,
    outbound: {
      text: body,
      by: opts.by || "Desk",
      waMessageId: send.providerId,
      role: "staff",
    },
    unreadDelta: 0,
  });

  if (!send.ok && send.mode === "stub") {
    return {
      ok: false,
      reason: `Saved locally but WhatsApp not configured: ${send.error}`,
    };
  }
  return { ok: true };
}

/** Staff reply from Comms hub — routes CRM/SIS/survey or generic send. */
export async function staffReplyWaHubThread(opts: {
  threadId: string;
  text: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const thread = await findHubThreadById(opts.threadId);
  if (!thread) return { ok: false, reason: "Thread not found" };

  switch (thread.category) {
    case "admission_enquiry": {
      const { staffReplyWaCrmBot } = await import("@/lib/waCrmBotServer");
      return staffReplyWaCrmBot({
        threadId: thread.id,
        text: opts.text,
        by: opts.by,
      });
    }
    case "parent": {
      const { staffReplyWaSisBot } = await import("@/lib/waSisBotServer");
      return staffReplyWaSisBot({
        threadId: thread.id,
        text: opts.text,
        by: opts.by,
      });
    }
    case "field_survey": {
      const { staffReplyWaSurveyBot } = await import("@/lib/waSurveyBotServer");
      return staffReplyWaSurveyBot({
        threadId: thread.id,
        text: opts.text,
        by: opts.by,
      });
    }
    default:
      return staffReplyWaHubGeneric({ thread, text: opts.text, by: opts.by });
  }
}

/** Send approved Meta template from hub (cold outbound / outside 24h). */
export async function staffSendWaHubTemplate(opts: {
  threadId: string;
  templateName: string;
  language: string;
  variableKeys?: string[];
  variables?: Record<string, string>;
  previewText?: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const thread = await findHubThreadById(opts.threadId);
  if (!thread) return { ok: false, reason: "Thread not found" };
  if (!opts.templateName.trim()) {
    return { ok: false, reason: "Missing template name" };
  }

  const {
    buildWaTemplateBodyComponent,
    sendWhatsAppTemplate,
  } = await import("@/lib/waSend");

  const components =
    opts.variableKeys && opts.variableKeys.length
      ? [buildWaTemplateBodyComponent(opts.variableKeys, opts.variables || {})]
      : [];

  const send = await sendWhatsAppTemplate({
    toMobile: thread.mobile,
    name: opts.templateName,
    language: opts.language || "en",
    components,
  });
  if (!send.ok) {
    return { ok: false, reason: send.error || "Template send failed" };
  }

  const logText =
    opts.previewText?.trim() ||
    `[Template: ${opts.templateName}]`;

  await appendWaHubExchange({
    mobile10: thread.mobile,
    displayName: thread.displayName,
    category: thread.category,
    source: thread.source || "hub_staff",
    status: thread.status,
    outbound: {
      text: logText,
      by: opts.by || "Desk",
      waMessageId: send.providerId,
      role: "staff",
      cannedId: `tpl:${opts.templateName}`,
    },
    unreadDelta: 0,
  });

  return { ok: true };
}
