/**
 * Bhashini — the Government of India's language stack (MeitY, National
 * Language Translation Mission), used here as a FREE first choice ahead of
 * the paid Sarvam key.
 *
 * Why this one is allowed where Puter is not: Bhashini runs on Indian
 * government infrastructure. A parent's dues reminder translated by it does
 * not leave the country, so unlike the browser-side free AI in puterAi.ts
 * this may be used parent-facing and inside the WhatsApp bots — which is
 * where almost all of our translation actually happens.
 *
 * ── Shape of the thing ──────────────────────────────────────────────────
 *
 * Bhashini is two calls, not one, and that is its whole awkwardness:
 *
 *   1. ULCA "pipeline config" — given a language pair and a task, tells you
 *      WHICH model to use (a serviceId) and WHERE to send the work (a
 *      callback host plus a per-request auth header).
 *   2. The inference call itself, to that host, naming that serviceId.
 *
 * Step 1's answer is stable for a language pair, so it is cached; without
 * that every translation would cost two round trips instead of one.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────
 *
 * Bhashini covers the 22 scheduled languages. **Bhojpuri is not one of
 * them** — it is not in the Eighth Schedule — so the gap that
 * householdPrefs.ts already records as `sarvam: null` for `bho` stays open.
 * Nothing here should be read as closing it, and `bhashiniLang("bho")`
 * returns null on purpose so a caller falls through rather than quietly
 * sending a Bhojpuri family Hindi it did not ask for.
 *
 * ── Honesty about the free tier ─────────────────────────────────────────
 *
 * Bhashini publishes its APIs as free for low-volume use and asks
 * integrators running production systems to talk to them about a plan. This
 * integration is therefore built as a FIRST CHOICE, never a replacement:
 * the Sarvam key stays configured and every failure — no credentials, a
 * quota refusal, a timeout, a shape we did not expect — falls through to it
 * silently. If the school is asked to move to a paid Bhashini plan, doing
 * nothing is a safe answer.
 *
 * Pure and client-safe so the mapping and parsing are testable; the calls
 * live in bhashini.server.ts.
 *
 * NOT VERIFIED AGAINST A LIVE RESPONSE — this session's egress policy blocks
 * both Bhashini hosts, so the shapes below follow the published API docs and
 * the parsers tolerate drift rather than assume it. A shape guessed wrong
 * degrades to "Sarvam answers instead", which is today's behaviour.
 */

/** Sarvam's codes, which householdPrefs.ts already maps every language to. */
export type SarvamLangCode = string;

/**
 * Sarvam code → Bhashini code, for the languages BOTH support.
 *
 * Deliberately built from the Sarvam side: householdPrefs.ts is the list the
 * school actually sends to, and a language missing here simply means Sarvam
 * keeps that one.
 */
const SARVAM_TO_BHASHINI: Record<string, string> = {
  "en-IN": "en",
  "hi-IN": "hi",
  "bn-IN": "bn",
  "ur-IN": "ur",
  "mai-IN": "mai",
  "ta-IN": "ta",
  "te-IN": "te",
  "mr-IN": "mr",
  "gu-IN": "gu",
  "kn-IN": "kn",
  "ml-IN": "ml",
  "pa-IN": "pa",
  // Sarvam spells Odia "od-IN"; ISO 639-1, which Bhashini follows, is "or".
  "od-IN": "or",
};

/**
 * The Bhashini code for a Sarvam code, or null when Bhashini cannot do it.
 *
 * Null is a real answer and the caller must respect it: Bhojpuri (`bho`)
 * has no scheduled-language model, and answering a Bhojpuri household in
 * Hindi because it is close enough is the school deciding a family's
 * language for them.
 */
export function bhashiniLang(sarvamCode: string): string | null {
  return SARVAM_TO_BHASHINI[String(sarvamCode || "").trim()] ?? null;
}

/** Can Bhashini translate this pair at all? */
export function bhashiniSupportsPair(from: string, to: string): boolean {
  return bhashiniLang(from) !== null && bhashiniLang(to) !== null;
}

/** Languages Bhashini will be tried for, for a settings screen or a doc. */
export function bhashiniSupportedSarvamCodes(): string[] {
  return Object.keys(SARVAM_TO_BHASHINI);
}

/* ── Step 1: pipeline config ─────────────────────────────────────────── */

export const ULCA_CONFIG_URL =
  "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline";

/**
 * MeitY's own pipeline id. Published in Bhashini's developer documentation
 * as the default for integrators and the one every quickstart uses.
 */
export const DEFAULT_PIPELINE_ID = "64392f96daac500b55c543cd";

export function configRequestBody(from: string, to: string, pipelineId: string) {
  return {
    pipelineTasks: [
      {
        taskType: "translation",
        config: { language: { sourceLanguage: from, targetLanguage: to } },
      },
    ],
    pipelineRequestConfig: { pipelineId },
  };
}

export type PipelineConfig = {
  serviceId: string;
  /** Where the inference call goes. */
  endpoint: string;
  /** Header name and value the callback host wants — NOT always "Authorization". */
  headerName: string;
  headerValue: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Read step 1's answer.
 *
 * The callback's auth header is named BY the response — Bhashini does not
 * promise it is called "Authorization" — so the name is carried through
 * rather than assumed. Getting that wrong is a 401 on every call, which is
 * indistinguishable from bad credentials and would be miserable to debug.
 */
export function parsePipelineConfig(raw: unknown): PipelineConfig | null {
  const root = obj(raw);
  if (!root) return null;

  const configs = Array.isArray(root.pipelineResponseConfig)
    ? root.pipelineResponseConfig
    : [];
  let serviceId = "";
  for (const entry of configs) {
    const e = obj(entry);
    if (!e) continue;
    const list = Array.isArray(e.config) ? e.config : [];
    for (const c of list) {
      const cc = obj(c);
      const id = cc ? str(cc.serviceId) : "";
      if (id) {
        serviceId = id;
        break;
      }
    }
    if (serviceId) break;
  }
  if (!serviceId) return null;

  const inference = obj(root.pipelineInferenceAPIEndPoint);
  if (!inference) return null;
  const endpoint = str(inference.callbackUrl);
  const scheme = obj(inference.inferenceApiKey);
  const headerName = scheme ? str(scheme.name) : "";
  const headerValue = scheme ? str(scheme.value) : "";
  if (!endpoint || !headerName || !headerValue) return null;

  return { serviceId, endpoint, headerName, headerValue };
}

/* ── Step 2: inference ───────────────────────────────────────────────── */

export function inferenceRequestBody(opts: {
  serviceId: string;
  from: string;
  to: string;
  text: string;
}) {
  return {
    pipelineTasks: [
      {
        taskType: "translation",
        config: {
          language: { sourceLanguage: opts.from, targetLanguage: opts.to },
          serviceId: opts.serviceId,
        },
      },
    ],
    inputData: { input: [{ source: opts.text }] },
  };
}

/**
 * Pull the translated string out, or null.
 *
 * Documented shape:
 *   { pipelineResponse: [ { output: [ { source, target } ] } ] }
 *
 * `target` identical to what we sent is treated as NO translation: Bhashini
 * echoing the input back is the failure mode that would otherwise send a
 * Hindi-speaking parent an English dues reminder and log it as a success.
 */
export function parseTranslation(raw: unknown, sent: string): string | null {
  const root = obj(raw);
  if (!root) return null;
  const responses = Array.isArray(root.pipelineResponse) ? root.pipelineResponse : [];
  for (const r of responses) {
    const rr = obj(r);
    if (!rr) continue;
    const outputs = Array.isArray(rr.output) ? rr.output : [];
    for (const o of outputs) {
      const oo = obj(o);
      const target = oo ? str(oo.target) : "";
      if (!target) continue;
      if (target === sent.trim()) return null;
      return target;
    }
  }
  return null;
}

/** Bhashini's documented per-request input cap for translation. */
export const BHASHINI_MAX_INPUT_CHARS = 2000;
