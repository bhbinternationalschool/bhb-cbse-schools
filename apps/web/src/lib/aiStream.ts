/**
 * Server-sent-events plumbing for the streaming chat routes — pure, no
 * server imports, so the parser is shared by the browser clients and the
 * provider readers and can be self-tested without a network.
 *
 * Wire format (one event per line pair, `data:` only):
 *   data: {"type":"delta","text":"..."}      ← a slice of the reply, in order
 *   data: {"type":"done", ...payload}        ← the reply is complete
 *   data: {"type":"error","error":"..."}     ← the reply cannot be completed
 *
 * A `done` after deltas carries the full reply too, so a client that missed
 * a chunk (or a non-streaming caller) can always trust the final event.
 */

export type AiStreamEvent<TDone extends object = Record<string, unknown>> =
  | { type: "delta"; text: string }
  | ({ type: "done" } & TDone)
  | { type: "error"; error: string };

export function encodeSseEvent(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Incremental parser for a text/event-stream body. Feed it decoded chunks
 * in arrival order; it returns every complete `data:` payload and holds
 * back a partial trailing line until the next chunk completes it.
 *
 * Handles the three things real providers do: multi-line events joined by
 * `\n`, `\r\n` line endings, and the literal `[DONE]` sentinel OpenAI sends.
 */
export function createSseParser(): {
  feed: (chunk: string) => string[];
  flush: () => string[];
} {
  let buffer = "";
  let dataLines: string[] = [];

  const closeEvent = (out: string[]) => {
    if (dataLines.length) {
      out.push(dataLines.join("\n"));
      dataLines = [];
    }
  };

  const consume = (line: string, out: string[]) => {
    if (line === "") {
      closeEvent(out);
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    // event:/id:/retry: fields are not used by anything here.
  };

  return {
    feed(chunk: string) {
      const out: string[] = [];
      buffer += chunk.replace(/\r\n/g, "\n");
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        consume(buffer.slice(0, nl), out);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
      }
      return out;
    },
    flush() {
      const out: string[] = [];
      if (buffer) {
        consume(buffer, out);
        buffer = "";
      }
      closeEvent(out);
      return out;
    },
  };
}

/** Parse one `data:` payload from our own routes; null for anything else. */
export function parseAiStreamEvent<TDone extends object>(
  payload: string,
): AiStreamEvent<TDone> | null {
  if (!payload || payload === "[DONE]") return null;
  try {
    const j = JSON.parse(payload) as { type?: unknown };
    if (j.type === "delta" || j.type === "done" || j.type === "error") {
      return j as AiStreamEvent<TDone>;
    }
  } catch {
    /* not ours */
  }
  return null;
}

/**
 * Text of one OpenAI chat-completions stream chunk, plus usage when the
 * final chunk carries it (`stream_options.include_usage`).
 */
export function readOpenAiStreamChunk(payload: string): {
  text: string;
  usage?: { promptTokens: number | null; completionTokens: number | null };
  error?: string;
} | null {
  if (payload === "[DONE]") return null;
  let j: {
    choices?: { delta?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    error?: { message?: string };
  };
  try {
    j = JSON.parse(payload);
  } catch {
    return null;
  }
  if (j.error) return { text: "", error: j.error.message || "OpenAI stream error" };
  const text = j.choices?.[0]?.delta?.content ?? "";
  const out: ReturnType<typeof readOpenAiStreamChunk> = { text };
  if (j.usage) {
    out!.usage = {
      promptTokens: j.usage.prompt_tokens ?? null,
      completionTokens: j.usage.completion_tokens ?? null,
    };
  }
  return out;
}

/** Text of one Gemini streamGenerateContent (alt=sse) chunk. */
export function readGeminiStreamChunk(payload: string): {
  text: string;
  finishReason?: string;
  usage?: { promptTokens: number | null; completionTokens: number | null };
  error?: string;
} | null {
  let j: {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    error?: { message?: string };
  };
  try {
    j = JSON.parse(payload);
  } catch {
    return null;
  }
  if (j.error) return { text: "", error: j.error.message || "Gemini stream error" };
  const c = j.candidates?.[0];
  const text = (c?.content?.parts || []).map((p) => p.text || "").join("");
  const out: ReturnType<typeof readGeminiStreamChunk> = { text };
  if (c?.finishReason) out!.finishReason = c.finishReason;
  if (j.usageMetadata) {
    out!.usage = {
      promptTokens: j.usageMetadata.promptTokenCount ?? null,
      completionTokens: j.usageMetadata.candidatesTokenCount ?? null,
    };
  }
  return out;
}

/**
 * Browser side: read a streaming Response from one of our routes and call
 * back per event. Resolves once the body closes. A response that is not an
 * event stream (an error JSON, say) is surfaced as one `error` event so
 * callers have a single code path.
 */
export async function consumeAiStream<TDone extends object>(
  res: Response,
  onEvent: (event: AiStreamEvent<TDone>) => void,
): Promise<void> {
  const type = res.headers.get("content-type") || "";
  if (!res.body || !type.includes("text/event-stream")) {
    let error = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) error = j.error;
    } catch {
      /* not JSON */
    }
    onEvent({ type: "error", error });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const emit = (payloads: string[]) => {
    for (const p of payloads) {
      const ev = parseAiStreamEvent<TDone>(p);
      if (ev) onEvent(ev);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    emit(parser.feed(decoder.decode(value, { stream: true })));
  }
  emit(parser.feed(decoder.decode()));
  emit(parser.flush());
}
