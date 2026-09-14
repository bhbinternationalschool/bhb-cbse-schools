/**
 * SIS enrolled parent WhatsApp bot intents.
 * Audience: households registered in SIS — not CRM admissions.
 */

import { formatInr } from "@/lib/masters";
import { detectBusLocationIntent } from "@/lib/parentBusReply";
import { TENANT } from "@/lib/types";

export type SisBotQuickId =
  | "kids"
  | "dues"
  | "pay"
  | "receipts"
  | "info"
  | "human"
  | "complaint"
  | "tutor"
  | "bus";

export const SIS_BOT_QUICK_PROMPTS: {
  id: SisBotQuickId;
  label: string;
  waKeyword: string;
}[] = [
  { id: "kids", label: "My children", waKeyword: "KIDS" },
  { id: "dues", label: "Fee dues", waKeyword: "DUES" },
  { id: "pay", label: "Pay fees", waKeyword: "PAY" },
  { id: "receipts", label: "Recent receipts", waKeyword: "RECEIPTS" },
  { id: "info", label: "School info", waKeyword: "INFO" },
  { id: "human", label: "Talk to office", waKeyword: "HUMAN" },
  { id: "complaint", label: "Raise a complaint", waKeyword: "COMPLAINT" },
  { id: "tutor", label: "Study help for your child", waKeyword: "TUTOR" },
  { id: "bus", label: "Where is the bus", waKeyword: "BUS" },
];

/**
 * The same menu in Hindi. The KEYWORDS stay in English letters, because they
 * are what the bot recognises and what a parent types; only the explanation
 * beside each is translated.
 *
 * Until 2026-09-13 every reply in this file was English-only and took no
 * language at all, so a family who had chosen Hindi — and every family who
 * had chosen nothing, which the school writes to in Hindi — got English the
 * moment they tapped a button on any template.
 */
export const SIS_BOT_LABEL_HI: Record<SisBotQuickId, string> = {
  kids: "मेरे बच्चे",
  dues: "बकाया फीस",
  pay: "फीस जमा करें",
  receipts: "हाल की रसीदें",
  info: "स्कूल की जानकारी",
  human: "ऑफिस से बात करें",
  complaint: "शिकायत दर्ज करें",
  tutor: "बच्चे की पढ़ाई में मदद",
  bus: "बस कहाँ है",
};

export function sisBotWelcomeText(
  multiChild = false,
  hasTransport = false,
  hindi = false,
): string {
  if (hindi) {
    return [
      `नमस्ते — *${TENANT.shortName}* अभिभावक सहायक।`,
      "",
      "यह सुविधा इस WhatsApp नंबर से जुड़े *स्कूल में पढ़ रहे बच्चों* के लिए है।",
      "नए प्रवेश / पूछताछ के लिए कृपया प्रवेश वाला WhatsApp नंबर इस्तेमाल करें।",
      "",
      "नीचे दिया गया शब्द लिखकर भेजें:",
      ...SIS_BOT_QUICK_PROMPTS.filter(
        (q) => q.id !== "pay" && (q.id !== "bus" || hasTransport),
      ).map((q) => `• *${q.waKeyword}* — ${SIS_BOT_LABEL_HI[q.id]}`),
      multiChild
        ? "• *PAY* — सभी बच्चों की फीस · *PAY 1* / *PAY 2* — एक बच्चे की (ऑनलाइन भुगतान लिंक)"
        : "• *PAY* — फीस का ऑनलाइन भुगतान लिंक (UPI / कार्ड / नेटबैंकिंग)",
    ].join("\n");
  }
  const payHint = multiChild
    ? "• *PAY* — all children · *PAY 1* / *PAY 2* — one child (online payment link)"
    : "• *PAY* — online payment link (UPI / card / net banking)";
  return [
    `Namaste — *${TENANT.shortName}* parent assistant (SIS).`,
    "",
    "For *enrolled students* linked to this WhatsApp number.",
    "Admission / enquiry parents: use the admissions WhatsApp separately.",
    "",
    "Reply with a keyword:",
    ...SIS_BOT_QUICK_PROMPTS.filter(
      (q) => q.id !== "pay" && (q.id !== "bus" || hasTransport),
    ).map((q) => `• *${q.waKeyword}* — ${q.label}`),
    payHint,
  ].join("\n");
}

export function detectSisBotIntent(text: string): SisBotQuickId | "unknown" {
  const t = (text || "").trim();
  const upper = t.toUpperCase();
  for (const q of SIS_BOT_QUICK_PROMPTS) {
    if (upper === q.waKeyword || upper.startsWith(`${q.waKeyword} `)) {
      return q.id;
    }
  }
  const asId = t.toLowerCase() as SisBotQuickId;
  if (SIS_BOT_QUICK_PROMPTS.some((q) => q.id === asId)) return asId;

  const low = t.toLowerCase();
  if (detectBusLocationIntent(low)) return "bus";
  if (/complain|complaint|grievance|shikayat/.test(low)) return "complaint";
  if (/^pay\b|upi|payment link|clear due/.test(low)) return "pay";
  if (/due|outstanding|balance|arrear|fee/.test(low)) return "dues";
  if (/receipt|paid|voucher/.test(low)) return "receipts";
  if (/child|kid|son|daughter|student|class/.test(low)) return "kids";
  if (/info|address|timing|contact|phone|office/.test(low)) return "info";
  if (/human|staff|office|help|counsellor|call me|agent/.test(low))
    return "human";
  return "unknown";
}

export type SisPayChildRef = { id: string; name: string };

export type SisPaySelection =
  | { scope: "all" }
  | { scope: "child"; studentId: string; studentName: string }
  | { scope: "invalid"; message: string };

/** Parse PAY / PAY 1 / PAY Rahul for per-child payment. */
export function parseSisPaySelection(
  text: string,
  children: SisPayChildRef[],
): SisPaySelection {
  const trimmed = (text || "").trim();
  const rest = trimmed.replace(/^pay\s*/i, "").trim();
  if (!rest || /^ALL$/i.test(rest)) {
    return { scope: "all" };
  }
  const num = rest.match(/^(\d+)$/);
  if (num) {
    const idx = Number(num[1]) - 1;
    if (idx < 0 || idx >= children.length) {
      return {
        scope: "invalid",
        message: `Child #${num[1]} not found. Reply *KIDS* for the list.`,
      };
    }
    const c = children[idx]!;
    return { scope: "child", studentId: c.id, studentName: c.name };
  }
  const q = rest.toLowerCase();
  const hit = children.find((c) => {
    const n = c.name.toLowerCase();
    return n === q || n.startsWith(q) || n.includes(q);
  });
  if (hit) {
    return { scope: "child", studentId: hit.id, studentName: hit.name };
  }
  return {
    scope: "invalid",
    message: `Could not match *${rest}*. Reply *KIDS*, then *PAY 1* or *PAY <first name>*.`,
  };
}

export type SisBotChildLine = {
  name: string;
  classLabel: string;
  admissionNo: string;
  status: string;
};

export type SisBotDueLine = {
  studentName: string;
  label: string;
  amountLabel: string;
  dueOn: string;
};

export function composeSisKidsReply(
  children: SisBotChildLine[],
  hindi = false,
): string {
  if (hindi) {
    if (children.length === 0) {
      return [
        "इस WhatsApp नंबर से कोई पढ़ रहा बच्चा नहीं जुड़ा है।",
        "कृपया स्कूल ऑफिस से अपना मोबाइल / WhatsApp नंबर अपडेट करवाएँ।",
        "",
        sisBotWelcomeText(false, false, true),
      ].join("\n");
    }
    return [
      `*${TENANT.shortName} में आपके बच्चे*`,
      "",
      ...children.map(
        (c, i) =>
          `${i + 1}. *${c.name}* · ${c.classLabel || "—"} · प्रवेश सं. ${c.admissionNo || "—"}`,
      ),
      "",
      children.length > 1
        ? "बकाया देखने के लिए *DUES* · सबकी फीस के लिए *PAY* · एक बच्चे के लिए *PAY 1* / *PAY 2* लिखें।"
        : "बकाया फीस के लिए *DUES* · ऑनलाइन भुगतान लिंक के लिए *PAY* लिखें।",
    ].join("\n");
  }
  if (children.length === 0) {
    return [
      "No active students found for this WhatsApp number.",
      "Ask the school office to update your household mobile / WhatsApp in SIS.",
      "",
      sisBotWelcomeText(false),
    ].join("\n");
  }
  const payLine =
    children.length > 1
      ? "Reply *DUES* · *PAY* (all) · *PAY 1* / *PAY 2* per child — pay online."
      : "Reply *DUES* for fee balance · *PAY* for an online payment link.";
  return [
    `*Your children at ${TENANT.shortName}*`,
    "",
    ...children.map(
      (c, i) =>
        `${i + 1}. *${c.name}* · ${c.classLabel || "—"} · Adm ${c.admissionNo || "—"} (${c.status})`,
    ),
    "",
    payLine,
  ].join("\n");
}

export function composeSisDuesReply(opts: {
  guardianName: string;
  dueLines: SisBotDueLine[];
  totalPaise: number;
  runningMonthOnly?: boolean;
  childFilterName?: string;
  hindi?: boolean;
  /**
   * The family's direct payment link (/pay/due). When given, the parent pays
   * from this message; the old "PAY, then GPay, then tap Confirm paid" steps
   * are gone either way.
   */
  payUrl?: string;
}): string {
  const scope =
    opts.childFilterName != null
      ? ` · ${opts.childFilterName}`
      : "";
  if (opts.hindi) {
    const who = opts.guardianName || "अभिभावक";
    if (opts.dueLines.length === 0) {
      return [
        `*बकाया फीस${scope}* · ${who}`,
        "",
        "चालू महीने तक कोई फीस बकाया नहीं है। धन्यवाद!",
        "हाल के भुगतान देखने के लिए *RECEIPTS* लिखें।",
      ].join("\n");
    }
    const maxHi = 12;
    return [
      `*बकाया फीस${scope}* · ${who}`,
      opts.runningMonthOnly
        ? "(चालू महीने तक — आगे की किश्तें शामिल नहीं)"
        : "(बाकी राशि)",
      "",
      ...opts.dueLines.slice(0, maxHi).map(
        (d) => `• ${d.studentName}: ${d.label} — *${d.amountLabel}* (अंतिम तिथि ${d.dueOn})`,
      ),
      opts.dueLines.length > maxHi
        ? `…और ${opts.dueLines.length - maxHi} पंक्ति`
        : null,
      "",
      `*कुल जमा करना है: ${formatInr(opts.totalPaise)}*`,
      "",
      ...(opts.payUrl
        ? [
            "💳 *अभी ऑनलाइन भुगतान करें* (UPI / कार्ड / नेटबैंकिंग):",
            opts.payUrl,
            "_भुगतान होते ही रसीद अपने आप यहीं WhatsApp पर आ जाएगी।_",
          ]
        : [
            opts.childFilterName != null
              ? `इस बच्चे का भुगतान लिंक पाने के लिए *PAY ${opts.childFilterName.split(" ")[0]}* लिखें।`
              : "ऑनलाइन भुगतान लिंक के लिए *PAY* लिखें।",
          ]),
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (opts.dueLines.length === 0) {
    return [
      `*Fee dues${scope}* · ${opts.guardianName || "Parent"}`,
      "",
      "No open dues till the current running month. Thank you!",
      "Reply *RECEIPTS* for recent payments.",
    ].join("\n");
  }
  const max = 12;
  const shown = opts.dueLines.slice(0, max);
  const payHint =
    opts.childFilterName != null
      ? `Reply *PAY ${opts.childFilterName.split(" ")[0]}* for this child's payment link.`
      : "Reply *PAY* for an online payment link.";
  return [
    `*Fee dues${scope}* · ${opts.guardianName || "Parent"}`,
    opts.runningMonthOnly
      ? "(Till current running month — future instalments excluded)"
      : "(Open balances)",
    "",
    ...shown.map(
      (d) =>
        `• ${d.studentName}: ${d.label} — *${d.amountLabel}* (due ${d.dueOn})`,
    ),
    opts.dueLines.length > max
      ? `…and ${opts.dueLines.length - max} more line(s)`
      : null,
    "",
    `*Total to pay: ${formatInr(opts.totalPaise)}*`,
    "",
    ...(opts.payUrl
      ? [
          "💳 *Pay online now* (UPI / card / net banking):",
          opts.payUrl,
          "_The receipt comes to this WhatsApp automatically when the payment goes through._",
        ]
      : [payHint]),
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeSisPayReply(opts: {
  amountPaise: number;
  payUrl: string;
  upiUri?: string;
  code: string;
  studentHint: string;
  autoSettle?: boolean;
  hindi?: boolean;
}): string {
  if (opts.hindi) {
    const hi = [
      `*${TENANT.shortName}* · फीस भुगतान लिंक ${opts.code}`,
      opts.studentHint,
      `राशि: *${formatInr(opts.amountPaise)}*`,
      "",
      opts.autoSettle
        ? "ऑनलाइन भुगतान करें (रसीद यहीं अपने आप आ जाएगी):"
        : "*Google Pay / UPI* से भुगतान करें (GPay, PhonePe, Paytm):",
      opts.payUrl,
    ];
    if (opts.upiUri && !opts.autoSettle) {
      hi.push(
        "",
        "या सीधे GPay / UPI खोलें:",
        opts.upiUri,
        "",
        "तरीका:",
        "1️⃣ GPay / UPI ऐप में भुगतान करें",
        "2️⃣ लिंक पर वापस आएँ",
        "3️⃣ *Confirm paid* दबाएँ — खाता अपडेट होगा और रसीद यहीं आएगी",
      );
    } else if (opts.autoSettle) {
      hi.push("", "कुछ दबाने की ज़रूरत नहीं — भुगतान होते ही खाता और रसीद अपडेट हो जाएँगे।");
    } else {
      hi.push("", "लिंक पर भुगतान करने के बाद खाता अपडेट होगा और रसीद यहीं भेजी जाएगी।");
    }
    return hi.join("\n");
  }
  const lines = [
    `*${TENANT.shortName}* · Fee pay link ${opts.code}`,
    opts.studentHint,
    `Amount: *${formatInr(opts.amountPaise)}*`,
    "",
    opts.autoSettle
      ? "Pay online (Razorpay — receipt sent here automatically):"
      : "Pay with *Google Pay / UPI* (GPay, PhonePe, Paytm):",
    opts.payUrl,
  ];
  if (opts.upiUri && !opts.autoSettle) {
    lines.push("", "Or open GPay / UPI directly:", opts.upiUri);
    lines.push(
      "",
      "Steps:",
      "1️⃣ Pay in GPay / UPI app",
      "2️⃣ Return to the link",
      "3️⃣ Tap *Confirm paid* — ledger updates & receipt sent here",
    );
  } else if (opts.autoSettle) {
    lines.push(
      "",
      "No need to tap confirm — fee ledger & receipt update when payment succeeds.",
    );
  } else {
    lines.push(
      "",
      "After you pay on the link, the fee ledger updates and we send your receipt here.",
    );
  }
  return lines.join("\n");
}

export function composeSisReceiptsReply(
  rows: { receiptNo: string; date: string; amountLabel: string }[],
  hindi = false,
): string {
  if (hindi) {
    if (rows.length === 0) {
      return "इस परिवार की अभी कोई फीस रसीद नहीं है। भुगतान के लिए *PAY* लिखें।";
    }
    return [
      "*हाल की फीस रसीदें*",
      "",
      ...rows.slice(0, 8).map((r) => `• ${r.receiptNo} · ${r.date} · *${r.amountLabel}*`),
      "",
      "ऑनलाइन भुगतान होते ही पूरी डिजिटल रसीद अपने आप यहीं आ जाती है।",
    ].join("\n");
  }
  if (rows.length === 0) {
    return "No fee receipts yet for this household. Reply *PAY* when ready.";
  }
  return [
    "*Recent fee receipts*",
    "",
    ...rows.slice(0, 8).map(
      (r) => `• ${r.receiptNo} · ${r.date} · *${r.amountLabel}*`,
    ),
    "",
    "The full digital receipt arrives here automatically as soon as an online payment goes through.",
  ].join("\n");
}

export function composeSisInfoReply(hindi = false): string {
  if (hindi) {
    return [
      `*${TENANT.nameDisplay}*`,
      TENANT.city,
      TENANT.publicPortal ? `पोर्टल: ${TENANT.publicPortal}` : null,
      "",
      "फीस ऑफिस का समय: स्कूल के कार्य दिवस (कृपया ऑफिस से पुष्टि करें)।",
      "",
      "मेनू: " + SIS_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · "),
      "फीस जमा करने के लिए *PAY* लिखें → लिंक खोलें → UPI / कार्ड / नेटबैंकिंग से भुगतान करें। रसीद अपने आप आएगी।",
      "एक से अधिक बच्चे: हर बच्चे के लिए *PAY 1* · *PAY 2*।",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `*${TENANT.nameDisplay}*`,
    TENANT.city,
    TENANT.publicPortal ? `Portal: ${TENANT.publicPortal}` : null,
    "",
    "Fee office hours: school working days (confirm with front office).",
    "",
    "Menu: " + SIS_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · "),
    "Pay fees: reply *PAY* → open the link → pay by UPI / card / net banking. The receipt comes automatically.",
    "Multi-child: *PAY 1* · *PAY 2* per child.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeSisHumanReply(hindi = false): string {
  if (hindi) {
    return [
      "आपको *स्कूल ऑफिस* से जोड़ा जा रहा है।",
      "स्टाफ का कोई सदस्य इसी WhatsApp पर जवाब देगा।",
      "कृपया बच्चे का नाम, कक्षा और अपना सवाल लिखें।",
    ].join("\n");
  }
  return [
    "Connecting you to *school office*.",
    "A staff member will reply on this WhatsApp.",
    "Please share: child name, class, and your question.",
  ].join("\n");
}

/* ── Replies to a fee reminder that are not commands ─────────────────
 *
 * On 11 Sep 2026 parents answered the reminder with "थोड़ा समय चाहिए",
 * "jama kar diye hai", "Only setambar mahine ka baki h" — and the bot
 * either sent the language menu or the keyword list. A parent who says
 * they need time is asked how much and by when; a parent who says they
 * have already paid gets an apology and a promise to re-check, and the
 * office sees both. Neither is ever answered with a menu.
 */
export type SisFeeReplyIntent = "need_time" | "claims_paid";

const CLAIMS_PAID =
  /jama\s*(kar|ho)\s*(diy|di\b|gay|gy|chuk)|bhugtan\s*(ho|kar)\s*(gay|diy)|payment\s*(ho\s*gay|kar\s*diy|done|kiya|complete)|already\s*paid|have\s*paid|paid\s*(already|yesterday|today|it|the\s*fee)|pay\s*kar\s*diy|fees?\s*(de|bhar|jama\s*kar)\s*(di|diy|chuk)|(de|bhej)\s*diy[ae]\s*(hai|h)|भुगतान\s*(हो\s*गया|कर\s*दिया)|जमा\s*(कर\s*दि|हो\s*ग|कर\s*चुक)|(फीस|पैसे|पैसा)\s*(दे|भर|भेज|जमा\s*कर)\s*(दी|दिए|दिया|दिये|चुके)/i;

const NEED_TIME =
  /thod[ai]\s*(samay|time|waqt|din)|samay\s*(chahiye|dijiye|de\b|do\b|lagega)|time\s*(chahiye|do\b|dijiye|lagega|chahie)|kuch\s*din|agle\s*(hafte|mahine|week|month)|next\s*(week|month)|salary\s*(aane|milne|ke\s*baad)|tankhwah|baad\s*m[e]?\b|bad\s*me\b|later\b|will\s*pay|(de|kar|jama\s*kar)\s*(denge|dunga|dungi|denga)|थोड़ा\s*(समय|टाइम|वक्त|वक़्त)|समय\s*(चाहिए|दीजिए|दो|लगेगा)|कुछ\s*दिन|अगले\s*(हफ्ते|महीने|सप्ताह)|बाद\s*में|(दे|कर|जमा\s*कर)\s*(देंगे|दूंगा|दूँगा|दूंगी|दूँगी|देंगें)|तनख्वाह|सैलरी/i;

/**
 * The ways parents actually said "already paid" on 11 Sep 2026 that the
 * pattern above missed — "Exam fees jama h", "Pass dal di hu" (paid it in,
 * which the tutor then read as a request for a study PASS), "1500 dina".
 * Only read as a payment when the message is not itself a question: "fees
 * kab jama hai?" asks when it is due.
 */
const CLAIMS_PAID_LOOSE =
  /\b(daal|dal)\s*(di|diya|diye|de|chuke|chuki)\b|\bjama\s*(h|hai|he|ho\s*chuka|ho\s*chuki)\b|\b\d{3,6}\s*(rs|rupaye|rupees|₹)?\s*(dina|diya|diye|di|de\s*di|de\s*diya|jama\s*kiya|jama\s*kiye)\b|\b(de|bhar)\s*(di|diya|diye)\s*(hu|hun|hoon|hai|h|he)\b|\bpay(ment)?\s*kar\s*(di|diya|diye)\b|डाल\s*(दी|दिया|दिए)|जमा\s*(है|हो\s*चुका|हो\s*चुकी)|दे\s*(दी|दिया|दिए)\s*(हूँ|हूं|है|हैं)/i;
const IS_QUESTION = /\?|\b(kab|kitna|kitni|kaise|kahan|kya|when|how|where)\b|कब|कितना|कितनी|कैसे|कहाँ|क्या/i;

export function detectSisFeeReplyIntent(text: string): SisFeeReplyIntent | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (CLAIMS_PAID.test(t)) return "claims_paid";
  if (CLAIMS_PAID_LOOSE.test(t) && !IS_QUESTION.test(t)) return "claims_paid";
  if (NEED_TIME.test(t)) return "need_time";
  return null;
}

export type SisPromiseToPay = {
  /** Paise; null when no figure was given. */
  amountPaise: number | null;
  /** True for "pura", "sab", "full". */
  full: boolean;
  /** ISO date; null when no date could be read. */
  byDate: string | null;
  raw: string;
};

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\b(sunday|ravivar|itwar)\b|रविवार|इतवार/i, 0],
  [/\b(monday|somvar|somwar)\b|सोमवार/i, 1],
  [/\b(tuesday|mangalvar|mangalwar)\b|मंगलवार/i, 2],
  [/\b(wednesday|budhvar|budhwar)\b|बुधवार/i, 3],
  [/\b(thursday|guruvar|guruwar|brihaspativar)\b|गुरुवार|बृहस्पतिवार/i, 4],
  [/\b(friday|shukravar|shukrawar|jumma)\b|शुक्रवार|जुम्मा/i, 5],
  [/\b(saturday|shanivar|shaniwar)\b|शनिवार/i, 6],
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTHS_HI = ["जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

function shift(todayIso: string, days: number): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * "2000 15 tarikh tak", "पूरा अगले हफ्ते", "kal 1500", "3000 by Monday".
 * Unknown stays null — a date the parent did not give is never invented.
 */
export function parseSisPromiseToPay(text: string, todayIso: string): SisPromiseToPay {
  const raw = (text || "").trim();
  const low = raw.toLowerCase();
  const out: SisPromiseToPay = { amountPaise: null, full: /\b(pura|poora|sab|full|whole|complete)\b|पूरा|पूरी|सब|सारा/i.test(raw), byDate: null, raw };

  // Amount: a rupee sign or word, else a bare number of 3+ digits that is not a day-of-month.
  const money = low.match(/(?:₹|rs\.?|rupees?|rupay[ae]?|रु\.?|रुपये|रुपए)\s*(\d[\d,]*)/) || low.match(/(\d[\d,]*)\s*(?:rs\b|rupees?|rupay[ae]?|₹|रु|रुपये|रुपए|hazaar|hazar|हज़ार|हजार)/);
  if (money) {
    let n = Number(money[1]!.replace(/,/g, ""));
    if (/hazaar|hazar|हज़ार|हजार/.test(money[0]!)) n *= 1000;
    if (n > 0) out.amountPaise = Math.round(n * 100);
  } else {
    const bare = low.match(/(?<![\d/-])(\d{3,6})(?![\d/-])/);
    if (bare) out.amountPaise = Number(bare[1]) * 100;
  }

  // Date words — read from the text with the amount taken out, so "2000 15
  // tarikh" cannot lend its "20" to the day and "2 hazar 20 sep" its "2".
  const dateText = money ? low.replace(money[0]!, " ") : out.amountPaise != null ? low.replace(/(?<![\d/-])\d{3,6}(?![\d/-])/, " ") : low;
  const today = new Date(`${todayIso}T00:00:00Z`);
  if (/\b(aaj|today)\b|आज/i.test(raw)) out.byDate = todayIso;
  else if (/\b(kal|tomorrow|tmrw)\b|कल/i.test(raw)) out.byDate = shift(todayIso, 1);
  else if (/\b(parso|parson)\b|परसों/i.test(raw)) out.byDate = shift(todayIso, 2);
  const nDays = dateText.match(/(\d{1,2})\s*(din|days?)\b/) || dateText.match(/(\d{1,2})\s*दिन/);
  if (!out.byDate && nDays) out.byDate = shift(todayIso, Number(nDays[1]));
  const nWeeks = dateText.match(/(\d)\s*(hafte|hafta|weeks?)\b/) || dateText.match(/(\d)\s*(हफ्ते|हफ़्ते|सप्ताह)/);
  if (!out.byDate && nWeeks) out.byDate = shift(todayIso, 7 * Number(nWeeks[1]));
  if (!out.byDate && (/agle\s*(hafte|week)|next\s*week|ek\s*hafte|एक\s*हफ्ते|अगले\s*(हफ्ते|हफ़्ते|सप्ताह)/i.test(raw))) out.byDate = shift(todayIso, 7);
  if (!out.byDate && (/agle\s*(mahine|month)|next\s*month|ek\s*mahine|अगले\s*महीने|एक\s*महीने/i.test(raw))) out.byDate = shift(todayIso, 30);
  if (!out.byDate) {
    for (const [re, dow] of WEEKDAYS) {
      if (re.test(raw)) {
        const delta = ((dow - today.getUTCDay()) + 7) % 7 || 7;
        out.byDate = shift(todayIso, delta);
        break;
      }
    }
  }
  if (!out.byDate) {
    // "15 tarikh", "15 ko", "15th", "15 sep", "15 सितंबर" → the next such day.
    const dm = dateText.match(/(?<!\d)(\d{1,2})(?!\d)\s*(?:st|nd|rd|th)?\s*(tarikh|tareekh|tarik|ko\b|tak\b|तारीख|को|तक|([a-z]{3,9})|([\u0900-\u097F]{2,8}))/);
    if (dm && Number(dm[1]) >= 1 && Number(dm[1]) <= 31) {
      const day = Number(dm[1]);
      let month = today.getUTCMonth();
      const mWord = (dm[3] || dm[4] || "").toLowerCase();
      const mi = mWord ? MONTHS.findIndex((m) => mWord.startsWith(m)) : -1;
      const mhi = mWord ? MONTHS_HI.findIndex((m) => mWord.startsWith(m.slice(0, 2))) : -1;
      if (mi >= 0) month = mi;
      else if (mhi >= 0) month = mhi;
      else if (day <= today.getUTCDate()) month += 1;
      const d = new Date(Date.UTC(today.getUTCFullYear(), month, day));
      if (d.getUTCDate() === day) out.byDate = d.toISOString().slice(0, 10);
    }
  }
  return out;
}

function niceDate(iso: string, hindi: boolean): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(hindi ? "hi-IN" : "en-IN", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** "थोड़ा समय चाहिए" → ask how much and by when, in one friendly line. */
export function composeSisNeedTimeAsk(hindi: boolean): string {
  return hindi
    ? "जी, कोई बात नहीं 🙏\n\nकृपया बताएँ — *कितनी राशि* और *कब तक* जमा कर पाएँगे? जैसे: _2000 15 तारीख तक_ या _पूरा अगले सोमवार_\n\nहम उसी हिसाब से नोट कर लेंगे; बीच में कोई स्मरण नहीं आएगा।"
    : "That's fine 🙏\n\nPlease tell us *how much* and *by when* you will be able to pay. For example: _2000 by the 15th_ or _full amount next Monday_\n\nWe will note it and hold the reminders till then.";
}

/** The parent's answer, read back — and what the office sees. */
export function composeSisPromiseRecorded(p: SisPromiseToPay, hindi: boolean): string {
  const amount = p.amountPaise != null ? formatInr(p.amountPaise) : p.full ? (hindi ? "पूरी राशि" : "the full amount") : "";
  const when = p.byDate ? niceDate(p.byDate, hindi) : "";
  if (!amount && !when) {
    return hindi
      ? "धन्यवाद 🙏 आपका संदेश कार्यालय तक पहुँच गया है। कार्यालय आपसे संपर्क कर राशि और तारीख तय कर लेगा।"
      : "Thank you 🙏 Your message has reached the school office; they will get in touch to agree the amount and date.";
  }
  const line = hindi
    ? `${amount || "राशि"}${when ? ` — ${when} तक` : ""}`
    : `${amount || "amount"}${when ? ` — by ${when}` : ""}`;
  return hindi
    ? `धन्यवाद 🙏 हमने नोट कर लिया: *${line}*।\n\nकार्यालय को सूचना दे दी गई है। यदि कुछ बदलना हो तो यहीं लिख दें।`
    : `Thank you 🙏 Noted: *${line}*.\n\nThe office has been informed. If anything changes, just write here.`;
}

/** "jama kar diye hai" → apologise, promise to re-check, ask for the receipt detail. */
export function composeSisClaimsPaidReply(hindi: boolean): string {
  return hindi
    ? "क्षमा करें 🙏 यदि आपने भुगतान कर दिया है तो इस स्मरण के लिए खेद है।\n\nहम अपने रिकॉर्ड की *दोबारा जाँच* करेंगे और आपसे संपर्क करेंगे। जाँच में मदद के लिए कृपया *रसीद नंबर* या *भुगतान की तारीख / स्क्रीनशॉट* भेज दें।"
    : "Sorry 🙏 If you have already paid, please excuse this reminder.\n\nWe will *re-check our records* and get back to you. To help us find it quickly, please share the *receipt number* or the *payment date / a screenshot*.";
}

/**
 * Did the parent actually answer "how much and by when"?
 *
 * On 11 Sep 2026 two families answered the question with something else —
 * "Hindi" (they were answering the language menu appended below it) and
 * "Aanjli mam ko" (they wanted a person). Both were recorded as promises
 * reading "amount not given, date not given", which tells the office
 * nothing, and worse: recording them closed the question, so when one
 * parent sent the real answer thirty seconds later ("1500 dina") the bot
 * had stopped listening and replied "I don't have that information here".
 *
 * A promise with no amount, no "full" and no date is not an answer.
 */
export function promiseIsEmpty(p: SisPromiseToPay): boolean {
  return p.amountPaise == null && !p.full && !p.byDate;
}

/** Ask again, shorter, when the reply carried neither a figure nor a date. */
export function composeSisPromiseUnclear(hindi: boolean): string {
  return hindi
    ? "माफ़ कीजिए, समझ नहीं पाया 🙏\n\nकृपया केवल *राशि* और *तारीख* लिखें — जैसे _2000 15 तारीख तक_ या _पूरा अगले सोमवार_।\n\nकिसी से बात करनी हो तो *HUMAN* लिखें।"
    : "Sorry, I did not catch that 🙏\n\nPlease reply with just the *amount* and the *date* — for example _2000 by the 15th_ or _full amount next Monday_.\n\nTo speak to someone, reply *HUMAN*.";
}

/** One line for the office thread: what was promised, machine-readable enough to act on. */
export function promiseSummaryForOffice(p: SisPromiseToPay): string {
  const parts = [p.amountPaise != null ? formatInr(p.amountPaise) : p.full ? "full amount" : "amount not given", p.byDate ? `by ${p.byDate}` : "date not given"];
  return `Promise to pay: ${parts.join(", ")} — "${p.raw.slice(0, 120)}"`;
}

/* ── "How much is the fee?" ──────────────────────────────────────────────
 *
 * On 13 Sep 2026 a parent asked four times — "Ukg ka fees kitna hai",
 * "Transport ka", "Monthly school fees kitna hai transport kitna hai",
 * "Aur fees mein kuchh discount" — and got the same list of September dues
 * three times and an English "I don't have that information" once. The
 * keyword matcher files any sentence containing "fee" under DUES, and DUES
 * answers "what do I owe now", not "what does the year cost".
 *
 * This answers from the child's OWN fee record for the session: every head,
 * the amount per instalment and how many, the concession already applied,
 * what is paid and what is left. Nothing here is general knowledge about
 * the school; a question it cannot answer from that record goes to the
 * office.
 */

export type SisFeeQuestion = {
  /** Asked about the bus / transport fee. */
  transport: boolean;
  /** Asked about the bus ONLY ("Transport ka") — the answer shows just that. */
  transportOnly: boolean;
  /** Asked about a discount / concession. */
  discount: boolean;
  /** A class the parent named ("UKG", "class 5"), normalised; "" when none. */
  namedClass: string;
};

const FEE_WORD = /\bfe+s?\b|\bfees\b|\bfis\b|फीस|फ़ीस|शुल्क|\btuition\b|\btution\b|\bkiraya\b|किराया/i;
const TRANSPORT_WORD = /\btransport\b|\btrans?port\b|\bbus\b|\bvan\b|\bgaadi\b|\bgadi\b|बस|वैन|गाड़ी|ट्रांसपोर्ट/i;
const DISCOUNT_WORD = /discount|concession|\bchhut\b|\bchut\b|\bchoot\b|maaf|माफ़|माफ|छूट|रियायत|कम\s*(कर|हो)/i;
const ASK_WORD =
  /kitn[aie]|how\s*much|what\s*is|kya\s*(hai|h\b|he\b)|batai?y?e|bata\s*(de|do|en|ein|dijiye)|bataen|structure|monthly|mahin[aeo]|mah?ine|saal|annual|yearly|total|pura|poora|kul\b|कितन[ाीे]|क्या\s*है|बताइए|बताएं|बताएँ|मासिक|महीने|सालाना|साल\s*का|कुल/i;
const CLASS_WORD = /\b(nursery|lkg|ukg|pre[-\s]?nursery|play\s*group|class\s*\d{1,2}|\d{1,2}\s*(st|nd|rd|th)\b)|नर्सरी|एलकेजी|यूकेजी|कक्षा\s*\d{1,2}/i;

/**
 * Is this a question about how much the fee IS (not what is owed now)?
 *
 * Needs an ask word or a class/discount word next to a fee or transport
 * word — "fees jama kar di" is a payment, handled before this runs, and a
 * bare "fees" still means DUES. A short follow-up like "Transport ka" /
 * "bus ki" counts: it only ever follows a fee question.
 */
export function detectSisFeeQuestion(text: string): SisFeeQuestion | null {
  const t = (text || "").trim();
  if (!t) return null;
  const fee = FEE_WORD.test(t);
  const transport = TRANSPORT_WORD.test(t);
  const discount = DISCOUNT_WORD.test(t);
  const ask = ASK_WORD.test(t);
  const cls = t.match(CLASS_WORD);
  const shortFollowUp = transport && /^\S+\s+(ka|ki|ke|का|की|के)\s*\??$/i.test(t);
  const isQuestion =
    ((fee || transport) && (ask || !!cls)) ||
    (fee && discount) ||
    shortFollowUp;
  if (!isQuestion) return null;
  return {
    transport,
    transportOnly: transport && !fee && !discount && !cls,
    discount,
    namedClass: cls ? normaliseClassName(cls[0]) : "",
  };
}

/** "UKG" / "class 5" / "5th" / "कक्षा 5" → "UKG" / "5" for comparison with a class label. */
export function normaliseClassName(raw: string): string {
  const t = (raw || "").trim().toLowerCase();
  if (/nursery|नर्सरी/.test(t)) return "NURSERY";
  if (/lkg|एलकेजी/.test(t)) return "LKG";
  if (/ukg|यूकेजी/.test(t)) return "UKG";
  const n = t.match(/\d{1,2}/);
  return n ? n[0]! : t.toUpperCase();
}

/** Does a class label ("UKG-A", "Class 5 B", "V-A") name this class? */
export function classLabelMatches(label: string, named: string): boolean {
  if (!named) return true;
  const l = (label || "").toUpperCase();
  if (/^\d+$/.test(named)) {
    const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][Number(named)] ?? "";
    return new RegExp(`(^|[^0-9])${named}([^0-9]|$)`).test(l) || (!!roman && new RegExp(`(^|[^A-Z])${roman}([^A-Z]|$)`).test(l));
  }
  return l.includes(named);
}

export type SisFeeHeadLine = {
  head: string;
  transport: boolean;
  /** Net of concession, per instalment, when every instalment is the same; null when they differ. */
  eachPaise: number | null;
  count: number;
  totalPaise: number;
};

export type SisChildFeeYear = {
  name: string;
  classLabel: string;
  heads: SisFeeHeadLine[];
  concessionPaise: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  /** Owed up to the running month. */
  dueNowPaise: number;
};

export function composeSisFeeStructureReply(opts: {
  academicYear: string;
  children: SisChildFeeYear[];
  question: SisFeeQuestion;
  hindi: boolean;
}): { text: string; escalate: boolean } {
  const { hindi, question } = opts;
  const shown = opts.children.filter((c) => c.heads.length > 0);
  const lines: string[] = [];
  let escalate = false;

  lines.push(hindi ? `*फीस की जानकारी* · सत्र ${opts.academicYear}` : `*Fee details* · session ${opts.academicYear}`);

  if (shown.length === 0) {
    lines.push(
      "",
      hindi
        ? "आपके बच्चे की इस सत्र की फीस अभी रिकॉर्ड में नहीं मिली। आपका सवाल स्कूल ऑफिस को भेज दिया गया है, वे जल्द बताएँगे।"
        : "This session's fee for your child is not on the record yet. Your question has gone to the school office and they will reply soon.",
    );
    return { text: lines.join("\n"), escalate: true };
  }

  for (const c of shown) {
    if (question.transportOnly && !c.heads.some((h) => h.transport)) continue;
    lines.push("", `*${c.name}*${c.classLabel ? ` (${c.classLabel})` : ""}`);
    const heads = question.transportOnly
      ? c.heads.filter((h) => h.transport)
      : question.transport && !question.discount
        ? [...c.heads.filter((h) => h.transport), ...c.heads.filter((h) => !h.transport)]
        : c.heads;
    for (const h of heads) {
      const amount =
        h.eachPaise != null && h.count > 1
          ? `${formatInr(h.eachPaise)} × ${h.count} = *${formatInr(h.totalPaise)}*`
          : `*${formatInr(h.totalPaise)}*`;
      lines.push(`• ${h.head}: ${amount}`);
    }
    if (question.transportOnly) continue;
    if (c.concessionPaise > 0) {
      lines.push(
        hindi
          ? `_(ऊपर की राशि में ${formatInr(c.concessionPaise)} की छूट पहले ही घटा दी गई है)_`
          : `_(the amounts above already have a concession of ${formatInr(c.concessionPaise)} taken off)_`,
      );
    }
    lines.push(
      hindi
        ? `साल की कुल फीस: *${formatInr(c.totalPaise)}* · जमा: ${formatInr(c.paidPaise)} · बाकी: *${formatInr(c.balancePaise)}*`
        : `Year total: *${formatInr(c.totalPaise)}* · paid: ${formatInr(c.paidPaise)} · left: *${formatInr(c.balancePaise)}*`,
    );
    if (c.dueNowPaise > 0) {
      lines.push(hindi ? `अभी तक देय (चालू महीने तक): ${formatInr(c.dueNowPaise)}` : `Due up to this month: ${formatInr(c.dueNowPaise)}`);
    }
  }

  if (question.transport && !shown.some((c) => c.heads.some((h) => h.transport))) {
    escalate = true;
    lines.push(
      "",
      hindi
        ? "🚌 आपके बच्चे के लिए स्कूल बस रिकॉर्ड में नहीं है, इसलिए ऊपर बस की फीस नहीं है। बस सुविधा और उसकी फीस के लिए आपका सवाल ऑफिस को भेज दिया गया है।"
        : "🚌 Your child is not on the school bus in our records, so no bus fee is shown. Your question about the bus and its fee has gone to the office.",
    );
  }

  if (question.namedClass && !shown.some((c) => classLabelMatches(c.classLabel, question.namedClass))) {
    escalate = true;
    lines.push(
      "",
      hindi
        ? `ऊपर आपके बच्चे की अपनी फीस है। *${question.namedClass}* कक्षा (जैसे नए एडमिशन) की फीस के लिए आपका सवाल ऑफिस को भेज दिया गया है।`
        : `The above is your own child's fee. For the *${question.namedClass}* class fee (for example a new admission), your question has gone to the office.`,
    );
  }

  if (question.discount) {
    escalate = true;
    lines.push(
      "",
      hindi
        ? "छूट के बारे में आपकी बात स्कूल ऑफिस तक पहुँचा दी गई है — छूट का निर्णय ऑफिस/प्रधानाचार्य करते हैं, वे आपसे बात करेंगे।"
        : "Your request about a discount has gone to the school office — discounts are decided by the office / principal, and they will talk to you.",
    );
  }

  lines.push("", hindi ? "अभी का बकाया देखने के लिए *DUES*, भुगतान के लिए *PAY* लिखें।" : "Reply *DUES* for what is owed now, *PAY* to pay.");
  return { text: lines.join("\n"), escalate };
}

/* ── Small talk that is not a question ─────────────────────────────── */

/** "ok", "thanks", "ठीक है", "👍" — acknowledge, do not send the menu again. */
export function isSisAcknowledgement(text: string): boolean {
  if (/^[👍🙏✅👌\s]+$/u.test((text || "").trim()) && (text || "").trim()) return true;
  const t = (text || "").trim().toLowerCase().replace(/[.!🙏👍\s]+$/u, "");
  if (!t) return false;
  return /^(ok+|okay|okk?|k|thik\s*h(ai|e)?|theek\s*h(ai|e)?|thank\s*(you|u)|thanks|thx|dhanyavaad|dhanyawad|shukriya|ji|jee|haan\s*ji|ha\s*ji|done|noted|ठीक\s*है|धन्यवाद|शुक्रिया|जी|ओके)$/iu.test(t) || /^[👍🙏✅👌]+$/u.test((text || "").trim());
}

export function composeSisAcknowledgement(hindi: boolean): string {
  return hindi
    ? "धन्यवाद 🙏 कुछ और जानना हो तो लिखें — या *DUES* · *PAY* · *RECEIPTS* · *HUMAN*।"
    : "Thank you 🙏 Write any time — or reply *DUES* · *PAY* · *RECEIPTS* · *HUMAN*.";
}

/** "hi", "hlw", "hello sir", "namaskar", "good morning", "प्रणाम" — a greeting, answered with the welcome. */
export function isSisGreeting(text: string): boolean {
  const t = (text || "").trim().toLowerCase().replace(/[.!🙏\s]+$/u, "");
  if (!t) return true;
  return /^(hi+|hii+|hey|hlo+|hlw|helo+|hello+|hello\s*(sir|mam|ma'am|madam|ji)|hi\s*(sir|mam|madam|ji)|namaste|namaskar|namaskaar|pranam|good\s*(morning|afternoon|evening)|gm|start|menu|नमस्ते|नमस्कार|प्रणाम|राम\s*राम|जय\s*श्री\s*राम)$/iu.test(t);
}

/**
 * An automatic reply from the parent's own WhatsApp Business account —
 * "You have contacted Aqua RO Service… we are currently unavailable". The
 * bot answered one with the school menu on 13 Sep 2026, which then triggers
 * the other side's auto-reply again. Logged, never answered.
 */
export function looksLikeAutoReply(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (t.length < 25) return false;
  return /you have contacted|currently unavailable|we (will|shall) (get back|get in touch|respond)|thank(s| you) for (contacting|your message|reaching)|this is an auto(mated|matic)|auto[-\s]?reply|out of office|मैसेज के लिए धन्यवाद|संदेश के लिए धन्यवाद|हम जल्द ही आपसे संपर्क|catalog(ue)?\b.*(book|order)|booking.*catalog/i.test(t);
}

/** When the model cannot answer from the family's own record — already sent to the office. */
export function composeSisUngroundedReply(hindi: boolean): string {
  return hindi
    ? "इसकी जानकारी मेरे पास नहीं है 🙏 आपका सवाल स्कूल ऑफिस को भेज दिया गया है — वे जल्द ही इसी WhatsApp पर जवाब देंगे।"
    : "I don't have that information 🙏 Your question has been sent to the school office — they will reply on this WhatsApp soon.";
}

/* ── "Already paid" → show them the record ─────────────────────────────
 *
 * The director's rule (14 Sep 2026): when a parent says "jama ho gaya",
 * "paid", "sab jama hai", do not just apologise — look up the family's own
 * receipts and dues and show them, with dates and amounts, what they paid,
 * what each payment covered, and what is still left up to this month. That
 * remaining amount is why the reminder came. A parent who can see the
 * receipt list either finds the gap themselves or sends the one receipt the
 * school is missing.
 */

export type SisPaidReceipt = {
  /** YYYY-MM-DD */
  date: string;
  receiptNo: string;
  amountPaise: number;
  /** Discount given on this receipt, if any. */
  waivedPaise?: number;
  /** What the payment was put against, as on the receipt. */
  covered: { studentName: string; label: string; amountPaise: number }[];
};

export type SisOpenDue = {
  studentName: string;
  label: string;
  amountPaise: number;
  dueOn: string;
};

/** "2026-08-12" → "12 Aug 2026". */
export function formatPaidDate(iso: string): string {
  const d = (iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso || "";
  const [y, m, day] = d.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m! - 1];
  return `${day} ${mon} ${y}`;
}

/**
 * "Tuition Fee · April", "Tuition Fee · May", "Exam Fee · April" for one
 * child → "Tuition Fee (April, May) · Exam Fee (April)". A receipt for four
 * months of three heads is otherwise twelve lines on a phone.
 */
export function summariseCovered(lines: { label: string }[]): string {
  const order: string[] = [];
  const periods = new Map<string, string[]>();
  for (const l of lines) {
    // "Transport · September 2026 · MAGIC-2 · −₹100 waived" → head
    // "Transport", period "September". The route and the waiver are not
    // what a parent needs in a list of what the payment covered.
    const segs = (l.label || "").split(" · ").map((x) => x.trim()).filter((x) => x && !/waived$/i.test(x));
    const h = segs[0] || (l.label || "").trim();
    const p = (segs[1] || "").replace(/\s+\d{4}$/, "");
    if (!periods.has(h)) {
      periods.set(h, []);
      order.push(h);
    }
    if (p && !periods.get(h)!.includes(p)) periods.get(h)!.push(p);
  }
  const monthIdx = (m: string) => ACADEMIC_MONTHS.indexOf(m.slice(0, 3).toLowerCase());
  return order
    .map((h) => {
      const ps = periods.get(h)!;
      if (ps.every((p) => monthIdx(p) >= 0)) ps.sort((a, b) => monthIdx(a) - monthIdx(b));
      return ps.length ? `${h} (${ps.join(", ")})` : h;
    })
    .join(" · ");
}

/** April first: the school year's order, so "June, July, August" reads as a run. */
const ACADEMIC_MONTHS = ["apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec", "jan", "feb", "mar"];

export function composeSisPaidStatement(opts: {
  hindi: boolean;
  guardianName: string;
  academicYear: string;
  /** This session's receipts, newest first. */
  receipts: SisPaidReceipt[];
  /** Still owed up to the running month. */
  openDues: SisOpenDue[];
}): { text: string; escalate: boolean; officeNote: string } {
  const { hindi } = opts;
  const MAX_RECEIPTS = 6;
  const MAX_DUES = 10;
  const paidTotal = opts.receipts.reduce((a, r) => a + r.amountPaise, 0);
  const dueTotal = opts.openDues.reduce((a, d) => a + d.amountPaise, 0);
  const who = opts.guardianName?.trim();
  const lines: string[] = [];

  lines.push(
    hindi
      ? `🙏 ${who ? `${who} जी, ` : ""}आपके परिवार की फीस का विवरण (सत्र ${opts.academicYear}):`
      : `🙏 ${who ? `${who}, ` : ""}here is your family's fee record (session ${opts.academicYear}):`,
  );

  lines.push("", hindi ? "✅ *जमा की गई फीस*" : "✅ *Fees paid*");
  if (opts.receipts.length === 0) {
    lines.push(hindi ? "इस सत्र की कोई रसीद हमारे रिकॉर्ड में नहीं है।" : "No receipt for this session is on our record.");
  } else {
    for (const r of opts.receipts.slice(0, MAX_RECEIPTS)) {
      const off = r.waivedPaise && r.waivedPaise > 0
        ? hindi ? ` (छूट ${formatInr(r.waivedPaise)})` : ` (discount ${formatInr(r.waivedPaise)})`
        : "";
      lines.push(
        hindi
          ? `• ${formatPaidDate(r.date)} · रसीद ${r.receiptNo} · *${formatInr(r.amountPaise)}*${off}`
          : `• ${formatPaidDate(r.date)} · receipt ${r.receiptNo} · *${formatInr(r.amountPaise)}*${off}`,
      );
      const byChild = new Map<string, { label: string }[]>();
      for (const c of r.covered) {
        const k = c.studentName || "";
        byChild.set(k, [...(byChild.get(k) ?? []), c]);
      }
      for (const [child, ls] of byChild) {
        const summary = summariseCovered(ls);
        if (summary) lines.push(`   ${child ? `${child}: ` : ""}${summary}`);
      }
    }
    if (opts.receipts.length > MAX_RECEIPTS) {
      const more = opts.receipts.length - MAX_RECEIPTS;
      lines.push(hindi ? `   …और ${more} पुरानी रसीदें` : `   …and ${more} earlier receipts`);
    }
    lines.push(hindi ? `*कुल जमा: ${formatInr(paidTotal)}*` : `*Total paid: ${formatInr(paidTotal)}*`);
  }

  if (opts.openDues.length === 0) {
    lines.push(
      "",
      hindi
        ? "✅ चालू महीने तक आपकी *पूरी फीस जमा है*, कुछ बाकी नहीं है।"
        : "✅ Everything up to this month is *paid* — nothing is due.",
      hindi
        ? "यदि आपको बकाया का स्मरण मिला था, तो वह आपका भुगतान दर्ज होने से पहले चला गया होगा — इसके लिए खेद है 🙏"
        : "If you received a reminder, it went out before your payment was recorded — sorry for that 🙏",
    );
    return {
      text: lines.join("\n"),
      escalate: false,
      officeNote: `Parent says paid — record agrees: nothing due up to this month (${opts.receipts.length} receipts, ${formatInr(paidTotal)}).`,
    };
  }

  lines.push("", hindi ? "⏳ *अभी तक बाकी (चालू महीने तक)*" : "⏳ *Still due (up to this month)*");
  for (const d of opts.openDues.slice(0, MAX_DUES)) {
    lines.push(
      hindi
        ? `• ${d.studentName}: ${d.label} — *${formatInr(d.amountPaise)}* (अंतिम तिथि ${formatPaidDate(d.dueOn)})`
        : `• ${d.studentName}: ${d.label} — *${formatInr(d.amountPaise)}* (due ${formatPaidDate(d.dueOn)})`,
    );
  }
  if (opts.openDues.length > MAX_DUES) {
    const more = opts.openDues.length - MAX_DUES;
    lines.push(hindi ? `…और ${more} पंक्ति` : `…and ${more} more`);
  }
  lines.push(
    hindi ? `*कुल बाकी: ${formatInr(dueTotal)}*` : `*Total due: ${formatInr(dueTotal)}*`,
    "",
    hindi
      ? "इसी बाकी राशि के लिए आपको फीस का स्मरण संदेश भेजा गया था।"
      : "This remaining amount is why you received the fee reminder.",
    "",
    hindi
      ? "यदि आपने कोई भुगतान किया है जो ऊपर नहीं दिख रहा, तो कृपया उसकी *रसीद या स्क्रीनशॉट* यहीं भेजें — ऑफिस जाँच कर रिकॉर्ड ठीक कर देगा। भुगतान के लिए *PAY* लिखें।"
      : "If you made a payment that is not shown above, please send its *receipt or a screenshot* here — the office will check and correct the record. Reply *PAY* to pay.",
  );
  return {
    text: lines.join("\n"),
    escalate: true,
    officeNote: `Parent says paid — record shows ${formatInr(dueTotal)} still due up to this month over ${opts.openDues.length} line(s); ${opts.receipts.length} receipts this session totalling ${formatInr(paidTotal)}. Check for a payment not yet entered.`,
  };
}


/* ── PAY: the direct link with what it pays for ──────────────────────── */

/**
 * The reply to PAY / PAY 1: the family's own payment link and exactly what it
 * collects, line by line. The parent taps once and pays on the gateway; the
 * receipt books itself. There is no "pay in GPay, come back, tap Confirm
 * paid" — that was the fallback for a school with no gateway, and it had
 * been the only thing parents were ever told.
 */
export function composeSisDirectPayReply(opts: {
  hindi: boolean;
  url: string;
  who: string;
  lines: { studentName: string; label: string; amountPaise: number; dueOn: string }[];
  totalPaise: number;
}): string {
  const MAX = 12;
  const byChild = new Set(opts.lines.map((l) => l.studentName)).size > 1;
  const row = (l: (typeof opts.lines)[number]) =>
    `• ${byChild && l.studentName ? `${l.studentName}: ` : ""}${l.label} — ${formatInr(l.amountPaise)}`;
  const more = opts.lines.length > MAX ? opts.lines.length - MAX : 0;
  if (opts.hindi) {
    return [
      `💳 *फीस भुगतान* · ${opts.who}`,
      "",
      "*इस भुगतान में शामिल:*",
      ...opts.lines.slice(0, MAX).map(row),
      more ? `…और ${more} पंक्ति` : "",
      `*कुल: ${formatInr(opts.totalPaise)}*`,
      "",
      "👇 नीचे के लिंक से सीधे भुगतान करें — UPI (GPay, PhonePe, Paytm), कार्ड या नेटबैंकिंग:",
      opts.url,
      "",
      "✅ भुगतान होते ही खाता अपडेट होगा और रसीद अपने आप इसी WhatsApp पर आ जाएगी — कुछ और दबाने की ज़रूरत नहीं।",
    ]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n");
  }
  return [
    `💳 *Fee payment* · ${opts.who}`,
    "",
    "*This payment covers:*",
    ...opts.lines.slice(0, MAX).map(row),
    more ? `…and ${more} more` : "",
    `*Total: ${formatInr(opts.totalPaise)}*`,
    "",
    "👇 Pay directly from this link — UPI (GPay, PhonePe, Paytm), card or net banking:",
    opts.url,
    "",
    "✅ The moment the payment goes through, your account updates and the receipt comes to this WhatsApp by itself — nothing else to tap.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}
