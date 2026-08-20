/**
 * Staff WhatsApp attendance bot — client-safe engine (keywords + texts).
 *
 * Bilingual: every composer takes the staff member's saved language
 * ("en" | "hi", chosen once on first contact via LANG / 1 / 2 and
 * remembered on the thread). Keywords stay English (IN / OUT / STATUS)
 * with Hindi aliases accepted.
 */

import { TENANT } from "@/lib/types";

export type StaffAttLang = "en" | "hi";

export type StaffAttBotQuickId =
  | "in"
  | "out"
  | "status"
  | "attend"
  | "cancel"
  | "human"
  | "lang";

export const STAFF_ATT_BOT_KEYWORDS: {
  id: StaffAttBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "in", label: "Punch in", waKeyword: "IN" },
  { id: "out", label: "Punch out", waKeyword: "OUT" },
  { id: "status", label: "Today's attendance", waKeyword: "STATUS" },
  { id: "attend", label: "Attendance help", waKeyword: "ATTEND" },
  { id: "cancel", label: "Cancel pending", waKeyword: "CANCEL" },
  { id: "human", label: "HR / office", waKeyword: "HUMAN" },
  { id: "lang", label: "Language / भाषा", waKeyword: "LANG" },
];

export function staffAttLanguageMenuText(staffName?: string): string {
  return [
    `*${TENANT.shortName}*${staffName ? ` · ${staffName}` : ""}`,
    "",
    "Choose your language for attendance messages / उपस्थिति संदेशों के लिए अपनी भाषा चुनें:",
    "*1* — English",
    "*2* — हिंदी",
    "",
    "(Reply 1 or 2 — remembered for future · बाद में *LANG* लिखकर बदल सकते हैं)",
  ].join("\n");
}

export function parseStaffAttLanguage(text: string): StaffAttLang | null {
  const t = (text || "").trim().toLowerCase().replace(/[.)\]]+$/, "");
  if (t === "1" || t === "english" || t === "en" || t === "अंग्रेजी" || t === "अंग्रेज़ी") return "en";
  if (t === "2" || t === "hindi" || t === "hi" || t === "हिंदी" || t === "हिन्दी") return "hi";
  return null;
}

export function staffAttLanguageConfirmText(lang: StaffAttLang): string {
  return lang === "hi"
    ? "धन्यवाद! अब उपस्थिति संदेश आपको हिंदी में मिलेंगे। बदलने के लिए कभी भी *LANG* लिखें।"
    : "Thank you! Attendance messages will now come in English. Reply *LANG* anytime to change.";
}

export function staffAttBotWelcomeText(staffName: string | undefined, lang: StaffAttLang): string {
  if (lang === "hi") {
    return [
      `*${TENANT.shortName}* स्टाफ़ उपस्थिति${staffName ? ` · ${staffName}` : ""}`,
      "",
      "स्कूल परिसर से *लाइव लोकेशन* के साथ पंच:",
      "• *IN* — पंच इन + 📍 लोकेशन",
      "• *OUT* — पंच आउट + 📍 लोकेशन",
      "• *STATUS* — आज की उपस्थिति",
      "",
      "WhatsApp → 📎 → *Location* → *Send your current location*",
      "(स्कूल परिसर में होना ज़रूरी है — GPS जियोफ़ेंस · भाषा बदलें: *LANG*)",
    ].join("\n");
  }
  return [
    `*${TENANT.shortName}* staff attendance${staffName ? ` · ${staffName}` : ""}`,
    "",
    "Campus punch with *live location* (anti-proxy):",
    "• *IN* — punch in + 📍 location pin",
    "• *OUT* — punch out + 📍 location pin",
    "• *STATUS* — today's IN/OUT",
    "",
    "WhatsApp → 📎 → *Location* → *Send your current location*",
    "(Must be on school premises — GPS geofence · change language: *LANG*)",
  ].join("\n");
}

export function staffAttAskLocationText(action: "in" | "out", lang: StaffAttLang): string {
  if (lang === "hi") {
    const verb = action === "in" ? "पंच *IN*" : "पंच *OUT*";
    return [
      `*${verb} के लिए लोकेशन भेजें*`,
      "",
      "📎 → *Location* → *Send your current location* पर टैप करें।",
      "सेव की गई जगह / घर का पिन मान्य नहीं — स्कूल में लाइव GPS भेजें।",
      "",
      "रद्द करने के लिए *CANCEL* लिखें।",
    ].join("\n");
  }
  const verb = action === "in" ? "punch IN" : "punch OUT";
  return [
    `*Share location to ${verb}*`,
    "",
    "Tap 📎 → *Location* → *Send your current location*.",
    "Saved places / home pins are not accepted — use live GPS at school.",
    "",
    "Reply *CANCEL* to abort.",
  ].join("\n");
}

/** Early check-out: staff replied OUT while school is still running. */
export function staffAttEarlyOutWarningText(opts: { now: string; end: string; lang: StaffAttLang }): string {
  if (opts.lang === "hi") {
    return [
      "⚠️ *स्कूल समय अभी चालू है*",
      "",
      `अभी ${opts.now} बजे हैं और स्कूल ${opts.end} बजे तक चलता है। आप स्कूल समय के भीतर चेक-आउट कर रहे हैं।`,
      "",
      "अगर सच में जल्दी जाना है (अनुमति/काम से), तो *YES* लिखें — फिर लोकेशन भेजें। यह रजिस्टर में *early checkout* के रूप में दर्ज होगा और HR देख सकता है।",
      "गलती से लिखा है तो *CANCEL* लिखें।",
    ].join("\n");
  }
  return [
    "⚠️ *School is still in session*",
    "",
    `It is ${opts.now} and school timing runs till ${opts.end}. You are checking out within school timing.`,
    "",
    "If you really are leaving early (with permission / on duty), reply *YES* — then share your location. It will be recorded as an *early checkout* in the register and HR can see it.",
    "Reply *CANCEL* if this was a mistake.",
  ].join("\n");
}

export function detectStaffAttBotIntent(text: string): StaffAttBotQuickId | "unknown" {
  const t = (text || "").trim();
  const upper = t.toUpperCase();
  for (const q of STAFF_ATT_BOT_KEYWORDS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  const low = t.toLowerCase();
  if (/^punch\s*in|check\s*in|clock\s*in|^in$|^हाज़िरी|^haziri|^पंच इन/.test(low)) return "in";
  if (/^punch\s*out|check\s*out|clock\s*out|^out$|^छुट्टी|^chutti|^पंच आउट/.test(low)) return "out";
  if (/status|my attendance|today|आज|स्थिति/.test(low)) return "status";
  if (/attend|attendance|उपस्थिति/.test(low)) return "attend";
  if (/^cancel|abort|रद्द/.test(low)) return "cancel";
  if (/^lang|language|भाषा|bhasha/.test(low)) return "lang";
  if (/human|hr|office|help|मदद/.test(low)) return "human";
  return "unknown";
}

export function isStaffAttendanceKeyword(text: string): boolean {
  return detectStaffAttBotIntent(text) !== "unknown";
}

/** Early-out confirmation words (used only while the confirm is pending). */
export function isEarlyOutConfirm(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return t === "yes" || t === "y" || t === "haan" || t === "हाँ" || t === "confirm" || t === "out confirm";
}

export function composeStaffAttPunchSuccess(opts: {
  kind: "in" | "out";
  time: string;
  distanceM: number;
  staffName: string;
  altMobile?: boolean;
  earlyOut?: boolean;
  schoolEnd?: string;
  lang: StaffAttLang;
}): string {
  if (opts.lang === "hi") {
    const lines = [
      opts.kind === "in" ? "✅ *पंच IN दर्ज हुआ*" : "✅ *पंच OUT दर्ज हुआ*",
      `${opts.staffName} · ${opts.time} IST`,
      `📍 स्कूल परिसर में (~${formatDistanceLabel(opts.distanceM)} स्कूल से)`,
    ];
    if (opts.earlyOut) lines.push(`⚠️ स्कूल समय (${opts.schoolEnd || ""} तक) के भीतर early checkout — रजिस्टर में दर्ज।`);
    if (opts.altMobile) lines.push("⚠ *alt mobile* से दर्ज — HR जाँच कर सकता है।");
    lines.push("", "कभी भी *STATUS* लिखें।");
    return lines.join("\n");
  }
  const lines = [
    opts.kind === "in" ? "✅ *Punch IN recorded*" : "✅ *Punch OUT recorded*",
    `${opts.staffName} · ${opts.time} IST`,
    `📍 On campus (~${formatDistanceLabel(opts.distanceM)} from school)`,
  ];
  if (opts.earlyOut) lines.push(`⚠️ Early checkout within school timing (till ${opts.schoolEnd || ""}) — noted in the register.`);
  if (opts.altMobile) lines.push("⚠ Registered via *alt mobile* — HR may verify.");
  lines.push("", "Reply *STATUS* anytime.");
  return lines.join("\n");
}

export function composeStaffAttHumanReply(lang: StaffAttLang): string {
  return lang === "hi"
    ? ["*HR / उपस्थिति डेस्क* से जोड़ा जा रहा है।", "अपना नाम, समस्या और आज की तारीख़ लिखें।"].join("\n")
    : ["Connecting you to *HR / attendance desk*.", "Share your name, issue, and today's date."].join("\n");
}

export function staffAttCancelText(lang: StaffAttLang): string {
  return lang === "hi"
    ? "उपस्थिति कार्रवाई रद्द। *IN*, *OUT* या *STATUS* लिखें।"
    : "Attendance step cancelled. Reply *IN*, *OUT*, or *STATUS*.";
}

export function staffAttLocationWithoutPendingText(lang: StaffAttLang): string {
  return lang === "hi"
    ? "पहले *IN* या *OUT* लिखें, फिर लोकेशन पिन भेजें।"
    : "Reply *IN* or *OUT* first, then share your location pin.";
}

function formatDistanceLabel(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
