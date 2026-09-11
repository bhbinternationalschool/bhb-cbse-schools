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
/**
 * The language the school writes in when a family has not said otherwise.
 *
 * Hindi, decided 2026-09-07. It was "en", hardcoded at each call site, and
 * every one of the school's 198 households had a blank preferred_language —
 * so in practice EVERY parent received English, in a school where most
 * families read Hindi far more comfortably. The language flow that was meant
 * to fix that per family had never once saved a choice.
 *
 * A family that picks a language still overrides this; the default only
 * decides what happens before they ever say. One constant, so the school's
 * language is a decision in one place rather than a literal repeated at
 * every call.
 */
export const SCHOOL_DEFAULT_WA_LANGUAGE: "en" | "hi" = "hi";

export function waTemplateLanguageFor(
  hh: HouseholdPrefsLike,
  schoolDefault: "en" | "hi" = SCHOOL_DEFAULT_WA_LANGUAGE,
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

/**
 * What to do about a parent's message when we may not know their language.
 *
 * The old rule asked "was the LAST BOT MESSAGE the language menu?" — which
 * read the SIS bot's thread. That thread is never persisted (only the
 * classChannel, hub, staffAtt and unified slices reach
 * `wa_desk_bot_slices`), so on any fresh instance the thread is empty, the
 * question is never recognised as pending, and a bare "2" falls through to
 * intent detection. Every one of the school's 198 households still had a
 * blank preferred_language on 2026-09-07: the choice had NEVER once been
 * saved, and every parent silently got English.
 *
 * So the decision is taken from the HOUSEHOLD instead, which does persist:
 *
 *   language already known  → never ask again, and a bare number means
 *                             whatever it normally means;
 *   not known, message is a choice → save it;
 *   not known, asked for the menu  → show it;
 *   not known, anything else       → ask, once, on this reply.
 *
 * Asking on the parent's own reply is also what makes it FREE. Meta's
 * 24-hour service window opens when the CUSTOMER messages the business —
 * sending them a template does not open it. So the menu cannot be pushed out
 * behind a receipt; it rides on the parent's first reply, when the window is
 * already open, and it is asked at most once because the answer is stored.
 */
export type LanguageGate =
  | { action: "save"; choice: HouseholdLanguage }
  | { action: "ask" }
  | { action: "pass" };

export function languageGateDecision(input: {
  /** The household's stored preference; "" when never set. */
  known: string | null | undefined;
  text: string;
}): LanguageGate {
  const text = (input.text || "").trim();
  const known = (input.known || "").trim();
  const upper = text.toUpperCase();
  const askedForMenu = LANGUAGE_MENU_KEYWORDS.some(
    (k) => upper === k || upper.startsWith(`${k} `),
  );

  // "LANG hindi" in one line, from anyone, at any time — an explicit change.
  if (askedForMenu) {
    const inline = parseLanguageChoice(text.replace(/^\S+\s*/, ""));
    return inline ? { action: "save", choice: inline } : { action: "ask" };
  }

  // Known already: never interpret a stray number as a language again. "2"
  // now belongs to whatever menu the parent is actually looking at.
  if (known) return { action: "pass" };

  // STRICT parse for an unprompted message. The two-letter codes collide with
  // ordinary words a parent actually types — "hi" is both the Hindi code and
  // the commonest English greeting in these chats, and "en"/"ur"/"bn" are no
  // safer. Reading "hi" as a language choice would silently set half the
  // school to Hindi the first time they said hello. Only an unambiguous
  // answer counts here: a menu number, or the language's name in either
  // script. After an explicit LANG the codes are fine, because the parent is
  // answering a question we just asked.
  const choice = parseLanguageChoiceStrict(text);
  if (choice) return { action: "save", choice };

  // Unknown, and they have just written to us: the window is open, so ask.
  return { action: "ask" };
}

/**
 * May the language question be the WHOLE reply?
 *
 * Only when the parent said nothing that needs an answer — a greeting, an
 * empty message, a bare "menu". Anything else ("Already paid", "DUES",
 * "थोड़ा समय चाहिए", a question) is answered first and the language
 * question rides behind the answer. On 11 Sep 2026 the menu was sent
 * INSTEAD of the answer to nine families replying to a fee reminder: three
 * "already paid" taps, a request for time and a DUES never reached anyone.
 */
export function languageAskStandsAlone(input: { text: string; isGreeting: boolean }): boolean {
  const t = (input.text || "").trim();
  return input.isGreeting || !t || t === "(open)";
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

/**
 * `parseLanguageChoice` without the bare two-letter codes.
 *
 * Used for messages the parent sent unprompted, where "hi" is overwhelmingly
 * a greeting rather than a request for Hindi. Numbers and full names stay.
 */
export function parseLanguageChoiceStrict(text: string): HouseholdLanguage | null {
  const t = (text || "").trim().toLowerCase().replace(/[.)\]]+$/, "");
  if (!t) return null;
  if (HOUSEHOLD_LANGUAGES.some((l) => t === l.id)) return null;
  return parseLanguageChoice(t);
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
