/**
 * Ask the ERP — information questions answered in conversation.
 *
 * The command desk answers command-shaped text ("5A me aaj kaun absent hai",
 * "Amay ki fees") and steps aside for everything else. A staff member who
 * types a question the catalogue does not know — "how much fee collected this
 * week?", "kitne bachche 90 din se baaki hain?", "class 5 me kitne students?"
 * — got silence on WhatsApp, "I didn't understand" in the app, or the wrong
 * window ("this week" answered with today's figure).
 *
 * This module is the answering layer that runs where the desk gives up:
 *
 *   1. a PLANNER picks which fact tools answer the question (allow-listed
 *      ids, a period, a band, a class) — the model never sees data here;
 *   2. code RUNS the tools against the school's own records, with the same
 *      RBAC the commands use, and renders the facts as text with the numbers;
 *   3. a WRITER turns question + facts into one or two conversational
 *      sentences in the asker's own language (Hindi, English, Hinglish);
 *   4. a GUARD checks every number in the reply appears in the facts. A reply
 *      that fails is replaced by the rendered facts — the figures are the
 *      answer, the prose is the courtesy.
 *
 * Unknown stays unknown: a tool the asker may not see is omitted and the
 * reply says so; a question the planner cannot place gets a plain "I can
 * answer about …" rather than a guess. This file is pure and client-safe;
 * the LLM calls are in aiLlm.server.ts and the tool executors in
 * erpAsk.server.ts.
 */

import { formatInr } from "@/lib/masters";
import type { RbacAction, RbacModule } from "@/lib/rbac";

export type ErpAskToolId =
  | "collections"
  | "dues_ageing"
  | "class_strength"
  | "attendance"
  | "admissions"
  | "staff_today"
  | "concessions";

export type ErpAskPeriod =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "session";

export type ErpAskBand = "over90" | "d31to90" | "d0to30" | "notDue" | "all";

export type ErpAskToolDef = {
  id: ErpAskToolId;
  module: RbacModule;
  action: RbacAction;
  /** What the planner reads. Plain, with the parameters it may fill. */
  description: string;
  params: ("period" | "band" | "classRef" | "limit")[];
};

export const ERP_ASK_TOOLS: ErpAskToolDef[] = [
  {
    id: "collections",
    module: "fees",
    action: "view",
    description: "Fee money collected: amount and number of receipts for a period, compared with the period before. Period defaults to today.",
    params: ["period"],
  },
  {
    id: "dues_ageing",
    module: "fees",
    action: "view",
    description: "What families still owe, aged: over 90 days, 31–90 days, 0–30 days, not yet due — amount and number of children in each band, and optionally the children in one band (or one class).",
    params: ["band", "classRef", "limit"],
  },
  {
    id: "class_strength",
    module: "students",
    action: "view",
    description: "How many students are enrolled, in the whole school or in one class/section.",
    params: ["classRef"],
  },
  {
    id: "attendance",
    module: "attendance",
    action: "view",
    description: "Student attendance for a day (today or yesterday): present, absent, sections not yet marked.",
    params: ["period"],
  },
  {
    id: "admissions",
    module: "admissions",
    action: "view",
    description: "Admissions enquiries and stage moves for a period (this week / this month), plus the pipeline.",
    params: ["period"],
  },
  {
    id: "staff_today",
    module: "staff",
    action: "view",
    description: "Staff present and absent today.",
    params: [],
  },
  {
    id: "concessions",
    module: "fees",
    action: "view",
    description: "Fee concessions: how many children hold one, how many definitions exist, how much they cost this session, how many expire soon.",
    params: [],
  },
];

export const ERP_ASK_PROMPT_VERSION = "v1";

/* ── question detection ──────────────────────────────────────────── */

const QUESTION_WORDS =
  /(?<![\p{L}\p{M}])(how\s+(?:much|many)|what|who|when|which|where|why|total|list|show\s+me|tell\s+me|kitn[aeio]|kaun|kab|kya|kahan|kaise|kaunse|batao|bataiye|bata\s*do|dikhao|कितन[ाेी]|कौन|कब|क्या|कहाँ|कैसे|बताओ|बताइए|दिखाओ)(?![\p{L}\p{M}])/iu;

/**
 * Does this read as a question the ERP might answer, rather than chat?
 *
 * A question mark or a question word is enough. So is a fact word with a
 * qualifier — "fees collected this week", "dues over 90 days", "class 5
 * strength" — the way people type a request into a search box. A fact word
 * on its own is not: "collection counter band karo" is staff talking to each
 * other and must fall through untouched, as it always has.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 4 || t.length > 400) return false;
  if (/\?\s*$/.test(t) || QUESTION_WORDS.test(t)) return true;
  const plan = deterministicPlan(t);
  if (!plan) return false;
  const tool = plan.tools[0]!;
  return !!(tool.period || tool.band || tool.classRef || /(?<![\p{L}\p{M}])(list|status|report|summary|total|details?|ageing|aging)(?![\p{L}\p{M}])/iu.test(t));
}

/* ── periods ─────────────────────────────────────────────────────── */

const PERIOD_PATTERNS: [ErpAskPeriod, RegExp][] = [
  ["last_week", /(?<![\p{L}\p{M}])(last|previous|pichl[ae]|pichhl[ae]|gaye|पिछले|गए)\s+(week|hafte?|haft[ae]|सप्ताह|हफ़्?ते)(?![\p{L}\p{M}])/iu],
  ["this_week", /(?<![\p{L}\p{M}])((this|is|iss|इस)\s+(week|hafte?|haft[ae]|सप्ताह|हफ़्?ते)|weekly|is\s+hafte)(?![\p{L}\p{M}])/iu],
  ["last_month", /(?<![\p{L}\p{M}])(last|previous|pichl[ae]|pichhl[ae]|पिछले)\s+(month|mahin[ae]|maheen[ae]|महीने|माह)(?![\p{L}\p{M}])/iu],
  ["this_month", /(?<![\p{L}\p{M}])((this|is|iss|इस)\s+(month|mahin[ae]|maheen[ae]|महीने|माह)|monthly|month\s+to\s+date|mtd)(?![\p{L}\p{M}])/iu],
  ["session", /(?<![\p{L}\p{M}])(session|this\s+year|is\s+saal|poore?\s+saal|सत्र|इस\s+साल|year\s+to\s+date|ytd|so\s+far|ab\s+tak|अब\s+तक)(?![\p{L}\p{M}])/iu],
  ["yesterday", /(?<![\p{L}\p{M}])(yesterday|kal|कल|beete\s+kal)(?![\p{L}\p{M}])/iu],
  ["today", /(?<![\p{L}\p{M}])(today|aaj|आज)(?![\p{L}\p{M}])/iu],
];

/** The period a question names, or null when it names none. */
export function detectAskPeriod(text: string): ErpAskPeriod | null {
  for (const [p, re] of PERIOD_PATTERNS) if (re.test(text)) return p;
  return null;
}

/** A period wider than one day — the command desk's day commands must not swallow it. */
export function namesPeriodBeyondDay(text: string): boolean {
  const p = detectAskPeriod(text);
  return p != null && p !== "today" && p !== "yesterday";
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function shift(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

export type DateRange = { from: string; to: string; label: string };

/**
 * Concrete dates for a period. Weeks run Monday to Sunday (the school works
 * Monday to Saturday); "this week" is Monday up to and including today.
 * The session range is left open at the start — the caller's data is
 * already scoped to the academic year.
 */
export function resolvePeriodRange(period: ErpAskPeriod, todayIso: string): DateRange {
  const today = new Date(`${todayIso}T00:00:00Z`);
  const dow = today.getUTCDay(); // 0 = Sunday
  const monday = shift(todayIso, -((dow + 6) % 7));
  switch (period) {
    case "today":
      return { from: todayIso, to: todayIso, label: "today" };
    case "yesterday": {
      const y = shift(todayIso, -1);
      return { from: y, to: y, label: "yesterday" };
    }
    case "this_week":
      return { from: monday, to: todayIso, label: "this week (from Monday)" };
    case "last_week":
      return { from: shift(monday, -7), to: shift(monday, -1), label: "last week" };
    case "this_month":
      return { from: `${todayIso.slice(0, 7)}-01`, to: todayIso, label: "this month" };
    case "last_month": {
      const firstThis = `${todayIso.slice(0, 7)}-01`;
      const lastPrev = shift(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev, label: "last month" };
    }
    case "session":
      return { from: "0000-01-01", to: todayIso, label: "this session so far" };
  }
}

/** The equal-length range immediately before, for "compared with". */
export function previousRange(r: DateRange): DateRange | null {
  if (r.from === "0000-01-01") return null;
  const days = Math.round((new Date(`${r.to}T00:00:00Z`).getTime() - new Date(`${r.from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  const to = shift(r.from, -1);
  return { from: shift(to, -(days - 1)), to, label: "the period before" };
}

/* ── the plan ────────────────────────────────────────────────────── */

export type ErpAskPlanTool = {
  id: ErpAskToolId;
  period?: ErpAskPeriod;
  band?: ErpAskBand;
  classRef?: string;
  limit?: number;
};

export type ErpAskPlan = {
  tools: ErpAskPlanTool[];
  /** Reply language the writer should use, from how the question was written. */
  language: "en" | "hi" | "hinglish";
  /** Set when the question is about the ERP's data but none of the tools fit. */
  outOfScope: boolean;
  confidence: number;
};

export function buildErpAskPlanSystemPrompt(opts: { tools: ErpAskToolDef[]; todayIso: string }): string {
  const lines = opts.tools.map((t) => `- ${t.id}: ${t.description}${t.params.length ? ` Parameters: ${t.params.join(", ")}.` : ""}`);
  return [
    "A school staff member has asked the ERP a question (Hindi, English or mixed Hinglish).",
    `Today is ${opts.todayIso} (India). Decide which FACT TOOLS answer it. You see no data; you only choose tools.`,
    "",
    "Tools:",
    ...lines,
    "",
    "period is one of: today, yesterday, this_week, last_week, this_month, last_month, session. Leave it out when the question names none.",
    "band is one of: over90, d31to90, d0to30, notDue, all — only for dues_ageing, only when the question names an age (e.g. '90 din se', 'over 3 months').",
    "classRef is the class or section exactly as written (e.g. '5A', 'class 5', 'nursery'). limit is how many children to list (default 10, max 25).",
    "language: 'hi' if the question is in Devanagari, 'hinglish' if it is Hindi in Latin letters, else 'en'.",
    "",
    'Respond with JSON only: {"tools":[{"id":"collections","period":"this_week"}],"language":"hinglish","outOfScope":false,"confidence":0.9}.',
    "Pick at most three tools. If the question is greeting or chat, or about something no tool covers, return tools:[] with outOfScope true when it was about school data, false otherwise.",
    "Never invent a class, a period or a band the question does not say.",
  ].join("\n");
}

const TOOL_IDS = new Set<string>(ERP_ASK_TOOLS.map((t) => t.id));
const PERIODS = new Set<string>(["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "session"]);
const BANDS = new Set<string>(["over90", "d31to90", "d0to30", "notDue", "all"]);

export function parseErpAskPlanJson(text: string): ErpAskPlan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tools: ErpAskPlanTool[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(o.tools) ? o.tools : []) {
    if (!t || typeof t !== "object") continue;
    const q = t as Record<string, unknown>;
    const id = typeof q.id === "string" ? q.id.trim() : "";
    if (!TOOL_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    const period = typeof q.period === "string" && PERIODS.has(q.period) ? (q.period as ErpAskPeriod) : undefined;
    const band = typeof q.band === "string" && BANDS.has(q.band) ? (q.band as ErpAskBand) : undefined;
    const classRef = typeof q.classRef === "string" ? q.classRef.trim().slice(0, 40) : "";
    const limitRaw = typeof q.limit === "number" ? Math.floor(q.limit) : NaN;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, limitRaw)) : undefined;
    tools.push({ id: id as ErpAskToolId, period, band, classRef: classRef || undefined, limit });
    if (tools.length === 3) break;
  }
  const lang = o.language === "hi" || o.language === "hinglish" ? o.language : "en";
  const confidence = typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0;
  return { tools, language: lang, outOfScope: o.outOfScope === true, confidence };
}

/* ── facts ───────────────────────────────────────────────────────── */

export type ErpAskFact = {
  tool: ErpAskToolId;
  /** Rendered, numbers included — what the writer reads and the fallback reply. */
  text: string;
};

export type CollectionsFacts = {
  range: DateRange;
  count: number;
  amountPaise: number;
  previous: { range: DateRange; count: number; amountPaise: number } | null;
  byMode: { label: string; amountPaise: number }[];
};

export function renderCollectionsFacts(f: CollectionsFacts): string {
  const lines = [`*Fee collection · ${f.range.label}* (${f.range.from === f.range.to ? f.range.from : `${f.range.from} to ${f.range.to}`})`, `*${formatInr(f.amountPaise)}* · ${f.count} receipt${f.count === 1 ? "" : "s"}`];
  if (f.previous) {
    const d = f.amountPaise - f.previous.amountPaise;
    lines.push(`${f.previous.range.label} (${f.previous.range.from} to ${f.previous.range.to}): ${formatInr(f.previous.amountPaise)} · ${f.previous.count} receipts → ${d === 0 ? "no change" : d > 0 ? `${formatInr(d)} more` : `${formatInr(-d)} less`}`);
  }
  if (f.byMode.length) lines.push(`By mode: ${f.byMode.map((m) => `${m.label} ${formatInr(m.amountPaise)}`).join(" · ")}`);
  return lines.join("\n");
}

export type AgeingFacts = {
  scopeLabel: string;
  bands: { band: Exclude<ErpAskBand, "all">; label: string; amountPaise: number; children: number }[];
  totalOpenPaise: number;
  childrenOwing: number;
  /** Only when one band (or a class) was asked for and the asker may see names. */
  listed: { band: string; rows: { name: string; classLabel: string; amountPaise: number; oldestDueOn: string }[]; more: number } | null;
};

export function renderAgeingFacts(f: AgeingFacts): string {
  const lines = [`*Dues ageing · ${f.scopeLabel}*`, `Still owed *${formatInr(f.totalOpenPaise)}* across ${f.childrenOwing} children`];
  for (const b of f.bands) if (b.amountPaise > 0) lines.push(`• ${b.label}: ${formatInr(b.amountPaise)} · ${b.children} children`);
  if (f.listed) {
    lines.push("", `*${f.listed.band}* — ${f.listed.rows.length}${f.listed.more ? ` of ${f.listed.rows.length + f.listed.more}` : ""} shown, largest first:`);
    f.listed.rows.forEach((r, i) => lines.push(`*${i + 1}.* ${r.name} · ${r.classLabel} · ${formatInr(r.amountPaise)} · oldest due ${r.oldestDueOn}`));
    if (f.listed.more) lines.push(`…and ${f.listed.more} more.`);
  }
  return lines.join("\n");
}

export type ClassStrengthFacts = {
  scopeLabel: string;
  total: number;
  rows: { label: string; count: number }[];
};

export function renderClassStrengthFacts(f: ClassStrengthFacts): string {
  const lines = [`*Students · ${f.scopeLabel}*`, `*${f.total}* active student${f.total === 1 ? "" : "s"}`];
  for (const r of f.rows) lines.push(`• ${r.label}: ${r.count}`);
  return lines.join("\n");
}

export type ConcessionsFacts = {
  children: number;
  grants: number;
  definitions: number;
  costThisSessionPaise: number | null;
  expiringBy: { date: string; grants: number } | null;
  withoutGround: number;
};

export function renderConcessionsFacts(f: ConcessionsFacts): string {
  const lines = [`*Concessions · this session*`, `${f.children} children hold ${f.grants} approved grant${f.grants === 1 ? "" : "s"} under ${f.definitions} definition${f.definitions === 1 ? "" : "s"}`];
  if (f.costThisSessionPaise != null) lines.push(`Cost this session: ${formatInr(f.costThisSessionPaise)}`);
  if (f.expiringBy) lines.push(`Expiring by ${f.expiringBy.date}: ${f.expiringBy.grants} grants`);
  if (f.withoutGround) lines.push(`Without a recorded ground: ${f.withoutGround} grants`);
  return lines.join("\n");
}

/* ── the answer ──────────────────────────────────────────────────── */

export function buildErpAskAnswerSystemPrompt(opts: { language: ErpAskPlan["language"]; schoolName: string; firstName: string }): string {
  const lang =
    opts.language === "hi"
      ? "Reply in simple Hindi (Devanagari)."
      : opts.language === "hinglish"
        ? "Reply in Hinglish — Hindi words in Latin letters, the way the question was written."
        : "Reply in plain English.";
  return [
    `You answer a staff member of ${opts.schoolName} (${opts.firstName}) who asked the school ERP a question on WhatsApp.`,
    lang,
    "",
    "You are given the FACTS that answer it, already computed from the school's records, with every number in them.",
    "Write the answer the way a helpful colleague would say it: one to three short sentences, then — only if the facts",
    "contain a list of children — keep that numbered list exactly as given, one per line.",
    "",
    "ABSOLUTE RULES:",
    "1. Every number you write must appear in the facts exactly (same digits; ₹ and commas as in the facts). Never round, never add, never estimate.",
    "2. Use only the facts. If something is marked 'not available' or 'not permitted', say that in one clause; do not guess it.",
    "3. Do not judge, praise or scold anyone. Do not name a family the facts do not name.",
    "4. WhatsApp formatting only: *bold* for the key figure, plain otherwise. No headings, no markdown tables.",
    "",
    'Reply with JSON only: {"answer":"..."}',
  ].join("\n");
}

export function buildErpAskAnswerUserPrompt(opts: { question: string; facts: ErpAskFact[]; notes: string[]; previous?: { question: string; answer: string } | null }): string {
  const lines: string[] = [];
  if (opts.previous) lines.push(`Their previous question: "${opts.previous.question}"`, `Your previous answer: "${opts.previous.answer.slice(0, 400)}"`, "");
  lines.push(`Question: "${opts.question}"`, "", "Facts:");
  for (const f of opts.facts) lines.push(f.text, "");
  for (const n of opts.notes) lines.push(`Note: ${n}`);
  return lines.join("\n");
}

/** Digit runs, commas stripped, so "₹1,00,950" and "100950" compare equal. */
export function numberTokens(text: string): string[] {
  return (text.replace(/(\d),(?=\d)/g, "$1").match(/\d+/g) ?? []).filter(Boolean);
}

/**
 * The guard: parse the writer's JSON and refuse an answer whose numbers are
 * not all present in the facts. Two-digit-or-shorter numbers are still
 * checked — "3 children" when the facts say 4 is exactly the error to stop.
 */
export function parseErpAskAnswerJson(text: string, factsText: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const answer = typeof (raw as { answer?: unknown }).answer === "string" ? (raw as { answer: string }).answer.trim() : "";
  if (!answer) return null;
  const allowed = new Set(numberTokens(factsText));
  for (const n of numberTokens(answer)) {
    if (!allowed.has(n)) return null;
  }
  return answer;
}

/** What the desk says when the planner finds nothing to run. */
export function erpAskOutOfScopeReply(allowedTools: ErpAskToolDef[]): string {
  const what = allowedTools.map((t) => t.id.replace("_", " ")).join(", ");
  return `I can answer questions about ${what || "the ERP"} — e.g. _fee collected this week_, _who owes over 90 days_, _class 5 me kitne students_. For anything else, open the ERP or send *help* for the command list.`;
}

/* ── the planner without a model ─────────────────────────────────── */

const TOOL_HINTS: [ErpAskToolId, RegExp][] = [
  ["concessions", /(?<![\p{L}\p{M}])(concession|discount|chhoot|chhut|छूट|रियायत)/iu],
  ["dues_ageing", /(?<![\p{L}\p{M}])(due|dues|owe|owes|owing|baaki|baki|bakaya|बाकी|बकाया|default|defaulter|overdue|pending\s+fee|outstanding|ageing|aging|\d+\s*(din|days?|दिन))/iu],
  ["collections", /(?<![\p{L}\p{M}])(collect|collection|collected|vasool|vasuli|कलेक्शन|वसूली|receipt|(fee|fees|paisa|paise|cash|money)\s+(aaya|aayi|aya|mila|mili|came|received)|kitna\s+(fee|paisa|cash))/iu],
  ["attendance", /(?<![\p{L}\p{M}])(attendance|absent|present|hazir|haziri|हाज़िरी|उपस्थित|अनुपस्थित|upasthit)/iu],
  ["admissions", /(?<![\p{L}\p{M}])(admission|enquir|inquir|lead|प्रवेश|dakhila|दाखिला)/iu],
  ["staff_today", /(?<![\p{L}\p{M}])(staff|teachers?|शिक्षक|स्टाफ)\s+(present|absent|aaye|aaya|nahi\s+aaye|hazir|कितने)/iu],
  ["class_strength", /(?<![\p{L}\p{M}])(students?|bachch[eo]n?|बच्चे|छात्र|strength|enrol|roll\s+strength|kitne\s+(bachche|students))/iu],
];

const CLASS_REF = /(?<![\p{L}\p{M}\p{N}])(?:class|kaksha|कक्षा|std|grade)?\s*((?:nursery|lkg|ukg|pre-?kg|kg|[1-9]|1[0-2]|i{1,3}|iv|v|vi{1,3}|ix|x|xi|xii)\s*-?\s*[a-h]?)(?![\p{L}\p{M}\p{N}])/iu;
const BAND_HINT: [Exclude<ErpAskBand, "all">, RegExp][] = [
  ["over90", /(90|ninety|nabbe|3\s*(months?|mahine|महीने)|teen\s+mahine|तीन\s+महीने)/iu],
  ["d31to90", /(30\s*(?:-|to|se)\s*90|31\s*(?:-|to|se)\s*90|1\s*(?:-|to|se)\s*3\s*months?)/iu],
  ["d0to30", /(this\s+month|is\s+mahine|30\s+days?|30\s+din|under\s+a\s+month)/iu],
];

/**
 * A plan from keywords alone — the fallback when no model is configured or
 * the model was unsure. Narrower than the model (one tool, obvious words)
 * and never a guess: no hint, no plan.
 */
export function deterministicPlan(text: string): ErpAskPlan | null {
  const t = text || "";
  const hit = TOOL_HINTS.find(([, re]) => re.test(t));
  if (!hit) return null;
  const tool: ErpAskPlanTool = { id: hit[0] };
  const period = detectAskPeriod(t);
  if (period && (tool.id === "collections" || tool.id === "admissions" || tool.id === "attendance")) tool.period = period;
  if (tool.id === "dues_ageing") {
    const band = BAND_HINT.find(([, re]) => re.test(t));
    if (band) tool.band = band[0];
  }
  if (tool.id === "dues_ageing" || tool.id === "class_strength") {
    const m = CLASS_REF.exec(t.replace(/\b(90|30|31)\b/g, ""));
    if (m && !/^(i|v|x)$/i.test(m[1]!.trim()) && !/(\d+)\s*(din|days?)/i.test(m[0])) tool.classRef = m[1]!.replace(/\s+/g, "").toUpperCase();
  }
  const language = /[ऀ-ॿ]/.test(t) ? "hi" : /(kitn|kaun|bachch|baaki|aaya|hai|kya|batao|mahine|hafte)/i.test(t) ? "hinglish" : "en";
  return { tools: [tool], language, outOfScope: false, confidence: 0.6 };
}
