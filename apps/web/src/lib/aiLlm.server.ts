/**
 * Route LLM calls — preferred engine first, fallback on API error or bad JSON.
 */

import { generateGeminiText, geminiConfigured } from "@/lib/erpAiGemini.server";
import {
  generateOpenAiText,
  openAiConfigured,
  type OpenAiChatTurn,
} from "@/lib/openAi.server";

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

type LlmTextOpts = {
  system: string;
  history?: OpenAiChatTurn[];
  userMessage: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  geminiMaxTokens?: number;
  geminiTemperature?: number;
};

async function callLlmText(
  opts: LlmTextOpts,
): Promise<
  | { ok: true; text: string; engine: LlmEngine }
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

  const errors: string[] = [];

  for (const engine of engines) {
    if (engine === "openai") {
      const r = await generateOpenAiText({
        system: opts.system,
        history: opts.history,
        userMessage: opts.userMessage,
        jsonMode: opts.jsonMode,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      });
      if (r.ok) return { ...r, engine: "openai" };
      errors.push(`openai: ${r.error}`);
      continue;
    }

    const geminiSystem = opts.jsonMode
      ? `${opts.system}\n\nRespond with valid JSON only — no markdown fences.`
      : opts.system;
    const r = await generateGeminiText({
      system: geminiSystem,
      history: (opts.history || []).map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        text: h.content,
      })),
      userMessage: opts.userMessage,
      maxTokens: opts.geminiMaxTokens ?? opts.maxTokens,
      temperature: opts.geminiTemperature ?? opts.temperature,
    });
    if (r.ok) {
      const text = opts.jsonMode ? stripJsonFence(r.text) : r.text;
      return { ok: true, text, engine: "gemini" };
    }
    errors.push(`gemini: ${r.error}`);
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
  | { ok: true; data: T; engine: LlmEngine }
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

  const errors: string[] = [];

  for (const engine of engines) {
    let text: string | null = null;

    if (engine === "openai") {
      const r = await generateOpenAiText({
        system: opts.system,
        history: opts.history,
        userMessage: opts.userMessage,
        jsonMode: true,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      });
      if (!r.ok) {
        errors.push(`openai: ${r.error}`);
        continue;
      }
      text = r.text;
    } else {
      const r = await generateGeminiText({
        system: `${opts.system}\n\nRespond with valid JSON only — no markdown fences.`,
        history: (opts.history || []).map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          text: h.content,
        })),
        userMessage: opts.userMessage,
        maxTokens: opts.geminiMaxTokens ?? opts.maxTokens,
        temperature: opts.geminiTemperature ?? opts.temperature,
      });
      if (!r.ok) {
        errors.push(`gemini: ${r.error}`);
        continue;
      }
      text = stripJsonFence(r.text);
    }

    const parsed = parse(text);
    if (parsed) return { ok: true, data: parsed, engine };
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
  | { ok: true; text: string; engine: LlmEngine }
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
  });
}

export async function generateExamPaperJson(opts: {
  system: string;
  userMessage: string;
}): Promise<
  | { ok: true; text: string; engine: LlmEngine }
  | { ok: false; error: string; engine: LlmEngine }
> {
  return callLlmText({
    system: opts.system,
    userMessage: opts.userMessage,
    jsonMode: true,
    maxTokens: 4096,
    temperature: 0.55,
    geminiMaxTokens: 4096,
  });
}

export async function generateWaTemplateDraftJson(opts: {
  purpose: string;
  module: string;
  language: string;
  layoutKind: string;
}): Promise<
  | { ok: true; body: string; footer: string; engine: LlmEngine }
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
    },
    parseWaDraftJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine };
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
  | { ok: true; whatsappMessage: string; callScript: string; engine: LlmEngine }
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
    },
    parseCollectionsDraftJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine };
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
  | { ok: true; nextAction: string; outreachMessage: string; engine: LlmEngine }
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
    },
    parseLeadNextActionJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine };
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
  | { ok: true; headline: string; highlights: string[]; engine: LlmEngine }
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
    },
    parseLeadershipDigestJson,
  );

  if (r.ok) return { ok: true, ...r.data, engine: r.engine };
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
    },
    parseSetup,
  );

  if (r.ok) return { ok: true, engine: r.engine, ...r.data };
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
  | { ok: true; doc: SchoolDocumentText; engine: LlmEngine }
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
    },
    parseSchoolDocumentJson,
  );

  if (r.ok) return { ok: true, doc: r.data, engine: r.engine };
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
  | { ok: true; doc: StaffAgreementAiText; engine: LlmEngine }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: opts.system,
      userMessage: opts.userMessage,
      maxTokens: 8000,
      temperature: 0.4,
      geminiMaxTokens: 8000,
    },
    parseStaffAgreementAiJson,
  );

  if (r.ok) return { ok: true, doc: r.data, engine: r.engine };
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
  | { ok: true; doc: StudentCertificateAiText; engine: LlmEngine }
  | { ok: false; error: string; engine: LlmEngine }
> {
  const r = await callLlmJson(
    {
      system: opts.system,
      userMessage: opts.userMessage,
      maxTokens: 6000,
      temperature: 0.4,
      geminiMaxTokens: 6000,
    },
    parseStudentCertificateAiJson,
  );

  if (r.ok) return { ok: true, doc: r.data, engine: r.engine };
  return {
    ok: false,
    error: r.error || "Set OPENAI_API_KEY or GEMINI_API_KEY for AI certificate drafting",
    engine: r.engine,
  };
}
