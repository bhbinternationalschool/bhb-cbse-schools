/**
 * Shared admissions (CRM parent) bot logic — used by web widget and WhatsApp Business API.
 * Audience: enquiry / registration parents only — not SIS student parents.
 */

import { TENANT } from "@/lib/types";

export type CrmBotQuickId =
  | "fee"
  | "register"
  | "docs"
  | "status"
  | "visit"
  | "human";

export const CRM_BOT_QUICK_PROMPTS: {
  id: CrmBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "fee", label: "Registration fee", waKeyword: "FEE" },
  { id: "register", label: "Register online", waKeyword: "REGISTER" },
  { id: "docs", label: "Documents needed", waKeyword: "DOCS" },
  { id: "status", label: "My application status", waKeyword: "STATUS" },
  { id: "visit", label: "Visit / counselling", waKeyword: "VISIT" },
  { id: "human", label: "Talk to admissions", waKeyword: "HUMAN" },
];

/** The admission menu's explanations in Hindi; keywords stay in English letters. */
export const CRM_BOT_LABEL_HI: Record<CrmBotQuickId, string> = {
  fee: "रजिस्ट्रेशन फीस",
  register: "ऑनलाइन रजिस्ट्रेशन",
  docs: "ज़रूरी दस्तावेज़",
  status: "मेरे आवेदन की स्थिति",
  visit: "स्कूल आएँ / परामर्श",
  human: "एडमिशन ऑफिस से बात करें",
};

export function crmBotWelcomeText(hindi = false): string {
  if (hindi) {
    return [
      `नमस्ते 🙏 — *${TENANT.shortName} एडमिशन* (WhatsApp / वेबसाइट)।`,
      "",
      "मैं *एडमिशन चाहने वाले अभिभावकों* की मदद करता हूँ (जानकारी और रजिस्ट्रेशन)।",
      "जिनके बच्चे पहले से स्कूल में हैं: फीस के लिए Parent login इस्तेमाल करें — यह बॉट नहीं।",
      "",
      "नीचे का कोई शब्द लिखें या अपना सवाल अपने शब्दों में पूछें:",
      ...CRM_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${CRM_BOT_LABEL_HI[q.id]}`),
    ].join("\n");
  }
  return [
    `Namaste — *${TENANT.shortName} Admissions* (WhatsApp / web).`,
    "",
    "I help *parents seeking admission* (enquiry & registration).",
    "Enrolled families: use Parent login for fees — not this bot.",
    "",
    "Reply with a keyword or ask in your words:",
    ...CRM_BOT_QUICK_PROMPTS.map((q) => `• *${q.waKeyword}* — ${q.label}`),
  ].join("\n");
}

/**
 * An exact keyword / button id ("FEE", "docs") or a greeting — the canned
 * menu reply is the right answer and the KB should not be consulted. Any
 * other sentence is a free question: KB first, keyword reply as fallback.
 */
export function isCrmKeywordOrGreeting(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 4) return true;
  const upper = t.toUpperCase();
  if (CRM_BOT_QUICK_PROMPTS.some((q) => upper === q.waKeyword || q.id === t.toLowerCase())) return true;
  return /^(hi|hello|hey|namaste|namaskar|menu|start|ok|okay|thanks|thank you|yes|no|haan|nahi)\b/i.test(t);
}

export function detectCrmBotIntent(text: string): CrmBotQuickId | "unknown" {
  const t = (text || "").trim();
  const upper = t.toUpperCase();
  for (const q of CRM_BOT_QUICK_PROMPTS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  // Interactive button / list reply ids often come as fee, register, etc.
  const asId = t.toLowerCase() as CrmBotQuickId;
  if (CRM_BOT_QUICK_PROMPTS.some((q) => q.id === asId)) return asId;

  const low = t.toLowerCase();
  if (/fee|payment|\bpay\b|upi|amount|₹|\brs\.?\b/.test(low)) return "fee";
  if (/register|registration|apply|admission form|sibling/.test(low))
    return "register";
  if (/document|docs|certificate|aadhaar|aadhar|birth|tc\b/.test(low))
    return "docs";
  if (/status|enquiry|application|lead|where.*form/.test(low)) return "status";
  if (/visit|campus|counsell|office|meet|tour/.test(low)) return "visit";
  if (
    /human|counsellor|counselor|staff|agent|person|call me|talk to|help desk|hi\b|hello|namaste|start|menu/.test(
      low,
    )
  ) {
    if (/hi\b|hello|namaste|start|menu/.test(low)) return "unknown"; // show menu
    return "human";
  }
  return "unknown";
}

export type CrmBotLeadContext = {
  childName?: string;
  enquiryNo?: string;
  applicationNo?: string;
  stageLabel?: string;
  feeAmountLabel?: string;
  /** ISO date the family first enquired. */
  enquiryDate?: string;
  /** How the enquiry reached the school, in words a parent recognises. */
  sourceLabel?: string;
  /** Every child on file for this family, for a multi-sibling enquiry. */
  siblingNames?: string[];
} | null;

/** AdmissionSource → words a parent recognises. */
export const ADMISSION_SOURCE_LABELS: Record<string, string> = {
  walk_in: "Walk-in at school",
  website: "School website",
  referral: "Referral",
  field_survey: "Field survey team",
  social: "WhatsApp / social",
  google: "Google",
  phone: "Phone call",
  whatsapp: "WhatsApp",
  other: "Other",
};

/** The same sources in Hindi, for a family the school writes to in Hindi. */
export const ADMISSION_SOURCE_LABELS_HI: Record<string, string> = {
  walk_in: "स्कूल में आकर",
  website: "स्कूल की वेबसाइट",
  referral: "किसी की सिफ़ारिश",
  field_survey: "स्कूल की सर्वे टीम",
  social: "WhatsApp / सोशल मीडिया",
  google: "Google",
  phone: "फ़ोन कॉल",
  whatsapp: "WhatsApp",
  other: "अन्य",
};

/** "12 Aug 2026" — parents read dates, not ISO strings. */
export function formatEnquiryDate(iso: string): string {
  const d = (iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  const parsed = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What the school already has on file for this enquiry, offered back to
 * the parent with the one question that moves it forward.
 *
 * Sent only to a family whose children are not yet on the SIS register —
 * telling an enrolled parent to "register for admission" would be both
 * wrong and alarming, and the caller checks that before composing this.
 */
export function composeAdmissionOffer(
  lead: NonNullable<CrmBotLeadContext>,
  registerUrl: string,
  hindi = false,
): string {
  const when = formatEnquiryDate(lead.enquiryDate || "");
  const kids =
    lead.siblingNames && lead.siblingNames.length > 1
      ? lead.siblingNames.join(", ")
      : lead.childName || "";

  if (hindi) {
    return [
      `*${TENANT.nameDisplay} — एडमिशन*`,
      "",
      "आपकी एडमिशन जानकारी हमारे पास दर्ज है:",
      kids ? `• बच्चा: *${kids}*` : null,
      lead.enquiryNo ? `• पूछताछ नंबर: ${lead.enquiryNo}` : null,
      when ? `• पूछताछ की तारीख: ${when}` : null,
      lead.sourceLabel ? `• कैसे जुड़े: ${lead.sourceLabel}` : null,
      lead.stageLabel ? `• स्थिति: *${lead.stageLabel}*` : null,
      "",
      "क्या आप एडमिशन की प्रक्रिया आगे बढ़ाना चाहेंगे?",
      "",
      "रजिस्ट्रेशन करने और रजिस्ट्रेशन फीस जमा करने के लिए *YES* (हाँ) लिखें, या यदि आपने मन बदल लिया है तो *NO* (नहीं) लिखें।",
      `आप सीधे फ़ॉर्म भी खोल सकते हैं: ${registerUrl}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `*${TENANT.nameDisplay} — Admissions*`,
    "",
    "We have your enquiry on file:",
    kids ? `• Child: *${kids}*` : null,
    lead.enquiryNo ? `• Enquiry no.: ${lead.enquiryNo}` : null,
    when ? `• Enquired on: ${when}` : null,
    lead.sourceLabel ? `• Came in via: ${lead.sourceLabel}` : null,
    lead.stageLabel ? `• Status: *${lead.stageLabel}*` : null,
    "",
    "Would you like to go ahead with admission?",
    "",
    `Reply *YES* to register and pay the registration fee, or *NO* if you have decided against it.`,
    `You can also open the form directly: ${registerUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Sent when the parent says yes — the tokenised link plus what happens next. */
export function composeAdmissionRegisterStep(
  registerUrl: string,
  feeAmountLabel?: string,
  hindi = false,
): string {
  if (hindi) {
    return [
      "*रजिस्ट्रेशन — अगला कदम*",
      "",
      "आपकी जानकारी पहले से भरी हुई है। उसे जाँच लें, भाई-बहन हों तो जोड़ें, और उसी पेज पर UPI से रजिस्ट्रेशन फीस जमा करें।",
      feeAmountLabel ? `रजिस्ट्रेशन फीस: ${feeAmountLabel}` : null,
      "",
      `खोलें: ${registerUrl}`,
      "",
      "यह लिंक सिर्फ़ आपकी पूछताछ के लिए है — कृपया इसे किसी को फ़ॉरवर्ड न करें।",
      "फीस जमा होने के बाद स्कूल दस्तावेज़ जाँचकर एडमिशन की पुष्टि करेगा।",
      "",
      "यदि आप चाहते हैं कि एडमिशन ऑफिस आपको कॉल करे, तो *HUMAN* लिखें।",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "*Registration — next step*",
    "",
    "Your details are already filled in. Check them, add any sibling, and pay the registration fee by UPI on the same page.",
    feeAmountLabel ? `Registration fee: ${feeAmountLabel}` : null,
    "",
    `Open: ${registerUrl}`,
    "",
    "This link is personal to your enquiry — please do not forward it.",
    "After payment the school verifies documents and confirms admission.",
    "",
    "Reply *HUMAN* if you would rather the admissions office called you.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function replyCrmBotIntent(
  intent: CrmBotQuickId | "unknown",
  ctx: {
    registerUrl: string;
    lead?: CrmBotLeadContext;
    /** Families on WhatsApp are written to in Hindi unless they chose English. */
    hindi?: boolean;
  },
): { text: string; escalate: boolean } {
  const school = TENANT.nameDisplay;
  const registerUrl = ctx.registerUrl;
  const lead = ctx.lead || null;
  if (ctx.hindi) return replyCrmBotIntentHi(intent, registerUrl, lead);

  switch (intent) {
    case "fee":
      return {
        escalate: false,
        text: [
          `*Registration fee*`,
          `Fee is set per child. Pay online (UPI) after the register form.`,
          "",
          `Register & pay: ${registerUrl}`,
          lead?.feeAmountLabel
            ? `On file for *${lead.childName}*: ${lead.feeAmountLabel}`
            : "Desk will confirm the exact amount for your class.",
          "",
          `Menu: ${CRM_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    case "register":
      return {
        escalate: false,
        text: [
          `*Online registration*`,
          `One parent can register multiple siblings. Fee is shown per student.`,
          "",
          `Start: ${registerUrl}`,
          "",
          "After payment, school verifies documents, then confirms admission.",
        ].join("\n"),
      };
    case "docs":
      return {
        escalate: false,
        text: [
          `*Documents usually required*`,
          "• Birth certificate",
          "• Child photo",
          "• Aadhaar (as applicable)",
          "• Transfer certificate (other-school transfers)",
          "• Category certificate (if applicable)",
          "",
          `Bring originals when you visit ${school}.`,
        ].join("\n"),
      };
    case "status":
      if (lead?.enquiryNo || lead?.childName) {
        return {
          escalate: false,
          text: [
            `*Your enquiry*`,
            lead.childName ? `Child: *${lead.childName}*` : null,
            lead.enquiryNo ? `Enquiry no.: ${lead.enquiryNo}` : null,
            lead.enquiryDate
              ? `Enquired on: ${formatEnquiryDate(lead.enquiryDate)}`
              : null,
            lead.sourceLabel ? `Came in via: ${lead.sourceLabel}` : null,
            lead.stageLabel ? `Status: *${lead.stageLabel}*` : null,
            lead.applicationNo ? `Application: ${lead.applicationNo}` : null,
            "",
            `To go ahead with admission, register & pay here: ${registerUrl}`,
            "Reply *HUMAN* to talk to the admissions office.",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      return {
        escalate: false,
        text: [
          "No CRM lead matched this WhatsApp number yet.",
          `Register: ${registerUrl}`,
          "Or reply *HUMAN* to talk to admissions.",
        ].join("\n"),
      };
    case "visit":
      return {
        escalate: false,
        text: [
          `*Campus visit / counselling*`,
          `${school}, ${TENANT.city}.`,
          "Share preferred date/time — a counsellor will confirm.",
          `Or register first: ${registerUrl}`,
        ].join("\n"),
      };
    case "human":
      return {
        escalate: true,
        text: [
          "Connecting you to *Admissions desk*.",
          "A counsellor will reply on this WhatsApp (CRM admissions channel).",
          "Please send: your name, child class sought, and question.",
        ].join("\n"),
      };
    default:
      return {
        escalate: false,
        text: crmBotWelcomeText(),
      };
  }
}

function replyCrmBotIntentHi(
  intent: CrmBotQuickId | "unknown",
  registerUrl: string,
  lead: CrmBotLeadContext,
): { text: string; escalate: boolean } {
  const school = TENANT.nameDisplay;
  const menu = `मेनू: ${CRM_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · ")}`;
  switch (intent) {
    case "fee":
      return {
        escalate: false,
        text: [
          "*रजिस्ट्रेशन फीस*",
          "फीस हर बच्चे के लिए अलग तय होती है। रजिस्ट्रेशन फ़ॉर्म भरने के बाद ऑनलाइन (UPI) जमा करें।",
          "",
          `रजिस्ट्रेशन और भुगतान: ${registerUrl}`,
          lead?.feeAmountLabel && lead.childName
            ? `*${lead.childName}* के लिए दर्ज फीस: ${lead.feeAmountLabel}`
            : "आपकी कक्षा की सही राशि ऑफिस बताएगा।",
          "",
          menu,
        ].join("\n"),
      };
    case "register":
      return {
        escalate: false,
        text: [
          "*ऑनलाइन रजिस्ट्रेशन*",
          "एक अभिभावक एक साथ कई भाई-बहनों का रजिस्ट्रेशन कर सकते हैं। फीस हर बच्चे की अलग दिखेगी।",
          "",
          `शुरू करें: ${registerUrl}`,
          "",
          "भुगतान के बाद स्कूल दस्तावेज़ जाँचकर एडमिशन की पुष्टि करेगा।",
        ].join("\n"),
      };
    case "docs":
      return {
        escalate: false,
        text: [
          "*आमतौर पर ज़रूरी दस्तावेज़*",
          "• जन्म प्रमाण पत्र",
          "• बच्चे की फ़ोटो",
          "• आधार (यदि लागू हो)",
          "• ट्रांसफ़र सर्टिफ़िकेट (दूसरे स्कूल से आने पर)",
          "• जाति/श्रेणी प्रमाण पत्र (यदि लागू हो)",
          "",
          `${school} आते समय मूल दस्तावेज़ साथ लाएँ।`,
        ].join("\n"),
      };
    case "status":
      if (lead?.enquiryNo || lead?.childName) {
        return {
          escalate: false,
          text: [
            "*आपकी पूछताछ*",
            lead.childName ? `बच्चा: *${lead.childName}*` : null,
            lead.enquiryNo ? `पूछताछ नंबर: ${lead.enquiryNo}` : null,
            lead.enquiryDate ? `पूछताछ की तारीख: ${formatEnquiryDate(lead.enquiryDate)}` : null,
            lead.sourceLabel ? `कैसे जुड़े: ${lead.sourceLabel}` : null,
            lead.stageLabel ? `स्थिति: *${lead.stageLabel}*` : null,
            lead.applicationNo ? `आवेदन: ${lead.applicationNo}` : null,
            "",
            `एडमिशन आगे बढ़ाने के लिए यहाँ रजिस्ट्रेशन और भुगतान करें: ${registerUrl}`,
            "एडमिशन ऑफिस से बात करने के लिए *HUMAN* लिखें।",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      return {
        escalate: false,
        text: [
          "इस WhatsApp नंबर से अभी कोई एडमिशन पूछताछ नहीं मिली।",
          `रजिस्ट्रेशन: ${registerUrl}`,
          "या एडमिशन ऑफिस से बात करने के लिए *HUMAN* लिखें।",
        ].join("\n"),
      };
    case "visit":
      return {
        escalate: false,
        text: [
          "*स्कूल देखने आएँ / परामर्श*",
          `${school}, ${TENANT.city}।`,
          "अपनी सुविधा की तारीख और समय लिखें — ऑफिस पुष्टि करेगा।",
          `या पहले रजिस्ट्रेशन करें: ${registerUrl}`,
        ].join("\n"),
      };
    case "human":
      return {
        escalate: true,
        text: [
          "आपको *एडमिशन ऑफिस* से जोड़ा जा रहा है।",
          "स्कूल का स्टाफ इसी WhatsApp पर जवाब देगा।",
          "कृपया लिखें: आपका नाम, बच्चे को किस कक्षा में एडमिशन चाहिए, और आपका सवाल।",
        ].join("\n"),
      };
    default:
      return { escalate: false, text: crmBotWelcomeText(true) };
  }
}

/** Admission stage in Hindi words. */
export function stageLabelForBotHi(stage: string): string {
  switch (stage) {
    case "enquiry":
      return "पूछताछ चालू";
    case "applied":
      return "रजिस्ट्रेशन हो गया";
    case "verified":
      return "जाँच पूरी — एडमिशन बाकी";
    case "enrolled":
      return "एडमिशन हो गया";
    case "lost":
      return "बंद";
    default:
      return stage || "—";
  }
}

export function stageLabelForBot(
  stage: string,
): string {
  switch (stage) {
    case "enquiry":
      return "Open enquiry";
    case "applied":
      return "Registered";
    case "verified":
      return "Verified — awaiting admit";
    case "enrolled":
      return "Admitted";
    default:
      return stage || "—";
  }
}
