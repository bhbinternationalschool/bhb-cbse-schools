/**
 * One PTM per-student brief — the router call and the family-language
 * rendering shared by the web PTM tab's route (/api/ai/ptm-student-brief)
 * and the staff app's (/api/v1/staff/ai/ptm-brief). Lifted out of the web
 * route on 2026-10-13 so both answer the same way.
 *
 * The draft is written in the household's template language (en / hi);
 * a regional preference is rendered from it through the translation layer,
 * and a missing engine is a warning, never a silent English brief claiming
 * to be Bhojpuri. Nothing is saved.
 */

import "server-only";
import { TENANT } from "@/lib/types";
import { generatePtmBriefJson } from "@/lib/aiLlm.server";
import { geminiModel } from "@/lib/erpAiGemini.server";
import { openAiModel } from "@/lib/openAi.server";
import type { PtmBriefDraft, PtmBriefFacts } from "@/lib/ptmBriefAi";
import {
  normalizeHouseholdLanguage,
  sarvamTargetFor,
  waTemplateLanguageFor,
} from "@/lib/householdPrefs";
import type { SarvamLang } from "@/lib/sarvam.server";
import { translateMany, translationConfigured } from "@/lib/translate.server";

export type PtmBriefDraftResult =
  | {
      ok: true;
      engine: string;
      model: string;
      /** What the brief is actually written in. */
      language: string;
      /** The household's preference as stored. */
      requestedLanguage: string;
      generationId: string;
      draft: PtmBriefDraft;
      warnings: string[];
    }
  | { ok: false; error: string; engine: string };

export async function draftPtmBrief(opts: {
  facts: PtmBriefFacts;
  /** The household's preferred language code, raw. */
  householdLanguage: unknown;
}): Promise<PtmBriefDraftResult> {
  const preferred = normalizeHouseholdLanguage(opts.householdLanguage);
  const prefs = { preferredLanguage: preferred };
  const draftLanguage = waTemplateLanguageFor(prefs);
  const sarvamTarget = sarvamTargetFor(prefs);

  const r = await generatePtmBriefJson({
    facts: opts.facts,
    language: draftLanguage,
    schoolName: TENANT.nameDisplay,
  });
  if (!r.ok) return { ok: false, error: r.error, engine: r.engine };

  let draft = r.draft;
  let renderedLanguage: string = draftLanguage;
  const warnings: string[] = [];
  if (sarvamTarget) {
    if (translationConfigured()) {
      const t = await translateMany({
        texts: [draft.observations, draft.concerns, draft.suggestions],
        from: draftLanguage === "hi" ? "hi-IN" : "en-IN",
        to: sarvamTarget as SarvamLang,
        mode: "formal",
      });
      if (t.texts[0] && t.texts[2]) {
        draft = { observations: t.texts[0], concerns: t.texts[1] || draft.concerns, suggestions: t.texts[2] };
        renderedLanguage = preferred;
      } else {
        warnings.push(...t.errors.slice(0, 2));
      }
    } else {
      warnings.push(`Family prefers ${preferred}; no translation engine configured — brief in ${draftLanguage}`);
    }
  }

  return {
    ok: true,
    engine: r.engine,
    model: r.engine === "gemini" ? geminiModel() : r.engine === "openai" ? openAiModel() : "",
    language: renderedLanguage,
    requestedLanguage: preferred,
    generationId: r.generationId,
    draft,
    warnings,
  };
}
