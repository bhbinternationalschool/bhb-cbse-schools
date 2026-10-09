/**
 * Which spoken line a phone plays for a notification (director, 9 Oct 2026:
 * "voice for notification"). Each kind of alert has its own short clip —
 * "BHB School — होमवर्क आया है" — played by Android as the notification
 * sound, so it speaks even with the app closed and the phone locked.
 *
 * Staff hear English. Parents hear Hindi unless they chose English in the
 * WhatsApp chatbot's language menu (waTemplateLanguageFor).
 *
 * The kind comes from what the notification already says about itself — its
 * in-app link and data.kind — so none of the ~30 places that send one had to
 * change. Each clip lives in its own Android notification channel, whose id
 * is the clip's name (cbse_school_mobile/android/app/src/main/res/raw).
 * A phone on an older app has no such channel; Android then uses the app's
 * default channel and its normal sound, so nothing breaks. Pure.
 */

export type PushVoiceKind = "homework" | "attendance" | "fees" | "message" | "leave" | "notice";
export type PushVoiceLang = "hi" | "en";

export const PUSH_VOICE_KINDS: PushVoiceKind[] = ["homework", "attendance", "fees", "message", "leave", "notice"];

export function pushVoiceKind(url: string | undefined, dataKind?: string): PushVoiceKind {
  const s = `${url || ""} ${dataKind || ""}`.toLowerCase();
  if (/homework|\bhw\b|diary/.test(s)) return "homework";
  if (/attendance|absent/.test(s)) return "attendance";
  if (/fee|receipt|pay|dues|ledger/.test(s)) return "fees";
  if (/leave/.test(s)) return "leave";
  if (/chat|message|complaint|reply|relay|contact/.test(s)) return "message";
  return "notice";
}

/** The Android channel id — and the res/raw sound name — for a clip. */
export function pushVoiceChannel(kind: PushVoiceKind, lang: PushVoiceLang): string {
  return `bhb_voice_${kind}_${lang}`;
}
