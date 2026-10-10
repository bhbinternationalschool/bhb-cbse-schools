/**
 * "Where is the school?" — the one question the bot could not answer.
 *
 * Found 2026-09-16 in the real chats: two parents wrote *"लोकेशन भेजें"*
 * (14 Sep and 16 Sep) and both got "आपका सवाल ऑफिस तक पहुँच गया है" — the
 * bot's way of saying it did not understand. Nobody was ever sent an
 * address. The English word "address" did reach the INFO reply, but that
 * reply carried the school's name and city and no address either.
 *
 * The school's address and coordinates have been on record all along
 * (lib/types.ts), so this was never a data problem.
 *
 * A parent who types "लोकेशन" wants a pin they can tap and drive to, which
 * is why `sendWhatsAppLocation` sends the real map pin alongside this text.
 */

import { TENANT } from "@/lib/types";
import { schoolAddressLine, schoolIdentity } from "@/lib/schoolIdentity";
import type { MastersState } from "@/lib/masters";

/** A tappable pin for any map app. */
export function schoolMapsLink(): string {
  return `https://www.google.com/maps/search/?api=1&query=${TENANT.schoolLat},${TENANT.schoolLng}`;
}

/**
 * Is this someone asking where the SCHOOL is?
 *
 * Deliberately not "where is the bus" — that is its own question with its
 * own live answer, and a parent watching for the van must never be handed
 * the school's address instead. The bus words are checked first and win.
 */
export function detectSchoolLocationRequest(text: string): boolean {
  const raw = (text || "").trim();
  const t = raw.toLowerCase();
  if (!t) return false;

  // The van has its own intent with its own live answer; a parent watching
  // for the bus must never be handed the campus address instead.
  if (/\b(bus|van|gaadi|gadi)\b/.test(t) || /बस|गाड़ी|वैन/.test(raw)) {
    return false;
  }

  // "Where do I pay the fee" is a fee question, not a map question. A bare
  // "कहाँ" is not enough on its own — it has to be about the school.
  const askedWhere =
    /\b(kaha|kahan|kahaan|kidhar)\b/.test(t) || /कहाँ|कहां|किधर/.test(raw);
  const aboutSchool =
    /\b(school|skool|scool|vidyalaya|campus|bhb)\b/.test(t) ||
    /स्कूल|विद्यालय|कैंपस/.test(raw);

  const saidLocation =
    /\b(location|locaton|loction|address|adress|map|maps|pin|direction|directions|landmark)\b/.test(
      t,
    ) || /लोकेशन|पता|नक्शा|मानचित्र|रास्ता|मार्ग/.test(raw);

  const askedHowToReach =
    /\bkaise (aaye|aayen|aana|pahuche|pahunche|jaye|jayen|jana)\b/.test(t) ||
    /कैसे (आएँ|आएं|पहुँच|पहुंच|जाएँ|जाएं)/.test(raw) ||
    /\bhow (do i |to )?(reach|get to|come)\b/.test(t);

  return saidLocation || askedHowToReach || (askedWhere && aboutSchool);
}

/**
 * Where the school is, how to reach it, and who to call.
 *
 * The address comes from the school profile the office maintains, falling
 * back to the built-in one; the pin comes from the coordinates. Nothing here
 * is invented — a wrong address sends a parent to the wrong village.
 */
export function composeSchoolLocationReply(opts?: {
  hindi?: boolean;
  masters?: MastersState | null;
}): string {
  const hindi = opts?.hindi ?? false;
  const identity = schoolIdentity(opts?.masters ?? null);
  const address = schoolAddressLine(opts?.masters ?? null) || TENANT.schoolAddress;
  const phone = (identity.phone || TENANT.officePhone || "").trim();
  const link = schoolMapsLink();

  if (hindi) {
    return [
      `📍 *${TENANT.nameDisplay}*`,
      "",
      address,
      "",
      `🗺️ नक्शे पर खोलें: ${link}`,
      phone ? `📞 कार्यालय: ${phone}` : null,
      "",
      "नीचे भेजा गया पिन दबाकर सीधे रास्ता देख सकते हैं।",
      "किसी और मदद के लिए *MENU* लिखें।",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `📍 *${TENANT.nameDisplay}*`,
    "",
    address,
    "",
    `🗺️ Open in maps: ${link}`,
    phone ? `📞 Office: ${phone}` : null,
    "",
    "Tap the pin below for directions.",
    "Reply *MENU* for anything else.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The pin itself, for `sendWhatsAppLocation`. */
export function schoolLocationPin(masters?: MastersState | null): {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
} {
  return {
    latitude: TENANT.schoolLat,
    longitude: TENANT.schoolLng,
    name: TENANT.name,
    address: schoolAddressLine(masters ?? null) || TENANT.schoolAddress,
  };
}
