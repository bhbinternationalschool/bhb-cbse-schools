/**
 * Parent voice notes — the server half.
 *
 * Downloads the audio WhatsApp only referenced, and turns it into words.
 *
 * Placement matters: this runs once, at the top of the unified bot, before
 * any flow routing. Before it existed a voice note reached the parent flows
 * as the literal string "[voice note]" — which matches no intent, so a parent
 * who spoke instead of typing was answered as if they had said nothing
 * useful. Staff had a transcription path (Google STT, inside the ERP command
 * handler); parents had none.
 *
 * Failure is deliberately quiet: the caller is left exactly as it was before
 * this module ran, so the existing Google STT fallback still gets its turn
 * and no flow behaves worse than it did yesterday.
 */
import "server-only";

import { transcribeVoiceNote } from "@/lib/aiLlm.server";
import { fetchWaMediaAsDataUrl } from "@/lib/waInboundMedia.server";
import {
  MAX_VOICE_NOTE_BYTES,
  guardVoiceNote,
  voiceNoteOutcome,
  type VoiceNoteOutcome,
} from "@/lib/voiceNote";

/**
 * Kill switch. Unset means on: the feature replaces a broken experience
 * rather than adding a new one, so the safe default is for it to work. Set it
 * to "0" to fall back to the behaviour that shipped before.
 */
export function voiceNoteTranscriptionEnabled(): boolean {
  const raw = (process.env.WA_VOICE_TRANSCRIBE || "").trim();
  return raw !== "0" && raw.toLowerCase() !== "false";
}

/**
 * Strip the `data:` prefix that fetchWaMediaAsDataUrl adds. The Gemini
 * inline_data field wants raw base64 — a data URL sent there is accepted and
 * transcribed as garbage, which is worse than an error.
 */
function rawBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

/**
 * Download and transcribe one voice note.
 *
 * Returns the full outcome, including the unusable branches, so the caller
 * can decide between "use these words" and "a human has to listen to this".
 */
export async function transcribeInboundVoiceNote(opts: {
  mediaId: string;
  mimeType?: string;
  waMessageId?: string;
  requester?: string;
}): Promise<VoiceNoteOutcome> {
  const media = await fetchWaMediaAsDataUrl(opts.mediaId);
  if (!media.ok) {
    console.warn("[voice-note] media download failed", media.error);
    return voiceNoteOutcome({
      guard: { ok: true, mimeType: opts.mimeType || "" },
      failure: "download-failed",
    });
  }

  const base64 = rawBase64(media.dataUrl);
  // base64 inflates by 4/3; recover the real size rather than trusting a
  // header, since the cap exists to bound what we send to the model.
  const byteLength = Math.floor((base64.length * 3) / 4);

  const guard = guardVoiceNote({
    mimeType: media.mimeType || opts.mimeType,
    byteLength,
  });
  if (!guard.ok) {
    console.warn(
      "[voice-note] refused",
      guard.reason,
      media.mimeType,
      `${byteLength}B`,
      `cap=${MAX_VOICE_NOTE_BYTES}`,
    );
    return voiceNoteOutcome({ guard });
  }

  const r = await transcribeVoiceNote({
    base64,
    mimeType: guard.mimeType,
    byteLength,
    waMessageId: opts.waMessageId,
    requester: opts.requester,
  });

  if (!r.ok) {
    console.warn("[voice-note] transcription failed", r.failure, r.error);
    return voiceNoteOutcome({ guard, failure: r.failure });
  }

  return voiceNoteOutcome({ guard, result: r.result });
}
