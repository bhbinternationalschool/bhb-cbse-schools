/**
 * What a parent can do on the school's WhatsApp number — the guide, and the
 * message that closes a chat.
 *
 * The director's rule (14 Sep 2026): every parent conversation ends with a
 * thank-you and this guide, in Hindi and English. A parent who has just been
 * helped is the one most likely to read what else the number does, and most
 * families had only ever seen a fee reminder from it.
 *
 * WHAT IT MAY PROMISE
 * Only what the bot does today. Each line maps to a handler:
 *   DUES / PAY / PAY 1 / RECEIPTS      waSisBotServer buildBotReply, /pay/due
 *   "UKG ki fees kitni", "bus ki fees"  detectSisFeeQuestion → feeQuestionReply
 *   "jama ho gaya"                      paidClaimStatement
 *   "thoda samay chahiye"               the promise-to-pay question
 *   KIDS / INFO / BUS                   buildBotReply (BUS only shown to riders)
 *   photo of Aadhaar / birth certificate, payment screenshot   udiseDocIntake
 *   voice note                          voiceNote transcribe-or-escalate
 *   TUTOR / PASS                        waTutorBot
 *   COMPLAINT                           the complaint Flow
 *   HUMAN, anything the bot cannot answer   escalation + office relay
 *   LANG                                language menu
 * A line added here without a handler is a promise the school breaks the
 * first time a parent tries it — waParentGuide.selftest.ts checks every
 * keyword named is one the bot recognises.
 */

import { TENANT } from "@/lib/types";

/** Every keyword the guide tells a parent to type. */
export const GUIDE_KEYWORDS = ["DUES", "PAY", "PAY 1", "RECEIPTS", "KIDS", "INFO", "BUS", "TUTOR", "PASS", "COMPLAINT", "HUMAN", "MENU", "LANG"] as const;

export function parentBotGuideHi(opts: { hasTransport?: boolean } = {}): string {
  return [
    `🤖 *${TENANT.shortName} — WhatsApp सहायक*`,
    "इस नंबर पर आप कभी भी ये सब कर सकते हैं। नीचे का शब्द लिखें, अपने शब्दों में पूछें, या वॉइस नोट भेजें:",
    "",
    "💰 *फीस*",
    "• *DUES* — अभी तक की बकाया फीस, हर बच्चे की अलग",
    "• *PAY* — सीधा ऑनलाइन भुगतान लिंक (UPI / कार्ड / नेटबैंकिंग), रसीद अपने आप · *PAY 1* / *PAY 2* — एक बच्चे की",
    "• *RECEIPTS* — जमा की गई फीस की रसीदें",
    "• पूछें _\"UKG की फीस कितनी है?\"_ या _\"बस की फीस?\"_ — पूरे साल की फीस का ब्योरा",
    "• लिखें _\"जमा हो गया\"_ — क्या-क्या जमा हुआ और क्या बाकी है, तारीख सहित",
    "• लिखें _\"थोड़ा समय चाहिए\"_ — राशि और तारीख बताइए, ऑफिस नोट कर लेगा",
    "",
    "👨‍👩‍👧 *बच्चे और स्कूल*",
    "• *KIDS* — आपके बच्चों की कक्षा और प्रवेश संख्या",
    "• *INFO* — स्कूल का पता और ऑफिस की जानकारी",
    opts.hasTransport === false ? "" : "• *BUS* — स्कूल बस अभी कहाँ है (बस सुविधा वाले परिवारों के लिए)",
    "• 📄 आधार / जन्म प्रमाण पत्र की फ़ोटो भेजें — बच्चे का रिकॉर्ड अपडेट होगा",
    "• 🧾 ऑनलाइन भुगतान का स्क्रीनशॉट भेजें — ऑफिस मिलान कर लेगा",
    "",
    "📚 *पढ़ाई में मदद*",
    "• *TUTOR* — बच्चे के होमवर्क और सवालों में मदद (रोज़ कुछ संकेत मुफ़्त · पूरी मदद के लिए *PASS*)",
    "",
    "🙋 *स्कूल से बात*",
    "• *COMPLAINT* — शिकायत दर्ज करें",
    "• *HUMAN* — ऑफिस से बात करें, जवाब इसी WhatsApp पर आएगा",
    "• जो सवाल सहायक न समझ पाए, वह अपने आप ऑफिस को भेज दिया जाता है",
    "",
    "⚙️ *MENU* — मुख्य मेनू · *LANG* — भाषा बदलें",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

export function parentBotGuideEn(opts: { hasTransport?: boolean } = {}): string {
  return [
    `🤖 *${TENANT.shortName} — WhatsApp assistant*`,
    "You can do all of this on this number, any time. Type the word below, ask in your own words, or send a voice note:",
    "",
    "💰 *Fees*",
    "• *DUES* — fees due up to now, child by child",
    "• *PAY* — a direct online payment link (UPI / card / net banking), receipt comes automatically · *PAY 1* / *PAY 2* — one child",
    "• *RECEIPTS* — receipts for fees paid",
    "• Ask _\"What is the UKG fee?\"_ or _\"bus fee?\"_ — the full year's fee",
    "• Write _\"already paid\"_ — what has been paid and what is left, with dates",
    "• Write _\"need some time\"_ — tell us the amount and date, the office notes it",
    "",
    "👨‍👩‍👧 *Children & school*",
    "• *KIDS* — your children's class and admission number",
    "• *INFO* — school address and office details",
    opts.hasTransport === false ? "" : "• *BUS* — where the school bus is now (for families on the bus)",
    "• 📄 Send a photo of Aadhaar / birth certificate — the child's record is updated",
    "• 🧾 Send an online payment screenshot — the office matches it",
    "",
    "📚 *Study help*",
    "• *TUTOR* — help with homework and questions (some hints free daily · *PASS* for full help)",
    "",
    "🙋 *Talk to the school*",
    "• *COMPLAINT* — raise a complaint",
    "• *HUMAN* — talk to the office, the reply comes on this WhatsApp",
    "• Anything the assistant cannot answer goes to the office automatically",
    "",
    "⚙️ *MENU* — main menu · *LANG* — change language",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

/** Both languages, Hindi first — the school's default for parents. */
export function parentBotGuideBilingual(opts: { hasTransport?: boolean } = {}): string {
  return `${parentBotGuideHi(opts)}\n\n— — —\n\n${parentBotGuideEn(opts)}`;
}

/** The first message of the one-off send to families inside the 24-hour window. */
export function parentBotIntroMessage(opts: { guardianName?: string; hasTransport?: boolean } = {}): string {
  const name = (opts.guardianName || "").trim();
  return [
    `नमस्ते${name ? ` ${name} जी` : ""} 🙏 / Namaste${name ? ` ${name}` : ""} 🙏`,
    "",
    parentBotGuideBilingual(opts),
  ].join("\n");
}

/**
 * How every parent chat ends: thanks in both languages, then the guide.
 *
 * Sent once per conversation — after a quiet spell, or when the parent says
 * "ok" / "thanks" — never after every message. `needsOffice` adds one line so
 * a parent whose question went to a person is not thanked as though it were
 * finished.
 */
export function parentChatClosingMessage(opts: { hasTransport?: boolean; needsOffice?: boolean } = {}): string {
  return [
    "🙏 *धन्यवाद!* स्कूल से जुड़े रहने के लिए आपका आभार।",
    "🙏 *Thank you* for staying in touch with the school.",
    opts.needsOffice
      ? "\nआपका सवाल ऑफिस तक पहुँच गया है, जवाब इसी WhatsApp पर आएगा। / Your question is with the office; the reply will come here."
      : "",
    "",
    "आगे भी कभी भी लिखें 👇 / Write any time 👇",
    "",
    parentBotGuideBilingual(opts),
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}
