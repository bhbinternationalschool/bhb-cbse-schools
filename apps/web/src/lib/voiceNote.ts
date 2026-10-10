/**
 * Parent voice notes — the pure half.
 *
 * A parent who cannot type sends a WhatsApp voice note instead. The inbound
 * parser has always captured the media id, but only the staff ERP command
 * desk ever used it (via Google STT, behind a pilot allow-list). For every
 * other flow the message arrived as the literal string "[voice note]", which
 * matches no intent — so a parent who spoke was answered as though they had
 * said nothing useful.
 *
 * This module holds everything that can be decided without the network: what
 * audio we accept, the transcription prompt, how a raw model reply becomes a
 * usable transcript, and — the part that matters most — what the bot is told
 * when transcription does NOT work. A voice note that cannot be transcribed
 * is still a parent asking for something; it must reach a human, never be
 * answered as if it were understood.
 */

/**
 * What WhatsApp actually sends for a voice note (ogg/opus) plus the formats
 * a forwarded audio file arrives as. Anything else is refused rather than
 * guessed at — a mislabelled blob wastes a model call and a budget slot.
 */
export const VOICE_NOTE_MIME_ALLOWLIST = [
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/amr",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
] as const;

/**
 * WhatsApp caps voice notes at 16 MB. We stop well short: the audio is sent
 * to the model inline as base64, which inflates it by a third, and a note
 * this long is a monologue that a human should hear anyway.
 */
export const MAX_VOICE_NOTE_BYTES = 8 * 1024 * 1024;

/** Longer than this and the transcript is almost certainly a runaway model. */
export const MAX_TRANSCRIPT_CHARS = 4000;

export type VoiceNoteRefusal =
  | "empty"
  | "too-large"
  | "unsupported-type";

export type VoiceNoteGuardResult =
  | { ok: true; mimeType: string }
  | { ok: false; reason: VoiceNoteRefusal };

/**
 * Decide whether this audio is worth a model call. The mime type arrives from
 * WhatsApp with codec parameters attached ("audio/ogg; codecs=opus"), so
 * compare on the type alone.
 */
export function guardVoiceNote(opts: {
  mimeType: string | undefined;
  byteLength: number;
}): VoiceNoteGuardResult {
  if (!opts.byteLength || opts.byteLength <= 0) return { ok: false, reason: "empty" };
  if (opts.byteLength > MAX_VOICE_NOTE_BYTES) return { ok: false, reason: "too-large" };
  const base = (opts.mimeType || "").split(";")[0]!.trim().toLowerCase();
  if (!base) return { ok: false, reason: "unsupported-type" };
  const allowed = (VOICE_NOTE_MIME_ALLOWLIST as readonly string[]).includes(base);
  if (!allowed) return { ok: false, reason: "unsupported-type" };
  return { ok: true, mimeType: base };
}

/**
 * Bump when the prompt below changes so a quality regression can be tied to
 * the edit that caused it (see AiCallMeta.promptVersion).
 */
export const VOICE_NOTE_PROMPT_VERSION = "voice-note-v1";

/**
 * The model is a transcriber here and nothing else. It is explicitly told not
 * to answer the parent, not to translate, and to return an empty string when
 * it cannot hear words — because a plausible guess at what a parent said is
 * worse than admitting we did not catch it.
 */
export const VOICE_NOTE_SYSTEM = [
  "You transcribe short voice messages sent by parents and staff of an Indian school.",
  "Speakers use Hindi, Bhojpuri, or Indian English, and often mix them in one sentence.",
  "",
  "Rules:",
  "- Write down exactly what was said. Do not answer it, summarise it, or reply to it.",
  "- Keep the speaker's language. Write Hindi and Bhojpuri in Devanagari, English in Latin script. Do not translate.",
  "- Keep names, amounts, dates and class names exactly as spoken. Never substitute a name you think is more likely.",
  "- Do not add greetings, punctuation-only filler, or anything the speaker did not say.",
  "- If the audio is silent, inaudible, or has no speech, return an empty transcript.",
  "",
  'Return JSON only: {"transcript": string, "language": "hi" | "bho" | "en" | "mixed" | "unknown", "audible": boolean}',
].join("\n");

export const VOICE_NOTE_PROMPT =
  "Transcribe this voice message. Return the JSON object described in the instructions.";

export type VoiceNoteTranscript = {
  transcript: string;
  language: "hi" | "bho" | "en" | "mixed" | "unknown";
  audible: boolean;
};

const LANGUAGES: VoiceNoteTranscript["language"][] = [
  "hi",
  "bho",
  "en",
  "mixed",
  "unknown",
];

/**
 * Read the model's JSON without trusting any of it. An absent or malformed
 * field becomes "we did not hear it", never a confident empty transcript.
 */
export function parseVoiceNoteTranscript(raw: unknown): VoiceNoteTranscript {
  const o = (raw ?? {}) as Record<string, unknown>;
  const transcript = cleanTranscript(typeof o.transcript === "string" ? o.transcript : "");
  const langRaw = typeof o.language === "string" ? o.language.trim().toLowerCase() : "";
  const language = (LANGUAGES as string[]).includes(langRaw)
    ? (langRaw as VoiceNoteTranscript["language"])
    : "unknown";
  // `audible` is only believed when it agrees with there being words. A model
  // that says audible:true and hands back nothing has told us nothing.
  const audible = o.audible === true && transcript.length > 0;
  return { transcript, language, audible };
}

/**
 * Trim the things models add around a transcript — code fences, a leading
 * "Transcript:", surrounding quotes — and collapse the whitespace that
 * dictation tends to leave behind.
 */
export function cleanTranscript(raw: string): string {
  let t = (raw || "").trim();
  const fence = t.match(/^```(?:\w+)?\s*([\s\S]*?)```$/);
  if (fence) t = fence[1]!.trim();
  t = t.replace(/^(?:transcript|transcription)\s*[:\-]\s*/i, "").trim();
  if (t.length >= 2 && /^["'“‘]/.test(t) && /["'”’]$/.test(t)) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (t.length > MAX_TRANSCRIPT_CHARS) t = t.slice(0, MAX_TRANSCRIPT_CHARS).trim();
  return t;
}

/**
 * Words, not just punctuation or a stray "..." — the bot should not be handed
 * something that will match no intent and read as gibberish in the thread.
 */
export function transcriptIsUsable(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 2) return false;
  return /[\p{L}\p{N}]/u.test(t);
}

export type VoiceNoteOutcome =
  | { kind: "transcribed"; text: string; language: VoiceNoteTranscript["language"] }
  | { kind: "unusable"; reason: VoiceNoteUnusableReason };

export type VoiceNoteUnusableReason =
  | VoiceNoteRefusal
  | "inaudible"
  | "download-failed"
  | "transcribe-failed"
  | "budget"
  | "disabled";

/**
 * What a human reading the thread should see when we could not turn the audio
 * into words. Every branch escalates: the parent said something, so somebody
 * has to listen to it. None of these is phrased as an answer to the parent.
 */
export const VOICE_NOTE_STAFF_NOTE: Record<VoiceNoteUnusableReason, string> = {
  empty: "Voice note arrived empty — nothing to play.",
  "too-large": "Voice note too long to transcribe automatically — play it in WhatsApp.",
  "unsupported-type": "Audio format not supported for transcription — play it in WhatsApp.",
  inaudible: "Voice note could not be made out — play it in WhatsApp.",
  "download-failed": "Voice note could not be downloaded from WhatsApp — play it in WhatsApp.",
  "transcribe-failed": "Voice note transcription failed — play it in WhatsApp.",
  budget: "Voice note not transcribed (AI budget reached) — play it in WhatsApp.",
  disabled: "Voice note transcription is switched off — play it in WhatsApp.",
};

/**
 * The single decision the caller cares about: does this reach the bot as
 * words, or does it go straight to a human?
 *
 * `escalate` is true for every unusable branch. That is deliberate and is the
 * whole point of the feature — the failure mode we are replacing is a parent
 * being told "I didn't understand that" when the school simply never listened.
 */
export function voiceNoteOutcome(input: {
  guard: VoiceNoteGuardResult;
  result?: VoiceNoteTranscript | null;
  failure?: Extract<
    VoiceNoteUnusableReason,
    "download-failed" | "transcribe-failed" | "budget"
  > | null;
}): VoiceNoteOutcome {
  if (!input.guard.ok) return { kind: "unusable", reason: input.guard.reason };
  if (input.failure) return { kind: "unusable", reason: input.failure };
  const r = input.result;
  if (!r || !r.audible || !transcriptIsUsable(r.transcript)) {
    return { kind: "unusable", reason: "inaudible" };
  }
  return { kind: "transcribed", text: r.transcript, language: r.language };
}

/**
 * How the transcript is labelled in the thread. Staff reading a complaint
 * must be able to tell a machine transcript from something the parent typed —
 * the words are the parent's, the spelling is the model's.
 */
export function labelledTranscript(text: string): string {
  return `🎙️ ${text}`;
}

/**
 * The audit row records what was sent, and audio cannot go in it — a base64
 * voice note would bloat ai_generations by megabytes a row. Store a
 * descriptor instead, which is what anyone auditing the call actually needs.
 */
export function voiceNoteAuditDescriptor(opts: {
  mimeType: string;
  byteLength: number;
  waMessageId?: string;
}): string {
  const kb = Math.round(opts.byteLength / 1024);
  const id = opts.waMessageId ? ` wa=${opts.waMessageId}` : "";
  return `[audio ${opts.mimeType} ${kb}KB${id}]`;
}

/**
 * What the parent is told when we could not turn their voice note into words.
 *
 * The one thing it must not do is imply they were misunderstood — they were
 * not understood at all, because nobody has listened yet. So it confirms the
 * message arrived and promises a person, and it asks for nothing: telling a
 * parent who cannot type to "please type your question" is how this failed
 * before.
 *
 * Hindi first: a parent who sends voice rather than text is the parent least
 * likely to read English comfortably.
 */
export const VOICE_NOTE_PARENT_ACK = [
  "आपका वॉइस मैसेज मिल गया है 🎙️ स्कूल कार्यालय से कोई इसे सुनकर आपसे संपर्क करेगा।",
  "",
  "We have received your voice message. Someone from the school office will listen to it and get back to you.",
].join("\n");

/**
 * The line a human sees in the WhatsApp hub. It names the reason so the
 * office knows whether to expect a playable note (most cases) or a broken
 * one, and it is prefixed so the thread reads as a handoff rather than as
 * something the parent typed.
 */
export function voiceNoteHubNote(reason: VoiceNoteUnusableReason): string {
  return `[VOICE NOTE] ${VOICE_NOTE_STAFF_NOTE[reason]}`;
}
