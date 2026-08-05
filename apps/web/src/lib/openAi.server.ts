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
