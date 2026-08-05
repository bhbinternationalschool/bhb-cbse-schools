/**
 * Parent portal voice commands — English + Hindi keyword routing.
 */

export type ParentPortalTab =
  | "fees"
  | "homework"
  | "ptm"
  | "leave"
  | "subjects"
  | "notices"
  | "news"
  | "gallery"
  | "profile";

export type ParentVoiceResult = {
  tab?: ParentPortalTab;
  reply: string;
  speakLang: "en-IN" | "hi-IN";
};

const TAB_PATTERNS: { tab: ParentPortalTab; re: RegExp }[] = [
  { tab: "fees", re: /\b(fee|fees|pending|dues|balance|फीस|शुल्क|बकाया)\b/i },
  { tab: "homework", re: /\b(homework|hw|assignment|diary|होमवर्क|कार्य|गृहकार्य)\b/i },
  { tab: "notices", re: /\b(notice|notices|circular|सूचना|नोटिस)\b/i },
  { tab: "news", re: /\b(news|announcement|समाचार|खबर)\b/i },
  { tab: "gallery", re: /\b(gallery|photo|photos|गैलरी|तस्वीर)\b/i },
  { tab: "ptm", re: /\b(ptm|parent.?teacher|meeting|मीटिंग|अभिभावक)\b/i },
  { tab: "leave", re: /\b(leave|absent|छुट्टी|अवकाश)\b/i },
  { tab: "subjects", re: /\b(subject|subjects|पाठ|विषय)\b/i },
  {
    tab: "profile",
    re: /\b(profile|document|documents|aadhaar|photo|upload|प्रोफाइल|दस्तावेज|आधार)\b/i,
  },
];

const TAB_LABEL: Record<ParentPortalTab, { en: string; hi: string }> = {
  fees: { en: "Fees", hi: "फीस" },
  homework: { en: "Homework", hi: "होमवर्क" },
  ptm: { en: "PTM", hi: "अभिभावक बैठक" },
  leave: { en: "Leave", hi: "छुट्टी" },
  subjects: { en: "Subjects", hi: "विषय" },
  notices: { en: "Notices", hi: "सूचनाएँ" },
  news: { en: "News", hi: "समाचार" },
  gallery: { en: "Gallery", hi: "गैलरी" },
  profile: { en: "Profile & docs", hi: "प्रोफाइल" },
};

export function parseParentVoiceCommand(text: string): ParentVoiceResult {
  const t = text.trim();
  const hi = /[\u0900-\u097F]/.test(t);

  for (const { tab, re } of TAB_PATTERNS) {
    if (re.test(t)) {
      const labels = TAB_LABEL[tab];
      return {
        tab,
        reply: hi
          ? `${labels.hi} खोल रहा हूँ।`
          : `Opening ${labels.en}.`,
        speakLang: hi ? "hi-IN" : "en-IN",
      };
    }
  }

  if (/\b(help|menu|मदद|सहायता)\b/i.test(t)) {
    return {
      reply: hi
        ? "बोलिए: फीस, होमवर्क, सूचना, समाचार, पीटीएम, या छुट्टी।"
        : "Say: fees, homework, notices, news, PTM, or leave.",
      speakLang: hi ? "hi-IN" : "en-IN",
    };
  }

  return {
    reply: hi
      ? "समझ नहीं आया। कहिए: फीस, होमवर्क, या सूचना।"
      : "I didn't catch that. Try: fees, homework, or notices.",
    speakLang: hi ? "hi-IN" : "en-IN",
  };
}
