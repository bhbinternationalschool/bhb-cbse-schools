/**
 * Browser voice — Web Speech API + optional Google Cloud fallback.
 */

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
  onError?: (message: string) => void;
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

  rec.onerror = () => {
    opts.onError?.("Could not hear you — try again");
    stopVoiceListen();
  };

  rec.onend = () => {
    activeRecognition = null;
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

export async function transcribeAudioBlob(
  blob: Blob,
  lang?: VoiceLang,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 = btoa(binary);
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
    return { ok: false, error: json.error || "Transcription failed" };
  }
  return { ok: true, text: json.text };
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
