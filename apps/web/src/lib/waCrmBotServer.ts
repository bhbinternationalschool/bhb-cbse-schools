/**
 * Server-side WhatsApp CRM admissions bot threads.
 * Separate from SIS parent portal. Persist under .data when writable.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  detectCrmBotIntent,
  replyCrmBotIntent,
} from "@/lib/crmAdmissionBotEngine";
import { TENANT } from "@/lib/types";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";

export type WaCrmBotChannel = "whatsapp";

export type WaCrmBotMsg = {
  id: string;
  role: "parent" | "bot" | "staff";
  text: string;
  at: string;
  by: string;
  waMessageId?: string;
};

export type WaCrmBotThread = {
  id: string;
  channel: WaCrmBotChannel;
  audience: "crm_admission_parent";
  mobile: string;
  parentName: string;
  status: "bot" | "needs_staff" | "open" | "closed";
  messages: WaCrmBotMsg[];
  createdAt: string;
  updatedAt: string;
  unreadStaff: number;
};

export type WaCrmBotStore = {
  version: 1;
  threads: WaCrmBotThread[];
};

const DATA_FILE = path.join(process.cwd(), ".data", "wa_crm_bot_threads.json");

let memoryStore: WaCrmBotStore = { version: 1, threads: [] };

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function publicRegisterUrl(): string {
  const host = (TENANT.publicPortal || "bhbinternational.school").replace(
    /^https?:\/\//,
    "",
  );
  return `https://${host.replace(/\/$/, "")}/register?src=wa_bot`;
}

async function readStore(): Promise<WaCrmBotStore> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<WaCrmBotStore>("crm", memoryStore);
  if (remote?.version === 1 && Array.isArray(remote.threads)) {
    memoryStore = remote;
    return remote;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as WaCrmBotStore;
    if (parsed?.version === 1 && Array.isArray(parsed.threads)) {
      memoryStore = parsed;
      return parsed;
    }
  } catch {
    /* missing file / serverless */
  }
  return memoryStore;
}

async function writeStore(store: WaCrmBotStore): Promise<void> {
  memoryStore = store;
  const { saveWaBotSlice } = await import("@/lib/waBotStore.server");
  await saveWaBotSlice("crm", store);
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* ephemeral runtime — keep memory only */
  }
}

function findOrCreateThread(
  store: WaCrmBotStore,
  mobile10: string,
  profileName?: string,
): { store: WaCrmBotStore; thread: WaCrmBotThread; created: boolean } {
  const open = store.threads.find(
    (t) => t.mobile === mobile10 && t.status !== "closed",
  );
  if (open) {
    return {
      store,
      created: false,
      thread: profileName && !open.parentName
        ? { ...open, parentName: profileName }
        : open,
    };
  }

  const thread: WaCrmBotThread = {
    id: nid("wat"),
    channel: "whatsapp",
    audience: "crm_admission_parent",
    mobile: mobile10,
    parentName: profileName || "",
    status: "bot",
    messages: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    unreadStaff: 0,
  };
  return {
    created: true,
    thread,
    store: { ...store, threads: [thread, ...store.threads] },
  };
}

export async function listWaCrmBotThreads(): Promise<WaCrmBotThread[]> {
  const store = await readStore();
  return [...store.threads].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function markWaCrmBotThreadRead(
  threadId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let store = await readStore();
  const thread = store.threads.find((t) => t.id === threadId);
  if (!thread) return { ok: false, reason: "Thread not found" };
  if (!thread.unreadStaff) return { ok: true };

  const next: WaCrmBotThread = { ...thread, unreadStaff: 0, updatedAt: nowIso() };
  store = {
    ...store,
    threads: store.threads.map((t) => (t.id === threadId ? next : t)),
  };
  await writeStore(store);
  return { ok: true };
}

export async function staffReplyWaCrmBot(opts: {
  threadId: string;
  text: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = opts.text.trim();
  if (!body) return { ok: false, reason: "Empty reply" };
  let store = await readStore();
  const thread = store.threads.find((t) => t.id === opts.threadId);
  if (!thread) return { ok: false, reason: "Thread not found" };

  const send = await sendWhatsAppText({
    toMobile: thread.mobile,
    body,
  });
  if (!send.ok && send.mode !== "stub") {
    return { ok: false, reason: send.error || "Send failed" };
  }

  const msg: WaCrmBotMsg = {
    id: nid("wam"),
    role: "staff",
    text:
      send.ok || send.mode === "stub"
        ? body
        : body,
    at: nowIso(),
    by: opts.by || "Admissions",
    waMessageId: send.providerId,
  };

  const next: WaCrmBotThread = {
    ...thread,
    status: "open",
    unreadStaff: 0,
    updatedAt: nowIso(),
    messages: [...thread.messages, msg],
  };
  store = {
    ...store,
    threads: store.threads.map((t) => (t.id === thread.id ? next : t)),
  };
  await writeStore(store);

  if (!send.ok && send.mode === "stub") {
    return {
      ok: false,
      reason: `Saved locally but WhatsApp not configured: ${send.error}`,
    };
  }
  return { ok: true };
}

/**
 * Handle one inbound parent WhatsApp text for CRM admissions bot.
 */
export async function handleWaCrmBotInbound(opts: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  /** Routed via unified school bot — skip generic admissions welcome on Hi. */
  fromUnified?: boolean;
  visitorName?: string;
  forceEscalate?: boolean;
}): Promise<{
  replied: boolean;
  escalate: boolean;
  replyText: string;
  stub: boolean;
  error?: string;
}> {
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
  const text = (opts.text || "").trim();
  if (mobile10.length !== 10) {
    return {
      replied: false,
      escalate: false,
      replyText: "",
      stub: false,
      error: "Invalid from number",
    };
  }

  let store = await readStore();
  const profile =
    opts.visitorName?.trim() || opts.profileName?.trim() || "";
  const opened = findOrCreateThread(store, mobile10, profile);
  store = opened.store;
  let thread = opened.thread;

  const parentMsg: WaCrmBotMsg = {
    id: nid("wam"),
    role: "parent",
    text: text || "(open)",
    at: nowIso(),
    by: thread.parentName || profile || "Parent",
    waMessageId: opts.waMessageId,
  };

  const isGreeting =
    !opts.fromUnified &&
    (!text || /^(hi|hello|namaste|hey|start|menu)$/i.test(text));
  const intent = opts.forceEscalate
    ? ("human" as const)
    : isGreeting
      ? ("unknown" as const)
      : detectCrmBotIntent(text);
  const { findAdmissionLeadByMobile, loadAdmissions, stageLabel } =
    await import("@/lib/admissions");
  const leadRow = findAdmissionLeadByMobile(loadAdmissions(), mobile10);
  const leadCtx = leadRow
    ? {
        childName: leadRow.childName,
        enquiryNo: leadRow.enquiryNo,
        applicationNo: leadRow.applicationNo,
        stageLabel: stageLabel(leadRow.stage),
      }
    : null;
  const bot = replyCrmBotIntent(intent, {
    registerUrl: publicRegisterUrl(),
    lead: leadCtx,
  });
  let replyText = bot.text;
  if (opts.fromUnified && intent === "unknown" && !opts.forceEscalate) {
    replyText =
      "Reply *FEE* · *REGISTER* · *DOCS* · *STATUS* · *VISIT* · *HUMAN* — or *MENU* for the main school menu.";
  }
  if (isGreeting && leadRow && !opts.fromUnified) {
    replyText = [
      `Namaste${opts.profileName ? ` ${opts.profileName}` : ""} — *${TENANT.nameDisplay} Admissions*.`,
      leadRow.childName
        ? `We have your enquiry for *${leadRow.childName}* (${stageLabel(leadRow.stage)}).`
        : `We have enquiry *${leadRow.enquiryNo}* on file.`,
      "",
      "Reply: FEE · REGISTER · DOCS · STATUS · VISIT · HUMAN",
    ].join("\n");
  }
  if (leadRow?.guardianName && !thread.parentName) {
    thread = { ...thread, parentName: leadRow.guardianName };
  }

  const botMsg: WaCrmBotMsg = {
    id: nid("wam"),
    role: "bot",
    text: replyText,
    at: nowIso(),
    by: "Admissions WA bot",
  };

  thread = {
    ...thread,
    status: bot.escalate
      ? "needs_staff"
      : thread.status === "closed"
        ? "bot"
        : thread.status || "bot",
    // Every parent message should surface in Admissions → WhatsApp bot inbox.
    unreadStaff: thread.unreadStaff + 1,
    messages: [...thread.messages, parentMsg, botMsg],
    updatedAt: nowIso(),
  };

  store = {
    ...store,
    threads: store.threads.map((t) => (t.id === thread.id ? thread : t)),
  };
  await writeStore(store);

  // Push WhatsApp profile name onto matching CRM leads for campaign {{guardianName}}
  if ((opts.profileName || "").trim()) {
    try {
      const { getSchoolMirrorSync, setMirrorSlice } = await import(
        "@/lib/schoolDataMirror"
      );
      const {
        applyWhatsAppNamesToLeads,
        normalizeAdmissionsState,
      } = await import("@/lib/admissions");
      const mirror = getSchoolMirrorSync();
      if (mirror.admissions) {
        const adm = normalizeAdmissionsState(
          mirror.admissions as Parameters<typeof normalizeAdmissionsState>[0],
        );
        const applied = applyWhatsAppNamesToLeads(
          adm,
          [
            {
              mobile: mobile10,
              displayName: opts.profileName!.trim(),
              waId: opts.fromWaId,
            },
          ],
          { alsoUpdateGuardianName: false },
        );
        if (applied.updated > 0) {
          setMirrorSlice("admissions", applied.state);
        }
      }
    } catch {
      /* mirror optional on some hosts */
    }
  }

  const send = await sendWhatsAppText({
    toMobile: mobile10,
    body: replyText,
    clientMessageId: botMsg.id,
  });

  return {
    replied: send.ok || send.mode === "stub",
    escalate: bot.escalate,
    replyText,
    stub: !send.ok,
    error: send.ok ? undefined : send.error,
  };
}

/** Parse Meta Cloud API webhook payload → inbound texts / locations */
export function parseMetaWebhookInbound(body: unknown): {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  location?: { lat: number; lng: number; name?: string; address?: string };
  mediaNote?: string;
}[] {
  const out: {
    fromWaId: string;
    text: string;
    waMessageId?: string;
    profileName?: string;
    location?: { lat: number; lng: number; name?: string; address?: string };
    mediaNote?: string;
  }[] = [];
  const root = body as {
    entry?: {
      changes?: {
        value?: {
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: {
            from?: string;
            id?: string;
            type?: string;
            text?: { body?: string };
            button?: { text?: string; payload?: string };
            image?: { caption?: string; id?: string; mime_type?: string };
            document?: {
              caption?: string;
              filename?: string;
              id?: string;
              mime_type?: string;
            };
            video?: { caption?: string; id?: string; mime_type?: string };
            audio?: { id?: string; mime_type?: string };
            location?: {
              latitude?: number;
              longitude?: number;
              name?: string;
              address?: string;
            };
            interactive?: {
              type?: string;
              button_reply?: { id?: string; title?: string };
              list_reply?: { id?: string; title?: string };
            };
          }[];
        };
      }[];
    }[];
  };

  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value?.messages) continue;
      const name = value.contacts?.[0]?.profile?.name || "";
      for (const msg of value.messages) {
        let text = "";
        let mediaNote: string | undefined;
        let location:
          | { lat: number; lng: number; name?: string; address?: string }
          | undefined;
        if (msg.type === "text") text = msg.text?.body || "";
        else if (msg.type === "button")
          text = msg.button?.payload || msg.button?.text || "";
        else if (msg.type === "interactive") {
          text =
            msg.interactive?.button_reply?.id ||
            msg.interactive?.button_reply?.title ||
            msg.interactive?.list_reply?.id ||
            msg.interactive?.list_reply?.title ||
            "";
        } else if (msg.type === "image") {
          text = msg.image?.caption || "";
          mediaNote = `image${msg.image?.mime_type ? ` (${msg.image.mime_type})` : ""}`;
        } else if (msg.type === "document") {
          text =
            msg.document?.caption ||
            msg.document?.filename ||
            "Document";
          mediaNote = `document:${msg.document?.filename || msg.document?.id || ""}`;
        } else if (msg.type === "video") {
          text = msg.video?.caption || "";
          mediaNote = "video";
        } else if (msg.type === "audio") {
          text = "";
          mediaNote = "audio";
        } else if (msg.type === "location" && msg.location) {
          const lat = Number(msg.location.latitude);
          const lng = Number(msg.location.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            location = {
              lat,
              lng,
              name: msg.location.name || undefined,
              address: msg.location.address || undefined,
            };
            text = "";
          } else continue;
        } else continue;
        if (!msg.from) continue;
        if (!text && !mediaNote && !location) continue;
        out.push({
          fromWaId: msg.from,
          text: text || (mediaNote ? `MEDIA ${mediaNote}` : ""),
          waMessageId: msg.id,
          profileName: name,
          location,
          mediaNote,
        });
      }
    }
  }
  return out;
}

export function parseGenericBspInbound(body: unknown): {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  location?: { lat: number; lng: number; name?: string; address?: string };
}[] {
  const b = body as Record<string, unknown>;
  // Common BSP shapes
  if (typeof b.from === "string" && (b.text || b.body || b.message || b.latitude != null)) {
    const text =
      typeof b.text === "string"
        ? b.text
        : typeof b.body === "string"
          ? b.body
          : typeof b.message === "string"
            ? b.message
            : "";
    const lat = Number(b.latitude ?? b.lat);
    const lng = Number(b.longitude ?? b.lng);
    const location =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : undefined;
    return [
      {
        fromWaId: b.from,
        text,
        waMessageId: typeof b.id === "string" ? b.id : undefined,
        profileName: typeof b.name === "string" ? b.name : undefined,
        location,
      },
    ];
  }
  if (Array.isArray(b.messages)) {
    return (b.messages as Record<string, unknown>[])
      .map((m) => {
        const lat = Number(m.latitude ?? m.lat);
        const lng = Number(m.longitude ?? m.lng);
        return {
          fromWaId: String(m.from || m.mobile || ""),
          text: String(m.text || m.body || ""),
          waMessageId: m.id ? String(m.id) : undefined,
          profileName: m.name ? String(m.name) : undefined,
          location:
            Number.isFinite(lat) && Number.isFinite(lng)
              ? { lat, lng }
              : undefined,
        };
      })
      .filter((m) => m.fromWaId && (m.text || m.location));
  }
  return [];
}
