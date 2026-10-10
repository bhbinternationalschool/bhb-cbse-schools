/**
 * "Where is my child's bus?" — what a parent is told.
 *
 * The position itself, and the decision about whether it may be shared at
 * all, come from fleetLivePosition.ts. This module only turns that decision
 * into a sentence — but the sentences are the whole feature, because every
 * one of them is a claim a parent will act on. A father who reads "your bus
 * is here" and drives to the stop has been sent somewhere by this text.
 *
 * Three rules hold throughout:
 *
 *  - Nothing is softened into a maybe. Either we know where the vehicle is,
 *    or we say plainly that we do not.
 *  - No refusal is dressed as a temporary glitch. Three of the six vehicles
 *    have no tracker and never will until one is fitted; telling those 94
 *    families to "try again later" would be a lie they would keep retrying.
 *  - Every dead end offers the office, because a parent asking where the bus
 *    is usually has a reason to be asking.
 */

import type { ParentPositionVerdict } from "@/lib/fleetLivePosition";

/** Hindi in, Hindi out — the script the parent typed decides the reply. */
export function wantsHindi(text: string): boolean {
  return /[ऀ-ॿ]/.test(text || "");
}

/**
 * Recognise the question in the languages parents actually use, including
 * romanised Hindi and Bhojpuri ("bus kahan bade", "gaadi kab aai").
 *
 * Deliberately narrow on the English side: "bus" alone is checked with a word
 * boundary so "business" and "busy" do not trip it.
 */
export function detectBusLocationIntent(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  if (/^bus\b/.test(t)) return true;
  const vehicle = /\b(bus|van|gaadi|gadi|vehicle)\b|बस|गाड़ी|गाडी/;
  const asking = /\b(where|kahan|kaha|kidhar|kab|location|track|reach|aayegi|aegi|ayegi|aai|bade|ba)\b|कहाँ|कहां|कब|कधर|लोकेशन/;
  return vehicle.test(t) && asking.test(t);
}

export type BusReplyContext = {
  /** "Magic-1", or the registration when the route has no name. */
  busLabel: string;
  /** Whose bus this is. Empty when the household has one child. */
  childName: string;
  /** "Moving", "Parked" … already localised by the caller. */
  motionLabel: string;
  speedKmh: number | null;
  ageLabel: string;
  mapsUrl: string;
};

function line(hindi: boolean, en: string, hi: string): string {
  return hindi ? hi : en;
}

/**
 * A position we are willing to stand behind.
 *
 * The age is in the message, not a footnote. "Live" here means a fix from the
 * last few minutes, and the parent is told which few minutes — a bus moves
 * two kilometres in the time this message takes to read.
 */
export function composeBusFoundReply(
  ctx: BusReplyContext,
  hindi: boolean,
): string {
  const who = ctx.childName ? ` (${ctx.childName})` : "";
  const speed =
    ctx.speedKmh !== null && ctx.speedKmh > 3 ? ` · ${Math.round(ctx.speedKmh)} km/h` : "";
  return [
    `🚌 *${ctx.busLabel}*${who} — ${ctx.motionLabel}${speed}`,
    line(
      hindi,
      `Last position ${ctx.ageLabel}:`,
      `आख़िरी लोकेशन (${ctx.ageLabel}):`,
    ),
    ctx.mapsUrl,
    "",
    line(
      hindi,
      "This is the vehicle's position, not your child's stop time.",
      "यह गाड़ी की लोकेशन है — बच्चे के स्टॉप का समय नहीं।",
    ),
  ].join("\n");
}

/**
 * Why we cannot answer, in the parent's terms.
 *
 * `no-feed` is the one that matters most and is the easiest to get wrong. It
 * is not a fault and not a delay: that vehicle has no tracker. Saying so once,
 * clearly, is kinder than an apology that invites the parent to keep asking.
 */
export function composeBusUnavailableReply(
  reason: Extract<ParentPositionVerdict, { share: false }>["reason"],
  ctx: { busLabel: string; childName: string },
  hindi: boolean,
): string {
  const who = ctx.childName ? ` for ${ctx.childName}` : "";
  const whoHi = ctx.childName ? ` ${ctx.childName} के लिए` : "";
  const office = line(
    hindi,
    "Reply *HUMAN* and the office will check for you.",
    "*HUMAN* भेजें — कार्यालय आपके लिए पता कर देगा।",
  );

  switch (reason) {
    case "no-vehicle":
      return [
        line(
          hindi,
          `Our records show no school transport${who}.`,
          `हमारे रिकॉर्ड में${whoHi} स्कूल गाड़ी दर्ज नहीं है।`,
        ),
        office,
      ].join("\n");

    case "no-feed":
      return [
        line(
          hindi,
          `*${ctx.busLabel}* does not have live tracking fitted, so I cannot show its position.`,
          `*${ctx.busLabel}* में लाइव ट्रैकिंग नहीं लगी है, इसलिए लोकेशन नहीं दिखा सकते।`,
        ),
        office,
      ].join("\n");

    case "off-trip":
      return [
        line(
          hindi,
          `*${ctx.busLabel}* is not on a run at the moment.`,
          `*${ctx.busLabel}* अभी चल नहीं रही है।`,
        ),
        line(
          hindi,
          "Live location is shared during the morning and afternoon runs.",
          "लाइव लोकेशन सुबह और दोपहर की ट्रिप के दौरान ही मिलती है।",
        ),
      ].join("\n");

    case "too-old":
      return [
        line(
          hindi,
          `The last position for *${ctx.busLabel}* is too old to rely on, so I will not guess where it is now.`,
          `*${ctx.busLabel}* की आख़िरी लोकेशन बहुत पुरानी है — अभी कहाँ है, अंदाज़ा नहीं लगाएँगे।`,
        ),
        office,
      ].join("\n");
  }
}

/** Joins one reply per bus when a household's children ride different ones. */
export function joinBusReplies(parts: string[]): string {
  return parts.filter(Boolean).join("\n\n———\n\n");
}

/**
 * The transport desk could not be read.
 *
 * Distinct from "no transport on record", and the distinction matters: a
 * failed read tells us nothing about whether this child rides a bus, and
 * saying "you have no school transport" to a family who does is worse than
 * admitting the system is having a moment. fetchTransportDeskFromDb()
 * reports ok:false for exactly this case rather than an empty bundle.
 */
export function composeBusCheckFailedReply(hindi: boolean): string {
  return [
    line(
      hindi,
      "I could not check the transport records just now.",
      "अभी ट्रांसपोर्ट रिकॉर्ड नहीं देख पा रहे हैं।",
    ),
    line(
      hindi,
      "Reply *HUMAN* and the office will tell you where the bus is.",
      "*HUMAN* भेजें — कार्यालय आपको बस की जानकारी देगा।",
    ),
  ].join("\n");
}
