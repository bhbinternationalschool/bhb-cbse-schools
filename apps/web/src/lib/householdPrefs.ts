/**
 * Household communication preferences — the one place the "which language,
 * which channel, when not to disturb" questions are answered for a family.
 *
 * Rules:
 *  - `""` means "not asked". Nothing here turns "not asked" into a fact:
 *    `householdLanguage()` returns the school default only when the caller
 *    passes one, and says so via `source: "default"`.
 *  - WhatsApp *templates* exist in en/hi only (Meta approval per language),
 *    so `waTemplateLanguageFor()` collapses regional preferences to Hindi
 *    (script the family can read) — free-text messages and AI drafts can
 *    still be rendered in the regional language through Sarvam.
 *  - Quiet hours are IST wall-clock, may cross midnight ("21:00" → "07:00").
 */

export type HouseholdLanguage = "en" | "hi" | "bn" | "ur" | "mai" | "bho";
export type HouseholdChannel = "whatsapp" | "sms" | "call";

export const HOUSEHOLD_LANGUAGES: {
  id: HouseholdLanguage;
  label: string;
  /** Name in its own script — what the parent sees on the option */
  native: string;
  /** Sarvam translate code; null = Sarvam does not translate into it */
  sarvam: string | null;
  /** Meta WhatsApp template language the school has approved for it */
  waTemplate: "en" | "hi";
}[] = [
  { id: "en", label: "English", native: "English", sarvam: "en-IN", waTemplate: "en" },
  { id: "hi", label: "Hindi", native: "हिंदी", sarvam: "hi-IN", waTemplate: "hi" },
  { id: "bho", label: "Bhojpuri", native: "भोजपुरी", sarvam: null, waTemplate: "hi" },
  { id: "mai", label: "Maithili", native: "मैथिली", sarvam: "mai-IN", waTemplate: "hi" },
  { id: "ur", label: "Urdu", native: "اردو", sarvam: "ur-IN", waTemplate: "hi" },
  { id: "bn", label: "Bengali", native: "বাংলা", sarvam: "bn-IN", waTemplate: "hi" },
];

export const HOUSEHOLD_CHANNELS: { id: HouseholdChannel; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "call", label: "Phone call" },
];

export function normalizeHouseholdLanguage(v: unknown): HouseholdLanguage | "" {
  const s = String(v ?? "").trim().toLowerCase();
  return HOUSEHOLD_LANGUAGES.some((l) => l.id === s) ? (s as HouseholdLanguage) : "";
}

export function normalizeHouseholdChannel(v: unknown): HouseholdChannel | "" {
  const s = String(v ?? "").trim().toLowerCase();
  return HOUSEHOLD_CHANNELS.some((c) => c.id === s) ? (s as HouseholdChannel) : "";
}

/** "HH:MM" 24h or ""; anything else → "" (never a guessed time). */
export function normalizeQuietTime(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return "";
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export type HouseholdPrefsLike = {
  preferredLanguage?: string;
  channelPreference?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
} | null | undefined;

export function languageLabel(id: string): string {
  const l = HOUSEHOLD_LANGUAGES.find((x) => x.id === id);
  return l ? `${l.label} · ${l.native}` : id || "—";
}

/**
 * The language to address this family in. `source` tells the caller
 * whether the family actually said so.
 */
export function householdLanguage(
  hh: HouseholdPrefsLike,
  schoolDefault: HouseholdLanguage = "en",
): { language: HouseholdLanguage; source: "household" | "default" } {
  const pref = normalizeHouseholdLanguage(hh?.preferredLanguage);
  return pref
    ? { language: pref, source: "household" }
    : { language: schoolDefault, source: "default" };
}

/** WhatsApp template language for this family (en/hi only exist). */
export function waTemplateLanguageFor(
  hh: HouseholdPrefsLike,
  schoolDefault: "en" | "hi" = "en",
): "en" | "hi" {
  const pref = normalizeHouseholdLanguage(hh?.preferredLanguage);
  if (!pref) return schoolDefault;
  return HOUSEHOLD_LANGUAGES.find((l) => l.id === pref)?.waTemplate ?? schoolDefault;
}

/** Sarvam target code when the family's language needs a translation pass
 * beyond en/hi; null when the draft language already matches or Sarvam
 * cannot produce it (caller then sends the en/hi text). */
export function sarvamTargetFor(hh: HouseholdPrefsLike): string | null {
  const pref = normalizeHouseholdLanguage(hh?.preferredLanguage);
  if (!pref || pref === "en" || pref === "hi") return null;
  return HOUSEHOLD_LANGUAGES.find((l) => l.id === pref)?.sarvam ?? null;
}

/** Minutes since midnight for "HH:MM"; null for "". */
function minutesOf(hhmm: string): number | null {
  const t = normalizeQuietTime(hhmm);
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Is `at` (default now, IST) inside the family's quiet window? False when
 * no window is set. Windows may cross midnight. Urgent messages (attendance
 * absence, safety) should ignore this; fee reminders and marketing must not.
 */
export function isInQuietHours(
  hh: HouseholdPrefsLike,
  at: Date = new Date(),
): boolean {
  const start = minutesOf(hh?.quietHoursStart ?? "");
  const end = minutesOf(hh?.quietHoursEnd ?? "");
  if (start == null || end == null || start === end) return false;
  // IST = UTC+5:30, no DST.
  const ist = new Date(at.getTime() + 330 * 60_000);
  const cur = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

export function quietHoursLabel(hh: HouseholdPrefsLike): string {
  const s = normalizeQuietTime(hh?.quietHoursStart ?? "");
  const e = normalizeQuietTime(hh?.quietHoursEnd ?? "");
  return s && e ? `${s}–${e}` : "";
}

/* ─── WhatsApp "which language?" flow (parent bot) ─────────────────── */

export const LANGUAGE_MENU_KEYWORDS = ["LANG", "LANGUAGE", "BHASHA", "भाषा"];

/** Numbered menu the bot sends; the number → code map is the same list. */
export function languageMenuText(): string {
  return [
    "Which language should the school message you in? Reply with the number:",
    ...HOUSEHOLD_LANGUAGES.map((l, i) => `${i + 1} — ${l.native}${l.native !== l.label ? ` (${l.label})` : ""}`),
    "You can change it any time by replying LANG.",
  ].join("\n");
}

/** Interpret a parent's reply to the menu: "2", "hindi", "हिंदी", "urdu"… → code, or null. */
export function parseLanguageChoice(text: string): HouseholdLanguage | null {
  const t = (text || "").trim().toLowerCase().replace(/[.)\]]+$/, "");
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= HOUSEHOLD_LANGUAGES.length) return HOUSEHOLD_LANGUAGES[n - 1].id;
  for (const l of HOUSEHOLD_LANGUAGES) {
    if (t === l.id || t === l.label.toLowerCase() || t === l.native.toLowerCase()) return l.id;
  }
  const alias: Record<string, HouseholdLanguage> = {
    english: "en", angrezi: "en", "अंग्रेजी": "en", "अंग्रेज़ी": "en",
    hindi: "hi", "हिन्दी": "hi",
    bhojpuri: "bho", "भोजपुरी": "bho",
    maithili: "mai", "मैथिली": "mai",
    urdu: "ur", "उर्दू": "ur", "اردو": "ur",
    bengali: "bn", bangla: "bn", "বাংলা": "bn", "बंगाली": "bn",
  };
  return alias[t] ?? null;
}

/** Confirmation in the chosen language (static — never sent through a model). */
export function languageChoiceConfirmation(code: HouseholdLanguage): string {
  switch (code) {
    case "hi":
      return "धन्यवाद। अब स्कूल के संदेश आपको हिंदी में मिलेंगे। बदलने के लिए LANG लिखें।";
    case "bho":
      return "धन्यवाद। अब स्कूल के संदेश आपको हिंदी (भोजपुरी परिवारों के लिए) में मिलेंगे। बदलने के लिए LANG लिखें।";
    case "mai":
      return "धन्यवाद। आब स्कूलक संदेश अहाँकेँ मैथिली/हिंदी मे भेटत। बदलबाक लेल LANG लिखू।";
    case "ur":
      return "شکریہ۔ اب اسکول کے پیغامات آپ کو اردو میں ملیں گے۔ تبدیل کرنے کے لیے LANG لکھیں۔";
    case "bn":
      return "ধন্যবাদ। এখন থেকে স্কুলের বার্তা আপনি বাংলায় পাবেন। বদলাতে LANG লিখুন।";
    default:
      return "Thank you. School messages will now come to you in English. Reply LANG any time to change.";
  }
}
