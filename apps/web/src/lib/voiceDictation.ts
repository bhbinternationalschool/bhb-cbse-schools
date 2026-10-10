/**
 * Voice dictation — the pure parts (2026-09-30).
 *
 * Teachers use the web ERP on their phones, mostly in Hindi or Hinglish, and
 * type slowly on a phone keyboard. The mic next to a remark / note / reason
 * box records them and appends what they said. Everything here is pure so it
 * can be tested without a browser: how dictated text joins what is already
 * typed, which recorder format to ask for, which formats the speech service
 * can read as-is, and the WAV encoder for the ones it cannot (iPhone Safari
 * records audio/mp4, which Google speech v1 does not accept).
 */

/**
 * Google speech:recognize (synchronous) refuses audio longer than one minute.
 * Stop a little before so the last word is not what tips it over.
 */
export const MAX_DICTATION_MS = 55_000;

/** Google's synchronous request cap is 10 MB of audio; base64 is 4/3 of that. */
export const MAX_DICTATION_BASE64_CHARS = 13_500_000;

/** The sample rate the WAV fallback is encoded at — the route tells Google 16 kHz for LINEAR16. */
export const DICTATION_WAV_RATE = 16_000;

/**
 * Join dictated text onto what the teacher already typed. Never replaces:
 * a second sentence must not wipe the first. What was typed is kept exactly
 * (including a trailing newline the teacher put there on purpose); only the
 * dictated piece is trimmed.
 */
export function appendDictation(current: string | null | undefined, dictated: string): string {
  const add = (dictated || "").replace(/\s+/g, " ").trim();
  const base = current ?? "";
  if (!add) return base;
  if (!base.trim()) return add;
  if (/\s$/.test(base)) return base + add;
  return `${base} ${add}`;
}

/**
 * Recorder formats in order of preference. WebM and Ogg Opus go to Google as
 * they are; audio/mp4 (iPhone Safari's only format before 18.4) is decoded in
 * the browser and re-encoded as WAV before upload.
 */
export const RECORDER_MIME_PREFERENCE = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

/** The first format this browser can record, or "" to let the browser choose. */
export function pickRecorderMime(isTypeSupported: (mime: string) => boolean): string {
  for (const m of RECORDER_MIME_PREFERENCE) {
    try {
      if (isTypeSupported(m)) return m;
    } catch {
      /* some webviews throw instead of answering false */
    }
  }
  return "";
}

export type SpeechAudioKind = "webm" | "ogg" | "wav";

/**
 * Which encoding the speech service will be told, or null when it cannot
 * read this format as-is (mp4 / aac / m4a / unknown). The route refuses null
 * rather than sending it on as LINEAR16 — that "works" and returns nonsense.
 */
export function speechAudioKind(mime: string | null | undefined): SpeechAudioKind | null {
  const m = (mime || "").toLowerCase().trim();
  if (!m) return null;
  // Container first: "audio/mp4;codecs=opus" is still an mp4 file.
  if (/mp4|m4a|aac|mpeg|3gp/.test(m)) return null;
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("wav") || m.includes("l16") || m.includes("pcm")) return "wav";
  return null;
}

/** True when a recording must be converted to WAV in the browser before upload. */
export function needsWavConversion(mime: string | null | undefined): boolean {
  return speechAudioKind(mime) === null;
}

/** "0:07", "1:02" — the recording clock shown next to the stop button. */
export function formatDictationClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Average-downsample mono float samples to `outRate`. Averaging (not
 * dropping) samples is a cheap low-pass, enough for speech at 16 kHz.
 */
export function downsampleMono(samples: Float32Array, inRate: number, outRate: number): Float32Array {
  if (!(inRate > 0) || !(outRate > 0) || outRate >= inRate) return samples;
  const ratio = inRate / outRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** 16-bit PCM mono WAV (44-byte RIFF header + little-endian samples). */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/**
 * The teacher-facing message for a Web Speech API error code. A mic that
 * fails must say why — a button that just stops pulsing reads as "it heard
 * nothing", and the teacher gives up on it.
 */
export function speechErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "not-allowed":
      return "Microphone blocked — allow it in the browser settings";
    case "service-not-allowed":
      return "Voice typing is off on this phone";
    case "no-speech":
      return "Didn't hear anything — tap the mic and speak";
    case "audio-capture":
      return "No microphone found";
    case "network":
      return "Voice needs internet — check the connection";
    case "language-not-supported":
      return "This language is not available for voice here";
    case "aborted":
      return "";
    default:
      return "Could not hear you — try again";
  }
}

/**
 * Codes after which the browser's own recognition will not work on this
 * device, so recording + server transcription is the way (iPhone with Siri
 * off reports service-not-allowed; some webviews claim support and then
 * refuse the language).
 */
export function speechErrorMeansUseRecorder(code: string | null | undefined): boolean {
  return code === "service-not-allowed" || code === "language-not-supported";
}
