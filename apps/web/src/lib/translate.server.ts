import "server-only";

/**
 * One door for translation: free first, paid behind it.
 *
 *   Bhashini (free, Government of India)  →  Sarvam (paid key)
 *
 * Every screen and bot that used to call sarvamTranslate directly now comes
 * here, so the ordering is decided in ONE place rather than five routes
 * each remembering to try the free one first.
 *
 * The rules, in order of how much they matter:
 *
 *  1. **A parent is waiting.** Every Bhashini failure — not configured, no
 *     model for the pair, quota, timeout, a shape that changed — falls
 *     through to Sarvam without a word on screen. Saving money is never
 *     worth a message that did not go out.
 *  2. **Sarvam stays configured.** This is a first choice, not a
 *     replacement. Bhashini publishes its APIs as free for low-volume use
 *     and asks production integrators to discuss a plan; if that
 *     conversation ever ends badly, doing nothing is a safe answer.
 *  3. **A language neither can do is not approximated.** Bhojpuri has no
 *     model in either, and the caller gets a refusal rather than Hindi
 *     wearing a Bhojpuri label.
 *
 * The engine that answered is reported back, because several screens show
 * the office which one wrote the Hindi and that should stay true.
 */

import { bhashiniConfigured, bhashiniTranslate } from "@/lib/bhashini.server";
import {
  sarvamConfigured,
  sarvamTranslate,
  type SarvamLang,
} from "@/lib/sarvam.server";

export type TranslationEngine = "bhashini" | "sarvam";

export type TranslateOutcome =
  | { ok: true; text: string; engine: TranslationEngine }
  | { ok: false; error: string };

/** Is any engine available at all? Replaces bare `sarvamConfigured()` checks. */
export function translationConfigured(): boolean {
  return bhashiniConfigured() || sarvamConfigured();
}

/** Which engines are live — for the "hindiEngine" line the AI screens show. */
export function translationEngines(): TranslationEngine[] {
  const out: TranslationEngine[] = [];
  if (bhashiniConfigured()) out.push("bhashini");
  if (sarvamConfigured()) out.push("sarvam");
  return out;
}

export type TranslateMode = "formal" | "modern-colloquial" | "classic-colloquial";

/**
 * Translate one string, free engine first.
 *
 * `mode` is Sarvam's register control and has no Bhashini equivalent, so a
 * caller that needs a specific register gets it only when Sarvam answers.
 * That is a real difference and the reason report-card remarks and letters
 * still read correctly either way: both engines produce formal prose by
 * default, and the colloquial modes are used for chat, where either is fine.
 */
export async function translateText(opts: {
  text: string;
  from?: SarvamLang;
  to: SarvamLang;
  mode?: TranslateMode;
}): Promise<TranslateOutcome> {
  const input = opts.text.trim();
  if (!input) return { ok: true, text: "", engine: "bhashini" };

  if (bhashiniConfigured()) {
    const free = await bhashiniTranslate({ text: input, from: opts.from, to: opts.to });
    if (free.ok && free.text) return { ok: true, text: free.text, engine: "bhashini" };
  }

  if (sarvamConfigured()) {
    const paid = await sarvamTranslate({
      text: input,
      from: opts.from,
      to: opts.to,
      mode: opts.mode,
    });
    if (paid.ok) return { ok: true, text: paid.text, engine: "sarvam" };
    return { ok: false, error: paid.error };
  }

  return { ok: false, error: "No translation engine configured" };
}

/** Bounded concurrency, matching sarvamTranslateMany's contract exactly. */
const CONCURRENCY = 4;

/**
 * Translate many strings. The result array is aligned with the input and a
 * failed item is "" with its error collected, so one bad string never sinks
 * a whole report-card run.
 *
 * `engines` reports every engine that contributed, because a batch can
 * legitimately be half free and half paid — Bhashini answering most of it
 * and Sarvam catching the two that timed out is the system working.
 */
export async function translateMany(opts: {
  texts: string[];
  from?: SarvamLang;
  to: SarvamLang;
  mode?: TranslateMode;
}): Promise<{ texts: string[]; errors: string[]; engines: TranslationEngine[] }> {
  const out: string[] = new Array(opts.texts.length).fill("");
  const errors: string[] = [];
  const used = new Set<TranslationEngine>();
  let next = 0;

  async function worker() {
    while (next < opts.texts.length) {
      const i = next++;
      const r = await translateText({
        text: opts.texts[i],
        from: opts.from,
        to: opts.to,
        mode: opts.mode,
      });
      if (r.ok) {
        out[i] = r.text;
        if (r.text) used.add(r.engine);
      } else {
        errors.push(r.error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, opts.texts.length) }, worker),
  );
  return { texts: out, errors, engines: [...used] };
}
