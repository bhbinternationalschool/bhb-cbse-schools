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

export function geminiModel(): string {
  return (
    process.env.GEMINI_MODEL ||
    process.env.GOOGLE_GEMINI_MODEL ||
    "gemini-2.0-flash"
  ).trim();
}

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
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = geminiApiKey();
  if (!key) {
    return { ok: false, error: "GEMINI_API_KEY not configured" };
  }

  const model = geminiModel();
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
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message || `Gemini HTTP ${res.status}`,
      };
    }

    const text = (json.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();

    if (!text) {
      return {
        ok: false,
        error: `Empty Gemini response (${json.candidates?.[0]?.finishReason || "unknown"})`,
      };
    }

    return { ok: true, text: sanitizeGeminiReply(text) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Gemini request failed",
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
