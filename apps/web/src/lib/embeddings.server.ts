/**
 * OpenAI text embeddings — server-only, backs the school knowledge-base
 * RAG pipeline (lib/schoolKb.server.ts). No other engine wired: unlike
 * chat completions this app has no fallback embeddings provider yet.
 */
import { openAiApiKey, openAiConfigured } from "@/lib/openAi.server";

const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export function embeddingsConfigured(): boolean {
  return openAiConfigured();
}

/**
 * The last few query embeddings, by exact text. A retried or re-asked
 * question skips the round-trip; the vector for a given string never
 * changes, so there is nothing to expire beyond bounding the size.
 */
const EMBED_MEMO_MAX = 64;
const embedMemo = new Map<string, number[]>();

export async function embedText(
  text: string,
): Promise<{ ok: true; vector: number[] } | { ok: false; error: string }> {
  const key = openAiApiKey();
  if (!key) return { ok: false, error: "OPENAI_API_KEY not configured" };
  const input = text.trim().slice(0, 8000);
  if (!input) return { ok: false, error: "Empty text" };
  const memo = embedMemo.get(input);
  if (memo) return { ok: true, vector: memo };

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { embedding?: number[] }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, error: json.error?.message || `OpenAI HTTP ${res.status}` };
    }
    const vector = json.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
      return { ok: false, error: "Unexpected embedding response shape" };
    }
    if (embedMemo.size >= EMBED_MEMO_MAX) {
      embedMemo.delete(embedMemo.keys().next().value as string);
    }
    embedMemo.set(input, vector);
    return { ok: true, vector };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Embedding request failed",
    };
  }
}

/** Embeds a batch sequentially — small corpora (school notices), no need for concurrency limits. */
export async function embedTexts(
  texts: string[],
): Promise<({ ok: true; vector: number[] } | { ok: false; error: string })[]> {
  const out: ({ ok: true; vector: number[] } | { ok: false; error: string })[] = [];
  for (const t of texts) {
    out.push(await embedText(t));
  }
  return out;
}
