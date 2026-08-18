/**
 * Sarvam AI — Indic language layer (server-only).
 *
 * Used as a *translation* engine, not a reasoning engine: Gemini/OpenAI
 * write the English; Sarvam turns it into natural Hindi (and later other
 * Indian languages) for parents. Kept separate from aiLlm.server.ts on
 * purpose — it is not part of the generateText failover chain.
 *
 * Endpoint verified 2026-08-18 against the production key:
 *   POST https://api.sarvam.ai/translate  (header api-subscription-key)
 *   { input, source_language_code, target_language_code, model }
 */

export type SarvamLang = "en-IN" | "hi-IN";

export function sarvamApiKey(): string {
  return (process.env.SARVAM_API_KEY || "").trim();
}

export function sarvamConfigured(): boolean {
  return sarvamApiKey().length > 0;
}

const SARVAM_TRANSLATE_URL = "https://api.sarvam.ai/translate";
const SARVAM_TRANSLATE_MODEL = "sarvam-translate:v1";
/** Sarvam's documented per-request input cap for the translate endpoint. */
const SARVAM_MAX_INPUT_CHARS = 2000;
const SARVAM_TIMEOUT_MS = 20_000;
const SARVAM_CONCURRENCY = 4;

export async function sarvamTranslate(opts: {
  text: string;
  from?: SarvamLang;
  to: SarvamLang;
  /** "formal" for report cards / letters; "modern-colloquial" for chat */
  mode?: "formal" | "modern-colloquial" | "classic-colloquial";
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = sarvamApiKey();
  if (!key) return { ok: false, error: "SARVAM_API_KEY not configured" };
  const input = opts.text.trim();
  if (!input) return { ok: true, text: "" };
  if (input.length > SARVAM_MAX_INPUT_CHARS) {
    return { ok: false, error: `Text exceeds ${SARVAM_MAX_INPUT_CHARS} characters` };
  }
  try {
    const res = await fetch(SARVAM_TRANSLATE_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        source_language_code: opts.from ?? "en-IN",
        target_language_code: opts.to,
        model: SARVAM_TRANSLATE_MODEL,
        mode: opts.mode ?? "formal",
      }),
      signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as {
      translated_text?: string;
      error?: { message?: string } | string;
      message?: string;
    };
    if (!res.ok) {
      const msg =
        (typeof body.error === "object" ? body.error?.message : body.error) ||
        body.message ||
        `HTTP ${res.status}`;
      return { ok: false, error: `Sarvam: ${msg}` };
    }
    const text = String(body.translated_text ?? "").trim();
    if (!text) return { ok: false, error: "Sarvam: empty translation" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: `Sarvam: ${(e as Error).message}` };
  }
}

/** Translate many strings with bounded concurrency. Result array is aligned
 * with the input; a failed item is "" with its error collected, so one bad
 * call never sinks the batch. */
export async function sarvamTranslateMany(opts: {
  texts: string[];
  from?: SarvamLang;
  to: SarvamLang;
  mode?: "formal" | "modern-colloquial" | "classic-colloquial";
}): Promise<{ texts: string[]; errors: string[] }> {
  const out: string[] = new Array(opts.texts.length).fill("");
  const errors: string[] = [];
  let next = 0;
  async function worker() {
    while (next < opts.texts.length) {
      const i = next++;
      const r = await sarvamTranslate({
        text: opts.texts[i],
        from: opts.from,
        to: opts.to,
        mode: opts.mode,
      });
      if (r.ok) out[i] = r.text;
      else errors.push(r.error);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SARVAM_CONCURRENCY, opts.texts.length) }, worker),
  );
  return { texts: out, errors };
}
