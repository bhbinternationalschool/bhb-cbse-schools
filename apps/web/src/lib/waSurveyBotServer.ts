/**
 * Server WhatsApp bot for field survey agents. Since 5 Oct 2026 the day
 * itself (start / break / end / families) runs on /survey-day, signed by the
 * surveyor's registered phone with live GPS; this bot answers questions,
 * lists beats and hands out that link.
 */

import { promises as fs } from "fs";
import path from "path";
import {
  loadAdmissions,
  type AdmissionsState,
  type SurveyTeamMember,
} from "@/lib/admissions";
import {
  ensureSurveyMasters,
  findSurveyMemberForSession,
} from "@/lib/fieldSurvey";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { TENANT } from "@/lib/types";
import {
  detectSurveyBotIntent,
  surveyBotWelcomeText,
} from "@/lib/surveyFieldBotEngine";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";
import { generateTutorText } from "@/lib/aiLlm.server";

export type WaSurveyBotMsg = {
  id: string;
  role: "parent" | "bot" | "staff";
  text: string;
  at: string;
  by: string;
  waMessageId?: string;
};

export type SurveyCaptureDraft = {
  guardianName: string;
  mobile: string;
  childName: string;
  classSoughtId: string;
  classLabel: string;
};

export type SurveyPending =
  | { kind: "punch_start"; beatId: string }
  | { kind: "punch_break" }
  | { kind: "punch_end" }
  | {
      kind: "capture";
      step: "guardian" | "mobile" | "child" | "class" | "confirm";
      draft: SurveyCaptureDraft;
    };

export type WaSurveyBotThread = {
  id: string;
  channel: "whatsapp";
  audience: "survey_agent";
  mobile: string;
  agentName: string;
  memberId: string;
  status: "bot" | "needs_staff" | "open" | "closed";
  pending: SurveyPending | null;
  messages: WaSurveyBotMsg[];
  createdAt: string;
  updatedAt: string;
  unreadStaff: number;
};

type Store = { version: 1; threads: WaSurveyBotThread[] };

const DATA_FILE = path.join(
  process.cwd(),
  ".data",
  "wa_survey_bot_threads.json",
);
let memory: Store = { version: 1, threads: [] };

function nid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() {
  return new Date().toISOString();
}

function publicOrigin(): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://bhbinternational.school";
  return env.replace(/\/$/, "");
}



async function readStore(): Promise<Store> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<Store>("survey", memory);
  if (remote?.version === 1 && Array.isArray(remote.threads)) {
    memory = {
      version: 1,
      threads: remote.threads.map((t) => ({
        ...t,
        pending: t.pending ?? null,
      })),
    };
    return memory;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.version === 1 && Array.isArray(parsed.threads)) {
      memory = {
        version: 1,
        threads: parsed.threads.map((t) => ({
          ...t,
          pending: t.pending ?? null,
        })),
      };
      return memory;
    }
  } catch {
    /* */
  }
  return memory;
}

async function writeStore(store: Store) {
  memory = store;
  const { saveWaBotSlice } = await import("@/lib/waBotStore.server");
  await saveWaBotSlice("survey", store);
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* */
  }
}

export function findSurveyAgentByWaMobile(
  mobile10: string,
): SurveyTeamMember | null {
  return findSurveyMemberForSession(loadAdmissions(), { mobile: mobile10 });
}

export function isSurveyAgentMobile(fromWaId: string): boolean {
  return !!findSurveyAgentByWaMobile(waNormalizeLocal10(fromWaId));
}


function activeBeats(state: AdmissionsState) {
  return ensureSurveyMasters(state).surveyBeats.filter((b) => b.isActive);
}







type HandleResult = {
  text: string;
  escalate: boolean;
  pending: SurveyPending | null;
};



/**
 * LLM fallback for field-agent messages the keyword matcher doesn't
 * recognize — only reachable when the agent has no active START/CAPTURE
 * flow pending (mid-flow, structured input is required and this is never
 * called). Points to the existing commands only; never invents survey data,
 * beat assignments, or schedule details it wasn't given. Returns null on
 * any failure — caller keeps the existing welcome text.
 */
async function tryFieldAgentAiFallback(
  text: string,
  agentName: string,
): Promise<string | null> {
  const system = `You are a WhatsApp assistant for a school's field survey agent (door-to-door admissions outreach) at ${TENANT.nameDisplay}.
You may ONLY point the agent to: the survey page (reply LINK) where they Start, Break, End and record families with live location; BEATS (list active beats); HUMAN.
You do NOT know beat assignments, schedules, or survey data — never guess at them.
Keep the reply under 300 characters, plain text (no markdown headers).`;

  const userMessage = `Field agent: ${agentName}
Message: "${text}"`;

  try {
    const r = await generateTutorText({ system, userMessage });
    if (!r.ok) return null;
    return r.text.trim() || null;
  } catch {
    return null;
  }
}

function buildKeywordReply(
  member: SurveyTeamMember,
  intent: ReturnType<typeof detectSurveyBotIntent>,
  rawText: string,
  currentPending: SurveyPending | null,
): HandleResult {
  const adm = ensureSurveyMasters(loadAdmissions());
  const beats = activeBeats(adm);

  if (intent === "cancel") {
    return {
      escalate: false,
      pending: null,
      text: currentPending
        ? "Cancelled. Reply *LINK* for your survey page."
        : "Nothing to cancel.",
    };
  }

  if (
    intent === "start" ||
    intent === "break" ||
    intent === "end" ||
    intent === "capture" ||
    intent === "link" ||
    intent === "status" ||
    intent === "counts"
  ) {
    return { escalate: false, pending: null, text: surveyDayLinkText() };
  }

  switch (intent) {
    case "beats":
      if (beats.length === 0) {
        return {
          escalate: false,
          pending: null,
          text: "No active beats. Ask office to activate one.",
        };
      }
      return {
        escalate: false,
        pending: null,
        text: [
          "*Active beats*",
          ...beats.map(
            (b, i) =>
              `${i + 1}. *${b.code || b.id}* — ${b.name}${b.area ? ` · ${b.area}` : ""}`,
          ),
          "",
          "Choose your beat when you press Start on your survey page (reply *LINK*).",
        ].join("\n"),
      };
    case "human":
      return {
        escalate: true,
        pending: null,
        text: [
          "Connecting you to *survey office*.",
          "Share: name, beat, and issue.",
        ].join("\n"),
      };
    default:
      return {
        escalate: false,
        pending: currentPending,
        text: surveyBotWelcomeText(member.fullName),
      };
  }
}

export async function listWaSurveyBotThreads(): Promise<WaSurveyBotThread[]> {
  const store = await readStore();
  return [...store.threads].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function staffReplyWaSurveyBot(opts: {
  threadId: string;
  text: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = opts.text.trim();
  if (!body) return { ok: false, reason: "Empty reply" };
  let store = await readStore();
  const thread = store.threads.find((t) => t.id === opts.threadId);
  if (!thread) return { ok: false, reason: "Thread not found" };
  const send = await sendWhatsAppText({ toMobile: thread.mobile, body });
  if (!send.ok && send.mode !== "stub") {
    return { ok: false, reason: send.error || "Send failed" };
  }
  const msg: WaSurveyBotMsg = {
    id: nid("wvm"),
    role: "staff",
    text: body,
    at: nowIso(),
    by: opts.by || "Survey office",
    waMessageId: send.providerId,
  };
  const next: WaSurveyBotThread = {
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

function findOrCreate(
  store: Store,
  mobile10: string,
  member: SurveyTeamMember,
): { store: Store; thread: WaSurveyBotThread } {
  const open = store.threads.find(
    (t) => t.mobile === mobile10 && t.status !== "closed",
  );
  if (open) {
    return {
      store,
      thread: {
        ...open,
        memberId: member.id,
        agentName: open.agentName || member.fullName,
        pending: open.pending ?? null,
      },
    };
  }
  const thread: WaSurveyBotThread = {
    id: nid("wvt"),
    channel: "whatsapp",
    audience: "survey_agent",
    mobile: mobile10,
    agentName: member.fullName,
    memberId: member.id,
    status: "bot",
    pending: null,
    messages: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    unreadStaff: 0,
  };
  return {
    thread,
    store: { ...store, threads: [thread, ...store.threads] },
  };
}

/**
 * Survey day steps and captures no longer run on WhatsApp (director,
 * 5 Oct 2026): a location pin can be sent from anywhere and a WhatsApp
 * number is not a phone. They run on /survey-day — signed by the
 * surveyor's registered phone, with live GPS at every step.
 */
function surveyDayLinkText(): string {
  return [
    "*Survey day has moved to your phone's browser*",
    "",
    `Open: ${publicOrigin()}/survey-day`,
    "",
    "Start, Break, End and every family you record are saved there with your live location.",
    "First time? Ask the office for your 6-digit phone code.",
  ].join("\n");
}

export async function handleWaSurveyBotInbound(opts: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  location?: { lat: number; lng: number; name?: string; address?: string };
  fromUnified?: boolean;
}): Promise<{
  matched: boolean;
  replied: boolean;
  escalate: boolean;
  replyText: string;
  stub: boolean;
  error?: string;
}> {
  await ensureSchoolMirrorHydrated();
  const mobile10 = waNormalizeLocal10(opts.fromWaId);
  const member = findSurveyAgentByWaMobile(mobile10);
  if (!member) {
    return {
      matched: false,
      replied: false,
      escalate: false,
      replyText: "",
      stub: false,
    };
  }

  const text = (opts.text || "").trim();
  let store = await readStore();
  const opened = findOrCreate(store, mobile10, member);
  store = opened.store;
  let thread = opened.thread;

  const displayText = opts.location
    ? `📍 Location ${opts.location.lat.toFixed(5)}, ${opts.location.lng.toFixed(5)}${
        opts.location.name ? ` · ${opts.location.name}` : ""
      }`
    : text || "(open)";

  const parentMsg: WaSurveyBotMsg = {
    id: nid("wvm"),
    role: "parent",
    text: displayText,
    at: nowIso(),
    by: member.fullName || opts.profileName || "Agent",
    waMessageId: opts.waMessageId,
  };

  let result: HandleResult;
  const punchPending =
    thread.pending?.kind === "punch_start" ||
    thread.pending?.kind === "punch_break" ||
    thread.pending?.kind === "punch_end"
      ? thread.pending
      : null;

  // Day steps and captures run on /survey-day now (signed + live GPS). A
  // thread still waiting for a pin or a capture answer from before is
  // closed with the link instead of being completed here.
  if (punchPending || thread.pending?.kind === "capture") {
    result = { escalate: false, pending: null, text: surveyDayLinkText() };
  } else if (opts.location && !thread.pending) {
    result = {
      escalate: false,
      pending: null,
      text: [
        "Location received, but nothing is waiting for GPS.",
        "Survey steps are on your survey page now — reply *LINK*.",
      ].join("\n"),
    };
  } else {
    const isGreeting =
      !text || /^(hi|hello|namaste|hey|menu)$/i.test(text);
    const intent = isGreeting
      ? ("unknown" as const)
      : detectSurveyBotIntent(text);
    result = buildKeywordReply(member, intent, text, thread.pending);
    if (intent === "unknown" && !isGreeting && text.trim().length > 3) {
      const aiReply = await tryFieldAgentAiFallback(text, member.fullName);
      if (aiReply) result = { ...result, text: aiReply };
    }
  }

  const botMsg: WaSurveyBotMsg = {
    id: nid("wvm"),
    role: "bot",
    text: result.text,
    at: nowIso(),
    by: "Survey WA bot",
  };

  thread = {
    ...thread,
    pending: result.pending,
    status: result.escalate
      ? "needs_staff"
      : thread.status === "closed"
        ? "bot"
        : thread.status || "bot",
    unreadStaff: result.escalate ? thread.unreadStaff + 1 : thread.unreadStaff,
    messages: [...thread.messages, parentMsg, botMsg],
    updatedAt: nowIso(),
  };
  store = {
    ...store,
    threads: store.threads.map((t) => (t.id === thread.id ? thread : t)),
  };
  await writeStore(store);

  const send = await sendWhatsAppText({
    toMobile: mobile10,
    body: result.text,
    clientMessageId: botMsg.id,
  });

  return {
    matched: true,
    replied: send.ok || send.mode === "stub",
    escalate: result.escalate,
    replyText: result.text,
    stub: !send.ok,
    error: send.ok ? undefined : send.error,
  };
}
