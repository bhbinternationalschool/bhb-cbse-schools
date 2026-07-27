/**
 * Server WhatsApp bot for field survey agents — WhatsApp-only day:
 * GPS via location pin + CAPTURE wizard (no Field app required).
 */

import { promises as fs } from "fs";
import path from "path";
import {
  loadAdmissions,
  saveAdmissions,
  type AdmissionsState,
  type SurveyGeoPoint,
  type SurveyTeamMember,
} from "@/lib/admissions";
import {
  activeSessionForMember,
  captureFieldSurveyWithExtras,
  endSurveyBreak,
  endSurveySession,
  ensureSurveyMasters,
  findSurveyMemberForSession,
  sessionWorkedMs,
  startSurveyBreak,
  startSurveySession,
  surveyDayAnalytics,
} from "@/lib/fieldSurvey";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { normalizeMobile } from "@/lib/sis";
import {
  detectSurveyBotIntent,
  parseSurveyStartBeatArg,
  surveyAskLocationText,
  surveyBotWelcomeText,
} from "@/lib/surveyFieldBotEngine";
import { sendWhatsAppText, waNormalizeLocal10 } from "@/lib/waSend";

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

function surveyAppUrl(): string {
  return `${publicOrigin()}/field/survey`;
}

function emptyCaptureDraft(): SurveyCaptureDraft {
  return {
    guardianName: "",
    mobile: "",
    childName: "",
    classSoughtId: "",
    classLabel: "",
  };
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

function formatMs(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  const mins = m % 60;
  if (h <= 0) return `${mins}m`;
  return `${h}h ${mins}m`;
}

function activeBeats(state: AdmissionsState) {
  return ensureSurveyMasters(state).surveyBeats.filter((b) => b.isActive);
}

function resolveBeatId(state: AdmissionsState, arg: string): string | null {
  const beats = activeBeats(state);
  if (!arg) return null;
  const key = arg.trim().toLowerCase();
  const hit =
    beats.find((b) => b.code.toLowerCase() === key) ||
    beats.find((b) => b.name.toLowerCase() === key) ||
    beats.find((b) => b.id === arg);
  return hit?.id || null;
}

function commitAdmissions(next: AdmissionsState) {
  saveAdmissions(next);
}

function geoFromLocation(
  loc?: { lat: number; lng: number } | null,
): SurveyGeoPoint | null {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return null;
  }
  return {
    lat: loc.lat,
    lng: loc.lng,
    accuracyM: 0,
    at: nowIso(),
  };
}

function classMenuText(): string {
  const classes = loadMasters().classes.filter((c) => c.isActive !== false);
  if (classes.length === 0) return "Reply with the class name (free text).";
  const lines = classes
    .slice(0, 25)
    .map((c, i) => `${i + 1}. ${c.name}`);
  return [
    "Reply with class *number* or name:",
    ...lines,
    classes.length > 25 ? `… +${classes.length - 25} more (type name)` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveClassChoice(answer: string): {
  id: string;
  label: string;
} | null {
  const classes = loadMasters().classes.filter((c) => c.isActive !== false);
  const t = answer.trim();
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= classes.length) {
    const c = classes[n - 1]!;
    return { id: c.id, label: c.name };
  }
  const low = t.toLowerCase();
  const hit =
    classes.find((c) => c.name.toLowerCase() === low) ||
    classes.find((c) => c.name.toLowerCase().includes(low));
  return hit ? { id: hit.id, label: hit.name } : null;
}

function beatNameOf(state: AdmissionsState, id: string) {
  return (
    state.surveyBeats.find((b) => b.id === id)?.name ||
    state.surveyBeats.find((b) => b.id === id)?.code ||
    id ||
    "—"
  );
}

type HandleResult = {
  text: string;
  escalate: boolean;
  pending: SurveyPending | null;
};

function applyPunch(
  member: SurveyTeamMember,
  pending: SurveyPending,
  geo: SurveyGeoPoint | null,
  skippedGps: boolean,
): HandleResult {
  const adm = ensureSurveyMasters(loadAdmissions());
  const gpsNote = skippedGps
    ? "⚠ GPS skipped — no coordinates saved."
    : geo
      ? `📍 ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`
      : "⚠ No GPS";

  if (pending.kind === "punch_start") {
    const r = startSurveySession(adm, member.id, pending.beatId, geo);
    if (!r.ok) return { text: r.reason, escalate: false, pending: null };
    commitAdmissions(r.state);
    return {
      escalate: false,
      pending: null,
      text: [
        `*Survey started* · ${beatNameOf(r.state, pending.beatId)}`,
        gpsNote,
        "",
        "Next: *CAPTURE* for households · *BREAK* / *END* when needed.",
        "Reply *STATUS* or *COUNTS* anytime.",
      ].join("\n"),
    };
  }

  const session = activeSessionForMember(adm, member.id);
  if (!session) {
    return {
      escalate: false,
      pending: null,
      text: "No active session. Reply *START CODE* then share location.",
    };
  }

  if (pending.kind === "punch_break") {
    if (session.status === "on_break") {
      const r = endSurveyBreak(adm, session.id, geo);
      if (!r.ok) return { text: r.reason, escalate: false, pending: null };
      commitAdmissions(r.state);
      return {
        escalate: false,
        pending: null,
        text: ["*Break ended* — survey running again.", gpsNote].join("\n"),
      };
    }
    const r = startSurveyBreak(adm, session.id, geo);
    if (!r.ok) return { text: r.reason, escalate: false, pending: null };
    commitAdmissions(r.state);
    return {
      escalate: false,
      pending: null,
      text: [
        "*On break.* Reply *BREAK* again + location when you resume.",
        gpsNote,
      ].join("\n"),
    };
  }

  if (pending.kind === "punch_end") {
    const worked = sessionWorkedMs(session);
    const r = endSurveySession(adm, session.id, geo);
    if (!r.ok) return { text: r.reason, escalate: false, pending: null };
    commitAdmissions(r.state);
    return {
      escalate: false,
      pending: null,
      text: [
        "*Survey day ended.*",
        `Worked: ${formatMs(worked)}`,
        gpsNote,
        "Thank you.",
      ].join("\n"),
    };
  }

  return { text: "Nothing pending.", escalate: false, pending: null };
}

function handleCaptureStep(
  member: SurveyTeamMember,
  pending: Extract<SurveyPending, { kind: "capture" }>,
  text: string,
): HandleResult {
  const step = pending.step;
  const draft = { ...pending.draft };
  const ans = text.trim();

  if (step === "guardian") {
    if (ans.length < 2) {
      return {
        escalate: false,
        pending,
        text: "Enter guardian / parent *full name*.",
      };
    }
    draft.guardianName = ans;
    return {
      escalate: false,
      pending: { kind: "capture", step: "mobile", draft },
      text: "Guardian mobile (10 digits):",
    };
  }

  if (step === "mobile") {
    const m = normalizeMobile(ans);
    if (m.length !== 10) {
      return {
        escalate: false,
        pending,
        text: "Send a valid *10-digit* mobile number.",
      };
    }
    draft.mobile = m;
    return {
      escalate: false,
      pending: { kind: "capture", step: "child", draft },
      text: "Child / student *full name*:",
    };
  }

  if (step === "child") {
    if (ans.length < 2) {
      return {
        escalate: false,
        pending,
        text: "Enter the child's name.",
      };
    }
    draft.childName = ans;
    return {
      escalate: false,
      pending: { kind: "capture", step: "class", draft },
      text: classMenuText(),
    };
  }

  if (step === "class") {
    const cls = resolveClassChoice(ans);
    if (!cls) {
      return {
        escalate: false,
        pending,
        text: "Class not matched.\n" + classMenuText(),
      };
    }
    draft.classSoughtId = cls.id;
    draft.classLabel = cls.label;
    return {
      escalate: false,
      pending: { kind: "capture", step: "confirm", draft },
      text: [
        "*Confirm capture*",
        `Guardian: ${draft.guardianName}`,
        `Mobile: ${draft.mobile}`,
        `Child: ${draft.childName}`,
        `Class: ${draft.classLabel}`,
        "",
        "Reply *YES* to save · *NO* to cancel.",
      ].join("\n"),
    };
  }

  // confirm
  if (/^(no|n|cancel)$/i.test(ans)) {
    return {
      escalate: false,
      pending: null,
      text: "Capture cancelled. Reply *CAPTURE* to start again.",
    };
  }
  if (!/^(yes|y|ok|save)$/i.test(ans)) {
    return {
      escalate: false,
      pending,
      text: "Reply *YES* to save or *NO* to cancel.",
    };
  }

  const adm = ensureSurveyMasters(loadAdmissions());
  const session = activeSessionForMember(adm, member.id);
  const beatId = session?.beatId || "";
  const beat = adm.surveyBeats.find((b) => b.id === beatId);
  const r = captureFieldSurveyWithExtras(
    adm,
    {
      guardianName: draft.guardianName,
      mobile: draft.mobile,
      childName: draft.childName,
      classSoughtId: draft.classSoughtId,
      beatId,
      beatName: beat?.name || beat?.code || "",
      parentConsent: true,
      transportInterest: "undecided",
    },
    member.fullName,
  );
  if (!r.ok) {
    return { escalate: false, pending: null, text: r.reason };
  }
  commitAdmissions(r.state);
  return {
    escalate: false,
    pending: null,
    text: [
      `*Lead saved* · ${r.lead.enquiryNo || r.lead.id}`,
      `${draft.childName} · ${draft.classLabel}`,
      `Guardian ${draft.guardianName} · ${draft.mobile}`,
      "",
      "Reply *CAPTURE* for next household · *COUNTS* for today's total.",
    ].join("\n"),
  };
}

function buildKeywordReply(
  member: SurveyTeamMember,
  intent: ReturnType<typeof detectSurveyBotIntent>,
  rawText: string,
  currentPending: SurveyPending | null,
): HandleResult {
  const adm = ensureSurveyMasters(loadAdmissions());
  const session = activeSessionForMember(adm, member.id);
  const beats = activeBeats(adm);

  if (intent === "cancel") {
    return {
      escalate: false,
      pending: null,
      text: currentPending
        ? "Cancelled. Reply *STATUS* or *START CODE* / *CAPTURE*."
        : "Nothing to cancel.",
    };
  }

  switch (intent) {
    case "link":
      return {
        escalate: false,
        pending: currentPending,
        text: [
          "Optional web Field app (GPS + photos):",
          surveyAppUrl(),
          "",
          "You can complete the full day on WhatsApp with location pins + *CAPTURE*.",
        ].join("\n"),
      };
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
          `Then: *START ${beats[0]!.code || "CODE"}* → share location pin.`,
        ].join("\n"),
      };
    case "status": {
      if (!session) {
        return {
          escalate: false,
          pending: null,
          text: [
            `*${member.fullName}* · not started`,
            "Reply *BEATS* then *START CODE* → send location pin.",
          ].join("\n"),
        };
      }
      return {
        escalate: false,
        pending: null,
        text: [
          `*${member.fullName}* · ${session.status}`,
          `Beat: ${beatNameOf(adm, session.beatId)}`,
          `Started: ${session.startedAt.slice(0, 16).replace("T", " ")}`,
          `Worked: ${formatMs(sessionWorkedMs(session))}`,
          session.startGeo
            ? `Start GPS: ${session.startGeo.lat.toFixed(4)}, ${session.startGeo.lng.toFixed(4)}`
            : "Start GPS: —",
          "",
          session.status === "on_break"
            ? "Reply *BREAK* then share location to resume."
            : "Reply *CAPTURE* · *BREAK* · *END* (each may ask for location).",
        ].join("\n"),
      };
    }
    case "counts": {
      const day = surveyDayAnalytics(adm);
      const mine = day.byAgent.find((a) => a.memberId === member.id);
      const teamTotal = day.byAgent.reduce((s, a) => s + a.captures, 0);
      return {
        escalate: false,
        pending: null,
        text: [
          `*Today* · ${member.fullName}`,
          mine
            ? `Status: ${mine.status} · Captures: *${mine.captures}* · Worked ${formatMs(mine.workedMs)}`
            : "No session yet.",
          `Team captures: *${teamTotal}*`,
        ].join("\n"),
      };
    }
    case "start": {
      if (session) {
        return {
          escalate: false,
          pending: null,
          text: `Already ${session.status} on ${beatNameOf(adm, session.beatId)}.`,
        };
      }
      const beatArg = parseSurveyStartBeatArg(rawText);
      if (!beatArg) {
        return {
          escalate: false,
          pending: null,
          text:
            beats.length === 0
              ? "No active beat."
              : [
                  "Choose a beat:",
                  ...beats.map(
                    (b) => `• *START ${b.code || b.id}* — ${b.name}`,
                  ),
                ].join("\n"),
        };
      }
      const beatId = resolveBeatId(adm, beatArg);
      if (!beatId) {
        return {
          escalate: false,
          pending: null,
          text: `Beat "${beatArg}" not found. Reply *BEATS*.`,
        };
      }
      return {
        escalate: false,
        pending: { kind: "punch_start", beatId },
        text: surveyAskLocationText(`START · ${beatNameOf(adm, beatId)}`),
      };
    }
    case "break": {
      if (!session) {
        return {
          escalate: false,
          pending: null,
          text: "No active survey. *START CODE* first.",
        };
      }
      return {
        escalate: false,
        pending: { kind: "punch_break" },
        text: surveyAskLocationText(
          session.status === "on_break" ? "END BREAK" : "BREAK",
        ),
      };
    }
    case "end": {
      if (!session) {
        return {
          escalate: false,
          pending: null,
          text: "No active survey to end.",
        };
      }
      return {
        escalate: false,
        pending: { kind: "punch_end" },
        text: surveyAskLocationText("END SURVEY"),
      };
    }
    case "capture": {
      if (!session) {
        return {
          escalate: false,
          pending: null,
          text: "Start survey first (*START CODE* + location), then *CAPTURE*.",
        };
      }
      return {
        escalate: false,
        pending: {
          kind: "capture",
          step: "guardian",
          draft: emptyCaptureDraft(),
        },
        text: [
          "*New household capture*",
          `Beat: ${beatNameOf(adm, session.beatId)}`,
          "",
          "Guardian / parent *full name*:",
          "(Reply *CANCEL* anytime)",
        ].join("\n"),
      };
    }
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

export async function handleWaSurveyBotInbound(opts: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
  location?: { lat: number; lng: number; name?: string; address?: string };
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

  // Location pin resolves pending GPS punch
  if (opts.location && punchPending) {
    result = applyPunch(
      member,
      punchPending,
      geoFromLocation(opts.location),
      false,
    );
  } else if (/^SKIPGPS$/i.test(text) && punchPending) {
    result = applyPunch(member, punchPending, null, true);
  } else if (punchPending) {
    const intentPeek = detectSurveyBotIntent(text);
    if (
      intentPeek === "cancel" ||
      intentPeek === "human" ||
      intentPeek === "status" ||
      intentPeek === "counts" ||
      intentPeek === "beats" ||
      intentPeek === "link"
    ) {
      result = buildKeywordReply(member, intentPeek, text, punchPending);
    } else {
      const label =
        punchPending.kind === "punch_start"
          ? "START"
          : punchPending.kind === "punch_break"
            ? "BREAK"
            : "END";
      result = {
        escalate: false,
        pending: punchPending,
        text: surveyAskLocationText(label),
      };
    }
  } else if (thread.pending?.kind === "capture" && text) {
    const intentPeek = detectSurveyBotIntent(text);
    if (intentPeek === "cancel" || intentPeek === "human") {
      result = buildKeywordReply(member, intentPeek, text, thread.pending);
    } else {
      result = handleCaptureStep(member, thread.pending, text);
    }
  } else if (opts.location && !thread.pending) {
    result = {
      escalate: false,
      pending: null,
      text: [
        "Location received, but nothing is waiting for GPS.",
        "Use *START CODE*, *BREAK*, or *END* first — then share location.",
      ].join("\n"),
    };
  } else {
    const isGreeting =
      !text || /^(hi|hello|namaste|hey|menu)$/i.test(text);
    const intent = isGreeting
      ? ("unknown" as const)
      : detectSurveyBotIntent(text);
    result = buildKeywordReply(member, intent, text, thread.pending);
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
