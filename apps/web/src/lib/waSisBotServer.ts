/**
 * Server WhatsApp bot for SIS parents (enrolled households).
 */

import { promises as fs } from "fs";
import path from "path";
import {
  buildSchoolUpiPayUri,
  resolveSchoolCollectionsUpi,
} from "@/lib/admissions";
import {
  composeWhatsAppFeeReceipt,
  computeHouseholdDues,
  formatInr,
  loadFees,
  markWhatsAppReceiptSent,
  openFeeDues,
  type FeeDueLine,
} from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import {
  buildPaymentSharePayload,
  buildPaymentShareUrlAbsolute,
  createPaymentLink,
} from "@/lib/payments";
import {
  classLabelForStudent,
  householdReceipts,
} from "@/lib/parentPortal";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  composeSisDuesReply,
  composeSisHumanReply,
  composeSisInfoReply,
  composeSisKidsReply,
  composeSisPayReply,
  composeSisReceiptsReply,
  detectSisBotIntent,
  parseSisPaySelection,
  sisBotWelcomeText,
  type SisBotChildLine,
  type SisBotDueLine,
} from "@/lib/sisParentBotEngine";
import { attachRazorpayToPaymentLink } from "@/lib/razorpay.server";
import { loadSis, householdWhatsApp, type Household, type SisStudent } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  sendWaFlowMessage,
  sendWaWithFailover,
  sendWhatsAppText,
  waNormalizeLocal10,
} from "@/lib/waSend";
import { generateParentBotReplyJson } from "@/lib/aiLlm.server";
import {
  householdLanguage,
  languageChoiceConfirmation,
  languageLabel,
  languageMenuText,
  LANGUAGE_MENU_KEYWORDS,
  parseLanguageChoice,
  sarvamTargetFor,
} from "@/lib/householdPrefs";
import { patchMirrorHousehold } from "@/lib/parentHousehold.server";
import { sarvamConfigured, sarvamTranslate, type SarvamLang } from "@/lib/sarvam.server";
import { formatKbContext, retrieveRelevantKb } from "@/lib/schoolKb.server";
import {
  buildComplaintFlowJson,
  buildComplaintFlowToken,
  COMPLAINT_FLOW_NAME,
  COMPLAINT_FLOW_SCREEN_ID,
} from "@/lib/waComplaintsFlow";
import { ensureMetaFlowPublished } from "@/lib/waFlowsMeta.server";

export type WaSisBotMsg = {
  id: string;
  role: "parent" | "bot" | "staff";
  text: string;
  at: string;
  by: string;
  waMessageId?: string;
};

export type WaSisBotThread = {
  id: string;
  channel: "whatsapp";
  audience: "sis_parent";
  mobile: string;
  parentName: string;
  householdId: string;
  status: "bot" | "needs_staff" | "open" | "closed";
  messages: WaSisBotMsg[];
  createdAt: string;
  updatedAt: string;
  unreadStaff: number;
};

type Store = { version: 1; threads: WaSisBotThread[] };

const DATA_FILE = path.join(process.cwd(), ".data", "wa_sis_bot_threads.json");
let memory: Store = { version: 1, threads: [] };

function nid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() {
  return new Date().toISOString();
}

export function publicAppOrigin(): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://bhbinternational.school";
  return env.replace(/\/$/, "");
}

async function readStore(): Promise<Store> {
  const { loadWaBotSlice } = await import("@/lib/waBotStore.server");
  const remote = await loadWaBotSlice<Store>("sis", memory);
  if (remote?.version === 1 && Array.isArray(remote.threads)) {
    memory = remote;
    return remote;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.version === 1 && Array.isArray(parsed.threads)) {
      memory = parsed;
      return parsed;
    }
  } catch {
    /* */
  }
  return memory;
}

async function writeStore(store: Store) {
  memory = store;
  const { saveWaBotSlice } = await import("@/lib/waBotStore.server");
  await saveWaBotSlice("sis", store);
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* */
  }
}

export function findHouseholdByWaMobile(mobile10: string): Household | null {
  const sis = loadSis();
  const m = mobile10.replace(/\D/g, "").slice(-10);
  if (m.length !== 10) return null;
  const byHh = sis.households.find(
    (h) =>
      h.whatsappMobile === m || h.mobile === m || h.altMobile === m,
  );
  if (byHh) return byHh;
  const st = sis.students.find(
    (s) => s.fatherMobile === m || s.motherMobile === m,
  );
  if (!st?.householdId) return null;
  return sis.households.find((h) => h.id === st.householdId) || null;
}

export function isSisRegisteredMobile(fromWaId: string): boolean {
  return !!findHouseholdByWaMobile(waNormalizeLocal10(fromWaId));
}

function childrenOf(hh: Household): SisStudent[] {
  return loadSis().students.filter(
    (s) => s.householdId === hh.id && s.status === "active",
  );
}

function flattenOpenDues(
  hhId: string,
  studentId?: string,
): FeeDueLine[] {
  const rows = computeHouseholdDues(
    hhId,
    loadSis(),
    loadMasters(),
    loadFees(),
    { includeFuture: false },
  );
  let dues = openFeeDues(rows.flatMap((r) => r.dues)).filter(
    (d) => d.balancePaise > 0,
  );
  if (studentId) {
    dues = dues.filter((d) => d.studentId === studentId);
  }
  return dues;
}

function dueStudentName(due: FeeDueLine): string {
  const st = loadSis().students.find((s) => s.id === due.studentId);
  return st?.fullName || due.label;
}

/**
 * LLM fallback for parent messages the keyword matcher doesn't recognize —
 * grounded ONLY in this household's own real data (children, open dues), so
 * it can answer "has X's fee been paid" style free text without guessing a
 * fact it wasn't given. Returns null (caller keeps the existing hardcoded
 * fallback) on any failure — this is a graceful upgrade, never a hard
 * dependency for the bot to keep working.
 */
const UNGROUNDED_REPLY =
  "I don't have that information here. Reply *HUMAN* and the school office will get back to you.";

async function tryAiFallbackReply(
  hh: Household,
  text: string,
): Promise<{ text: string; grounded: boolean } | null> {
  const masters = loadMasters();
  const kids = childrenOf(hh);
  const dues = flattenOpenDues(hh.id);
  const totalDuePaise = dues.reduce((s, d) => s + d.balancePaise, 0);
  const kidsLine =
    kids
      .map(
        (s) =>
          `${s.fullName} (${classLabelForStudent(s, masters)}, ${s.status})`,
      )
      .join("; ") || "none on record";
  const duesLine = dues.length
    ? dues
        .map(
          (d) =>
            `${dueStudentName(d)}: ${d.label} ${formatInr(d.balancePaise)} due ${d.dueOn}`,
        )
        .join("; ")
    : "no open dues";

  const kbMatches = await retrieveRelevantKb(text, { audiences: ["all", "parents"] });
  const kbContext = formatKbContext(kbMatches);

  // Family's language (Students → Family). Unset → mirror the parent's own
  // language; regional → draft in Hindi and render through Sarvam below.
  const pref = householdLanguage(hh, "en");
  const sarvamTarget = sarvamTargetFor(hh);
  const langRule =
    pref.source === "default"
      ? "Reply in the language the parent wrote in — Hindi (Devanagari) if they wrote in Hindi or Hinglish, otherwise simple English."
      : pref.language === "en"
        ? "Reply in simple English."
        : `Reply in Hindi (Devanagari), formal register (आप).${sarvamTarget ? ` (The family's language is ${languageLabel(pref.language)}; the reply will be translated from Hindi.)` : ""}`;

  const system = `You are a WhatsApp assistant for parents of ${TENANT.nameDisplay}.
${langRule}
You may discuss ONLY: (1) the household data given below (their children, dues), and (2) the school notices given below, if any are given — you do NOT know this school's policies, dates, timings, curriculum, transport, uniform, or any other fact beyond what's given here, even if it seems like common knowledge for a school. Do not state or confirm anything outside the data given.
For ANY question neither the household data nor the notices below answer, reply that you don't have that information and to reply *HUMAN* to talk to the school office — do not attempt to answer it a different way.
Keep the reply under 300 characters, warm and simple, plain text (no markdown headers).`;

  const userMessage = `Guardian: ${hh.guardianName || "Parent"}
Children: ${kidsLine}
Open dues: total ${formatInr(totalDuePaise)} — ${duesLine}
${kbContext ? `Relevant school notices:\n${kbContext}\n` : ""}Parent's message: "${text}"`;

  try {
    const r = await generateParentBotReplyJson({ system, userMessage });
    if (!r.ok) return null;
    // Hard gate: an ungrounded answer never reaches the parent verbatim.
    if (!r.grounded) return { text: UNGROUNDED_REPLY, grounded: false };
    const reply = r.reply.trim();
    if (!reply) return null;
    // Regional preference: render the Hindi draft in the family's language
    // when Sarvam can; otherwise the Hindi text goes as-is.
    if (sarvamTarget && sarvamConfigured()) {
      const t = await sarvamTranslate({ text: reply, from: "hi-IN", to: sarvamTarget as SarvamLang, mode: "modern-colloquial" });
      if (t.ok && t.text.trim()) return { text: t.text.trim(), grounded: true };
    }
    return { text: reply, grounded: true };
  } catch {
    return null;
  }
}

/** Record parent + bot turns for the language flow, send the bot text, and return. */
async function finishLanguageFlow(
  store: Store,
  thread: WaSisBotThread,
  parentMsg: WaSisBotMsg,
  replyText: string,
): Promise<{ matched: boolean; replied: boolean; escalate: boolean; replyText: string; stub: boolean; error?: string }> {
  const botMsg: WaSisBotMsg = { id: nid("wsm"), role: "bot", text: replyText, at: nowIso(), by: "SIS parent WA bot" };
  const next: WaSisBotThread = {
    ...thread,
    messages: [...thread.messages, parentMsg, botMsg],
    updatedAt: nowIso(),
  };
  await writeStore({ ...store, threads: store.threads.map((t) => (t.id === next.id ? next : t)) });
  const send = await sendWhatsAppText({ toMobile: next.mobile, body: replyText, clientMessageId: botMsg.id });
  return {
    matched: true,
    replied: send.ok || send.mode === "stub",
    escalate: false,
    replyText,
    stub: !send.ok,
    error: send.ok ? undefined : send.error,
  };
}

export async function listWaSisBotThreads(): Promise<WaSisBotThread[]> {
  const store = await readStore();
  return [...store.threads].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function staffReplyWaSisBot(opts: {
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
  const msg: WaSisBotMsg = {
    id: nid("wsm"),
    role: "staff",
    text: body,
    at: nowIso(),
    by: opts.by || "School office",
    waMessageId: send.providerId,
  };
  const next: WaSisBotThread = {
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
  hh: Household,
  profileName?: string,
): { store: Store; thread: WaSisBotThread } {
  const open = store.threads.find(
    (t) => t.mobile === mobile10 && t.status !== "closed",
  );
  if (open) {
    return {
      store,
      thread: {
        ...open,
        householdId: hh.id,
        parentName: open.parentName || hh.guardianName || profileName || "",
      },
    };
  }
  const thread: WaSisBotThread = {
    id: nid("wst"),
    channel: "whatsapp",
    audience: "sis_parent",
    mobile: mobile10,
    parentName: hh.guardianName || profileName || "",
    householdId: hh.id,
    status: "bot",
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

async function buildPayLinkReply(
  hh: Household,
  kids: SisStudent[],
  dues: FeeDueLine[],
  payLabel: { studentName: string; classLabel: string; studentId: string },
): Promise<{ text: string; escalate: boolean }> {
  if (dues.length === 0) {
    return {
      escalate: false,
      text: "No open dues till the current running month. Reply *DUES* to refresh.",
    };
  }

  const masters = loadMasters();
  const created = createPaymentLink({
    householdId: hh.id,
    studentId: payLabel.studentId,
    studentName: payLabel.studentName,
    classLabel: payLabel.classLabel,
    dues,
    createdBy: "SIS WhatsApp bot",
    note: "Created via parent WhatsApp PAY",
    expiresInDays: 7,
  });
  if (!created.ok) {
    return { escalate: false, text: created.error };
  }

  let link = created.link;
  let payUrl: string;
  let autoSettle = false;
  const mobile10 =
    householdWhatsApp(hh) || hh.mobile || hh.whatsappMobile || "";

  const rz = await attachRazorpayToPaymentLink({
    link,
    customerName: hh.guardianName || payLabel.studentName,
    customerMobile: mobile10,
    appOrigin: publicAppOrigin(),
  });
  if (rz.ok) {
    link = rz.link;
    payUrl = rz.checkoutUrl;
    autoSettle = true;
  } else {
    const upi = resolveSchoolCollectionsUpi(masters);
    const upiUri = buildSchoolUpiPayUri({
      vpa: upi.vpa,
      payeeName: upi.payeeName,
      amountPaise: link.amountPaise,
      note: `Fees ${link.code}`,
    });
    const payload = buildPaymentSharePayload(
      link,
      TENANT.nameDisplay,
      upi.vpa,
      upiUri,
    );
    payUrl = buildPaymentShareUrlAbsolute(publicAppOrigin(), payload);
  }

  const upi = resolveSchoolCollectionsUpi(masters);
  const upiUri = buildSchoolUpiPayUri({
    vpa: upi.vpa,
    payeeName: upi.payeeName,
    amountPaise: link.amountPaise,
    note: `Fees ${link.code}`,
  });

  return {
    escalate: false,
    text: composeSisPayReply({
      amountPaise: link.amountPaise,
      payUrl,
      upiUri: autoSettle ? undefined : upiUri,
      code: link.code,
      studentHint: `${payLabel.studentName}${payLabel.classLabel ? ` (${payLabel.classLabel})` : ""}`,
      autoSettle,
    }),
  };
}

async function buildBotReply(
  hh: Household,
  intent: ReturnType<typeof detectSisBotIntent>,
  rawText: string,
): Promise<{ text: string; escalate: boolean }> {
  const masters = loadMasters();
  const kids = childrenOf(hh);
  const childLines: SisBotChildLine[] = kids.map((s) => ({
    name: s.fullName,
    classLabel: classLabelForStudent(s, masters),
    admissionNo: s.admissionNo || "",
    status: s.status,
  }));

  switch (intent) {
    case "kids":
      return { escalate: false, text: composeSisKidsReply(childLines) };
    case "dues": {
      const dues = flattenOpenDues(hh.id);
      const dueLines: SisBotDueLine[] = dues.map((d) => ({
        studentName: dueStudentName(d),
        label: d.label,
        amountLabel: formatInr(d.balancePaise),
        dueOn: d.dueOn,
      }));
      const total = dues.reduce((s, d) => s + d.balancePaise, 0);
      return {
        escalate: false,
        text: composeSisDuesReply({
          guardianName: hh.guardianName,
          dueLines,
          totalPaise: total,
          runningMonthOnly: true,
        }),
      };
    }
    case "pay": {
      const payRefs = kids.map((s) => ({ id: s.id, name: s.fullName }));
      const selection =
        kids.length <= 1
          ? ({ scope: "all" } as const)
          : parseSisPaySelection(rawText, payRefs);
      if (selection.scope === "invalid") {
        return { escalate: false, text: selection.message };
      }

      const studentId =
        selection.scope === "child" ? selection.studentId : undefined;
      const dues = flattenOpenDues(hh.id, studentId);
      if (dues.length === 0) {
        const who =
          selection.scope === "child"
            ? ` for *${selection.studentName}*`
            : "";
        return {
          escalate: false,
          text: `No open dues${who} till the current running month. Reply *DUES* to refresh.`,
        };
      }

      let payLabel: {
        studentName: string;
        classLabel: string;
        studentId: string;
      };
      if (selection.scope === "child") {
        const st = kids.find((k) => k.id === selection.studentId)!;
        payLabel = {
          studentId: st.id,
          studentName: st.fullName,
          classLabel: classLabelForStudent(st, masters),
        };
      } else if (kids.length > 1) {
        payLabel = {
          studentId: kids[0]!.id,
          studentName: `${hh.guardianName || "Family"} (${kids.length} children)`,
          classLabel: "Household",
        };
      } else {
        const primary = kids[0]!;
        payLabel = {
          studentId: primary.id,
          studentName: primary.fullName,
          classLabel: classLabelForStudent(primary, masters),
        };
      }

      return buildPayLinkReply(hh, kids, dues, payLabel);
    }
    case "receipts": {
      const rows = householdReceipts(hh.id).map((v) => ({
        receiptNo: v.receiptNo,
        date: v.collectionDate,
        amountLabel: formatInr(v.totalPaise),
      }));
      return { escalate: false, text: composeSisReceiptsReply(rows) };
    }
    case "info":
      return { escalate: false, text: composeSisInfoReply() };
    case "human":
      return { escalate: true, text: composeSisHumanReply() };
    case "complaint":
      return { escalate: false, text: "Opening the complaint form…" };
    default:
      return {
        escalate: false,
        text: sisBotWelcomeText(kids.length > 1),
      };
  }
}

export async function handleWaSisBotInbound(opts: {
  fromWaId: string;
  text: string;
  waMessageId?: string;
  profileName?: string;
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
  const hh = findHouseholdByWaMobile(mobile10);
  if (!hh) {
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
  const opened = findOrCreate(store, mobile10, hh, opts.profileName);
  store = opened.store;
  let thread = opened.thread;

  const parentMsg: WaSisBotMsg = {
    id: nid("wsm"),
    role: "parent",
    text: text || "(open)",
    at: nowIso(),
    by: thread.parentName || "Parent",
    waMessageId: opts.waMessageId,
  };

  const isGreeting =
    !opts.fromUnified &&
    (!text || /^(hi|hello|namaste|hey|start|menu)$/i.test(text));

  // ── Language preference flow: "LANG" → numbered menu; a number / name
  // right after the menu (last bot message) → save on the household. ──
  const upper = text.toUpperCase();
  const askedForMenu = LANGUAGE_MENU_KEYWORDS.some((k) => upper === k || upper.startsWith(`${k} `));
  const lastBot = [...thread.messages].reverse().find((m) => m.role === "bot");
  const awaitingChoice = !!lastBot && lastBot.text.startsWith("Which language should the school message you in?");
  const inlineChoice = askedForMenu ? parseLanguageChoice(text.replace(/^\S+\s*/, "")) : null;
  const choice = inlineChoice ?? (awaitingChoice ? parseLanguageChoice(text) : null);
  if (askedForMenu && !choice) {
    return finishLanguageFlow(store, thread, parentMsg, languageMenuText());
  }
  if (choice) {
    const updated: Household = { ...hh, preferredLanguage: choice };
    const kids = childrenOf(hh);
    try {
      const { pushSisToDb } = await import("@/lib/sisNormalized.server");
      const r = await pushSisToDb({ households: [updated], students: [] });
      if (!r.ok) console.warn("[wa-sis-bot] language pref push failed", r.error);
      patchMirrorHousehold(updated, kids);
    } catch (e) {
      console.warn("[wa-sis-bot] language pref save failed", e);
    }
    return finishLanguageFlow(store, thread, parentMsg, languageChoiceConfirmation(choice));
  }

  const intent = isGreeting ? ("unknown" as const) : detectSisBotIntent(text);
  const bot = await buildBotReply(hh, intent, text);
  let replyText = bot.text;
  if (opts.fromUnified && intent === "unknown") {
    replyText =
      "Reply *KIDS* · *DUES* · *PAY* (GPay/UPI) · *PAY 1* · *RECEIPTS* · *HUMAN* — or *MENU* for the main school menu.";
  }
  let escalateUngrounded = false;
  if (intent === "unknown" && !isGreeting && text.trim().length > 3) {
    const aiReply = await tryAiFallbackReply(hh, text);
    if (aiReply) {
      replyText = aiReply.text;
      // Not answerable from what we know → the office should see it.
      escalateUngrounded = !aiReply.grounded;
    }
  }

  const botMsg: WaSisBotMsg = {
    id: nid("wsm"),
    role: "bot",
    text: replyText,
    at: nowIso(),
    by: "SIS parent WA bot",
  };

  const escalate = bot.escalate || escalateUngrounded;
  thread = {
    ...thread,
    status: escalate
      ? "needs_staff"
      : thread.status === "closed"
        ? "bot"
        : thread.status || "bot",
    unreadStaff: escalate ? thread.unreadStaff + 1 : thread.unreadStaff,
    messages: [...thread.messages, parentMsg, botMsg],
    updatedAt: nowIso(),
  };
  store = {
    ...store,
    threads: store.threads.map((t) => (t.id === thread.id ? thread : t)),
  };
  await writeStore(store);

  if (intent === "complaint") {
    const ensured = await ensureMetaFlowPublished({
      name: COMPLAINT_FLOW_NAME,
      categories: ["OTHER"],
      flowJson: buildComplaintFlowJson(),
    });
    if (!ensured.ok) {
      const fallback = await sendWhatsAppText({
        toMobile: mobile10,
        body: "Sorry, the complaint form is temporarily unavailable. Reply HUMAN to reach the office directly.",
      });
      return {
        matched: true,
        replied: fallback.ok,
        escalate: false,
        replyText,
        stub: !fallback.ok,
        error: ensured.error,
      };
    }
    const flowSend = await sendWaFlowMessage({
      toMobile: mobile10,
      flowId: ensured.flowId,
      flowToken: buildComplaintFlowToken(hh.id),
      headerText: "Raise a complaint",
      bodyText: "Tell us what happened and the office will follow up.",
      ctaText: "Start",
      screenId: COMPLAINT_FLOW_SCREEN_ID,
    });
    return {
      matched: true,
      replied: flowSend.ok,
      escalate: false,
      replyText,
      stub: !flowSend.ok,
      error: flowSend.ok ? undefined : flowSend.error,
    };
  }

  const send = await sendWhatsAppText({
    toMobile: mobile10,
    body: replyText,
    clientMessageId: botMsg.id,
  });

  return {
    matched: true,
    replied: send.ok || send.mode === "stub",
    escalate,
    replyText,
    stub: !send.ok,
    error: send.ok ? undefined : send.error,
  };
}

/** After pay-link confirm — send receipt on WhatsApp Business API. Retries
 * `fallbackMobile` (e.g. the household's altMobile) if the primary number's
 * send fails synchronously — a parent just paid, the receipt should reach
 * them. */
export async function sendSisFeeReceiptOnWhatsApp(opts: {
  mobile: string;
  fallbackMobile?: string;
  voucherId: string;
}): Promise<{ ok: boolean; error?: string; usedFallback?: boolean }> {
  await ensureSchoolMirrorHydrated();
  const voucher = loadFees().vouchers.find((v) => v.id === opts.voucherId);
  if (!voucher) return { ok: false, error: "Voucher not found" };
  const text = composeWhatsAppFeeReceipt(voucher, loadSis(), loadMasters());
  const send = await sendWaWithFailover({
    primaryMobile: opts.mobile,
    fallbackMobile: opts.fallbackMobile,
    body: text,
  });
  if (send.ok) {
    markWhatsAppReceiptSent(voucher.id);
  }
  return { ok: send.ok, error: send.error, usedFallback: send.usedFallback };
}
