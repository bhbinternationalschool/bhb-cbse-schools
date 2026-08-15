/**
 * Server-side WhatsApp CRM admissions bot threads.
 * Separate from SIS parent portal. Persist under .data when writable.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  ADMISSION_SOURCE_LABELS,
  composeAdmissionOffer,
  composeAdmissionRegisterStep,
  detectCrmBotIntent,
  replyCrmBotIntent,
} from "@/lib/crmAdmissionBotEngine";
import { signAdmissionLinkToken } from "@/lib/admissionLinkToken.server";
import { TENANT } from "@/lib/types";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";
import { generateTutorText } from "@/lib/aiLlm.server";

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

/**
 * The same form, but carrying a signed token for this family — so the
 * submit converts their existing enquiry instead of filing a second lead
 * for a child the school already has on file. Falls back to the plain
 * link if the token cannot be signed (no secret configured), because a
 * parent who cannot register at all is worse than a possible duplicate.
 */
function personalRegisterUrl(householdId: string, mobile10: string): string {
  const token = signAdmissionLinkToken({ householdId, mobile10 });
  if (!token) return publicRegisterUrl();
  const host = (TENANT.publicPortal || "bhbinternational.school").replace(
    /^https?:\/\//,
    "",
  );
  return `https://${host.replace(/\/$/, "")}/register?src=wa_bot&lead=${encodeURIComponent(token)}`;
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
 * LLM fallback for admissions-enquiry messages the keyword matcher doesn't
 * recognize — grounded ONLY in this contact's own enquiry record (if any)
 * and the public registration link, never a specific fee/date/policy it
 * wasn't given. Returns null on any failure — caller keeps the existing
 * hardcoded fallback, this is a graceful upgrade, not a hard dependency.
 */
async function tryAiFallbackReply(
  text: string,
  lead: {
    childName: string;
    enquiryNo: string;
    applicationNo: string;
    stageLabel: string;
  } | null,
): Promise<string | null> {
  const system = `You are a WhatsApp assistant for prospective-parent admissions enquiries at ${TENANT.nameDisplay}.
You may ONLY discuss the enquiry record given below (child's name, enquiry number, stage/status, next steps) and share the public registration link.
You do NOT know this school's fees, admission dates, seat availability, curriculum, medium of instruction, transport, uniform, or any other policy or factual detail — even if it seems like common knowledge for a school, do not state it, confirm it, or guess at it.
For ANY question outside the enquiry record above, reply that you don't have that information and to reply *HUMAN* to talk to the admissions office — do not attempt to answer it a different way.
Keep the reply under 300 characters, warm and simple, plain text (no markdown headers).`;

  const userMessage = `Enquiry on file: ${
    lead
      ? `${lead.childName || "child"} · ${lead.enquiryNo}${lead.applicationNo ? ` · ${lead.applicationNo}` : ""} · stage: ${lead.stageLabel}`
      : "none yet"
  }
Public registration link: ${publicRegisterUrl()}
Parent's message: "${text}"`;

  try {
    const r = await generateTutorText({ system, userMessage });
    if (!r.ok) return null;
    return r.text.trim() || null;
  } catch {
    return null;
  }
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

  let admissionsState = loadAdmissions();
  let leadCreatedEnquiryNo: string | null = null;
  let leadRow = findAdmissionLeadByMobile(admissionsState, mobile10);
  if (!leadRow) {
    const { ingestWhatsAppAdmissionLead } = await import(
      "@/lib/admissionsLeadIngest.server"
    );
    const ingested = await ingestWhatsAppAdmissionLead({
      mobile10,
      profileName: profile || opts.profileName,
      waId: opts.fromWaId,
      inboundText: text,
    });
    if (ingested.ok) {
      admissionsState = ingested.state;
      leadRow = findAdmissionLeadByMobile(admissionsState, mobile10);
      if (ingested.created) leadCreatedEnquiryNo = ingested.enquiryNo;
    }
  }
  // Not yet on the school register: no confirmed SIS match and not
  // enrolled. Only these families are offered admission — a parent whose
  // child is already a student must never be told to register again.
  const awaitingAdmission =
    !!leadRow && leadRow.stage !== "enrolled" && leadRow.sisMatch !== "admitted";

  const registerUrl =
    awaitingAdmission && leadRow?.householdId
      ? personalRegisterUrl(leadRow.householdId, mobile10)
      : publicRegisterUrl();

  // Every lead this family has on file. The offer quotes the family's
  // FIRST enquiry date, which is also what the registration form shows —
  // quoting the matched lead's own date instead had the bot and the form
  // naming two different days for the same enquiry.
  const familyLeads = leadRow
    ? admissionsState.leads
        .filter((l) => l.householdId === leadRow.householdId && l.stage !== "lost")
        .sort((a, b) => (a.leadDate || "").localeCompare(b.leadDate || ""))
    : [];

  const leadCtx = leadRow
    ? {
        childName: leadRow.childName,
        enquiryNo: leadRow.enquiryNo,
        applicationNo: leadRow.applicationNo,
        stageLabel: stageLabel(leadRow.stage),
        enquiryDate: familyLeads[0]?.leadDate || leadRow.leadDate,
        sourceLabel: ADMISSION_SOURCE_LABELS[leadRow.source] || "Enquiry",
        feeAmountLabel:
          leadRow.registrationFeeAmountPaise > 0
            ? `₹${(leadRow.registrationFeeAmountPaise / 100).toLocaleString("en-IN")}`
            : undefined,
        siblingNames: familyLeads
          .filter((l) => l.childName.trim())
          .map((l) => l.childName),
      }
    : null;
  const bot = replyCrmBotIntent(intent, {
    registerUrl,
    lead: leadCtx,
  });
  let replyText = bot.text;

  // "YES" / "NO" only mean admission right after we asked — otherwise
  // they are just words in a sentence and the normal matcher handles them.
  const answer = /^(yes|y|haan|haa|ha|ok|okay|sure)\b/i.test(text)
    ? "yes"
    : /^(no|nahi|nahin|not now|later)\b/i.test(text)
      ? "no"
      : null;
  // Set once the admission offer (or its answer) has composed the reply,
  // so the generic menu lines below don't overwrite it.
  let handledAdmissionOffer = false;
  if (answer && awaitingAdmission && leadCtx && intent === "unknown") {
    replyText =
      answer === "yes"
        ? composeAdmissionRegisterStep(registerUrl, leadCtx.feeAmountLabel)
        : [
            "Understood — we have noted that for now.",
            "",
            "If you change your mind, reply *REGISTER* any time.",
            "Reply *HUMAN* to talk to the admissions office.",
          ].join("\n");
    handledAdmissionOffer = true;
  } else if (isGreeting && awaitingAdmission && leadCtx && !opts.forceEscalate) {
    replyText = composeAdmissionOffer(leadCtx, registerUrl);
    handledAdmissionOffer = true;
  }
  if (
    opts.fromUnified &&
    intent === "unknown" &&
    !opts.forceEscalate &&
    !handledAdmissionOffer
  ) {
    replyText =
      "Reply *FEE* · *REGISTER* · *DOCS* · *STATUS* · *VISIT* · *HUMAN* — or *MENU* for the main school menu.";
  }
  if (isGreeting && leadRow && !opts.fromUnified && !handledAdmissionOffer) {
    replyText = [
      `Namaste${opts.profileName ? ` ${opts.profileName}` : ""} — *${TENANT.nameDisplay} Admissions*.`,
      leadRow.childName
        ? `We have your enquiry for *${leadRow.childName}* (${stageLabel(leadRow.stage)}).`
        : `We have enquiry *${leadRow.enquiryNo}* on file.`,
      "",
      "Reply: FEE · REGISTER · DOCS · STATUS · VISIT · HUMAN",
    ].join("\n");
  }
  if (
    leadCreatedEnquiryNo &&
    intent === "unknown" &&
    !opts.forceEscalate &&
    !isGreeting &&
    !handledAdmissionOffer
  ) {
    replyText = [
      `Thank you for contacting *${TENANT.nameDisplay} Admissions*.`,
      `We created enquiry *${leadCreatedEnquiryNo}* for this WhatsApp number.`,
      "",
      "Reply: FEE · REGISTER · DOCS · STATUS · VISIT · HUMAN",
      `Register online: ${publicRegisterUrl()}`,
    ].join("\n");
  }
  if (leadRow?.guardianName && !thread.parentName) {
    thread = { ...thread, parentName: leadRow.guardianName };
  }
  if (
    intent === "unknown" &&
    !isGreeting &&
    !leadCreatedEnquiryNo &&
    !opts.forceEscalate &&
    !handledAdmissionOffer &&
    text.trim().length > 3
  ) {
    const aiReply = await tryAiFallbackReply(text, leadCtx);
    if (aiReply) replyText = aiReply;
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

  // Push WhatsApp profile name onto matching CRM leads for campaign
  // {{guardianName}}.
  //
  // Used to read via getSchoolMirrorSync().admissions — a stale,
  // multi-MB copy of the whole leads table (see the egress
  // investigation) — and write back via setMirrorSlice(), which only
  // patches the server's in-memory mirror. Admissions writes are already
  // skip-gated from ever reaching school_mirror_state once
  // ADMISSIONS_READ_FROM_DB is on, so that write never actually reached
  // admission_desk_leads: this backfill has likely been a silent no-op
  // for as long as that flag's been set. Talks to the real table
  // directly now, both ways, and only touches the 0-2 leads whose mobile
  // or whatsapp number matches this thread — never the whole table.
  if ((opts.profileName || "").trim()) {
    try {
      const { applyWhatsAppNamesToLeads, defaultAdmissionsState } =
        await import("@/lib/admissions");
      const { findAdmissionLeadCandidatesByMobile, pushAdmissionLeadToDb } =
        await import("@/lib/admissionsNormalized.server");
      const candidates = await findAdmissionLeadCandidatesByMobile(mobile10);
      if (candidates.length > 0) {
        const before = { ...defaultAdmissionsState(), leads: candidates };
        const applied = applyWhatsAppNamesToLeads(
          before,
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
          const changed = applied.state.leads.filter(
            (l, i) => l !== before.leads[i],
          );
          await Promise.all(changed.map((l) => pushAdmissionLeadToDb(l)));
        }
      }
    } catch {
      /* admissions push optional — never block the WA reply */
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

export type WaInboundMediaRef = {
  mediaId: string;
  mediaType: "image" | "document" | "video" | "audio";
  mimeType?: string;
  filename?: string;
};

/** A completed WhatsApp Flow submission (interactive.type "nfm_reply"). */
export type WaInboundFlowResponse = {
  flowToken: string;
  responseJson: string;
};

/** Parse Meta Cloud API webhook payload → inbound texts / locations */
export function parseMetaWebhookInbound(body: unknown): {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  location?: { lat: number; lng: number; name?: string; address?: string };
  mediaNote?: string;
  media?: WaInboundMediaRef;
  flowResponse?: WaInboundFlowResponse;
}[] {
  const out: {
    fromWaId: string;
    text: string;
    waMessageId?: string;
    profileName?: string;
    location?: { lat: number; lng: number; name?: string; address?: string };
    mediaNote?: string;
    media?: WaInboundMediaRef;
    flowResponse?: WaInboundFlowResponse;
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
              nfm_reply?: { response_json?: string; body?: string; name?: string };
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
        let media: WaInboundMediaRef | undefined;
        let location:
          | { lat: number; lng: number; name?: string; address?: string }
          | undefined;
        let flowResponse: WaInboundFlowResponse | undefined;
        if (msg.type === "text") text = msg.text?.body || "";
        else if (msg.type === "button")
          text = msg.button?.payload || msg.button?.text || "";
        else if (msg.type === "interactive") {
          const responseJson = msg.interactive?.nfm_reply?.response_json;
          if (msg.interactive?.type === "nfm_reply" && responseJson) {
            let flowToken = "";
            try {
              const parsed = JSON.parse(responseJson) as { flow_token?: string };
              flowToken = String(parsed.flow_token || "");
            } catch {
              /* leave flowToken empty — caller treats an empty token as unresolvable */
            }
            flowResponse = { flowToken, responseJson };
          } else {
            text =
              msg.interactive?.button_reply?.id ||
              msg.interactive?.button_reply?.title ||
              msg.interactive?.list_reply?.id ||
              msg.interactive?.list_reply?.title ||
              "";
          }
        } else if (msg.type === "image") {
          text = msg.image?.caption || "";
          mediaNote = `image${msg.image?.mime_type ? ` (${msg.image.mime_type})` : ""}`;
          if (msg.image?.id) {
            media = {
              mediaId: msg.image.id,
              mediaType: "image",
              mimeType: msg.image.mime_type,
            };
          }
        } else if (msg.type === "document") {
          text =
            msg.document?.caption ||
            msg.document?.filename ||
            "Document";
          mediaNote = `document:${msg.document?.filename || msg.document?.id || ""}`;
          if (msg.document?.id) {
            media = {
              mediaId: msg.document.id,
              mediaType: "document",
              mimeType: msg.document.mime_type,
              filename: msg.document.filename,
            };
          }
        } else if (msg.type === "video") {
          text = msg.video?.caption || "";
          mediaNote = "video";
          if (msg.video?.id) {
            media = {
              mediaId: msg.video.id,
              mediaType: "video",
              mimeType: msg.video.mime_type,
            };
          }
        } else if (msg.type === "audio") {
          text = "";
          mediaNote = "audio";
          if (msg.audio?.id) {
            media = {
              mediaId: msg.audio.id,
              mediaType: "audio",
              mimeType: msg.audio.mime_type,
            };
          }
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
        if (!text && !mediaNote && !location && !flowResponse) continue;
        out.push({
          fromWaId: msg.from,
          text: text || (mediaNote ? `MEDIA ${mediaNote}` : ""),
          waMessageId: msg.id,
          profileName: name,
          location,
          flowResponse,
          mediaNote,
          media,
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
