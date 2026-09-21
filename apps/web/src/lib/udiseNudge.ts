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

import type { AadhaarCentre } from "@/lib/aadhaarCentres";
import { missingDocsList } from "@/lib/udiseDocIntakeAi";

export type NudgeChildInput = {
  name: string;
  classLabel: string;
  gaps: string[];
  hasDob: boolean;
  hasAddress: boolean;
  /**
   * The UDISE+ portal rejected this child's Aadhaar ("Validation failed").
   * With it, what the school holds — so the parent can see what must match.
   */
  aadhaarFailed?: { dob: string; gender: string; last4: string } | null;
  /** ISO date of birth, for how a child without Aadhaar enrols (under 5 or not). */
  dob?: string;
};

export type NudgeChildNeed = {
  name: string;
  classLabel: string;
  docs: string[];
  /** APAAR not yet made: the signed consent / refusal form is needed. */
  consent: boolean;
  /** Aadhaar rejected by the portal: a fresh photo of the card, for a re-check. */
  recheck: { dob: string; gender: string; last4: string } | null;
  /** No Aadhaar yet: how to enrol. `under5` decides what the centre does. */
  enrol: { under5: boolean | null } | null;
};

/** What each child still needs from the family. Children needing nothing are left out. */
function under5(dobIso: string | undefined, todayIso: string): boolean | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dobIso || "");
  if (!m) return null;
  const fifth = `${Number(m[1]) + 5}-${m[2]}-${m[3]}`;
  return todayIso < fifth;
}

export function udiseNudgeNeeds(
  children: NudgeChildInput[],
  language: "en" | "hi",
  todayIso: string = new Date().toISOString().slice(0, 10),
): NudgeChildNeed[] {
  const out: NudgeChildNeed[] = [];
  for (const c of children) {
    const docs = missingDocsList({ gaps: c.gaps, hasDob: c.hasDob, hasAddress: c.hasAddress, language });
    const recheck = c.aadhaarFailed ?? null;
    if (recheck && !docs.some((d) => /aadhaar|आधार/i.test(d) && !/father|mother|पिता|माता/i.test(d))) {
      docs.unshift(
        language === "hi"
          ? "बच्चे के आधार कार्ड की साफ़ फ़ोटो — आगे और पीछे (दोबारा जाँच के लिए)"
          : "a clear photo of the child's Aadhaar card — front and back (for a re-check)",
      );
    }
    const consent = c.gaps.includes("apaar");
    if (!docs.length && !consent) continue;
    const enrol = c.gaps.includes("student_aadhaar") && !recheck ? { under5: under5(c.dob, todayIso) } : null;
    out.push({ name: c.name, classLabel: c.classLabel, docs, consent, recheck, enrol });
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


function ddmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * Why a child's Aadhaar was not verified on UDISE+, and what to do.
 *
 * The portal gives no reason beyond "Validation failed". It checks the
 * Aadhaar number against UIDAI with the child's name, date of birth and
 * gender, so the cause is one of those not matching what UIDAI holds, or a
 * wrong digit. The school's own record is shown so the parent can spot it.
 * Fees are UIDAI's published charges (uidai.gov.in, "Aadhaar Update
 * Charges", checked 21 Sep 2026): name / DOB / gender ₹75; a child's
 * biometric update free at 5–7 and 15–17, and at 7–15 until 30 Sep 2026.
 */
function recheckSection(needs: NudgeChildNeed[], hi: boolean): string[] {
  const failed = needs.filter((n) => n.recheck);
  if (!failed.length) return [];
  const g = (x: string) => (hi ? (x === "M" ? "पुरुष" : x === "F" ? "महिला" : "—") : x === "M" ? "Male" : x === "F" ? "Female" : "—");
  const lines: string[] = [""];
  if (hi) {
    lines.push("⚠️ *आधार सत्यापन नहीं हुआ*");
    for (const n of failed) {
      lines.push(
        `*${n.name}* का आधार UDISE+ पोर्टल पर सत्यापित नहीं हो सका ("Validation failed")। स्कूल के रिकॉर्ड में: जन्म तिथि ${ddmmyyyy(n.recheck!.dob) || "—"} · लिंग ${g(n.recheck!.gender)}${n.recheck!.last4 ? ` · आधार के अंतिम 4 अंक ${n.recheck!.last4}` : ""}`,
      );
    }
    lines.push(
      "",
      "*ऐसा क्यों होता है:* पोर्टल आधार नंबर को UIDAI के रिकॉर्ड से मिलाता है — नाम, जन्म तिथि और लिंग बिल्कुल वैसे ही होने चाहिए जैसे आधार में दर्ज हैं। नाम की स्पेलिंग, जन्म तिथि या लिंग अलग होने पर, या नंबर का एक भी अंक गलत होने पर सत्यापन नहीं होता।",
      "",
      "*आप क्या करें:*",
      "1️⃣ आधार कार्ड की साफ़ फ़ोटो (आगे-पीछे) यहीं भेजें — स्कूल रिकॉर्ड को कार्ड से मिलाकर पोर्टल पर *दोबारा जाँच* के लिए भेजेगा।",
      "2️⃣ अगर गलती आधार कार्ड में ही है, तो नज़दीकी आधार केंद्र पर सुधार कराएँ:",
      "   • नाम / जन्म तिथि / लिंग सुधार — ₹75 (जन्म तिथि के लिए जन्म प्रमाणपत्र साथ ले जाएँ)",
      "   • बच्चे का बायोमेट्रिक अपडेट — 5–7 और 15–17 वर्ष में निःशुल्क; 7–15 वर्ष में *30 सितंबर 2026 तक निःशुल्क*",
      "   केंद्र खोजें / समय लें: appointments.uidai.gov.in",
      "   सुधार के बाद नए आधार की फ़ोटो यहीं भेजें।",
    );
  } else {
    lines.push("⚠️ *Aadhaar not verified*");
    for (const n of failed) {
      lines.push(
        `*${n.name}*'s Aadhaar could not be verified on the UDISE+ portal ("Validation failed"). The school's record: date of birth ${ddmmyyyy(n.recheck!.dob) || "—"} · gender ${g(n.recheck!.gender)}${n.recheck!.last4 ? ` · Aadhaar ending ${n.recheck!.last4}` : ""}`,
      );
    }
    lines.push(
      "",
      "*Why this happens:* the portal checks the Aadhaar number with UIDAI, and the name, date of birth and gender must be exactly as they are on the Aadhaar. A different spelling, date or gender — or one wrong digit — and it fails.",
      "",
      "*What to do:*",
      "1️⃣ Send a clear photo of the Aadhaar card (front and back) here — the school matches the record to the card and submits it to the portal *for a re-check*.",
      "2️⃣ If the mistake is on the Aadhaar itself, correct it at the nearest Aadhaar centre:",
      "   • name / date of birth / gender correction — ₹75 (take the birth certificate for a date of birth)",
      "   • child's biometric update — free at 5–7 and 15–17 years; at 7–15 years *free until 30 Sep 2026*",
      "   Find a centre / book: appointments.uidai.gov.in",
      "   After the correction, send a photo of the new Aadhaar here.",
    );
  }
  return lines;
}

/**
 * A child with no Aadhaar yet: how to get one, and where.
 *
 * UIDAI (uidai.gov.in, checked 21 Sep 2026): new enrolment is free; a
 * child under five enrols with a parent — the parent's Aadhaar, the birth
 * certificate as proof of relationship, the child's photo only; five and
 * over, the same documents and the child's own biometrics. A recognised
 * school may certify its own students on UIDAI's standard certificate
 * format (List of Acceptable Documents, item 13(v)).
 * The centres are Google Maps listings near the family, chosen in
 * aadhaarCentres.ts — never typed in by hand.
 */
function enrolSection(needs: NudgeChildNeed[], hi: boolean, centres: AadhaarCentre[], near: "home" | "school"): string[] {
  const kids = needs.filter((n) => n.enrol);
  if (!kids.length) return [];
  const lines: string[] = [""];
  const who = (n: NudgeChildNeed) =>
    n.enrol!.under5 === true ? (hi ? " (5 वर्ष से कम)" : " (under 5)") : n.enrol!.under5 === false ? (hi ? " (5 वर्ष या अधिक)" : " (5 or older)") : "";
  if (hi) {
    lines.push(
      "🆔 *आधार नहीं बना है? ऐसे बनवाएँ — नया आधार निःशुल्क है*",
      `बच्चा: ${kids.map((n) => `*${n.name}*${who(n)}`).join(", ")}`,
      "• माता या पिता बच्चे को साथ लेकर आधार केंद्र जाएँ",
      "• साथ ले जाएँ: बच्चे का *जन्म प्रमाणपत्र* और *माता-पिता का आधार कार्ड*",
    );
    if (kids.some((n) => n.enrol!.under5 !== false)) lines.push("• 5 वर्ष से छोटे बच्चे की केवल फ़ोटो ली जाती है");
    if (kids.some((n) => n.enrol!.under5 !== true)) {
      lines.push(
        "• 5 वर्ष या बड़े बच्चे के उंगलियों व आँखों के निशान (बायोमेट्रिक) लिए जाते हैं",
        "• कोई पहचान पत्र न हो तो स्कूल UIDAI के निर्धारित फ़ॉर्मेट में छात्र का प्रमाणपत्र दे सकता है — इसी WhatsApp पर *आधार सर्टिफिकेट* लिखें",
      );
    }
    if (centres.length) {
      lines.push("", near === "home" ? "📍 *आपके पास के आधार केंद्र* (Google Maps):" : "📍 *स्कूल के पास के आधार केंद्र* (Google Maps):");
      centres.forEach((c, i) => lines.push(`${i + 1}. ${c.name} — लगभग ${c.km} किमी`, `   ${c.mapsUrl}`));
      lines.push("जाने से पहले Maps पर खुलने का समय देख लें।");
    }
    lines.push("सभी केंद्र / समय लेने के लिए: appointments.uidai.gov.in", "आधार बनने के बाद उसकी फ़ोटो यहीं भेजें।");
    return lines;
  }
  lines.push(
    "🆔 *No Aadhaar yet? How to get one — new enrolment is free*",
    `Child: ${kids.map((n) => `*${n.name}*${who(n)}`).join(", ")}`,
    "• The mother or father takes the child to an Aadhaar centre",
    "• Take the child's *birth certificate* and the *parents' Aadhaar cards*",
  );
  if (kids.some((n) => n.enrol!.under5 !== false)) lines.push("• A child under 5 only has a photo taken");
  if (kids.some((n) => n.enrol!.under5 !== true)) {
    lines.push(
      "• A child of 5 or older gives fingerprints and an iris scan",
      "• If there is no ID document, the school can issue a student certificate on UIDAI's standard format — reply *Aadhaar certificate* here",
    );
  }
  if (centres.length) {
    lines.push("", near === "home" ? "📍 *Aadhaar centres near you* (Google Maps):" : "📍 *Aadhaar centres near the school* (Google Maps):");
    centres.forEach((c, i) => lines.push(`${i + 1}. ${c.name} — about ${c.km} km`, `   ${c.mapsUrl}`));
    lines.push("Check the opening hours on Maps before you go.");
  }
  lines.push("All centres / book a slot: appointments.uidai.gov.in", "Once the Aadhaar is made, send a photo of it here.");
  return lines;
}

/** The message. Hindi by default, as every parent message is. */
export function composeUdiseNudge(input: {
  guardianName: string;
  needs: NudgeChildNeed[];
  language: "en" | "hi";
  consentAttached: boolean;
  /** Aadhaar centres near the family, for a child with no Aadhaar. */
  centres?: AadhaarCentre[];
  /** What the distances were measured from: the family's home when it is located, else the school. */
  centresNear?: "home" | "school";
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
    lines.push(...recheckSection(input.needs, true));
    lines.push(...enrolSection(input.needs, true, input.centres ?? [], input.centresNear ?? "school"));
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
      `📎 संदर्भ: शिक्षा मंत्रालय, भारत सरकार — apaar.education.gov.in${input.needs.some((n) => n.recheck || n.enrol) ? " · UIDAI — uidai.gov.in" : ""}`,
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
  lines.push(...recheckSection(input.needs, false));
  lines.push(...enrolSection(input.needs, false, input.centres ?? [], input.centresNear ?? "school"));
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
    `📎 Reference: Ministry of Education, Government of India — apaar.education.gov.in${input.needs.some((n) => n.recheck || n.enrol) ? " · UIDAI — uidai.gov.in" : ""}`,
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
