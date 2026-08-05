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

  let lastError = "LLM request failed";

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
      lastError = r.error;
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
    lastError = r.error;
  }

  return { ok: false, error: lastError, engine: "none" };
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

  let lastError = "LLM request failed";

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
        lastError = r.error;
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
        lastError = r.error;
        continue;
      }
      text = stripJsonFence(r.text);
    }

    const parsed = parse(text);
    if (parsed) return { ok: true, data: parsed, engine };
    lastError = "Invalid JSON from LLM";
  }

  return { ok: false, error: lastError, engine: "none" };
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
    geminiMaxTokens: 900,
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
      geminiMaxTokens: 600,
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
      geminiMaxTokens: 500,
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
      geminiMaxTokens: 2000,
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
