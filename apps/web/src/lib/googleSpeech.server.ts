/**
 * Google Cloud Speech-to-Text + Text-to-Speech (server-only).
 * Enable both APIs on the same GCP project as Maps/Gemini.
 */

export function speechApiKey(): string {
  return (
    process.env.GOOGLE_SPEECH_API_KEY ||
    process.env.GOOGLE_TTS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ""
  ).trim();
}

export function speechConfigured(): boolean {
  return speechApiKey().length > 0;
}

export async function googleSpeechToText(opts: {
  audioBase64: string;
  mimeType?: string;
  languageCode?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = speechApiKey();
  if (!key) {
    return { ok: false, error: "Speech API key not configured" };
  }

  // WhatsApp voice notes arrive as audio/ogg; codecs=opus at 16 kHz.
  const mime = (opts.mimeType || "").toLowerCase();
  const encoding = mime.includes("webm")
    ? "WEBM_OPUS"
    : mime.includes("ogg") || mime.includes("opus")
      ? "OGG_OPUS"
      : "LINEAR16";
  const lang = opts.languageCode || "hi-IN";

  try {
    const res = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            encoding,
            sampleRateHertz: encoding === "WEBM_OPUS" ? 48000 : 16000,
            languageCode: lang,
            alternativeLanguageCodes:
              lang === "hi-IN" ? ["en-IN"] : ["hi-IN"],
            enableAutomaticPunctuation: true,
          },
          audio: { content: opts.audioBase64.replace(/^data:[^;]+;base64,/, "") },
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      results?: { alternatives?: { transcript?: string }[] }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message || `Speech HTTP ${res.status}`,
      };
    }
    const text = (json.results || [])
      .flatMap((r) => r.alternatives || [])
      .map((a) => a.transcript || "")
      .join(" ")
      .trim();
    if (!text) {
      return { ok: false, error: "No speech detected" };
    }
    return { ok: true, text };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Speech recognition failed",
    };
  }
}

export async function googleTextToSpeech(opts: {
  text: string;
  languageCode?: string;
}): Promise<
  | { ok: true; audioBase64: string; mimeType: string }
  | { ok: false; error: string }
> {
  const key = speechApiKey();
  if (!key) {
    return { ok: false, error: "TTS API key not configured" };
  }
  const text = opts.text.trim().slice(0, 5000);
  if (!text) {
    return { ok: false, error: "Empty text" };
  }

  const lang = opts.languageCode || "hi-IN";
  const voiceName =
    lang.startsWith("hi") ? "hi-IN-Standard-A" : "en-IN-Standard-A";

  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: lang, name: voiceName },
          audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      audioContent?: string;
      error?: { message?: string };
    };
    if (!res.ok || !json.audioContent) {
      return {
        ok: false,
        error: json.error?.message || `TTS HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      audioBase64: json.audioContent,
      mimeType: "audio/mpeg",
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "TTS failed",
    };
  }
}
