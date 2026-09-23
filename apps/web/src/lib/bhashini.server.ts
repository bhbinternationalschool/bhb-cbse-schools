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
  DEFAULT_PIPELINE_ID,
  ULCA_CONFIG_URL,
  bhashiniLang,
  configRequestBody,
  inferenceRequestBody,
  parsePipelineConfig,
  parseTranslation,
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

async function pipelineConfig(
  from: string,
  to: string,
): Promise<PipelineConfig | null> {
  const creds = credentials();
  if (!creds) return null;
  const key = `${from}>${to}`;
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
      body: JSON.stringify(configRequestBody(from, to, DEFAULT_PIPELINE_ID)),
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

  const config = await pipelineConfig(from, to);
  if (!config) return { ok: false, error: "Bhashini: no pipeline config" };

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
      body: JSON.stringify(
        inferenceRequestBody({ serviceId: config.serviceId, from, to, text: input }),
      ),
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
    if (!res.ok) {
      // A stale cached config is the likeliest cause of a sudden 401/403, so
      // drop it and let the next call rebuild rather than failing all hour.
      if (res.status === 401 || res.status === 403) configCache.delete(`${from}>${to}`);
      return { ok: false, error: `Bhashini: HTTP ${res.status}` };
    }
    const text = parseTranslation(await res.json(), input);
    if (!text) return { ok: false, error: "Bhashini: empty translation" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: `Bhashini: ${(e as Error).message}` };
  }
}
