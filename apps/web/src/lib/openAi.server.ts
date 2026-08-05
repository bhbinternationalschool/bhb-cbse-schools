/**
 * OpenAI Chat Completions — server-only (homework tutor, exam paper assist).
 */

export function openAiApiKey(): string {
  return (process.env.OPENAI_API_KEY || "").trim();
}

export function openAiModel(): string {
  return (process.env.AI_TUTOR_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
}

export function openAiConfigured(): boolean {
  return openAiApiKey().length > 0;
}

export type OpenAiChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export async function generateOpenAiText(opts: {
  system: string;
  history?: OpenAiChatTurn[];
  userMessage: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = openAiApiKey();
  if (!key) {
    return { ok: false, error: "OPENAI_API_KEY not configured" };
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
        model: openAiModel(),
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 1200,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
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

    const text = (json.choices?.[0]?.message?.content || "").trim();
    if (!text) {
      return { ok: false, error: "Empty OpenAI response" };
    }

    return { ok: true, text };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "OpenAI request failed",
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
