/**
 * What a family's reply to "where does your child wait?" actually means.
 *
 * The request goes out with two quick-reply buttons, and only one of them
 * produces a location. Tapping *लोकेशन भेजें* sends the words "लोकेशन भेजें" —
 * it is an intention, not a pin — so a flow that treated any reply as an
 * answer would close the request on a parent who was about to send one. The
 * three outcomes are kept apart here, away from the WhatsApp plumbing, so
 * they can be tested against the words parents actually send.
 *
 * WHY A REFUSAL IS A FIRST-CLASS ANSWER
 * The message promises that transport continues unchanged and that we will
 * not ask again. Keeping that promise means recognising a no — including the
 * short, unpunctuated, Roman-script no that most people actually type — and
 * recording it, so the next person to run the job does not ask the same
 * family a second time.
 */

import { haversineKm } from "@/lib/transport";

export type PinReplyKind =
  /** A location arrived. */
  | "pin"
  /** "I will send it" — an intention. The request stays open. */
  | "will_share"
  /** A no. Record it and stop asking. */
  | "decline"
  /** Anything else; the ordinary bot should answer instead. */
  | "unrelated";

/** Words that mean "no" to this question, Hindi and Roman-script Hindi. */
const DECLINE_PATTERNS = [
  /^अभी\s*नहीं/,
  /^नहीं/,
  /^ना$/,
  /^नही/,
  /\bnot\s*now\b/i,
  /^no\b/i,
  /^nahi+n?\b/i,
  /^nai\b/i,
  /\bmana\b/i,
  /\bdon'?t\s*want\b/i,
  /\bnahi\s*bhejna\b/i,
];

/** Words that mean "I'll send it", which is NOT a pin. */
const WILL_SHARE_PATTERNS = [
  /^लोकेशन\s*भेज/,
  /\bshare\s*location\b/i,
  /\bsend(ing)?\s*(the\s*)?location\b/i,
  /^location$/i,
  /^लोकेशन$/,
  /\bbhej\s*(raha|rahe|rahi|denge|dunga|dungi)\b/i,
  /\bthik\s*hai\b/i,
  /^ok(ay)?\b/i,
  /^ठीक\s*है/,
  /^हाँ|^हा\b|^haan?\b|^yes\b/i,
];

function firstMatch(text: string, patterns: RegExp[]): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return patterns.some((re) => re.test(t));
}

/**
 * Classify one inbound message from a household we have asked.
 *
 * A location always wins: a parent who taps the button and then sends a pin
 * in the same breath has answered, whatever the accompanying words say.
 */
export function classifyPinReply(input: {
  text: string;
  hasLocation: boolean;
}): PinReplyKind {
  if (input.hasLocation) return "pin";
  const text = (input.text || "").trim();
  if (!text) return "unrelated";
  // Refusal is checked FIRST. "nahi bhej payenge" contains "bhej", and
  // reading that as an intention to send would keep pestering a family who
  // has just said no.
  if (firstMatch(text, DECLINE_PATTERNS)) return "decline";
  if (firstMatch(text, WILL_SHARE_PATTERNS)) return "will_share";
  return "unrelated";
}

/**
 * How far a boarding pin may sensibly be from the school.
 *
 * The furthest village any rider comes from is about 30 km by road. A pin
 * from 200 km away is a parent who happened to be travelling when they read
 * the message, and saving it would move their child's stop to another
 * district. Generous, because refusing a real pin is worse than holding one
 * for a human to look at.
 */
export const MAX_PIN_KM_FROM_SCHOOL = 60;

export type PinPlausibility =
  | { ok: true; kmFromSchool: number }
  | { ok: false; reason: "too-far" | "not-a-coordinate"; kmFromSchool: number | null };

export function checkPinPlausible(
  pin: { lat: number; lng: number },
  school: { lat: number; lng: number },
): PinPlausibility {
  const { lat, lng } = pin;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    (lat === 0 && lng === 0) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { ok: false, reason: "not-a-coordinate", kmFromSchool: null };
  }
  const km = Math.round(haversineKm(lat, lng, school.lat, school.lng) * 10) / 10;
  if (km > MAX_PIN_KM_FROM_SCHOOL) {
    return { ok: false, reason: "too-far", kmFromSchool: km };
  }
  return { ok: true, kmFromSchool: km };
}

/** Join names the way a person would say them, in the family's language. */
export function joinNames(names: string[], language: "hi" | "en"): string {
  const list = names.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  const last = list[list.length - 1];
  const rest = list.slice(0, -1).join(", ");
  return language === "hi" ? `${rest} और ${last}` : `${rest} and ${last}`;
}

/**
 * The confirmation, which NAMES the children the pin was saved against.
 *
 * A quarter of transport households send more than one child, and one pin is
 * recorded for all of them. Naming them is what makes that correctable: a
 * family whose older child boards on the main road can see, in the reply,
 * that we have put both at the same place, and say so.
 */
export function pinSavedMessage(input: {
  childNames: string[];
  kmFromSchool: number;
  language: "hi" | "en";
}): string {
  const names = joinNames(input.childNames, input.language);
  if (input.language === "hi") {
    return (
      `धन्यवाद 🙏 जगह मिल गई।\n\n` +
      `यह ${names} के बस स्टॉप के रूप में दर्ज कर ली गई है ` +
      `(विद्यालय से लगभग ${input.kmFromSchool} किमी)।\n\n` +
      `अगर आपके बच्चे अलग-अलग जगह से बस पकड़ते हैं, तो इसी संदेश का उत्तर देकर बता दीजिए — ` +
      `हम अलग-अलग जगह दर्ज कर देंगे।\n\n` +
      `बस या स्टॉप में कोई बदलाव होगा तो कार्यालय आपको पहले बताएगा।`
    );
  }
  return (
    `Thank you 🙏 We have the spot.\n\n` +
    `It is recorded as the boarding point for ${names} ` +
    `(about ${input.kmFromSchool} km from school).\n\n` +
    `If your children board from different places, reply to this message and ` +
    `tell us — we will record them separately.\n\n` +
    `The office will tell you before any bus or stop actually changes.`
  );
}

/** Asked to send, but nothing arrived yet — explain how, do not close. */
export function pinHowToMessage(language: "hi" | "en"): string {
  if (language === "hi") {
    return (
      `ज़रूर 🙏 इसी चैट में नीचे 📎 दबाइए → *Location* चुनिए → ` +
      `*Send your current location* भेजिए।\n\n` +
      `हो सके तो वहीं खड़े होकर भेजिए जहाँ बच्चा रोज़ बस का इंतज़ार करता है।`
    );
  }
  return (
    `Of course 🙏 In this chat tap 📎 → choose *Location* → ` +
    `*Send your current location*.\n\n` +
    `If you can, send it while standing at the spot where your child waits ` +
    `for the bus each morning.`
  );
}

/** A no, acknowledged, with the promise kept. */
export function pinDeclinedMessage(language: "hi" | "en"): string {
  if (language === "hi") {
    return (
      `ठीक है जी 🙏 कोई बात नहीं।\n\n` +
      `आपके बच्चे की बस और स्टॉप में कोई बदलाव नहीं होगा, और हम दोबारा नहीं पूछेंगे।\n\n` +
      `बाद में मन हो तो कभी भी यहाँ लोकेशन भेज दीजिए।`
    );
  }
  return (
    `That is absolutely fine 🙏\n\n` +
    `Your child's bus and stop stay exactly as they are, and we will not ask ` +
    `again.\n\n` +
    `If you change your mind, you can send the location here any time.`
  );
}

/** A pin arrived, but from far outside the area the buses serve. */
export function pinTooFarMessage(input: {
  kmFromSchool: number;
  language: "hi" | "en";
}): string {
  if (input.language === "hi") {
    return (
      `धन्यवाद 🙏 पर यह जगह विद्यालय से लगभग ${input.kmFromSchool} किमी दूर दिख रही है, ` +
      `जो बस के रास्ते से काफ़ी बाहर है।\n\n` +
      `अगर आप अभी कहीं बाहर हैं तो कोई बात नहीं — जब बच्चे के बस स्टॉप पर हों तब भेज दीजिए। ` +
      `अगर यही सही जगह है तो इसी संदेश का उत्तर दीजिए, कार्यालय देख लेगा।`
    );
  }
  return (
    `Thank you 🙏 — but that spot is about ${input.kmFromSchool} km from school, ` +
    `well outside where the buses run.\n\n` +
    `If you are away from home just now, no problem: send it when you are at ` +
    `your child's boarding point. If it really is the right place, reply to ` +
    `this message and the office will take a look.`
  );
}
