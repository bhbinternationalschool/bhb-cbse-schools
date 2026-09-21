/**
 * UDISE+ / APAAR — telling a parent what the school still needs, and why.
 *
 * When a parent whose child has an open UDISE+ gap writes to the school
 * about anything, the bot answers them as usual and then — at most once a
 * week — sends one message: which documents each child still needs, why
 * PEN and APAAR matter, what the family gains, and where that comes from.
 * The Ministry of Education's consent / refusal form goes with it.
 *
 * Pure. Every claim in the text comes from an official source, checked on
 * 21 Sep 2026, and nothing here says more than those sources do:
 *  - apaar.education.gov.in (Ministry of Education): APAAR is "One Nation
 *    One Student ID" under NEP 2020; "PEN of student is mandatory for
 *    generation of APAAR ID"; "the name of student as per student records
 *    in UDISE+ must match with the name of the student as per Aadhaar";
 *    records kept in DigiLocker; "voluntary", with parental consent.
 *  - The Ministry's "Parental Consent / Refusal Form for APAAR ID
 *    Generation" (Annexure-1) — the form attached — which also names
 *    scholarship portals as an optional, consented use.
 *
 * APAAR is consent-based and the message says so. It never tells a parent
 * the ID is compulsory, because the Ministry says it is not.
 */

import { missingDocsList } from "@/lib/udiseDocIntakeAi";

export type NudgeChildInput = {
  name: string;
  classLabel: string;
  gaps: string[];
  hasDob: boolean;
  hasAddress: boolean;
};

export type NudgeChildNeed = {
  name: string;
  classLabel: string;
  docs: string[];
  /** APAAR not yet made: the signed consent / refusal form is needed. */
  consent: boolean;
};

/** What each child still needs from the family. Children needing nothing are left out. */
export function udiseNudgeNeeds(children: NudgeChildInput[], language: "en" | "hi"): NudgeChildNeed[] {
  const out: NudgeChildNeed[] = [];
  for (const c of children) {
    const docs = missingDocsList({ gaps: c.gaps, hasDob: c.hasDob, hasAddress: c.hasAddress, language });
    const consent = c.gaps.includes("apaar");
    if (!docs.length && !consent) continue;
    out.push({ name: c.name, classLabel: c.classLabel, docs, consent });
  }
  return out;
}

/** Days between nudges to one family, and how many before a person takes over. */
export const UDISE_NUDGE_EVERY_DAYS = 7;
export const UDISE_NUDGE_MAX = 4;

/**
 * Whether this family may be sent the message now.
 *
 * A parent who writes every day must not get the same long message every
 * day; one who has been told four times needs a phone call, not a fifth.
 * Night is left alone (20:00–08:00 IST), the same hours the fee reminders keep.
 */
export function udiseNudgeDue(input: {
  lastAtIso: string | null;
  sentCount: number;
  now: Date;
  istHour: number;
}): { due: boolean; reason: string } {
  if (input.sentCount >= UDISE_NUDGE_MAX) return { due: false, reason: "max" };
  if (input.istHour >= 20 || input.istHour < 8) return { due: false, reason: "night" };
  if (input.lastAtIso) {
    const since = input.now.getTime() - Date.parse(input.lastAtIso);
    if (Number.isFinite(since) && since < UDISE_NUDGE_EVERY_DAYS * 86_400_000) return { due: false, reason: "recent" };
  }
  return { due: true, reason: "" };
}

/** The message. Hindi by default, as every parent message is. */
export function composeUdiseNudge(input: {
  guardianName: string;
  needs: NudgeChildNeed[];
  language: "en" | "hi";
  consentAttached: boolean;
}): string {
  const hi = input.language === "hi";
  const anyConsent = input.needs.some((n) => n.consent);
  const lines: string[] = [];
  if (hi) {
    lines.push(
      "📋 *UDISE+ / APAAR ID — ज़रूरी दस्तावेज़*",
      `नमस्ते ${input.guardianName || "अभिभावक"} जी 🙏`,
      "",
      "स्कूल इस सत्र के UDISE+ रिकॉर्ड अभी पूरे कर रहा है। कृपया *जल्द से जल्द* इनकी साफ़ फ़ोटो या PDF यहीं भेजें:",
    );
    for (const n of input.needs) {
      lines.push("", `*${n.name}* (${n.classLabel})`);
      for (const d of n.docs) lines.push(`• ${d}`);
      if (n.consent) lines.push(`• APAAR सहमति फ़ॉर्म — भरकर व हस्ताक्षर करके${input.consentAttached ? " (साथ में भेजा है)" : ""}`);
    }
    lines.push(
      "",
      "*यह क्यों ज़रूरी है*",
      "• *PEN* (Permanent Education Number) — UDISE+ में बच्चे का स्थायी शिक्षा नंबर, जो पूरी पढ़ाई में साथ रहता है। स्कूल बदलने पर बच्चे का रिकॉर्ड इसी नंबर से आगे जाता है।",
      "• *APAAR ID* — \"One Nation One Student ID\" (राष्ट्रीय शिक्षा नीति 2020, शिक्षा मंत्रालय)। मंत्रालय के अनुसार APAAR ID के लिए बच्चे का PEN अनिवार्य है, और UDISE+ में बच्चे का नाम आधार के नाम से मेल खाना चाहिए — इसीलिए आधार कार्ड चाहिए।",
      "",
      "*बच्चे और परिवार को लाभ*",
      "• मार्कशीट, प्रमाणपत्र और उपलब्धियाँ DigiLocker में हमेशा सुरक्षित — कागज़ खोने का डर नहीं",
      "• स्कूल, बोर्ड या कॉलेज बदलने पर पूरा शैक्षिक रिकॉर्ड बच्चे के साथ जाता है",
      "• छात्रवृत्ति पोर्टल जैसी सेवाओं में सुविधा (आपकी सहमति से)",
    );
    if (anyConsent) {
      lines.push("", "APAAR ID आपकी सहमति से बनती है — शिक्षा मंत्रालय का सहमति फ़ॉर्म (Annexure-1) भरकर उसकी फ़ोटो भेजें।");
    }
    lines.push(
      "",
      "📎 संदर्भ: शिक्षा मंत्रालय, भारत सरकार — apaar.education.gov.in",
      "आधार नंबर चैट में टाइप न करें — कार्ड की फ़ोटो भेजें, बच्चे के रिकॉर्ड में अपने-आप दर्ज हो जाएगा।",
    );
    return lines.join("\n");
  }
  lines.push(
    "📋 *UDISE+ / APAAR ID — documents needed*",
    `Dear ${input.guardianName || "Parent"} 🙏`,
    "",
    "The school is completing this session's UDISE+ records now. Please send a clear photo or PDF of these *as soon as possible*, here on WhatsApp:",
  );
  for (const n of input.needs) {
    lines.push("", `*${n.name}* (${n.classLabel})`);
    for (const d of n.docs) lines.push(`• ${d}`);
    if (n.consent) lines.push(`• APAAR consent form — filled in and signed${input.consentAttached ? " (attached)" : ""}`);
  }
  lines.push(
    "",
    "*Why it is needed*",
    "• *PEN* (Permanent Education Number) — the child's permanent education number in UDISE+, which stays with them through school. When a child changes school, the record moves on this number.",
    "• *APAAR ID* — \"One Nation One Student ID\" (National Education Policy 2020, Ministry of Education). The Ministry requires the child's PEN to create an APAAR ID, and the child's name in UDISE+ must match the name on Aadhaar — which is why the Aadhaar card is needed.",
    "",
    "*What the child and family gain*",
    "• Marksheets, certificates and achievements kept safe in DigiLocker — nothing lost on paper",
    "• The full academic record goes with the child to a new school, board or college",
    "• Easier access to services such as scholarship portals (with your consent)",
  );
  if (anyConsent) {
    lines.push("", "An APAAR ID is made only with your consent — please fill in the Ministry of Education's consent form (Annexure-1) and send a photo of it.");
  }
  lines.push(
    "",
    "📎 Reference: Ministry of Education, Government of India — apaar.education.gov.in",
    "Please don't type the Aadhaar number in chat — send a photo of the card and it is entered in the child's record automatically.",
  );
  return lines.join("\n");
}

/** What goes in the family's message log: the list, so "what did we ask for?" has an answer. */
export function udiseNudgeLogLine(needs: NudgeChildNeed[]): string {
  return needs
    .map((n) => `${n.name}: ${[...n.docs, ...(n.consent ? ["APAAR consent form"] : [])].join(", ")}`)
    .join(" · ")
    .slice(0, 400);
}
