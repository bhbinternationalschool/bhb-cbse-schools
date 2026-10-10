import "server-only";

/**
 * The two Bhashini calls. Every rule and all the parsing is in bhashini.ts;
 * this is credentials, caching and network.
 *
 * Nothing here throws, and every failure returns the same `ok: false` so
 * translate.server.ts can do the one thing that matters: fall through to
 * Sarvam, quietly, while a parent waits for a message.
 */

import {
  BHASHINI_MAX_INPUT_CHARS,
  BHASHINI_MAX_TTS_CHARS,
  DEFAULT_PIPELINE_ID,
  ULCA_CONFIG_URL,
  asrInferenceBody,
  bhashiniAudioFormat,
  bhashiniLang,
  bhashiniSpeechLang,
  configRequestBody,
  inferenceRequestBody,
  parseAsr,
  parsePipelineConfig,
  parseTranslation,
  parseTts,
  speechConfigRequestBody,
  ttsInferenceBody,
  type BhashiniSpeechTask,
  type PipelineConfig,
} from "@/lib/bhashini";

const CONFIG_TIMEOUT_MS = 10_000;
const INFERENCE_TIMEOUT_MS = 20_000;

/**
 * Credentials come from the Bhashini developer portal (sign up, verify,
 * generate a key): a userID and the ULCA key for step 1, and an inference
 * key that some deployments need alongside the per-pipeline header.
 */
function credentials(): { userId: string; ulcaKey: string; inferenceKey: string } | null {
  const userId = (process.env.BHASHINI_USER_ID || "").trim();
  const ulcaKey = (process.env.BHASHINI_ULCA_API_KEY || "").trim();
  if (!userId || !ulcaKey) return null;
  return {
    userId,
    ulcaKey,
    inferenceKey: (process.env.BHASHINI_INFERENCE_API_KEY || "").trim(),
  };
}

export function bhashiniConfigured(): boolean {
  return credentials() !== null;
}

/**
 * Step 1's answer per language pair, in memory.
 *
 * Which model serves hi→bn does not change minute to minute, and without
 * this every translation costs two round trips. Cached for an hour so a
 * rotated service is picked up the same working day; on Cloud Run each
 * instance keeps its own, which is fine for something this cheap to rebuild.
 */
const CONFIG_TTL_MS = 60 * 60 * 1000;
const configCache = new Map<string, { at: number; config: PipelineConfig }>();

/**
 * Step 1 for any task. `key` names the cache slot ("translation:hi>bn",
 * "asr:hi") so a translation pair and a speech language never share one.
 */
async function pipelineConfig(key: string, body: unknown): Promise<PipelineConfig | null> {
  const creds = credentials();
  if (!creds) return null;
  const hit = configCache.get(key);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.config;

  try {
    const res = await fetch(ULCA_CONFIG_URL, {
      method: "POST",
      headers: {
        userID: creds.userId,
        ulcaApiKey: creds.ulcaKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const config = parsePipelineConfig(await res.json());
    if (!config) return null;
    configCache.set(key, { at: Date.now(), config });
    return config;
  } catch {
    return null;
  }
}

function translationConfig(from: string, to: string): Promise<PipelineConfig | null> {
  return pipelineConfig(
    `translation:${from}>${to}`,
    configRequestBody(from, to, DEFAULT_PIPELINE_ID),
  );
}

function speechConfig(task: BhashiniSpeechTask, lang: string): Promise<PipelineConfig | null> {
  return pipelineConfig(
    `${task}:${lang}`,
    speechConfigRequestBody(task, lang, DEFAULT_PIPELINE_ID),
  );
}

/**
 * Step 2 for any task. Returns the parsed JSON or an error; a 401/403 drops
 * the cached step-1 answer, the likeliest cause of a sudden refusal.
 */
async function runInference(
  cacheKey: string,
  config: PipelineConfig,
  body: unknown,
  timeoutMs: number,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const creds = credentials();
    const res = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        // The callback names its own auth header — Bhashini does not promise
        // it is "Authorization", and assuming so is a 401 on every call that
        // looks exactly like bad credentials.
        [config.headerName]: config.headerValue,
        ...(creds?.inferenceKey ? { Authorization: creds.inferenceKey } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) configCache.delete(cacheKey);
      return { ok: false, error: `Bhashini: HTTP ${res.status}` };
    }
    return { ok: true, json: await res.json() };
  } catch (e) {
    return { ok: false, error: `Bhashini: ${(e as Error).message}` };
  }
}

export type TranslateResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Translate one string via Bhashini.
 *
 * Refuses rather than approximates when Bhashini has no model for a
 * language — Bhojpuri above all. Sending a Bhojpuri household Hindi because
 * it is close enough is the school deciding a family's language for them,
 * and it would be invisible in the logs because it would look like success.
 */
export async function bhashiniTranslate(opts: {
  text: string;
  /** Sarvam-style codes, as householdPrefs.ts stores them. */
  from?: string;
  to: string;
}): Promise<TranslateResult> {
  if (!bhashiniConfigured()) {
    return { ok: false, error: "Bhashini not configured" };
  }
  const input = opts.text.trim();
  if (!input) return { ok: true, text: "" };
  if (input.length > BHASHINI_MAX_INPUT_CHARS) {
    return { ok: false, error: `Bhashini: over ${BHASHINI_MAX_INPUT_CHARS} characters` };
  }

  const from = bhashiniLang(opts.from ?? "en-IN");
  const to = bhashiniLang(opts.to);
  if (!from || !to) {
    return { ok: false, error: `Bhashini has no model for ${opts.from ?? "en-IN"}→${opts.to}` };
  }
  if (from === to) return { ok: true, text: input };

  const config = await translationConfig(from, to);
  if (!config) return { ok: false, error: "Bhashini: no pipeline config" };

  const r = await runInference(
    `translation:${from}>${to}`,
    config,
    inferenceRequestBody({ serviceId: config.serviceId, from, to, text: input }),
    INFERENCE_TIMEOUT_MS,
  );
  if (!r.ok) return r;
  const text = parseTranslation(r.json, input);
  if (!text) return { ok: false, error: "Bhashini: empty translation" };
  return { ok: true, text };
}

/**
 * Speech to text via Bhashini, or a reason it did not.
 *
 * Every refusal is the caller's cue to try Google: no credentials, a
 * language with no model (Bhojpuri), a recording format Bhashini does not
 * list (Chrome's WebM), a timeout, or an empty transcript.
 */
export async function bhashiniSpeechToText(opts: {
  audioBase64: string;
  mimeType?: string;
  /** BCP-47, e.g. "hi-IN". */
  languageCode?: string;
}): Promise<TranslateResult> {
  if (!bhashiniConfigured()) return { ok: false, error: "Bhashini not configured" };
  const lang = bhashiniSpeechLang(opts.languageCode || "hi-IN");
  if (!lang) return { ok: false, error: `Bhashini has no speech model for ${opts.languageCode}` };
  const audioFormat = bhashiniAudioFormat(opts.mimeType);
  if (!audioFormat) return { ok: false, error: `Bhashini: unsupported audio ${opts.mimeType || "unknown"}` };

  const config = await speechConfig("asr", lang);
  if (!config) return { ok: false, error: "Bhashini: no ASR pipeline config" };
  const r = await runInference(
    `asr:${lang}`,
    config,
    asrInferenceBody({ serviceId: config.serviceId, lang, audioBase64: opts.audioBase64, audioFormat }),
    INFERENCE_TIMEOUT_MS,
  );
  if (!r.ok) return r;
  const text = parseAsr(r.json);
  if (!text) return { ok: false, error: "Bhashini: no speech detected" };
  return { ok: true, text };
}

/** Text to speech via Bhashini, as base64 WAV, or a reason it did not. */
export async function bhashiniTextToSpeech(opts: {
  text: string;
  /** BCP-47, e.g. "hi-IN". */
  languageCode?: string;
}): Promise<{ ok: true; audioBase64: string; mimeType: string } | { ok: false; error: string }> {
  if (!bhashiniConfigured()) return { ok: false, error: "Bhashini not configured" };
  const text = opts.text.trim();
  if (!text) return { ok: false, error: "Empty text" };
  if (text.length > BHASHINI_MAX_TTS_CHARS) {
    return { ok: false, error: `Bhashini: over ${BHASHINI_MAX_TTS_CHARS} characters` };
  }
  const lang = bhashiniSpeechLang(opts.languageCode || "hi-IN");
  if (!lang) return { ok: false, error: `Bhashini has no voice for ${opts.languageCode}` };

  const config = await speechConfig("tts", lang);
  if (!config) return { ok: false, error: "Bhashini: no TTS pipeline config" };
  const r = await runInference(
    `tts:${lang}`,
    config,
    ttsInferenceBody({ serviceId: config.serviceId, lang, text }),
    INFERENCE_TIMEOUT_MS,
  );
  if (!r.ok) return r;
  const audioBase64 = parseTts(r.json);
  if (!audioBase64) return { ok: false, error: "Bhashini: no audio" };
  return { ok: true, audioBase64, mimeType: "audio/wav" };
}
