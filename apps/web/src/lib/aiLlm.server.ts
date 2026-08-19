/**
 * Route LLM calls — preferred engine first, fallback on API error or bad JSON.
 *
 * Server-only: reads provider keys, the request cookie (requester for the
 * ai_generations audit row) and Supabase. Anything client-side that needs a
 * shared constant from a bot engine must import it from a client-safe module
 * (see waTransportBotPrompts.ts) — never from here.
 */
import "server-only";

import {
  generateGeminiText,
  geminiConfigured,
  geminiModel,
  type LlmUsage,
} from "@/lib/erpAiGemini.server";
import {
  generateOpenAiText,
  openAiConfigured,
  openAiModel,
  type OpenAiChatTurn,
} from "@/lib/openAi.server";
import { getDemoSession } from "@/lib/auth";
import { recordAiGeneration, type AiTier } from "@/lib/aiGenerations.server";
import { checkAiBudget } from "@/lib/aiBudget.server";
import { aiCacheGet, aiCacheKey, aiCachePut } from "@/lib/aiCache.server";
import {
  buildRemarkSystemPrompt,
  buildRemarkUserPrompt,
  parseRemarkDraftsJson,
  type RemarkTone,
  type StudentRemarkDraft,
  type StudentRemarkFacts,
} from "@/lib/reportRemarkAi";
import {
  buildLessonPlanSystemPrompt,
  buildLessonPlanUserPrompt,
  parseLessonPlanJson,
  type LessonPlanAiInput,
  type LessonPlanDraft,
} from "@/lib/lessonPlanAi";
import {
  buildPtmBriefSystemPrompt,
  buildPtmBriefUserPrompt,
  parsePtmBriefJson,
  type PtmBriefDraft,
  type PtmBriefFacts,
  type PtmBriefLanguage,
} from "@/lib/ptmBriefAi";
import {
  buildRiskNoteSystemPrompt,
  buildRiskNoteUserPrompt,
  parseRiskNotesJson,
  type RiskFlag,
  type RiskNoteDraft,
  type RiskNoteLanguage,
  type StudentRiskFacts,
} from "@/lib/academicRisk";
import {
  buildPedagogySystemPrompt,
  buildPedagogyUserPrompt,
  parsePedagogyJson,
  type PedagogyDraft,
  type PedagogyFacts,
} from "@/lib/itemAnalytics";
import {
  buildMinutesSystemPrompt,
  buildMinutesUserPrompt,
  parseMinutesJson,
  type MeetingMinutesDraft,
  type MinutesLanguage,
} from "@/lib/meetingMinutesAi";

export type LlmEngine = "openai" | "gemini" | "none";
export type PreferredEngine = "auto" | "openai" | "gemini";

function preferredEngineEnv(): PreferredEngine {
  const raw = (process.env.AI_PREFERRED_ENGINE || "auto").trim().toLowerCase();
  if (raw === "openai" || raw === "gemini") return raw;
  return "auto";
}

export function resolveEngineOrder(): ("openai" | "gemini")[] {
  const openai = openAiConfigured();
  const gemini = geminiConfigured();
  const pref = preferredEngineEnv();

  if (pref === "openai") {
    const order: ("openai" | "gemini")[] = [];
    if (openai) order.push("openai");
    if (gemini) order.push("gemini");
    return order;
  }
  if (pref === "gemini") {
    const order: ("openai" | "gemini")[] = [];
    if (gemini) order.push("gemini");
    if (openai) order.push("openai");
    return order;
  }
  // auto — OpenAI first when both configured
  const order: ("openai" | "gemini")[] = [];
  if (openai) order.push("openai");
  if (gemini) order.push("gemini");
  return order;
}

export function primaryLlmEngine(): LlmEngine {
  return resolveEngineOrder()[0] ?? "none";
}

function fallbackLlmEngine(): LlmEngine | null {
  const order = resolveEngineOrder();
  return order[1] ?? null;
}

export function llmConfigured(): boolean {
  return resolveEngineOrder().length > 0;
}

export function llmStatus(): {
  openaiConfigured: boolean;
  geminiConfigured: boolean;
  preferredEngine: PreferredEngine;
  primaryEngine: LlmEngine;
  fallbackEngine: LlmEngine | null;
  tutorEngine: LlmEngine;
  examEngine: LlmEngine;
  chatEngine: LlmEngine;
} {
  const openai = openAiConfigured();
  const gemini = geminiConfigured();
  const primary = primaryLlmEngine();
  const fallback = fallbackLlmEngine();
  return {
    openaiConfigured: openai,
    geminiConfigured: gemini,
    preferredEngine: preferredEngineEnv(),
    primaryEngine: primary,
    fallbackEngine: fallback,
    tutorEngine: primary,
    examEngine: primary,
    chatEngine: primary,
  };
}

/**
 * Who/what is asking — recorded on every attempt in ai_generations.
 * `route` is the generator name (usually the /api/ai/<route> path);
 * `promptVersion` bumps whenever the prompt text for that route changes so
 * quality regressions can be tied to a prompt edit; `tier` picks the model
 * class ("pro" only where reasoning matters — see geminiModel()).
 */
export type AiCallMeta = {
  route: string;
  promptVersion: string;
  tier?: AiTier;
  /**
   * Same input → same output is acceptable (certificates, agreements,
   * documents, lesson plans). Personalised generators must leave this off.
   */
  cacheable?: boolean;
};

type LlmTextOpts = {
  system: string;
  history?: OpenAiChatTurn[];
  userMessage: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  geminiMaxTokens?: number;
  geminiTemperature?: number;
  meta: AiCallMeta;
};

/**
 * Best-effort requester for the audit row: the staff session when the call
 * comes from a route handler, "system" from webhooks / cron / anywhere
 * without a request cookie store (cookies() throws there — swallowed).
 */
async function resolveRequester(): Promise<string> {
  try {
    const s = await getDemoSession();
    return s ? s.email || s.fullName || s.persona : "system";
  } catch {
    return "system";
  }
}

type AttemptResult =
  | { ok: true; text: string; model: string; usage: LlmUsage }
  | { ok: false; error: string; model: string };

/** One provider attempt, timed and recorded. */
async function attemptEngine(
  engine: "openai" | "gemini",
  opts: LlmTextOpts,
  requester: string,
): Promise<{ r: AttemptResult; generationId: string }> {
  const tier: AiTier = opts.meta.tier ?? "flash";
  const t0 = Date.now();
  let r: AttemptResult;
  if (engine === "openai") {
    r = await generateOpenAiText({
      system: opts.system,
      history: opts.history,
      userMessage: opts.userMessage,
      jsonMode: opts.jsonMode,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      model: openAiModel(tier),
    });
  } else {
    const geminiSystem = opts.jsonMode
      ? `${opts.system}\n\nRespond with valid JSON only — no markdown fences.`
      : opts.system;
    const g = await generateGeminiText({
      system: geminiSystem,
      history: (opts.history || []).map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        text: h.content,
      })),
      userMessage: opts.userMessage,
      maxTokens: opts.geminiMaxTokens ?? opts.maxTokens,
      temperature: opts.geminiTemperature ?? opts.temperature,
      model: geminiModel(tier),
    });
    r = g.ok
      ? { ...g, text: opts.jsonMode ? stripJsonFence(g.text) : g.text }
      : g;
  }
  const latencyMs = Date.now() - t0;
  const generationId = await recordAiGeneration({
    route: opts.meta.route,
    promptVersion: opts.meta.promptVersion,
    tier,
    engine,
    model: r.model,
    status: r.ok ? "ok" : "error",
    error: r.ok ? "" : r.error,
    inputText: `${opts.system}\n---\n${(opts.history || [])
      .map((h) => `${h.role}: ${h.content}`)
      .join("\n")}\n---\n${opts.userMessage}`,
    outputText: r.ok ? r.text : "",
    promptTokens: r.ok ? r.usage.promptTokens : null,
    completionTokens: r.ok ? r.usage.completionTokens : null,
    latencyMs,
    requester,
  });
  return { r, generationId };
}

function cacheKeyFor(opts: LlmTextOpts): string | null {
  if (!opts.meta.cacheable) return null;
  return aiCacheKey({
    route: opts.meta.route,
    promptVersion: opts.meta.promptVersion,
    tier: opts.meta.tier ?? "flash",
    system: opts.system,
    userMessage: opts.userMessage,
    history: (opts.history || []).map((h) => `${h.role}:${h.content}`).join("|"),
  });
}

async function callLlmText(
  opts: LlmTextOpts,
): Promise<
  | { ok: true; text: string; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const engines = resolveEngineOrder();
  if (!engines.length) {
    return {
      ok: false,
      error: "Set OPENAI_API_KEY or GEMINI_API_KEY on the server",
      engine: "none",
    };
  }
  const key = cacheKeyFor(opts);
  if (key) {
    const hit = await aiCacheGet(key);
    if (hit) {
      return { ok: true, text: hit.response, engine: (hit.engine as LlmEngine) || "none", generationId: hit.generationId };
    }
  }
  const requester = await resolveRequester();
  const budget = await checkAiBudget(requester);
  if (!budget.ok) return { ok: false, error: budget.reason, engine: "none" };
  const errors: string[] = [];

  for (const engine of engines) {
    const { r, generationId } = await attemptEngine(engine, opts, requester);
    if (r.ok) {
      if (key) void aiCachePut({ key, route: opts.meta.route, engine, model: r.model, response: r.text, generationId });
      return { ok: true, text: r.text, engine, generationId };
    }
    errors.push(`${engine}: ${r.error}`);
  }

  return {
    ok: false,
    error: errors.join(" · ") || "LLM request failed",
    engine: "none",
  };
}

async function callLlmJson<T>(
  opts: LlmTextOpts,
  parse: (text: string) => T | null,
): Promise<
  | { ok: true; data: T; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const engines = resolveEngineOrder();
  if (!engines.length) {
    return {
      ok: false,
      error: "Set OPENAI_API_KEY or GEMINI_API_KEY on the server",
      engine: "none",
    };
  }
  const key = cacheKeyFor(opts);
  if (key) {
    const hit = await aiCacheGet(key);
    if (hit) {
      const parsed = parse(hit.response);
      if (parsed) {
        return { ok: true, data: parsed, engine: (hit.engine as LlmEngine) || "none", generationId: hit.generationId };
      }
    }
  }
  const requester = await resolveRequester();
  const budget = await checkAiBudget(requester);
  if (!budget.ok) return { ok: false, error: budget.reason, engine: "none" };
  const errors: string[] = [];

  for (const engine of engines) {
    const { r, generationId } = await attemptEngine(
      engine,
      { ...opts, jsonMode: true },
      requester,
    );
    if (!r.ok) {
      errors.push(`${engine}: ${r.error}`);
      continue;
    }
    const parsed = parse(r.text);
    if (parsed) {
      if (key) void aiCachePut({ key, route: opts.meta.route, engine, model: r.model, response: r.text, generationId });
      return { ok: true, data: parsed, engine, generationId };
    }
    errors.push(`${engine}: invalid JSON in response`);
  }

  return {
    ok: false,
    error: errors.join(" · ") || "LLM request failed",
    engine: "none",
  };
}

function stripJsonFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (m ? m[1] : t).trim();
}

export async function generateTutorText(opts: {
  system: string;
  history?: OpenAiChatTurn[];
  userMessage: string;
}): Promise<
  | { ok: true; text: string; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  return callLlmText({
    system: opts.system,
    history: opts.history,
    userMessage: opts.userMessage,
    maxTokens: 900,
    temperature: 0.45,
    // Gemini 3.x spends part of maxOutputTokens on internal "thinking" before
    // the visible reply — 900 was enough for OpenAI but truncated Gemini's
    // actual answer, so Gemini gets a larger budget for the same reply length.
    geminiMaxTokens: 1536,
    meta: { route: "tutor", promptVersion: "v1" },
  });
}

/**
 * Exam paper draft. Runs on the "pro" tier: a plausible-but-wrong numerical
 * or a marking scheme that doesn't add up costs a teacher more than the
 * tokens (roadmap §1b). Prompt v2 = competency formats + LO tagging.
 */
export async function generateExamPaperJson(opts: {
  system: string;
  userMessage: string;
  promptVersion?: string;
}): Promise<
  | { ok: true; text: string; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  return callLlmText({
    system: opts.system,
    userMessage: opts.userMessage,
    jsonMode: true,
    maxTokens: 6000,
    temperature: 0.55,
    geminiMaxTokens: 8192,
    meta: { route: "exam-paper", promptVersion: opts.promptVersion ?? "v2", tier: "pro" },
  });
}

export async function generateWaTemplateDraftJson(opts: {
  purpose: string;
  module: string;
  language: string;
  layoutKind: string;
}): Promise<
  | { ok: true; body: string; footer: string; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const system = `You draft WhatsApp Business API message templates for Indian CBSE schools.
Use {{variableName}} placeholders (e.g. {{guardianName}}, {{schoolName}}, {{childName}}).
Keep body under 1024 characters. Footer under 60 characters if provided.
Respond with JSON only: {"body":"...","footer":"..."}.`;

  const userMessage = `Purpose: ${opts.purpose}
Module: ${opts.module}
Language: ${opts.language === "hi" ? "Hindi (Devanagari)" : "English"}
Layout: ${opts.layoutKind}
Include 2-4 relevant variables in the body.`;

  const r = await callLlmJson(
    {
      system,
      userMessage,
      maxTokens: 600,
      temperature: 0.5,
      // See generateTutorText — Gemini 3.x needs headroom for internal
      // "thinking" tokens on top of the visible JSON reply, or the JSON
      // comes back truncated/invalid.
      geminiMaxTokens: 2048,
      meta: { route: "wa-template-draft", promptVersion: "v1" },
    },
    parseWaDraftJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI template drafts",
    engine: r.engine,
  };
}

function parseWaDraftJson(
  text: string,
): { body: string; footer: string } | null {
  try {
    const raw = JSON.parse(text) as { body?: string; footer?: string };
    const body = String(raw.body || "").trim();
    if (!body) return null;
    return { body, footer: String(raw.footer || "").trim() };
  } catch {
    return null;
  }
}

/**
 * Draft a personalized fee-defaulter WhatsApp message + phone call script.
 * A draft, not an auto-send — the office reviews/edits before sending, same
 * as every other AI-drafted text in this app (agreements, certificates).
 */
export async function generateCollectionsDraftJson(opts: {
  schoolName: string;
  studentName: string;
  classLabel: string;
  amountLabel: string;
  overdueDaysLabel: string;
  stageLabel: string;
  language: string;
}): Promise<
  | { ok: true; whatsappMessage: string; callScript: string; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const system = `You draft fee-collection outreach for an Indian CBSE school's accounts office.
Write with a firm but respectful, non-threatening tone — the goal is to get the family to pay or come in to talk, not to shame them.
Never invent a due date, policy, or threat that wasn't given to you.
Respond with JSON only: {"whatsappMessage":"...","callScript":"..."}.
whatsappMessage: under 500 characters, WhatsApp-formatted (*bold* with single asterisks), ends with a clear next step.
callScript: 3-5 short spoken lines an office staff member can read out on a phone call — opening, the ask, and a polite close.`;

  const userMessage = `School: ${opts.schoolName}
Student: ${opts.studentName} (${opts.classLabel})
Overdue amount: ${opts.amountLabel}
Overdue: ${opts.overdueDaysLabel}
Stage: ${opts.stageLabel}
Language: ${opts.language === "hi" ? "Hindi (Devanagari)" : "English"}`;

  const r = await callLlmJson(
    {
      system,
      userMessage,
      maxTokens: 500,
      temperature: 0.5,
      // See generateTutorText — Gemini 3.x's internal "thinking" tokens eat
      // into a small budget before the visible JSON reply is produced.
      geminiMaxTokens: 2048,
      meta: { route: "collections-draft", promptVersion: "v1" },
    },
    parseCollectionsDraftJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI collections drafts",
    engine: r.engine,
  };
}

function parseCollectionsDraftJson(
  text: string,
): { whatsappMessage: string; callScript: string } | null {
  try {
    const raw = JSON.parse(text) as {
      whatsappMessage?: string;
      callScript?: string;
    };
    const whatsappMessage = String(raw.whatsappMessage || "").trim();
    const callScript = String(raw.callScript || "").trim();
    if (!whatsappMessage || !callScript) return null;
    return { whatsappMessage, callScript };
  } catch {
    return null;
  }
}

/**
 * Suggest the next-best-action for an admissions lead + draft the outreach
 * message for it. A suggestion, not an auto-send — the counsellor reviews.
 */
export async function generateLeadNextActionJson(opts: {
  schoolName: string;
  childName: string;
  classSoughtLabel: string;
  stageLabel: string;
  sourceLabel: string;
  daysSinceEnquiry: number;
  followUpSummary: string;
  language: string;
}): Promise<
  | { ok: true; nextAction: string; outreachMessage: string; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const system = `You advise a school admissions counsellor on the single next-best action for one enquiry lead, and draft the outreach message for it.
Never invent facts (dates, fees, seat availability) not given to you.
Respond with JSON only: {"nextAction":"...","outreachMessage":"..."}.
nextAction: one short imperative sentence (under 120 characters), e.g. "Call today — no contact since enquiry" or "Send a campus-visit invite".
outreachMessage: a warm, non-pushy WhatsApp message under 400 characters, WhatsApp-formatted (*bold* with single asterisks), ending with a clear next step.`;

  const userMessage = `School: ${opts.schoolName}
Child: ${opts.childName}
Class sought: ${opts.classSoughtLabel}
Stage: ${opts.stageLabel}
Source: ${opts.sourceLabel}
Days since enquiry: ${opts.daysSinceEnquiry}
Follow-up history: ${opts.followUpSummary || "No follow-ups logged yet"}
Language: ${opts.language === "hi" ? "Hindi (Devanagari)" : "English"}`;

  const r = await callLlmJson(
    {
      system,
      userMessage,
      maxTokens: 500,
      temperature: 0.5,
      // See generateTutorText — Gemini 3.x's internal "thinking" tokens eat
      // into a small budget before the visible JSON reply is produced.
      geminiMaxTokens: 2048,
      meta: { route: "lead-next-action", promptVersion: "v1" },
    },
    parseLeadNextActionJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI next-action suggestions",
    engine: r.engine,
  };
}

function parseLeadNextActionJson(
  text: string,
): { nextAction: string; outreachMessage: string } | null {
  try {
    const raw = JSON.parse(text) as {
      nextAction?: string;
      outreachMessage?: string;
    };
    const nextAction = String(raw.nextAction || "").trim();
    const outreachMessage = String(raw.outreachMessage || "").trim();
    if (!nextAction || !outreachMessage) return null;
    return { nextAction, outreachMessage };
  } catch {
    return null;
  }
}

/**
 * Synthesize the day's already-computed KPI numbers into a short narrative
 * digest for a principal/leadership dashboard. The numbers themselves are
 * ground truth supplied by the caller — this only prioritizes and phrases
 * them, it never computes or invents a number of its own.
 */
export async function generateLeadershipDigestJson(opts: {
  schoolName: string;
  metricsSummary: string;
}): Promise<
  | { ok: true; headline: string; highlights: string[]; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const system = `You write a one-paragraph daily digest for a school principal from KPI numbers they give you.
Use ONLY the numbers given — never invent, estimate, or restate a figure that wasn't provided.
Respond with JSON only: {"headline":"...","highlights":["...","..."]}.
headline: one sentence, under 140 characters, the single most important thing today.
highlights: 2-4 short bullet points (each under 100 characters) — prioritize risks/anomalies (low attendance, high dues, overdue follow-ups, low stock) over routine-good numbers.`;

  const userMessage = `School: ${opts.schoolName}
Today's numbers:
${opts.metricsSummary}`;

  const r = await callLlmJson(
    {
      system,
      userMessage,
      maxTokens: 500,
      temperature: 0.4,
      // See generateTutorText — Gemini 3.x's internal "thinking" tokens eat
      // into a small budget before the visible JSON reply is produced.
      geminiMaxTokens: 2048,
      meta: { route: "leadership-digest", promptVersion: "v1" },
    },
    parseLeadershipDigestJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for the AI digest",
    engine: r.engine,
  };
}

function parseLeadershipDigestJson(
  text: string,
): { headline: string; highlights: string[] } | null {
  try {
    const raw = JSON.parse(text) as {
      headline?: string;
      highlights?: unknown;
    };
    const headline = String(raw.headline || "").trim();
    const highlights = Array.isArray(raw.highlights)
      ? raw.highlights.map((h) => String(h || "").trim()).filter(Boolean)
      : [];
    if (!headline || highlights.length === 0) return null;
    return { headline, highlights: highlights.slice(0, 4) };
  } catch {
    return null;
  }
}

export async function generateAutomationSetupJson(opts: {
  ruleName: string;
  description: string;
  module: string;
  hint: string;
}): Promise<
  | {
      ok: true;
      engine: LlmEngine;
      generationId: string;
      audienceSummary: string;
      audienceExplanation: string;
      triggerType?: "schedule" | "interval" | "event";
      cronExpr?: string;
      intervalMinutes?: number;
      eventKey?: string;
      scheduleExplanation?: string;
    }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const system = `You help school ERP staff configure WhatsApp automation rules for Indian CBSE schools.
Respond with JSON only:
{
  "audienceSummary": "short label under 80 chars for approval queue",
  "audienceExplanation": "one sentence plain English",
  "triggerType": "schedule" | "interval" | "event",
  "cronExpr": "5-field cron if schedule e.g. 0 10 * * 1-6 for 10:00 Mon-Sat",
  "intervalMinutes": number if interval e.g. 240,
  "eventKey": "dotted.key if event e.g. homework.published",
  "scheduleExplanation": "plain English when it runs"
}
Use IST. Prefer schedule for daily reminders, interval for follow-up scans, event for instant triggers.
Known events: attendance.absent_marked, homework.published, exams.datesheet_published, ptm.opened, leave.decided, comms.notice_published, campaign.due`;

  const userMessage = `Rule: ${opts.ruleName}
Module: ${opts.module}
Description: ${opts.description || "(none)"}
Staff request: ${opts.hint}`;

  function parseSetup(text: string) {
    try {
      const raw = JSON.parse(stripJsonFence(text)) as {
        audienceSummary?: string;
        audienceExplanation?: string;
        triggerType?: string;
        cronExpr?: string;
        intervalMinutes?: number;
        eventKey?: string;
        scheduleExplanation?: string;
      };
      const audienceSummary = String(raw.audienceSummary || "").trim();
      if (!audienceSummary) return null;
      const triggerType: "schedule" | "interval" | "event" | undefined =
        raw.triggerType === "interval"
          ? "interval"
          : raw.triggerType === "event"
            ? "event"
            : raw.triggerType === "schedule"
              ? "schedule"
              : undefined;
      return {
        audienceSummary,
        audienceExplanation: String(raw.audienceExplanation || "").trim(),
        triggerType,
        cronExpr: String(raw.cronExpr || "").trim() || undefined,
        intervalMinutes: Number.isFinite(raw.intervalMinutes)
          ? Number(raw.intervalMinutes)
          : undefined,
        eventKey: String(raw.eventKey || "").trim() || undefined,
        scheduleExplanation:
          String(raw.scheduleExplanation || "").trim() || undefined,
      };
    } catch {
      return null;
    }
  }

  const r = await callLlmJson(
    {
      system,
      userMessage,
      maxTokens: 500,
      temperature: 0.4,
      // See generateTutorText — Gemini 3.x's internal "thinking" tokens eat
      // into a small budget before the visible JSON reply is produced.
      geminiMaxTokens: 2048,
      meta: { route: "automation-setup", promptVersion: "v1" },
    },
    parseSetup,
  );

  if (r.ok) return { ok: true, engine: r.engine, generationId: r.generationId, ...r.data };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI automation helper",
    engine: r.engine,
  };
}

export type SchoolDocumentText = {
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  subject: string;
};

function parseSchoolDocumentJson(text: string): SchoolDocumentText | null {
  try {
    const raw = JSON.parse(stripJsonFence(text)) as Partial<SchoolDocumentText>;
    const titleEn = String(raw.titleEn || "").trim();
    const bodyEn = String(raw.bodyEn || "").trim();
    const bodyHi = String(raw.bodyHi || "").trim();
    if (!titleEn && !bodyEn && !bodyHi) return null;
    return {
      titleEn,
      titleHi: String(raw.titleHi || "").trim(),
      bodyEn,
      bodyHi,
      subject: String(raw.subject || "").trim(),
    };
  } catch {
    return null;
  }
}

export async function generateSchoolDocumentText(opts: {
  system: string;
  userMessage: string;
}): Promise<
  | { ok: true; doc: SchoolDocumentText; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: opts.system,
      userMessage: opts.userMessage,
      maxTokens: 2000,
      temperature: 0.45,
      // See generateTutorText — give Gemini 3.x headroom over its internal
      // "thinking" tokens on top of a document-length JSON reply.
      geminiMaxTokens: 3072,
      meta: { route: "school-document", promptVersion: "v1", cacheable: true },
    },
    parseSchoolDocumentJson,
  );

  if (r.ok) return { ok: true, doc: r.data, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI document maker",
    engine: r.engine,
  };
}

export type StaffAgreementAiText = {
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
};

export type StudentCertificateAiText = StaffAgreementAiText & {
  remarks: string;
  tcSubjectsStudied: string;
  tcGamesActivities: string;
  tcAnnualExamResult: string;
};

function parseStaffAgreementAiJson(text: string): StaffAgreementAiText | null {
  try {
    const raw = JSON.parse(stripJsonFence(text)) as Partial<StaffAgreementAiText>;
    const bodyEn = String(raw.bodyEn || "").trim();
    const bodyHi = String(raw.bodyHi || "").trim();
    if (!bodyEn && !bodyHi) return null;
    return {
      titleEn: String(raw.titleEn || "").trim(),
      titleHi: String(raw.titleHi || "").trim(),
      bodyEn,
      bodyHi,
    };
  } catch {
    return null;
  }
}

/** CBSE staff agreement — longer output than generic school documents. */
export async function generateStaffAgreementText(opts: {
  system: string;
  userMessage: string;
}): Promise<
  | { ok: true; doc: StaffAgreementAiText; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: opts.system,
      userMessage: opts.userMessage,
      maxTokens: 8000,
      temperature: 0.4,
      geminiMaxTokens: 8000,
      meta: { route: "staff-agreement", promptVersion: "v1", cacheable: true },
    },
    parseStaffAgreementAiJson,
  );

  if (r.ok) return { ok: true, doc: r.data, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI agreement drafting",
    engine: r.engine,
  };
}

function parseStudentCertificateAiJson(text: string): StudentCertificateAiText | null {
  try {
    const raw = JSON.parse(stripJsonFence(text)) as Partial<StudentCertificateAiText>;
    const bodyEn = String(raw.bodyEn || "").trim();
    const bodyHi = String(raw.bodyHi || "").trim();
    if (!bodyEn && !bodyHi) return null;
    return {
      titleEn: String(raw.titleEn || "").trim(),
      titleHi: String(raw.titleHi || "").trim(),
      bodyEn,
      bodyHi,
      remarks: String(raw.remarks || "").trim(),
      tcSubjectsStudied: String(raw.tcSubjectsStudied || "").trim(),
      tcGamesActivities: String(raw.tcGamesActivities || "").trim(),
      tcAnnualExamResult: String(raw.tcAnnualExamResult || "").trim(),
    };
  } catch {
    return null;
  }
}

/** CBSE / UP Basic Education student certificate AI text. */
export async function generateStudentCertificateText(opts: {
  system: string;
  userMessage: string;
}): Promise<
  | { ok: true; doc: StudentCertificateAiText; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: opts.system,
      userMessage: opts.userMessage,
      maxTokens: 6000,
      temperature: 0.4,
      geminiMaxTokens: 6000,
      meta: { route: "student-certificate", promptVersion: "v1", cacheable: true },
    },
    parseStudentCertificateAiJson,
  );

  if (r.ok) return { ok: true, doc: r.data, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI certificate drafting",
    engine: r.engine,
  };
}

/**
 * Homework OCR grading assist — reads OCR'd text from a photographed
 * submission and drafts a completeness note + feedback comment for the
 * teacher to review before acknowledging. A draft, not an auto-grade —
 * homework has no numeric marks, so this never assigns a score.
 */
export async function generateHomeworkGradingAssistJson(opts: {
  assignmentTitle: string;
  subjectLabel?: string;
  referenceAnswer?: string;
  extractedText: string;
  studentLabel: string;
}): Promise<
  | {
      ok: true;
      completeness: "complete" | "partial" | "unclear";
      feedbackDraft: string;
      engine: LlmEngine;
      generationId: string;
    }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const system = `You help a teacher at an Indian CBSE school review a student's handwritten homework, already OCR-scanned from a photo.
Only use the OCR text given — handwriting OCR is imperfect, so judge generously and note when text looks garbled/cut off rather than assuming the student got it wrong.
${
  opts.referenceAnswer
    ? "A reference answer/rubric is given — compare the OCR text against it and judge completeness against those specific points, never against outside knowledge of the subject."
    : "No reference answer was given — only assess whether the response looks complete and legible, do not judge correctness of content you have no rubric for."
}
Respond with JSON only: {"completeness":"complete"|"partial"|"unclear","feedbackDraft":"..."}.
completeness: "unclear" if the OCR text is too garbled/short to judge, "partial" if it's readable but visibly incomplete or missing points from the rubric, "complete" otherwise.
feedbackDraft: 1-2 short sentences a teacher could paste as a comment to the student — specific and encouraging, never invent an error not evidenced in the text.`;

  const userMessage = `Assignment: ${opts.assignmentTitle}${opts.subjectLabel ? ` (${opts.subjectLabel})` : ""}
Student: ${opts.studentLabel}
${opts.referenceAnswer ? `Reference answer/rubric:\n${opts.referenceAnswer}\n` : ""}
OCR text from the submitted photo:
${opts.extractedText}`;

  const r = await callLlmJson(
    {
      system,
      userMessage,
      maxTokens: 500,
      temperature: 0.4,
      // See generateTutorText — Gemini 3.x's internal "thinking" tokens eat
      // into a small budget before the visible JSON reply is produced.
      geminiMaxTokens: 2048,
      meta: { route: "homework-grading-assist", promptVersion: "v1" },
    },
    parseHomeworkGradingAssistJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI grading assist",
    engine: r.engine,
  };
}

function parseHomeworkGradingAssistJson(
  text: string,
): { completeness: "complete" | "partial" | "unclear"; feedbackDraft: string } | null {
  try {
    const raw = JSON.parse(text) as {
      completeness?: string;
      feedbackDraft?: string;
    };
    const feedbackDraft = String(raw.feedbackDraft || "").trim();
    if (!feedbackDraft) return null;
    const completeness =
      raw.completeness === "complete" || raw.completeness === "partial"
        ? raw.completeness
        : "unclear";
    return { completeness, feedbackDraft };
  } catch {
    return null;
  }
}

/**
 * Plain-language summary of an already-decided, already-saved teacher
 * time-block + substitution outcome — for the office/principal. Read-only:
 * never suggests who could cover an uncovered period, never invents a
 * teacher/subject/reason not present in the input. All labels (teacher,
 * class, subject names) must already be resolved by the caller — this
 * never receives raw ids.
 */
export async function generateSubstitutionSummaryJson(opts: {
  teacherLabel: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  covered: { periodLabel: string; classSection: string; subject: string; substituteName: string }[];
  uncovered: { periodLabel: string; classSection: string; subject: string }[];
}): Promise<
  | { ok: true; summary: string; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const system = `You write a short, plain-language note for a school office/principal, summarizing a substitute-teacher arrangement that has ALREADY been decided and saved by the system.
Only use the facts given below — never invent a teacher, subject, class, or reason that isn't in the input, and never suggest who could cover an uncovered period (that decision is already made elsewhere).
Respond with JSON only: {"summary":"..."}.
summary: 2-4 short plain sentences. Mention the teacher, the reason, the time window, how many periods were covered and by whom (briefly), and call out any uncovered periods plainly if present.`;

  const coveredLines = opts.covered.length
    ? opts.covered
        .map(
          (c) =>
            `- ${c.periodLabel} · ${c.classSection} · ${c.subject} → covered by ${c.substituteName}`,
        )
        .join("\n")
    : "(none)";
  const uncoveredLines = opts.uncovered.length
    ? opts.uncovered
        .map((c) => `- ${c.periodLabel} · ${c.classSection} · ${c.subject}`)
        .join("\n")
    : "(none)";

  const userMessage = `Teacher: ${opts.teacherLabel}
Date: ${opts.date}, ${opts.startTime}–${opts.endTime}
Reason: ${opts.reason}

Covered periods:
${coveredLines}

Uncovered periods:
${uncoveredLines}`;

  const r = await callLlmJson(
    {
      system,
      userMessage,
      maxTokens: 500,
      temperature: 0.4,
      geminiMaxTokens: 2048,
      meta: { route: "substitution-summary", promptVersion: "v1" },
    },
    parseSubstitutionSummaryJson,
  );

  if (r.ok) return { ok: true, summary: r.data.summary, engine: r.engine, generationId: r.generationId };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI summary",
    engine: r.engine,
  };
}

function parseSubstitutionSummaryJson(text: string): { summary: string } | null {
  try {
    const raw = JSON.parse(text) as { summary?: string };
    const summary = String(raw.summary || "").trim();
    if (!summary) return null;
    return { summary };
  } catch {
    return null;
  }
}

/**
 * Report-card remarks for a batch of students (≤ REMARK_STUDENTS_PER_LLM_CALL
 * per call — the route chunks). English only; Hindi is produced afterwards
 * by the Sarvam translation layer (or, if that is not configured, by a
 * second LLM pass) so both languages always say the same thing. Returns
 * drafts — nothing here is persisted.
 */
export async function generateReportRemarksJson(opts: {
  students: StudentRemarkFacts[];
  tone: RemarkTone;
  includeSubjectRemarks: boolean;
  schoolName: string;
}): Promise<
  | { ok: true; drafts: StudentRemarkDraft[]; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const ids = opts.students.map((s) => s.studentId);
  const r = await callLlmJson(
    {
      system: buildRemarkSystemPrompt({
        tone: opts.tone,
        includeSubjectRemarks: opts.includeSubjectRemarks,
        schoolName: opts.schoolName,
      }),
      userMessage: buildRemarkUserPrompt(opts.students),
      // ~120 tokens per student for overall + subject phrases, with headroom.
      maxTokens: Math.min(4000, 400 + opts.students.length * 220),
      temperature: 0.6,
      // Gemini 3.x thinking tokens share the budget with the visible reply.
      geminiMaxTokens: Math.min(8192, 2048 + opts.students.length * 400),
      meta: { route: "report-remarks", promptVersion: "v1" },
    },
    (text) => parseRemarkDraftsJson(text, ids),
  );
  if (r.ok) {
    return { ok: true, drafts: r.data, engine: r.engine, generationId: r.generationId };
  }
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI remarks",
    engine: r.engine,
  };
}

/** Hindi rendering of finished English remarks when Sarvam is unavailable —
 * translation only, the model is told not to add or drop content. */
export async function translateRemarksToHindiJson(opts: {
  items: { id: string; text: string }[];
}): Promise<
  | { ok: true; items: { id: string; text: string }[]; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const system = `You translate school report-card remarks from English to Hindi (Devanagari) for parents at an Indian CBSE school. Translate faithfully — same meaning, same length, formal register (आप), no additions, no omissions, keep subject names in Hindi where a standard Hindi name exists (गणित, विज्ञान, अंग्रेज़ी, हिंदी, सामाजिक विज्ञान) and otherwise as given.
Respond with JSON only: {"items":[{"id":"...","text":"..."}]} — every id given, same order.`;
  const userMessage = opts.items
    .map((i) => `id: ${i.id}\n${i.text}`)
    .join("\n\n");
  const ids = new Set(opts.items.map((i) => i.id));
  const r = await callLlmJson(
    {
      system,
      userMessage,
      maxTokens: Math.min(4000, 300 + opts.items.length * 200),
      temperature: 0.2,
      geminiMaxTokens: Math.min(8192, 2048 + opts.items.length * 300),
      meta: { route: "report-remarks-hi", promptVersion: "v1" },
    },
    (text) => {
      try {
        const raw = JSON.parse(text) as { items?: { id?: unknown; text?: unknown }[] };
        if (!Array.isArray(raw.items)) return null;
        const items = raw.items
          .map((x) => ({ id: String(x?.id ?? "").trim(), text: String(x?.text ?? "").trim() }))
          .filter((x) => x.id && x.text && ids.has(x.id));
        return items.length ? items : null;
      } catch {
        return null;
      }
    },
  );
  if (r.ok) return { ok: true, items: r.data, engine: r.engine, generationId: r.generationId };
  return { ok: false, error: r.error, engine: r.engine };
}

/**
 * One lesson-plan draft from the syllabus units the teacher ticked. Returns
 * the draft only — the editor shows it, the teacher saves it (or not) and
 * `LessonPlan.source` records provenance.
 */
export async function generateLessonPlanJson(opts: {
  input: LessonPlanAiInput;
  schoolName: string;
}): Promise<
  | { ok: true; draft: LessonPlanDraft; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: buildLessonPlanSystemPrompt({
        language: opts.input.language,
        schoolName: opts.schoolName,
      }),
      userMessage: buildLessonPlanUserPrompt(opts.input),
      // Activities grow with periods; Hindi is ~1.6× the tokens of English.
      maxTokens: Math.min(
        4000,
        (900 + opts.input.periods * 250) * (opts.input.language === "hi" ? 1.6 : 1),
      ),
      temperature: 0.5,
      geminiMaxTokens: Math.min(8192, 3000 + opts.input.periods * 400),
      meta: { route: "lesson-plan", promptVersion: "v1", cacheable: true },
    },
    parseLessonPlanJson,
  );
  if (r.ok) {
    return { ok: true, draft: r.data, engine: r.engine, generationId: r.generationId };
  }
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI lesson plans",
    engine: r.engine,
  };
}

/** Three-paragraph PTM brief for one student. Draft only — nothing saved. */
export async function generatePtmBriefJson(opts: {
  facts: PtmBriefFacts;
  language: PtmBriefLanguage;
  schoolName: string;
}): Promise<
  | { ok: true; draft: PtmBriefDraft; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: buildPtmBriefSystemPrompt({
        language: opts.language,
        schoolName: opts.schoolName,
      }),
      userMessage: buildPtmBriefUserPrompt(opts.facts),
      maxTokens: opts.language === "hi" ? 1600 : 1000,
      temperature: 0.5,
      geminiMaxTokens: 4096,
      meta: { route: "ptm-student-brief", promptVersion: "v1" },
    },
    parsePtmBriefJson,
  );
  if (r.ok) {
    return { ok: true, draft: r.data, engine: r.engine, generationId: r.generationId };
  }
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI PTM briefs",
    engine: r.engine,
  };
}

/** "What to do" notes for a batch of rule-flagged students. Draft only. */
export async function generateRiskNotesJson(opts: {
  students: (StudentRiskFacts & { flags: RiskFlag[] })[];
  language: RiskNoteLanguage;
  schoolName: string;
}): Promise<
  | { ok: true; notes: RiskNoteDraft[]; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const ids = opts.students.map((s) => s.studentId);
  const r = await callLlmJson(
    {
      system: buildRiskNoteSystemPrompt({ language: opts.language, schoolName: opts.schoolName }),
      userMessage: buildRiskNoteUserPrompt(opts.students),
      maxTokens: Math.min(4000, 300 + opts.students.length * (opts.language === "hi" ? 260 : 170)),
      temperature: 0.5,
      geminiMaxTokens: Math.min(8192, 2048 + opts.students.length * 400),
      meta: { route: "at-risk-notes", promptVersion: "v1" },
    },
    (text) => parseRiskNotesJson(text, ids),
  );
  if (r.ok) return { ok: true, notes: r.data, engine: r.engine, generationId: r.generationId };
  return { ok: false, error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI notes", engine: r.engine };
}

/** Teaching moves from item-score roll-ups. Draft only. */
export async function generatePedagogyJson(opts: {
  facts: PedagogyFacts;
  language: "en" | "hi";
  schoolName: string;
}): Promise<
  | { ok: true; draft: PedagogyDraft; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: buildPedagogySystemPrompt({ language: opts.language, schoolName: opts.schoolName }),
      userMessage: buildPedagogyUserPrompt(opts.facts),
      maxTokens: opts.language === "hi" ? 1400 : 900,
      temperature: 0.5,
      geminiMaxTokens: 4096,
      meta: { route: "pedagogy-suggestions", promptVersion: "v1" },
    },
    parsePedagogyJson,
  );
  if (r.ok) return { ok: true, draft: r.data, engine: r.engine, generationId: r.generationId };
  return { ok: false, error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI suggestions", engine: r.engine };
}

/** Formal minutes from raw notes / transcript. Draft only. */
export async function generateMeetingMinutesJson(opts: {
  title: string;
  date: string;
  attendees: string;
  notes: string;
  language: MinutesLanguage;
  schoolName: string;
}): Promise<
  | { ok: true; draft: MeetingMinutesDraft; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: buildMinutesSystemPrompt({ language: opts.language, schoolName: opts.schoolName }),
      userMessage: buildMinutesUserPrompt(opts),
      // Long transcripts → long minutes; Hindi doubles the output.
      maxTokens: opts.language === "en" ? 3000 : 4000,
      temperature: 0.3,
      geminiMaxTokens: 8192,
      meta: { route: "meeting-minutes", promptVersion: "v1" },
    },
    parseMinutesJson,
  );
  if (r.ok) return { ok: true, draft: r.data, engine: r.engine, generationId: r.generationId };
  return { ok: false, error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI minutes", engine: r.engine };
}

/**
 * Parent WhatsApp bot fallback with a hard grounding gate: the model must
 * say whether its reply is grounded in the household data / notices it was
 * given. Ungrounded → the caller sends the fixed "reply HUMAN" text and
 * escalates the thread; the model's own words never reach the parent.
 */
export async function generateParentBotReplyJson(opts: {
  system: string;
  userMessage: string;
}): Promise<
  | { ok: true; grounded: boolean; reply: string; engine: LlmEngine; generationId: string }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: `${opts.system}\n\nRespond with JSON only: {"grounded": true|false, "reply": "…"}. grounded=true ONLY if every fact in reply comes from the household data or notices given; if the parent asked something those do not answer, set grounded=false and put a short "please reply HUMAN" message in reply.`,
      userMessage: opts.userMessage,
      maxTokens: 400,
      temperature: 0.3,
      geminiMaxTokens: 1024,
      meta: { route: "wa-parent-bot", promptVersion: "v2" },
    },
    (text) => {
      try {
        const j = JSON.parse(text) as { grounded?: unknown; reply?: unknown };
        const reply = String(j.reply ?? "").trim();
        if (!reply) return null;
        return { grounded: j.grounded === true, reply: reply.slice(0, 600) };
      } catch {
        return null;
      }
    },
  );
  if (r.ok) return { ok: true, grounded: r.data.grounded, reply: r.data.reply, engine: r.engine, generationId: r.generationId };
  return { ok: false, error: r.error, engine: r.engine };
}
