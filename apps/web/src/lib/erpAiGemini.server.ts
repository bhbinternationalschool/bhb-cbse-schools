/**
 * Google Gemini — ERP floating assistant (server-only).
 */

import { TENANT } from "@/lib/types";

export function geminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    ""
  ).trim();
}

/**
 * Model per tier. "flash" is the default for every route; "pro" is opted
 * into per call (exam papers, marking schemes — anything where a plausible
 * but wrong answer costs more than the tokens). Both overridable by env so
 * a retired model name is a config change, not a deploy.
 */
export function geminiModel(tier: "flash" | "pro" = "flash"): string {
  if (tier === "pro") {
    return (
      process.env.GEMINI_PRO_MODEL ||
      // Available on the prod key as of 2026-08-18 (see docs/AI_ROADMAP_2026-08.md §1b).
      "gemini-2.5-pro"
    ).trim();
  }
  return (
    process.env.GEMINI_MODEL ||
    process.env.GOOGLE_GEMINI_MODEL ||
    // gemini-2.0/2.5-flash were retired for new users (404 as of 2026-08-18);
    // Google names 3.6-flash as the replacement.
    "gemini-3.6-flash"
  ).trim();
}

export type LlmUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
};

export function geminiConfigured(): boolean {
  return geminiApiKey().length > 0;
}

export type GeminiChatTurn = {
  role: "user" | "model";
  text: string;
};

export async function generateGeminiText(opts: {
  system: string;
  history?: GeminiChatTurn[];
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  /** Explicit model id; defaults to the flash-tier model */
  model?: string;
}): Promise<
  | { ok: true; text: string; model: string; usage: LlmUsage }
  | { ok: false; error: string; model: string }
> {
  const model = (opts.model || geminiModel()).trim();
  const key = geminiApiKey();
  if (!key) {
    return { ok: false, error: "GEMINI_API_KEY not configured", model };
  }

  const version = process.env.GEMINI_API_VERSION || "v1beta";
  const url = `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const contents: { role: string; parts: { text: string }[] }[] = [];
  for (const turn of (opts.history || []).slice(-10)) {
    const text = turn.text.trim();
    if (!text) continue;
    contents.push({
      role: turn.role === "model" ? "model" : "user",
      parts: [{ text }],
    });
  }
  contents.push({ role: "user", parts: [{ text: opts.userMessage.trim() }] });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.system }] },
        contents,
        generationConfig: {
          temperature: opts.temperature ?? 0.35,
          maxOutputTokens: opts.maxTokens ?? 1024,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
        ],
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message || `Gemini HTTP ${res.status}`,
        model,
      };
    }
    const usage: LlmUsage = {
      promptTokens: json.usageMetadata?.promptTokenCount ?? null,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? null,
    };

    const text = (json.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();

    if (!text) {
      return {
        ok: false,
        error: `Empty Gemini response (${json.candidates?.[0]?.finishReason || "unknown"})`,
        model,
      };
    }

    return { ok: true, text: sanitizeGeminiReply(text), model, usage };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Gemini request failed",
      model,
    };
  }
}

/** Trim overly long replies; keep markdown bold for UI. */
function sanitizeGeminiReply(text: string): string {
  let out = text.replace(/\r\n/g, "\n").trim();
  if (out.length > 4000) out = `${out.slice(0, 3990)}…`;
  if (!out.includes(TENANT.shortName) && out.length < 80) {
    /* fine */
  }
  return out;
}

/**
 * One image (or PDF) + instructions → JSON. Used for form / document
 * extraction where Gemini's multimodal input does OCR + structuring in one
 * call. Returns raw text (caller parses); strips a ```json fence if present.
 */
export async function generateGeminiVisionJson(opts: {
  system: string;
  prompt: string;
  /** Raw base64 (no data: prefix) */
  base64: string;
  mimeType: string;
  maxTokens?: number;
  model?: string;
}): Promise<
  | { ok: true; text: string; model: string; usage: LlmUsage }
  | { ok: false; error: string; model: string }
> {
  const model = (opts.model || geminiModel()).trim();
  const key = geminiApiKey();
  if (!key) return { ok: false, error: "GEMINI_API_KEY not configured", model };
  const version = process.env.GEMINI_API_VERSION || "v1beta";
  const url = `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: `${opts.system}\n\nRespond with valid JSON only — no markdown fences.` }] },
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: opts.mimeType, data: opts.base64 } },
              { text: opts.prompt },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: opts.maxTokens ?? 1500, responseMimeType: "application/json" },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message?: string };
    };
    if (!res.ok) return { ok: false, error: json.error?.message || `Gemini HTTP ${res.status}`, model };
    const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) return { ok: false, error: `Empty Gemini response (${json.candidates?.[0]?.finishReason || "unknown"})`, model };
    const m = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    return {
      ok: true,
      text: (m ? m[1] : text).trim(),
      model,
      usage: {
        promptTokens: json.usageMetadata?.promptTokenCount ?? null,
        completionTokens: json.usageMetadata?.candidatesTokenCount ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gemini request failed", model };
  }
}
