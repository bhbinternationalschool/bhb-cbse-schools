/**
 * Browser voice — Web Speech API + optional Google Cloud fallback.
 */

import {
  DICTATION_WAV_RATE,
  downsampleMono,
  encodeWavPcm16,
  speechErrorMessage,
} from "@/lib/voiceDictation";
import {
  detectVoiceLang,
  resolveRecognitionLang,
  resolveSpeakLang,
  type VoiceLang,
} from "@/lib/voiceLanguages";

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function browserSpeechRecognitionSupported(): boolean {
  return !!getSpeechRecognition();
}

export function browserSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}

export type VoiceListenOptions = {
  lang?: VoiceLang;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  /** `code` is the Web Speech error code (e.g. "not-allowed") when there is one. */
  onError?: (message: string, code?: string) => void;
  /**
   * Fires once when this recognition session is over — after a result, an
   * error, silence, or stop(). Without it a caller whose session ended on
   * silence stayed "listening" forever (2026-09-30).
   */
  onEnd?: () => void;
};

let activeRecognition: SpeechRecognition | null = null;

export function stopVoiceListen(): void {
  try {
    activeRecognition?.stop();
  } catch {
    /* ignore */
  }
  activeRecognition = null;
}

export function startVoiceListen(opts: VoiceListenOptions): boolean {
  const Ctor = getSpeechRecognition();
  if (!Ctor) {
    opts.onError?.("Voice input not supported in this browser — use Chrome");
    return false;
  }
  stopVoiceListen();
  const rec = new Ctor();
  activeRecognition = rec;
  rec.lang = resolveRecognitionLang(opts.lang || "auto");
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;

  let finalText = "";

  rec.onresult = (ev: SpeechRecognitionEvent) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i]?.[0]?.transcript || "";
      if (ev.results[i]?.isFinal) finalText += t;
      else interim += t;
    }
    if (interim) opts.onInterim?.(interim.trim());
    if (finalText.trim()) opts.onFinal(finalText.trim());
  };

  rec.onerror = (ev: Event) => {
    const code = (ev as Event & { error?: string }).error;
    // "aborted" is our own stop() — not something to tell the teacher.
    if (code !== "aborted") {
      opts.onError?.(speechErrorMessage(code) || "Could not hear you — try again", code);
    }
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  };

  rec.onend = () => {
    // Only clear the slot if it is still ours: a newer session started by
    // another mic must not be orphaned by this one's late end event.
    if (activeRecognition === rec) activeRecognition = null;
    opts.onEnd?.();
  };

  try {
    rec.start();
    return true;
  } catch {
    opts.onError?.("Microphone blocked or busy");
    return false;
  }
}

let speakToken = 0;

export function stopSpeaking(): void {
  speakToken += 1;
  if (typeof window !== "undefined") {
    window.speechSynthesis?.cancel();
  }
}

export async function speakText(
  text: string,
  opts?: { lang?: VoiceLang; preferGoogle?: boolean },
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || typeof window === "undefined") return;

  const lang = resolveSpeakLang(trimmed, opts?.lang || "auto");
  const token = ++speakToken;

  if (opts?.preferGoogle) {
    try {
      const res = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, languageCode: lang }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        audioBase64?: string;
        mimeType?: string;
      };
      if (res.ok && json.ok && json.audioBase64) {
        const audio = new Audio(
          `data:${json.mimeType || "audio/mpeg"};base64,${json.audioBase64}`,
        );
        await audio.play();
        return;
      }
    } catch {
      /* fallback browser */
    }
  }

  if (token !== speakToken) return;
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(trimmed);
  u.lang = lang;
  window.speechSynthesis.speak(u);
}

function blobToBase64(blob: Blob): Promise<string> {
  // FileReader rather than a char-by-char String.fromCharCode loop: a
  // 55-second WAV is ~1.7 MB and the loop stalls low-end phones (2026-09-30).
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result || "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

/**
 * Decode a recording the browser can play but the speech service cannot read
 * (iPhone Safari's audio/mp4) and re-encode it as 16 kHz mono WAV, which the
 * transcribe route sends on as LINEAR16 (2026-09-30).
 */
export async function recordingToWav(blob: Blob): Promise<Blob> {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext || w.webkitAudioContext;
  if (!Ctx) throw new Error("This browser cannot convert the recording");
  const ctx = new Ctx();
  try {
    const buf = await blob.arrayBuffer();
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      // Older Safari only supports the callback form of decodeAudioData.
      const p = ctx.decodeAudioData(buf, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === "function") p.then(resolve, reject);
    });
    const len = decoded.length;
    const mono = new Float32Array(len);
    const n = decoded.numberOfChannels;
    for (let c = 0; c < n; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] = mono[i]! + ch[i]! / n;
    }
    const pcm = downsampleMono(mono, decoded.sampleRate, DICTATION_WAV_RATE);
    // Recorded below 16 kHz already (rare) — keep its own rate in the header.
    const rate = decoded.sampleRate < DICTATION_WAV_RATE ? decoded.sampleRate : DICTATION_WAV_RATE;
    return new Blob([encodeWavPcm16(pcm, rate)], { type: "audio/wav" });
  } finally {
    void ctx.close().catch(() => {});
  }
}

export async function transcribeAudioBlob(
  blob: Blob,
  lang?: VoiceLang,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const b64 = await blobToBase64(blob);
    const res = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64: b64,
        mimeType: blob.type || "audio/webm",
        languageCode: lang === "en-IN" ? "en-IN" : "hi-IN",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      text?: string;
      error?: string;
    };
    if (!res.ok || !json.text) {
      return { ok: false, error: json.error || `Transcription failed (${res.status})` };
    }
    return { ok: true, text: json.text };
  } catch {
    // Offline, or the request never reached the server — say so, never go quiet.
    return { ok: false, error: "Could not reach the server — check the connection" };
  }
}

export async function fetchVoiceStatus(): Promise<{
  browserStt: boolean;
  browserTts: boolean;
  googleSpeech: boolean;
}> {
  const browserStt = browserSpeechRecognitionSupported();
  const browserTts = browserSpeechSynthesisSupported();
  try {
    const res = await fetch("/api/voice");
    const json = (await res.json()) as { googleSpeech?: boolean };
    return {
      browserStt,
      browserTts,
      googleSpeech: !!json.googleSpeech,
    };
  } catch {
    return { browserStt, browserTts, googleSpeech: false };
  }
}

export { detectVoiceLang };
