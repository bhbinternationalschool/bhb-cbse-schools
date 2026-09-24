import { parseTeacherWaText, teacherRelayAck } from "@/lib/teacherContact";
import { matchSeedQuickReply, quickReplyAcknowledgement } from "@/lib/waTemplates";
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
  COUNTER_DISCOUNT_CODE,
  waiverFromReceiptLabel,
  composeWhatsAppFeeReceipt,
  computeHouseholdDues,
  formatInr,
  loadFees,
  markWhatsAppReceiptSent,
  openFeeDues,
  type FeeDueLine,
} from "@/lib/fees";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
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
  composeSchoolLocationReply,
  detectSchoolLocationRequest,
  schoolLocationPin,
} from "@/lib/schoolLocationReply";
import {
  isFeeWhyQuestion,
  composeSisDuesReply,
  composeSisHumanReply,
  composeSisInfoReply,
  composeSisKidsReply,
  composeSisPayReply,
  composeSisDirectPayReply,
  composeSisReceiptsReply,
  detectSisBotIntent,
  parseSisPaySelection,
  sisBotWelcomeText,
  type SisBotChildLine,
  type SisBotDueLine,
  detectSisFeeReplyIntent,
  parseSisPromiseToPay,
  composeSisNeedTimeAsk,
  composeSisPromiseRecorded,
  composeSisClaimsPaidReply,
  composeSisPaidStatement,
  promiseSummaryForOffice,
  promiseIsEmpty,
  composeSisPromiseUnclear,
  composeSisAcknowledgement,
  composeSisFeeStructureReply,
  composeSisUngroundedReply,
  composeSisClarifyReply,
  detectSisFeeQuestion,
  isSisAcknowledgement,
  isSisGreeting,
  type SisChildFeeYear,
  type SisFeeHeadLine,
  type SisFeeQuestion,
} from "@/lib/sisParentBotEngine";
import { attachRazorpayToPaymentLink } from "@/lib/razorpay.server";
import {
  attachCashfreeToPaymentLink,
  shouldUseCashfreeCheckout,
} from "@/lib/cashfree.server";
import { loadSis, householdWhatsApp, type Household, type SisStudent, childrenOfHousehold} from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  sendWaFlowMessage,
  sendWaWithFailover,
  sendWhatsAppText,
  sendWhatsAppLocation,
  waNormalizeLocal10,
} from "@/lib/waSend";
import { generateParentBotReplyJson } from "@/lib/aiLlm.server";
import {
  householdLanguage,
  languageChoiceConfirmation,
  languageLabel,
  languageMenuText,
  languageGateDecision,
  LANGUAGE_MENU_KEYWORDS,
  sarvamTargetFor, waTemplateLanguageFor } from "@/lib/householdPrefs";
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
import { SCHOOL_DEFAULT_WA_LANGUAGE } from "@/lib/householdPrefs";
import { duePayUrl } from "@/lib/duePayToken.server";
import { parentChatClosingMessage } from "@/lib/parentBotGuide";
import { alreadyClosed } from "@/lib/parentChatClose";

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
  /**
   * The bot asked a question whose answer the next message is.
   *  - "ptp"     — how much, and by when.
   *  - "clarify" — the bot did not understand and asked back. Set so it can
   *                never ask twice running: the next message that still
   *                lands nowhere goes to the office.
   */
  pendingAsk?: "ptp" | "clarify";
  /** How many times the ptp question has been put without a usable answer. */
  ptpAsks?: number;
  /** Last promise to pay the parent made on WhatsApp. */
  lastPromise?: { amountPaise: number | null; byDate: string | null; at: string; raw: string };
  /** When the closing thank-you + guide was last sent; the chat is closed until the parent writes again. */
  closingSentAt?: string;
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

/**
 * The household a WhatsApp number belongs to.
 *
 * A number can sit on more than one household — a family re-admitted under
 * a new record keeps the old one too. Until 24 Sep 2026 the first match
 * won, whichever it was. MR. HARINATH PRASAD PATEL's number is on last
 * year's household (one Nursery row, 2025-26) and on this year's (two
 * children): exam-eve messages went out through this year's, but every
 * reply landed on last year's, so tapping "अभ्यास शुरू करें" told him no
 * child of this session was linked to his number. Three numbers are shared
 * like this in prod, each with exactly one household that has children
 * this session — that one is the family the parent is writing about.
 *
 * Order among the rest is unchanged: the household's own numbers, then a
 * parent's number on a child's record.
 */
export function findHouseholdByWaMobile(mobile10: string): Household | null {
  const sis = loadSis();
  const m = mobile10.replace(/\D/g, "").slice(-10);
  if (m.length !== 10) return null;
  const matches: Household[] = sis.households.filter(
    (h) =>
      h.whatsappMobile === m || h.mobile === m || h.altMobile === m,
  );
  for (const s of sis.students) {
    if (!s.householdId || (s.fatherMobile !== m && s.motherMobile !== m)) continue;
    if (matches.some((h) => h.id === s.householdId)) continue;
    const hh = sis.households.find((h) => h.id === s.householdId);
    if (hh) matches.push(hh);
  }
  if (matches.length <= 1) return matches[0] ?? null;
  const ay = currentAcademicYearCode(loadMasters());
  const current = matches.find((h) => childrenOfHousehold(sis, h.id, ay).length > 0);
  return current ?? matches[0]!;
}

export function isSisRegisteredMobile(fromWaId: string): boolean {
  return !!findHouseholdByWaMobile(waNormalizeLocal10(fromWaId));
}

function childrenOf(hh: Household): SisStudent[] {
  // One row per child, this session. flattenOpenDues just below has always
  // been scoped, with a comment warning that otherwise "the bot would quote a
  // parent several times what they owe" — this list had the same fault and
  // told a parent their one child three times, with three stale class labels.
  return childrenOfHousehold(
    loadSis(),
    hh.id,
    currentAcademicYearCode(loadMasters()),
  );
}

function flattenOpenDues(
  hhId: string,
  studentId?: string,
): FeeDueLine[] {
  const masters = loadMasters();
  // Scoped to the running session: this flattens the WHOLE household, so
  // older student rows of the same children would otherwise be added in and
  // the bot would quote a parent several times what they owe.
  const rows = computeHouseholdDues(
    hhId,
    loadSis(),
    masters,
    loadFees(),
    {
      includeFuture: false,
      academicYearCode: currentAcademicYearCode(masters),
    },
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

async function tryAiFallbackReply(
  hh: Household,
  text: string,
  opts: { mayClarify: boolean },
): Promise<{ text: string; grounded: boolean; clarified: boolean } | null> {
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
  const pref = householdLanguage(hh, SCHOOL_DEFAULT_WA_LANGUAGE);
  const sarvamTarget = sarvamTargetFor(hh);
  const langRule =
    pref.source === "default"
      ? // Unset used to mirror the parent, so anyone typing in Roman letters
        // ("fees kitna baaki hai") got English. They get Hindi now, unless
        // they wrote in genuine English sentences.
        "Reply in Hindi (Devanagari), formal register (आप). Only if the parent wrote in full English sentences, reply in simple English."
      : pref.language === "en"
        ? "Reply in simple English."
        : `Reply in Hindi (Devanagari), formal register (आप).${sarvamTarget ? ` (The family's language is ${languageLabel(pref.language)}; the reply will be translated from Hindi.)` : ""}`;

  const system = `You are a WhatsApp assistant for parents of ${TENANT.nameDisplay}.
${langRule}
You may discuss ONLY: (1) the household data given below (their children, dues), and (2) the school notices given below, if any are given — you do NOT know this school's policies, dates, timings, curriculum, transport, uniform, or any other fact beyond what's given here, even if it seems like common knowledge for a school. Do not state or confirm anything outside the data given.
For ANY question neither the household data nor the notices below answer, do not attempt to answer it a different way — either ask the one question that would let you answer it (see "clarify" below) or say you don't have that information.
Keep the reply under 300 characters, warm and simple, plain text (no markdown headers).`;

  const userMessage = `Guardian: ${hh.guardianName || "Parent"}
Children: ${kidsLine}
Open dues: total ${formatInr(totalDuePaise)} — ${duesLine}
${kbContext ? `Relevant school notices:\n${kbContext}\n` : ""}Parent's message: "${text}"`;

  const hindi = waTemplateLanguageFor(hh) === "hi";
  try {
    const r = await generateParentBotReplyJson({ system, userMessage });
    if (!r.ok) return null;

    // The middle outcome: the bot cannot answer yet, but the parent is
    // plainly asking about something the school holds for them. Ask the one
    // question back instead of handing them to a queue — but only when the
    // caller says we have not just asked (see `mayClarify`). A bot that asks
    // twice is not helping, it is stalling.
    if (r.kind === "clarify" && opts.mayClarify) {
      const question = r.reply.trim();
      if (question) {
        const rendered = await renderForFamily(question, sarvamTarget);
        return { text: composeSisClarifyReply(rendered, hindi), grounded: false, clarified: true };
      }
    }

    // Hard gate: an ungrounded answer never reaches the parent verbatim.
    // Already escalated by the caller, so the parent is told it has gone to
    // the office — not asked to type HUMAN — and in their own language. It
    // was English for every family until 2026-09-14.
    if (r.kind !== "answer") {
      recordUnansweredQuestion(hh, text);
      return { text: composeSisUngroundedReply(hindi), grounded: false, clarified: false };
    }
    const reply = r.reply.trim();
    if (!reply) return null;
    return { text: await renderForFamily(reply, sarvamTarget), grounded: true, clarified: false };
  } catch {
    return null;
  }
}

/**
 * Regional preference: render a Hindi draft in the family's own language
 * when Sarvam can; otherwise the Hindi goes as it is.
 */
async function renderForFamily(text: string, sarvamTarget: string | null): Promise<string> {
  if (!sarvamTarget || !sarvamConfigured()) return text;
  const t = await sarvamTranslate({ text, from: "hi-IN", to: sarvamTarget as SarvamLang, mode: "modern-colloquial" });
  return t.ok && t.text.trim() ? t.text.trim() : text;
}

/**
 * A question the school could not answer goes into the answer book.
 *
 * PROPOSED, with no answer: the office sees what parents keep asking and
 * writes the school's reply once, and nobody is answered from it until it is
 * approved. Never awaited and never allowed to throw — the parent has
 * already been handed to a person, and learning is the bonus.
 *
 * Called from the caller's own `unknown` path too, so an hour when the model
 * is unreachable still leaves the office the questions. Before 21 Sep 2026
 * this only ran when the model had answered and declined, so a failed call
 * lost the question entirely.
 */
function recordUnansweredQuestion(hh: Household, text: string): void {
  void (async () => {
    try {
      const { worthRecording } = await import("@/lib/answerBook");
      if (!worthRecording(text)) return;
      const { captureAnswerPair } = await import("@/lib/answerBook.server");
      await captureAnswerPair({ question: text, source: "unanswered", sourceRef: `household:${hh.id}` });
    } catch (e) {
      console.warn("[answerBook] could not record the question", (e as Error)?.message);
    }
  })();
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

/**
 * Record the closing message on a thread. Re-reads the store and patches the
 * one thread, so a parent message that arrived while the sweep was sending is
 * kept rather than overwritten by the sweep's older copy.
 */
export async function appendSisBotClosing(opts: { threadId: string; text: string; at: string }): Promise<void> {
  const store = await readStore();
  const next = store.threads.map((t) =>
    t.id === opts.threadId
      ? {
          ...t,
          closingSentAt: opts.at,
          messages: [...t.messages, { id: nid("wsm"), role: "bot" as const, text: opts.text, at: opts.at, by: "SIS parent WA bot · closing" }],
          updatedAt: opts.at,
        }
      : t,
  );
  await writeStore({ ...store, threads: next });
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
  const hindi = waTemplateLanguageFor(hh) === "hi";
  if (dues.length === 0) {
    return {
      escalate: false,
      text: hindi
        ? "चालू महीने तक कोई फीस बकाया नहीं है। दोबारा देखने के लिए *DUES* लिखें।"
        : "No open dues till the current running month. Reply *DUES* to refresh.",
    };
  }

  // The family's own direct link: tapping it raises the checkout for what is
  // owed at that moment and opens the gateway. The link below is the old
  // path, kept only for a server with no signing secret.
  const directUrl = duePayUrl(publicAppOrigin(), {
    householdId: hh.id,
    studentId: kids.length > 1 && payLabel.classLabel !== "Household" ? payLabel.studentId : undefined,
    scope: "open",
  });
  if (directUrl) {
    return {
      escalate: false,
      text: composeSisDirectPayReply({
        hindi,
        url: directUrl,
        who: `${payLabel.studentName}${payLabel.classLabel && payLabel.classLabel !== "Household" ? ` (${payLabel.classLabel})` : ""}`,
        lines: dues.map((d) => ({
          studentName: dueStudentName(d),
          label: d.label,
          amountPaise: d.balancePaise,
          dueOn: d.dueOn,
        })),
        totalPaise: dues.reduce((a, d) => a + d.balancePaise, 0),
      }),
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

  const attachOpts = {
    link,
    customerName: hh.guardianName || payLabel.studentName,
    customerMobile: mobile10,
    appOrigin: publicAppOrigin(),
  };
  const gw = shouldUseCashfreeCheckout()
    ? await attachCashfreeToPaymentLink(attachOpts)
    : await attachRazorpayToPaymentLink(attachOpts);
  if (gw.ok) {
    link = gw.link;
    payUrl = gw.checkoutUrl;
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
      hindi,
    }),
  };
}

/**
 * The whole session's fee for each child, from the child's own record:
 * every head with its instalments, the concession already applied, what is
 * paid and what is left. Store sales are left out — they are purchases, not
 * the fee a parent is asking about.
 */
function childFeeYears(hh: Household, hindi: boolean): { academicYear: string; children: SisChildFeeYear[] } {
  const masters = loadMasters();
  const ay = currentAcademicYearCode(masters);
  const sis = loadSis();
  const fees = loadFees();
  const rows = computeHouseholdDues(hh.id, sis, masters, fees, {
    includeFuture: true,
    includePaid: true,
    academicYearCode: ay,
  });
  const headName = (d: FeeDueLine) => {
    if (d.kind === "transport") return hindi ? "बस / परिवहन" : "Transport";
    const h = (masters.feeHeads ?? []).find((x) => x.id === d.feeHeadId);
    return (hindi ? h?.nameHi || h?.nameEn : h?.nameEn) || d.feeHeadName || d.label;
  };
  const children: SisChildFeeYear[] = rows.map(({ student, dues }) => {
    const lines = dues.filter((d) => d.kind !== "store");
    const byHead = new Map<string, { head: string; transport: boolean; nets: number[] }>();
    for (const d of lines) {
      const key = `${d.kind === "transport" ? "transport" : d.feeHeadId || d.feeHeadName}`;
      const net = Math.max(0, d.billedPaise - d.concessionPaise);
      // A head the school named "Transport fee" is a bus fee too, even when
      // it is billed as an ordinary head rather than from the route.
      const isBus = d.kind === "transport" || /transport|\bbus\b|\bvan\b|परिवहन|बस/i.test(`${d.feeHeadName} ${headName(d)}`);
      const cur = byHead.get(key) ?? { head: headName(d), transport: isBus, nets: [] };
      cur.nets.push(net);
      byHead.set(key, cur);
    }
    const heads: SisFeeHeadLine[] = [...byHead.values()]
      .map((h) => ({
        head: h.head,
        transport: h.transport,
        count: h.nets.length,
        eachPaise: h.nets.every((n) => n === h.nets[0]) ? h.nets[0]! : null,
        totalPaise: h.nets.reduce((a, b) => a + b, 0),
      }))
      .filter((h) => h.totalPaise > 0);
    const dueNow = flattenOpenDues(hh.id, student.id).reduce((a, d) => a + d.balancePaise, 0);
    return {
      name: student.fullName,
      classLabel: classLabelForStudent(student, masters),
      heads,
      concessionPaise: lines.reduce((a, d) => a + d.concessionPaise, 0),
      totalPaise: heads.reduce((a, h) => a + h.totalPaise, 0),
      paidPaise: lines.reduce((a, d) => a + d.paidPaise, 0),
      balancePaise: lines.reduce((a, d) => a + d.balancePaise, 0),
      dueNowPaise: dueNow,
    };
  });
  return { academicYear: ay, children };
}

export function feeQuestionReply(hh: Household, question: SisFeeQuestion): { text: string; escalate: boolean } {
  const hindi = waTemplateLanguageFor(hh) === "hi";
  const { academicYear, children } = childFeeYears(hh, hindi);
  return composeSisFeeStructureReply({ academicYear, children, question, hindi });
}

/**
 * The family's receipts this session and what is still owed up to the
 * running month, for a parent who says the fee is paid. Null when the fee
 * record could not be read — a statement built from an empty book would tell
 * a family that has paid that they have paid nothing.
 */
export function paidClaimStatement(
  hh: Household,
  hindi: boolean,
): { text: string; escalate: boolean; officeNote: string } | null {
  try {
    const masters = loadMasters();
    const ay = currentAcademicYearCode(masters);
    const fees = loadFees();
    if (!Array.isArray(fees.vouchers) || fees.vouchers.length === 0) return null;
    const receipts = householdReceipts(hh.id, fees)
      .filter((v) => v.academicYearCode === ay)
      .map((v) => ({
        date: v.collectionDate,
        receiptNo: v.schoolReceiptNo ? `${v.receiptNo} (${v.schoolReceiptNo})` : v.receiptNo,
        amountPaise: v.totalPaise,
        waivedPaise: (v.lines ?? []).reduce((a, l) => {
          const stamped = (l.concessionDetails ?? [])
            .filter((d) => d.code === COUNTER_DISCOUNT_CODE)
            .reduce((x, d) => x + (d.amountPaise ?? 0), 0);
          return a + (stamped > 0 ? stamped : waiverFromReceiptLabel(l.label));
        }, 0),
        covered: (v.lines ?? []).map((l) => ({
          studentName: l.studentName,
          label: l.label,
          amountPaise: l.amountPaise,
        })),
      }));
    const openDues = flattenOpenDues(hh.id).map((d) => ({
      studentName: dueStudentName(d),
      label: d.label,
      amountPaise: d.balancePaise,
      dueOn: d.dueOn,
    }));
    return composeSisPaidStatement({
      hindi,
      guardianName: hh.guardianName,
      academicYear: ay,
      receipts,
      openDues,
    });
  } catch (e) {
    console.error("[wa-sis-bot] paid statement failed", e);
    return null;
  }
}

/**
 * What this family still owes the school STORE, in paise.
 *
 * Zero on any failure — deliberately: the store line is extra information
 * on a fee reply, and a Supabase hiccup must not stop the parent being told
 * their fee dues. The fee figures in the same message come from the fee
 * book and are unaffected either way.
 */
async function householdStoreDuesPaise(studentIds: string[]): Promise<number> {
  if (studentIds.length === 0) return 0;
  try {
    const { storeDuesForStudents } = await import(
      "@/lib/inventory/sales.server"
    );
    const rows = await storeDuesForStudents(studentIds);
    return rows.reduce((sum, r) => sum + (r.balancePaise || 0), 0);
  } catch (e) {
    console.warn(
      "[wa-sis-bot] store dues unavailable:",
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
}

async function buildBotReply(
  hh: Household,
  intent: ReturnType<typeof detectSisBotIntent>,
  rawText: string,
): Promise<{ text: string; escalate: boolean; sendLocationPin?: boolean }> {
  const masters = loadMasters();
  const kids = childrenOf(hh);
  // The family's language, Hindi when they have not chosen. Every reply below
  // was English-only until 2026-09-13.
  const hindi = waTemplateLanguageFor(hh) === "hi";
  const childLines: SisBotChildLine[] = kids.map((s) => ({
    name: s.fullName,
    classLabel: classLabelForStudent(s, masters),
    admissionNo: s.admissionNo || "",
    status: s.status,
  }));

  // "Where is the school?" — checked before the intent switch, because the
  // intents never had an answer for it: two parents wrote "लोकेशन भेजें" on
  // 14 and 16 Sep 2026 and both were told their question had reached the
  // office. The school's address and coordinates were on record the whole
  // time. The bus has its own live answer and is excluded inside the
  // detector, so a parent watching for the van still gets the van.
  if (detectSchoolLocationRequest(rawText)) {
    return {
      escalate: false,
      text: composeSchoolLocationReply({ hindi, masters }),
      sendLocationPin: true,
    };
  }

  switch (intent) {
    case "kids":
      return { escalate: false, text: composeSisKidsReply(childLines, hindi) };
    case "dues": {
      const dues = flattenOpenDues(hh.id);
      // Books / uniform on credit, named beside the fee dues and never
      // inside them: the pay link below cannot settle a store slip, so one
      // combined total would under-pay and the family would think they were
      // clear. Unknown stays silent rather than quoting a wrong figure.
      const storeDuesPaise = await householdStoreDuesPaise(kids.map((k) => k.id));
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
          hindi,
          storeDuesPaise,
          payUrl: dues.length ? duePayUrl(publicAppOrigin(), { householdId: hh.id, scope: "open" }) || undefined : undefined,
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
      return { escalate: false, text: composeSisReceiptsReply(rows, hindi) };
    }
    case "info":
      return { escalate: false, text: composeSisInfoReply(hindi) };
    case "human":
      return { escalate: true, text: composeSisHumanReply(hindi) };
    case "complaint":
      return {
        escalate: false,
        text: hindi ? "शिकायत का फॉर्म खोला जा रहा है…" : "Opening the complaint form…",
      };
    case "bus": {
      const { busLocationReplyForHousehold } = await import(
        "@/lib/parentBusLocation.server"
      );
      return busLocationReplyForHousehold({
        children: kids.map((s) => ({ id: s.id, name: s.fullName })),
        rawText,
      });
    }
    default: {
      const { householdRidesTheBus } = await import(
        "@/lib/parentBusLocation.server"
      );
      return {
        escalate: false,
        // BUS is offered only to households that ride, so the 130-odd
        // families without transport are not shown a keyword that can only
        // tell them they have no bus.
        text: sisBotWelcomeText(
          kids.length > 1,
          await householdRidesTheBus(kids.map((s) => ({ id: s.id, name: s.fullName }))),
          hindi,
        ),
      };
    }
  }
}

/**
 * Is this a tap on one of the school's own template buttons?
 *
 * Those are answers to a question the school asked ("Already paid"), and
 * study help must not intercept one.
 */
function quickReplyGate(text: string): boolean {
  return !!matchSeedQuickReply(text);
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

  // ── A message for a teacher, pre-addressed by the app ("Ref: T:…"):
  // relay it through the school within hours, hold it after 8 PM. ──
  const relay = parseTeacherWaText(text);
  if (relay) {
    const child = childrenOf(hh).find((s) => s.id === relay.studentId);
    // Blank used to mean English here; the school writes in Hindi unless the
    // family chose otherwise.
    const hindi = waTemplateLanguageFor(hh) === "hi";
    if (!child) {
      return finishLanguageFlow(store, thread, parentMsg, hindi ? "यह बच्चा आपके परिवार में दर्ज नहीं है। कृपया ऐप से दोबारा भेजें।" : "That child is not on your family's record. Please send again from the app.");
    }
    if (!relay.message) {
      return finishLanguageFlow(store, thread, parentMsg, hindi ? "कृपया अपना संदेश 'Ref' वाली पंक्ति के नीचे लिखकर भेजें।" : "Please type your message below the 'Ref' line and send again.");
    }
    const { relayTeacherMessage } = await import("@/lib/teacherContact.server");
    const r = await relayTeacherMessage({ household: hh, student: child, staffId: relay.staffId, body: relay.message, channel: "whatsapp" });
    const ack = r.ok
      ? teacherRelayAck({ teacherName: r.teacherName, open: r.via !== "held", hindi })
      : hindi ? `संदेश नहीं भेजा जा सका: ${r.error}` : `Could not send: ${r.error}`;
    return finishLanguageFlow(store, thread, parentMsg, ack);
  }

  // "hlw", "hello sir", "namaskar", "good morning" are greetings too. It
  // used to be six exact words, and only when the message had not come
  // through the unified bot — which is how every parent message arrives — so
  // "Hlw" got a bare list of keywords instead of the welcome.
  const isGreeting = isSisGreeting(text);

  // ── Language preference: decided from the HOUSEHOLD, not from the thread.
  //
  // This used to ask "was the last bot message the menu?", which reads the
  // SIS bot's thread — and that thread is never persisted (only classChannel,
  // hub, staffAtt and unified reach wa_desk_bot_slices). On any fresh
  // instance the thread is empty, so a bare "2" was never recognised as an
  // answer. All 198 households still had a blank preferred_language on
  // 2026-09-07: the choice had never once been saved, and every parent
  // silently got English.
  //
  // Asked at most once, on the parent's OWN reply — which is also what makes
  // it free. Meta's 24-hour window opens when the customer writes to us;
  // sending them a template does not open it, so the menu cannot ride out
  // behind a receipt. It rides on the reply the receipt provokes.
  // The language question is asked only when the parent asks for it (LANG).
  //
  // It used to be appended to EVERY reply for a family with no language on
  // record — 191 of 200 households — so a parent asking about fees got the
  // answer followed by a six-line "Which language…" menu, message after
  // message (13 Sep 2026). The school writes in Hindi unless a family says
  // otherwise, so there is nothing to ask. A bare "2" is read as a language
  // only right after the menu was sent, never out of the blue.
  const explicitLang = LANGUAGE_MENU_KEYWORDS.some((k) => {
    const u = text.toUpperCase();
    return u === k || u.startsWith(`${k} `);
  });
  const lastBot = [...thread.messages].reverse().find((m) => m.role === "bot");
  const justAskedLanguage = !!lastBot && lastBot.text.startsWith(languageMenuText().slice(0, 40));
  const rawGate = languageGateDecision({ known: justAskedLanguage ? "" : hh.preferredLanguage || (explicitLang ? "" : "hi"), text });
  const gate =
    rawGate.action === "ask" && !explicitLang
      ? ({ action: "pass" } as const)
      : rawGate.action === "save" && !explicitLang && !justAskedLanguage && /^\s*\d+\s*$/.test(text)
        ? ({ action: "pass" } as const)
        : rawGate;
  if (gate.action === "ask") {
    return finishLanguageFlow(store, thread, parentMsg, languageMenuText());
  }
  if (gate.action === "save") {
    const choice = gate.choice;
    const updated: Household = { ...hh, preferredLanguage: choice };
    const kids = childrenOf(hh);
    let saved = false;
    try {
      const { pushSisToDb } = await import("@/lib/sisNormalized.server");
      const r = await pushSisToDb({ households: [updated], students: [] });
      saved = !!r.ok;
      if (!r.ok) {
        console.error("[wa-sis-bot] language pref push FAILED", r.error);
      } else {
        patchMirrorHousehold(updated, kids);
      }
    } catch (e) {
      console.error("[wa-sis-bot] language pref save FAILED", e);
    }
    // Never confirm a save that did not happen. The old code logged a warning
    // and thanked the parent anyway, so a failed write looked exactly like a
    // successful one — and the next message still arrived in English with
    // nobody any the wiser. If it did not store, say so and let them retry.
    return finishLanguageFlow(
      store,
      thread,
      parentMsg,
      saved
        ? languageChoiceConfirmation(choice)
        : "Sorry — we could not save that just now. Please reply LANG and choose again in a few minutes.",
    );
  }

  // ── Giving a child their own number (LINK / UNLINK) ──
  //
  // The parent's own number is the only place this can be done: the code
  // is handed over in person, never sent to the child's phone, which is
  // also the only workable design — Meta's window is shut for a number
  // that has never messaged us.
  {
    const { parseParentLinkCommand } = await import(
      "@/lib/waStudentLinkEngine"
    );
    const linkCmd = parseParentLinkCommand(text);
    if (linkCmd.kind !== "none") {
      try {
        const { handleParentLinkCommand } = await import(
          "@/lib/waStudentLinkParent.server"
        );
        const r = await handleParentLinkCommand({
          household: hh,
          children: childrenOf(hh),
          mobile10,
          command: linkCmd,
        });
        return finishLanguageFlow(store, thread, parentMsg, r.replyText);
      } catch (e) {
        console.error("[wa-sis-bot] student link failed", e);
      }
    }
  }

  // ── APAAR ID consent: the parent's tap on "✅ हाँ, सहमति है" / "❌ नहीं",
  // or "APAAR" to be asked (again). Before the drill and the tutor: the tap
  // is a decision about the child's data, never an answer to a question. ──
  try {
    const { handleApaarConsentInbound } = await import("@/lib/apaarConsent.server");
    const apaar = await handleApaarConsentInbound({
      household: hh,
      children: childrenOf(hh),
      mobile10,
      text,
      hindi: waTemplateLanguageFor(hh) === "hi",
      waMessageId: opts.waMessageId,
    });
    if (apaar !== null) {
      return finishLanguageFlow(store, thread, parentMsg, apaar);
    }
  } catch (e) {
    console.error("[wa-sis-bot] APAAR consent failed", e);
  }

  // ── A revision drill already running on this number ──
  //
  // Before exam-eve and before the tutor: while a drill is open, a bare "60"
  // or "photosynthesis" is an ANSWER to the question we just asked, and both
  // of those would otherwise be read as something else entirely. It claims
  // nothing when no drill is open, and nothing at all unless
  // EXAM_DRILL_ENABLED is set.
  try {
    const { continueExamDrill } = await import("@/lib/examDrill.server");
    const drill = await continueExamDrill({
      household: hh,
      mobile10,
      text,
      hindi: waTemplateLanguageFor(hh) === "hi",
    });
    if (drill.handled) {
      return finishLanguageFlow(store, thread, parentMsg, drill.replyText);
    }
  } catch (e) {
    // A drill that cannot run must never take fees and receipts with it.
    console.error("[wa-sis-bot] exam drill failed", e);
  }

  // ── Exam eve: the "Start practice" button and TIMETABLE ──
  //
  // Before study help, because the button's own words ("अभ्यास शुरू करें")
  // would otherwise reach the tutor as a question with no subject, and
  // before the keyword matcher, which has no idea what TIMETABLE means.
  // The handler answers only those two things and returns null for
  // everything else, so the normal flow is untouched.
  try {
    const { handleExamEveInbound } = await import("@/lib/examEve.server");
    const exam = await handleExamEveInbound({
      household: hh,
      children: childrenOf(hh),
      mobile10,
      text,
    });
    if (exam) {
      return finishLanguageFlow(store, thread, parentMsg, exam);
    }
  } catch (e) {
    // A date-sheet read that fails must never take fees and receipts with it.
    console.error("[wa-sis-bot] exam eve failed", e);
  }

  // ── Study help (the app's tutor, on WhatsApp) ──
  //
  // Asked BEFORE the keyword matcher only so that an open session can claim
  // free text — a parent typing "explain fractions" mid-session means the
  // tutor, and the keyword matcher would read "class" in that sentence as
  // KIDS. It never claims the school's own keywords (PAY, DUES, HUMAN…),
  // so fees keep working mid-session; see RESERVED in waTutorBotEngine.
  if (!quickReplyGate(text)) {
    try {
      const { handleWaTutorInbound } = await import("@/lib/waTutorBot.server");
      const tutor = await handleWaTutorInbound({
        household: hh,
        children: childrenOf(hh),
        mobile10,
        text,
      });
      if (tutor.handled) {
        return finishLanguageFlow(store, thread, parentMsg, tutor.replyText);
      }
    } catch (e) {
      // Study help failing must never take the fee and receipt bot with
      // it — fall through to the normal keyword flow.
      console.error("[wa-sis-bot] study help failed", e);
    }
  }

  // A tap on one of the school's own template buttons ("Already paid",
  // "Child is unwell") is an answer to a question the school asked, not a
  // keyword to guess at — acknowledge it and put a person on it.
  const quickReply = matchSeedQuickReply(text);
  // A fee-reminder reply that is not a command: "already paid" (typed or the
  // template's own button) and "need some time". Read BEFORE the keyword
  // matcher, which would file "paid" under RECEIPTS and "time" under nothing.
  const hindi = waTemplateLanguageFor(hh) === "hi";
  const paidButton = !!quickReply && /paid|भुगतान/i.test(quickReply.label);
  // "What is this ₹3,500 for?" is neither a payment claim nor a dues query.
  const feeWhy = !paidButton && !quickReply && isFeeWhyQuestion(text);
  const feeReply = paidButton ? ("claims_paid" as const) : feeWhy ? null : detectSisFeeReplyIntent(text);
  // "1500 dina" in answer to "how much and by when" says it is already paid,
  // not a promise — read the payment first.
  const answeringPtp =
    thread.pendingAsk === "ptp" && !quickReply && feeReply !== "claims_paid" && detectSisBotIntent(text) === "unknown";
  const feeQuestion = !quickReply && !feeReply && !feeWhy ? detectSisFeeQuestion(text) : null;
  let nextPendingAsk: WaSisBotThread["pendingAsk"] = undefined;
  let nextPtpAsks: number | undefined;
  let lastPromise = thread.lastPromise;
  let officeNote = "";
  let closingNow = false;
  let intent: ReturnType<typeof detectSisBotIntent>;
  let bot: { text: string; escalate: boolean; sendLocationPin?: boolean };
  if (answeringPtp) {
    const p = parseSisPromiseToPay(text, new Date().toISOString().slice(0, 10));
    if (promiseIsEmpty(p)) {
      // Not an answer. Keep listening rather than filing an empty promise:
      // the real figure often arrives in the very next message. Asked twice
      // at most — after that a person takes it, because a parent who has
      // not answered twice is not going to answer a third machine.
      const asks = (thread.ptpAsks ?? 1) + 1;
      if (asks > 2) {
        intent = "human";
        officeNote = `Parent asked for time but did not give an amount or a date after two asks. Last message: "${text.slice(0, 120)}"`;
        bot = { escalate: true, text: composeSisHumanReply(waTemplateLanguageFor(hh) === "hi") };
      } else {
        nextPendingAsk = "ptp";
        nextPtpAsks = asks;
        intent = "unknown";
        bot = { escalate: false, text: composeSisPromiseUnclear(hindi) };
      }
    } else {
      lastPromise = { amountPaise: p.amountPaise, byDate: p.byDate, at: nowIso(), raw: p.raw };
      officeNote = promiseSummaryForOffice(p);
      intent = "human";
      bot = { escalate: true, text: composeSisPromiseRecorded(p, hindi) };
    }
  } else if (feeReply === "claims_paid") {
    intent = "human";
    // Show the family its own record — what was paid, what it covered, what
    // is still left and so why the reminder came. Only if the record cannot
    // be read does the old "we will re-check" apology go instead.
    const statement = paidClaimStatement(hh, hindi);
    if (statement) {
      officeNote = statement.officeNote;
      bot = { escalate: statement.escalate, text: statement.text };
    } else {
      officeNote = "Parent says the fee is already paid — re-check receipts and the counter book, then reply here.";
      bot = { escalate: true, text: composeSisClaimsPaidReply(hindi) };
    }
  } else if (feeReply === "need_time") {
    intent = "human";
    nextPendingAsk = "ptp";
    nextPtpAsks = 1;
    bot = { escalate: false, text: composeSisNeedTimeAsk(hindi) };
  } else if (feeQuestion) {
    // "How much is the fee / the bus / any discount?" — the year's fee from
    // the child's own record, not the dues list (see detectSisFeeQuestion).
    intent = "dues";
    bot = feeQuestionReply(hh, feeQuestion);
    if (bot.escalate) {
      officeNote = `Parent asked about fees${feeQuestion.transport ? " / transport" : ""}${feeQuestion.discount ? " / a discount" : ""}${feeQuestion.namedClass ? ` / class ${feeQuestion.namedClass}` : ""}: "${text.slice(0, 160)}"`;
    }
  } else if (!quickReply && isSisAcknowledgement(text)) {
    // "ok / thanks" ends the conversation: thanks + the guide, once. A second
    // "ok" in the same closed conversation just gets a short thank-you.
    intent = "info";
    if (alreadyClosed({ status: thread.status, messages: thread.messages, closingSentAt: thread.closingSentAt })) {
      bot = { escalate: false, text: composeSisAcknowledgement(hindi) };
    } else {
      const { householdRidesTheBus } = await import("@/lib/parentBusLocation.server");
      bot = {
        escalate: false,
        text: parentChatClosingMessage({
          needsOffice: thread.status === "needs_staff",
          hasTransport: await householdRidesTheBus(childrenOf(hh).map((s) => ({ id: s.id, name: s.fullName }))),
        }),
      };
      closingNow = true;
    }
  } else {
    intent = quickReply
      ? ("human" as const)
      : isGreeting || feeWhy
        ? ("unknown" as const)
        : detectSisBotIntent(text);
    bot = quickReply
      ? { escalate: true, text: quickReplyAcknowledgement(quickReply) }
      : await buildBotReply(hh, intent, text);
  }
  let replyText = bot.text;
  // An answer to "how much and by when" that could not be read already has
  // its reply (ask again, then a person). Until 22 Sep 2026 the two
  // fallbacks below overwrote it with "इसकी जानकारी मेरे पास नहीं है".
  if (opts.fromUnified && intent === "unknown" && !isGreeting && !answeringPtp) {
    replyText =
      waTemplateLanguageFor(hh) === "hi"
        ? "*KIDS* · *DUES* · *PAY* (ऑनलाइन भुगतान) · *PAY 1* · *RECEIPTS* · *HUMAN* में से कोई शब्द लिखें — या स्कूल के मुख्य मेनू के लिए *MENU*।"
        : "Reply *KIDS* · *DUES* · *PAY* (online payment) · *PAY 1* · *RECEIPTS* · *HUMAN* — or *MENU* for the main school menu.";
  }
  let escalateUngrounded = false;
  if (intent === "unknown" && !isGreeting && !answeringPtp && text.trim().length > 3) {
    // Ask back at most once per conversation. If the bot's own question did
    // not land, the parent has now been misunderstood twice and wants a
    // person, not a third try.
    const alreadyAsked = thread.pendingAsk === "clarify";
    const aiReply = await tryAiFallbackReply(hh, text, { mayClarify: !alreadyAsked });
    if (aiReply) {
      replyText = aiReply.text;
      if (aiReply.clarified) {
        // The bot is waiting on an answer, not the office.
        nextPendingAsk = "clarify";
      } else {
        // Not answerable from what we know → the office should see it.
        escalateUngrounded = !aiReply.grounded;
      }
    } else {
      // No model, or the call failed. It is still a question the school
      // could not answer, and the office still wants to see it — before
      // 21 Sep 2026 an unreachable model lost the question entirely.
      recordUnansweredQuestion(hh, text);
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
    messages: officeNote
      ? [...thread.messages, parentMsg, botMsg, { id: nid("wsm"), role: "bot" as const, text: `📌 ${officeNote}`, at: nowIso(), by: "SIS parent WA bot · note for office" }]
      : [...thread.messages, parentMsg, botMsg],
    pendingAsk: nextPendingAsk,
    ptpAsks: nextPtpAsks,
    lastPromise,
    // Set AFTER this parent message is in the thread, so the closing covers it.
    closingSentAt: closingNow ? new Date(Date.now() + 1).toISOString() : thread.closingSentAt,
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

  // The pin the parent actually asked for, beside the address. Best-effort:
  // the address and the maps link are already delivered, so a failed pin is
  // logged and nothing more.
  if (bot.sendLocationPin && send.ok) {
    const pin = schoolLocationPin(loadMasters());
    const pinSend = await sendWhatsAppLocation({ toMobile: mobile10, ...pin });
    if (!pinSend.ok) {
      console.warn("[wa-sis-bot] location pin not sent:", pinSend.error);
    }
  }

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
  // Never WhatsApp a cancelled receipt. If it was voided between the
  // payment and this send, the parent must hear it from the office, not
  // receive a receipt for money the books no longer show.
  if (voucher.voidedAt) return { ok: false, error: "Receipt is voided" };
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
