import "server-only";

/**
 * Speech, free engine first:
 *
 *   Bhashini (free, Government of India)  →  Google Cloud Speech (paid key)
 *
 * The same rule as translate.server.ts. Every Bhashini refusal — not
 * configured, no model for the language, a recording format it does not
 * list, a timeout, an empty transcript — falls through to Google without a
 * word, because a teacher holding a mic button is waiting either way.
 *
 * Only staff dictation, staff WhatsApp voice commands and read-aloud come
 * through here. A PARENT's WhatsApp voice note does not: it goes to Gemini
 * alone (aiLlm.server.ts transcribeVoiceNote), which also reads what the
 * parent wants, and the reason it has no second provider applies here too
 * in reverse — this file never adds a third.
 */

import { bhashiniConfigured, bhashiniSpeechToText, bhashiniTextToSpeech } from "@/lib/bhashini.server";
import { googleSpeechToText, googleTextToSpeech, speechConfigured } from "@/lib/googleSpeech.server";

export type SpeechEngine = "bhashini" | "google";

/** Can anything transcribe or speak at all? Replaces bare `speechConfigured()`. */
export function anySpeechConfigured(): boolean {
  return bhashiniConfigured() || speechConfigured();
}

export async function speechToText(opts: {
  audioBase64: string;
  mimeType?: string;
  languageCode?: string;
}): Promise<{ ok: true; text: string; engine: SpeechEngine } | { ok: false; error: string }> {
  if (bhashiniConfigured()) {
    const free = await bhashiniSpeechToText(opts);
    if (free.ok && free.text) return { ok: true, text: free.text, engine: "bhashini" };
  }
  if (speechConfigured()) {
    const paid = await googleSpeechToText(opts);
    return paid.ok ? { ok: true, text: paid.text, engine: "google" } : paid;
  }
  return { ok: false, error: "Speech recognition is not configured" };
}

export async function textToSpeech(opts: {
  text: string;
  languageCode?: string;
}): Promise<
  | { ok: true; audioBase64: string; mimeType: string; engine: SpeechEngine }
  | { ok: false; error: string }
> {
  if (bhashiniConfigured()) {
    const free = await bhashiniTextToSpeech(opts);
    if (free.ok) return { ...free, engine: "bhashini" };
  }
  if (speechConfigured()) {
    const paid = await googleTextToSpeech(opts);
    return paid.ok ? { ...paid, engine: "google" } : paid;
  }
  return { ok: false, error: "Text to speech is not configured" };
}
