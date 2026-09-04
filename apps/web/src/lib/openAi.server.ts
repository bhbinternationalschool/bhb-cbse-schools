import { createSseParser, readOpenAiStreamChunk } from "@/lib/aiStream";
/**
 * OpenAI Chat Completions — server-only (homework tutor, exam paper assist).
 */

export function openAiApiKey(): string {
  return (process.env.OPENAI_API_KEY || "").trim();
}

/** Model per tier — see geminiModel() for the rule. */
export function openAiModel(tier: "flash" | "pro" = "flash"): string {
  if (tier === "pro") {
    return (process.env.OPENAI_PRO_MODEL || "gpt-4o").trim();
  }
  return (process.env.AI_TUTOR_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
}

export type OpenAiUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
};

export function openAiConfigured(): boolean {
  return openAiApiKey().length > 0;
}

export type OpenAiChatTurn = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Same call as generateOpenAiText but token-by-token: `onDelta` gets each
 * slice of the reply as it arrives; the resolved value is the complete
 * reply plus usage (the final chunk carries it with include_usage), so the
 * caller's audit row is identical to the non-streaming path.
 */
export async function streamOpenAiText(
  opts: {
    system: string;
    history?: OpenAiChatTurn[];
    userMessage: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  },
  onDelta: (text: string) => void,
): Promise<
  | { ok: true; text: string; model: string; usage: OpenAiUsage }
  | { ok: false; error: string; model: string }
> {
  const model = (opts.model || openAiModel()).trim();
  const key = openAiApiKey();
  if (!key) {
    return { ok: false, error: "OPENAI_API_KEY not configured", model };
  }
  const messages: { role: string; content: string }[] = [
    { role: "system", content: opts.system },
  ];
  for (const turn of (opts.history || []).slice(-12)) {
    const content = turn.content.trim();
    if (!content) continue;
    messages.push({ role: turn.role, content });
  }
  messages.push({ role: "user", content: opts.userMessage.trim() });

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 1200,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!res.ok || !res.body) {
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return {
        ok: false,
        error: json.error?.message || `OpenAI HTTP ${res.status}`,
        model,
      };
    }
    let text = "";
    let usage: OpenAiUsage = { promptTokens: null, completionTokens: null };
    const parser = createSseParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    const take = (payloads: string[]) => {
      for (const p of payloads) {
        const chunk = readOpenAiStreamChunk(p);
        if (!chunk) continue;
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.text) {
          text += chunk.text;
          onDelta(chunk.text);
        }
        if (chunk.usage) usage = chunk.usage;
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      take(parser.feed(decoder.decode(value, { stream: true })));
    }
    take(parser.feed(decoder.decode()));
    take(parser.flush());
    text = text.trim();
    if (!text) return { ok: false, error: "Empty OpenAI response", model };
    return { ok: true, text, model, usage };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "OpenAI request failed",
      model,
    };
  }
}

export async function generateOpenAiText(opts: {
  system: string;
  history?: OpenAiChatTurn[];
  userMessage: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Explicit model id; defaults to the flash-tier model */
  model?: string;
}): Promise<
  | { ok: true; text: string; model: string; usage: OpenAiUsage }
  | { ok: false; error: string; model: string }
> {
  const model = (opts.model || openAiModel()).trim();
  const key = openAiApiKey();
  if (!key) {
    return { ok: false, error: "OPENAI_API_KEY not configured", model };
  }

  const messages: { role: string; content: string }[] = [
    { role: "system", content: opts.system },
  ];
  for (const turn of (opts.history || []).slice(-12)) {
    const content = turn.content.trim();
    if (!content) continue;
    messages.push({ role: turn.role, content });
  }
  messages.push({ role: "user", content: opts.userMessage.trim() });

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 1200,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message || `OpenAI HTTP ${res.status}`,
        model,
      };
    }

    const text = (json.choices?.[0]?.message?.content || "").trim();
    if (!text) {
      return { ok: false, error: "Empty OpenAI response", model };
    }

    return {
      ok: true,
      text,
      model,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? null,
        completionTokens: json.usage?.completion_tokens ?? null,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "OpenAI request failed",
      model,
    };
  }
}

export type OpenAiVisionJsonResult<T> =
  | { ok: true; data: T; rawText: string }
  | { ok: false; error: string };

/** Vision + JSON mode — e.g. bill/challan OCR. */
export async function generateOpenAiVisionJson<T extends Record<string, unknown>>(opts: {
  system: string;
  imageBase64: string;
  mimeType: string;
  userHint?: string;
  maxTokens?: number;
}): Promise<OpenAiVisionJsonResult<T>> {
  const key = openAiApiKey();
  if (!key) {
    return { ok: false, error: "OPENAI_API_KEY not configured" };
  }

  const mime = opts.mimeType || "image/jpeg";
  const dataUrl = `data:${mime};base64,${opts.imageBase64.replace(/^data:[^;]+;base64,/, "")}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel(),
        messages: [
          { role: "system", content: opts.system },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  opts.userHint ||
                  "Extract structured fields from this bill/challan image. Return JSON only.",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: opts.maxTokens ?? 1500,
        response_format: { type: "json_object" },
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message || `OpenAI HTTP ${res.status}`,
      };
    }

    const rawText = (json.choices?.[0]?.message?.content || "").trim();
    if (!rawText) {
      return { ok: false, error: "Empty OpenAI response" };
    }

    try {
      const data = JSON.parse(rawText) as T;
      return { ok: true, data, rawText };
    } catch {
      return { ok: false, error: "OpenAI returned invalid JSON" };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "OpenAI vision request failed",
    };
  }
}
