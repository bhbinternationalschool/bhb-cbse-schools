/** BHB voice — English + Hindi (India). */

export type VoiceLang = "en-IN" | "hi-IN" | "auto";

export const VOICE_LANGS: { id: VoiceLang; label: string }[] = [
  { id: "auto", label: "Auto EN/HI" },
  { id: "en-IN", label: "English" },
  { id: "hi-IN", label: "हिंदी" },
];

export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

export function detectVoiceLang(text: string, fallback: VoiceLang = "en-IN"): VoiceLang {
  if (hasDevanagari(text)) return "hi-IN";
  if (fallback === "auto") return "en-IN";
  return fallback === "hi-IN" ? "hi-IN" : "en-IN";
}

export function resolveRecognitionLang(pref: VoiceLang): string {
  if (pref === "hi-IN") return "hi-IN";
  if (pref === "en-IN") return "en-IN";
  return "hi-IN";
}

export function resolveSpeakLang(text: string, pref: VoiceLang): string {
  if (pref === "hi-IN") return "hi-IN";
  if (pref === "en-IN") return "en-IN";
  return detectVoiceLang(text);
}
