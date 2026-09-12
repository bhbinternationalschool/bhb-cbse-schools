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

export function sisBotWelcomeText(
  multiChild = false,
  hasTransport = false,
): string {
  const payHint = multiChild
    ? "• *PAY* — all children · *PAY 1* / *PAY 2* — one child (GPay / UPI)"
    : "• *PAY* — GPay / UPI pay link";
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

export function composeSisKidsReply(children: SisBotChildLine[]): string {
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
      ? "Reply *DUES* · *PAY* (all) · *PAY 1* / *PAY 2* per child — pay via GPay / UPI."
      : "Reply *DUES* for fee balance · *PAY* for a GPay / UPI link.";
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
}): string {
  const scope =
    opts.childFilterName != null
      ? ` · ${opts.childFilterName}`
      : "";
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
      ? `Reply *PAY ${opts.childFilterName.split(" ")[0]}* for this child's link.`
      : "Reply *PAY* for all children · *PAY 1* / *PAY 2* for one child.";
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
    payHint,
    "",
    "_After GPay payment, tap *Confirm paid* on the link for instant receipt._",
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
}): string {
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
): string {
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
    "Full digital receipt is sent after GPay / UPI payment (tap *Confirm paid* on the link).",
  ].join("\n");
}

export function composeSisInfoReply(): string {
  return [
    `*${TENANT.nameDisplay}*`,
    TENANT.city,
    TENANT.publicPortal ? `Portal: ${TENANT.publicPortal}` : null,
    "",
    "Fee office hours: school working days (confirm with front office).",
    "Parent web portal: /parent (demo login) for fees & subjects.",
    "",
    "Menu: " + SIS_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · "),
    "Pay fees: reply *PAY* → GPay / UPI → tap *Confirm paid* on the link.",
    "Multi-child: *PAY 1* · *PAY 2* per child.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeSisHumanReply(): string {
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

export function detectSisFeeReplyIntent(text: string): SisFeeReplyIntent | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (CLAIMS_PAID.test(t)) return "claims_paid";
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
