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
 * is the clip's name (cbse_school_mobile/android/app/src/main/res/raw) —
 * plus `_v2` for approval/document (see PUSH_VOICE_V2_KINDS).
 * A phone on an older app has no such channel; Android then uses the app's
 * default channel and its normal sound, so nothing breaks. Pure.
 */

export type PushVoiceKind =
  | "homework"
  | "attendance"
  | "fees"
  | "message"
  | "leave"
  | "notice"
  // 20 Oct 2026 (lib/notify): named only by the notification service, never
  // inferred from a link, so the ~30 older send sites keep their clips.
  | "approval"
  | "document";
export type PushVoiceLang = "hi" | "en";

export const PUSH_VOICE_KINDS: PushVoiceKind[] = [
  "homework",
  "attendance",
  "fees",
  "message",
  "leave",
  "notice",
  "approval",
  "document",
];

export function isPushVoiceKind(v: unknown): v is PushVoiceKind {
  return typeof v === "string" && (PUSH_VOICE_KINDS as string[]).includes(v);
}

export function pushVoiceKind(url: string | undefined, dataKind?: string): PushVoiceKind {
  const s = `${url || ""} ${dataKind || ""}`.toLowerCase();
  if (/homework|\bhw\b|diary/.test(s)) return "homework";
  if (/attendance|absent/.test(s)) return "attendance";
  if (/fee|receipt|pay|dues|ledger/.test(s)) return "fees";
  if (/leave/.test(s)) return "leave";
  if (/chat|message|complaint|reply|relay|contact/.test(s)) return "message";
  return "notice";
}

/** The clip's res/raw sound name (cbse_school_mobile/android/app/src/main/res/raw). */
export function pushVoiceSound(kind: PushVoiceKind, lang: PushVoiceLang): string {
  return `bhb_voice_${kind}_${lang}`;
}

/**
 * Kinds whose Android channel was renamed `<clip>_v2` (21 Oct 2026). A build
 * with placeholder clips for approval/document reached phones, and Android
 * fixes a channel's sound when the channel is first created — so the real
 * clips (PR #698) only play on a channel id those phones have never seen.
 * The clip files keep their names; only the channel id changes.
 */
export const PUSH_VOICE_V2_KINDS: readonly PushVoiceKind[] = ["approval", "document"];

/** The first app build that creates the `_v2` channels (pubspec 1.0.34+35). */
export const PUSH_VOICE_V2_MIN_BUILD = 35;

/** The Android channel id for a clip, as the current app creates it. */
export function pushVoiceChannel(kind: PushVoiceKind, lang: PushVoiceLang): string {
  const sound = pushVoiceSound(kind, lang);
  return PUSH_VOICE_V2_KINDS.includes(kind) ? `${sound}_v2` : sound;
}

/** The res/raw sound a voice channel plays (`bhb_voice_approval_en_v2` → `bhb_voice_approval_en`). */
export function pushVoiceSoundOfChannel(channel: string): string {
  return channel.replace(/_v\d+$/, "");
}

/** The build number of an app version string ("1.0.34+35" → 35), or null. */
function buildOf(appVersion: string | undefined): number | null {
  const m = /\+(\d+)\s*$/.exec(appVersion || "");
  return m ? Number(m[1]) : null;
}

/**
 * The channel id to send to one installed app. An app older than the `_v2`
 * release (or one that never said its version) gets the pre-v2 id, which it
 * still has; naming a channel it lacks would make Firebase fall back to the
 * app's default channel (bhb_default) and its normal sound.
 */
export function pushVoiceChannelForApp(channel: string, appVersion: string | undefined): string {
  if (!/^bhb_voice_.*_v2$/.test(channel)) return channel;
  const build = buildOf(appVersion);
  return build != null && build >= PUSH_VOICE_V2_MIN_BUILD ? channel : pushVoiceSoundOfChannel(channel);
}
