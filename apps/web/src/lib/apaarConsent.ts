/**
 * APAAR ID consent on WhatsApp — two buttons, not a printed form.
 *
 * WHY (21 Sep 2026): the school sent parents the Ministry of Education's
 * "Parental Consent / Refusal Form for APAAR ID" (Annexure-1) as a PDF to
 * print, sign, photograph and send back. The director's call: that is too
 * hard for our families. The same decision is now asked in the chat — the
 * form's substance as the message, and "✅ हाँ, सहमति है" / "❌ नहीं" as
 * buttons. The answer is recorded on each child with the time, the
 * registered mobile it came from and the WhatsApp message id: that record,
 * not a signature, is the school's evidence of consent.
 *
 * APAAR is voluntary (apaar.education.gov.in; the Ministry's own form is a
 * consent OR refusal form). So:
 *  - nothing here calls it compulsory or implies a penalty for "no";
 *  - "no" is a valid, final answer — recorded and never chased again;
 *  - the message says consent can be withdrawn later.
 *
 * Only a tap counts. A typed "haan" in the middle of some other
 * conversation is not consent to share a child's data with the government.
 *
 * Pure.
 */

export const APAAR_CONSENT_YES_ID = "APAAR_CONSENT_YES";
export const APAAR_CONSENT_NO_ID = "APAAR_CONSENT_NO";

const YES_HI = "✅ हाँ, सहमति है";
const NO_HI = "❌ नहीं";
const YES_EN = "✅ Yes, I consent";
const NO_EN = "❌ No";

export type ApaarAnswer = "given" | "refused";

/**
 * The parent's tap. The inbound parser hands us the button id (or, on some
 * clients, its title) — both are recognised; free text never is.
 */
export function parseApaarConsentReply(text: string): ApaarAnswer | null {
  const t = (text || "").trim();
  if (t === APAAR_CONSENT_YES_ID || t === YES_HI || t === YES_EN) return "given";
  if (t === APAAR_CONSENT_NO_ID || t === NO_HI || t === NO_EN) return "refused";
  return null;
}

export function apaarConsentButtons(hindi: boolean): { id: string; title: string }[] {
  return [
    { id: APAAR_CONSENT_YES_ID, title: hindi ? YES_HI : YES_EN },
    { id: APAAR_CONSENT_NO_ID, title: hindi ? NO_HI : NO_EN },
  ];
}

/**
 * The consent sentence itself, in English — the same words the message
 * carries and the printed record (apaarConsentPdf) quotes, so the record
 * says exactly what the parent agreed to.
 */
export function consentSentenceEn(guardianName: string, childNames: string): string {
  const guardian = guardianName.trim();
  return `I${guardian ? `, ${guardian},` : ""} parent/guardian of ${childNames}, consent to an APAAR ID being created for my child, and to the child's name, date of birth, gender, Aadhaar and school details being shared with the Ministry of Education / UDISE+ / DigiLocker for it.`;
}

export const CONSENT_VOLUNTARY_EN = "This is entirely your choice, and consent can be withdrawn at any time.";

/**
 * The question, carrying what Annexure-1 asks the parent to agree to: an
 * APAAR ID for the child, and the child's details shared with the Ministry
 * of Education / UDISE+ / DigiLocker for it. At most 1024 characters (Meta's
 * limit for an interactive body).
 */
export function composeApaarConsentAsk(input: { guardianName: string; childNames: string[]; hindi: boolean }): string {
  const names = input.childNames.join(", ");
  const guardian = input.guardianName.trim();
  const text = input.hindi
    ? [
        `🆔 *APAAR ID — आपकी सहमति*`,
        "",
        `${names} की APAAR ID ("One Nation One Student ID", शिक्षा मंत्रालय) अभी नहीं बनी है। इसमें बच्चे के अंक-पत्र, प्रमाणपत्र और पढ़ाई का रिकॉर्ड DigiLocker में एक जगह सुरक्षित रहता है — स्कूल बदलने पर भी।`,
        "",
        `*सहमति:* मैं${guardian ? `, ${guardian},` : ""} ${names} का/की अभिभावक, बच्चे की APAAR ID बनाने के लिए सहमति देता/देती हूँ, और इसके लिए बच्चे का नाम, जन्म तिथि, लिंग, आधार व स्कूल का विवरण शिक्षा मंत्रालय / UDISE+ / DigiLocker के साथ साझा करने की अनुमति देता/देती हूँ।`,
        "",
        "यह पूरी तरह आपकी इच्छा पर है, और सहमति बाद में कभी भी वापस ली जा सकती है। कोई फ़ॉर्म प्रिंट या हस्ताक्षर करने की ज़रूरत नहीं — नीचे एक बटन दबाइए।",
      ].join("\n")
    : [
        `🆔 *APAAR ID — your consent*`,
        "",
        `${names} ${input.childNames.length === 1 ? "does" : "do"} not have an APAAR ID ("One Nation One Student ID", Ministry of Education) yet. It keeps the child's marksheets, certificates and study record together in DigiLocker — even across a change of school.`,
        "",
        `*Consent:* ${consentSentenceEn(guardian, names)}`,
        "",
        `${CONSENT_VOLUNTARY_EN} No form to print or sign — just tap a button below.`,
      ].join("\n");
  return text.slice(0, 1024);
}

/** What a child's APAAR still needs from the parent (udiseCompliance.apaarReadiness). */
export type ApaarStillNeeded = { name: string; waitingFor: "parent_aadhaar"[] };

/**
 * The parent's part: the consenting parent's own Aadhaar. One line for the
 * family, naming the children — it is the same card for all of them.
 */
export function parentPartOfApaar(items: ApaarStillNeeded[], hindi: boolean): string[] {
  const names = items.filter((it) => it.waitingFor.includes("parent_aadhaar")).map((it) => it.name);
  if (!names.length) return [];
  return [
    hindi
      ? `• सहमति देने वाले *माता या पिता का आधार कार्ड* (आगे और पीछे की फ़ोटो) — ${names.join(", ")} की APAAR ID के लिए`
      : `• the consenting *parent's own Aadhaar card* (photo of front and back) — for ${names.join(", ")}'s APAAR ID`,
  ];
}

/** What the parent is told once the tap is recorded. */
export function composeApaarConsentThanks(input: {
  answer: ApaarAnswer;
  childNames: string[];
  hindi: boolean;
  /** For a "yes": what each child still needs. Empty = the school can create the IDs now. */
  stillNeeded?: ApaarStillNeeded[];
  /** Whose Aadhaar goes with the consent, already worked out (renderApaarParentIdLines). */
  parentIdLines?: string[];
}): string {
  const names = input.childNames.join(", ");
  if (input.answer === "given") {
    const idLines = input.parentIdLines ?? [];
    if (idLines.length) {
      return [
        input.hindi ? `🙏 धन्यवाद! ${names} की APAAR ID के लिए आपकी सहमति दर्ज हो गई है।` : `🙏 Thank you! Your consent for ${names}'s APAAR ID is recorded.`,
        "",
        ...idLines,
        ...(parentPartOfApaar(input.stillNeeded ?? [], input.hindi).length
          ? ["", ...parentPartOfApaar(input.stillNeeded ?? [], input.hindi)]
          : []),
      ].join("\n");
    }
    const asks = parentPartOfApaar(input.stillNeeded ?? [], input.hindi);
    if (!asks.length) {
      return input.hindi
        ? `🙏 धन्यवाद! ${names} की APAAR ID के लिए आपकी सहमति दर्ज हो गई है। स्कूल UDISE+ पोर्टल पर APAAR ID बनवाएगा — बनने के बाद यह बच्चे के DigiLocker में दिखेगी।`
        : `🙏 Thank you! Your consent for ${names}'s APAAR ID is recorded. The school will create the APAAR ID on UDISE+ — once made, it shows in the child's DigiLocker.`;
    }
    // A "yes" alone does not make the ID: the school needs the consenting
    // parent's Aadhaar with it. Ask now, while the parent is here.
    return input.hindi
      ? [
          `🙏 धन्यवाद! ${names} की APAAR ID के लिए आपकी सहमति दर्ज हो गई है।`,
          "",
          "APAAR ID बनवाने के लिए अभी यह चाहिए — कृपया इसी चैट में फ़ोटो भेजें:",
          ...asks,
          "",
          "फ़ोटो मिलते ही रिकॉर्ड अपने-आप अपडेट होगा और स्कूल APAAR ID बनवाएगा।",
        ].join("\n")
      : [
          `🙏 Thank you! Your consent for ${names}'s APAAR ID is recorded.`,
          "",
          "To create the APAAR ID we still need — please send a photo here in this chat:",
          ...asks,
          "",
          "As soon as it arrives the record updates by itself and the school creates the APAAR ID.",
        ].join("\n");
  }
  return input.hindi
    ? `🙏 ठीक है — ${names} की APAAR ID नहीं बनाई जाएगी, और आपका निर्णय दर्ज कर लिया गया है। मन बदलने पर कभी भी *APAAR* लिखकर भेजें।`
    : `🙏 Understood — no APAAR ID will be made for ${names}, and your decision is recorded. If you change your mind, just send *APAAR* any time.`;
}

/** A parent asking to be asked again ("APAAR", "apaar id", "APAAR सहमति"). */
export function isApaarConsentRequest(text: string): boolean {
  return /^\s*apaar(\s*id)?(\s*(consent|सहमति))?\s*[?.!]*\s*$/i.test(text || "");
}

/** The children still to be asked: in session, active, no APAAR ID, no answer yet. */
export function apaarConsentPending<T extends { status: string; apaarId?: string; apaarConsent?: string }>(children: T[]): T[] {
  return children.filter((c) => c.status === "active" && !(c.apaarId || "").trim() && !c.apaarConsent);
}

/* ── whose Aadhaar goes with the consent (22 Sep 2026) ───────────── */

/** "MR. KISHAN YADAV" and "Kishan Yadav" are one person; "BRIJESH YADAV" is not. */
export function samePersonName(a: string, b: string): boolean {
  const norm = (x: string) =>
    String(x || "")
      .toUpperCase()
      .replace(/\b(MR|MRS|MS|SHRI|SMT|SRI|DR|LATE)\b\.?/g, " ")
      .replace(/[^A-Z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const fx = x.split(" ")[0]!;
  const fy = y.split(" ")[0]!;
  return fx.length >= 3 && fx === fy;
}

export type ParentAadhaarOnFile = { father: { name: string; last4: string } | null; mother: { name: string; last4: string } | null };

export type ApaarParentIdState =
  | { kind: "consenter_on_file"; last4: string }
  | { kind: "other_parent_on_file"; who: "father" | "mother"; name: string; last4: string }
  | { kind: "none" };

/**
 * The APAAR ID is made on the consenting parent's own Aadhaar. A father's
 * card on file does not cover a consent the guardian gave: on 22 Sep 2026
 * Brijesh Yadav said YES for Kriyansh, whose record holds Kishan Yadav's
 * Aadhaar, and was asked for nothing.
 */
export function apaarParentIdState(onFile: ParentAadhaarOnFile, consenterName: string): ApaarParentIdState {
  for (const who of ["father", "mother"] as const) {
    const p = onFile[who];
    if (p?.last4 && samePersonName(p.name, consenterName)) return { kind: "consenter_on_file", last4: p.last4 };
  }
  for (const who of ["father", "mother"] as const) {
    const p = onFile[who];
    if (p?.last4) return { kind: "other_parent_on_file", who, name: p.name, last4: p.last4 };
  }
  return { kind: "none" };
}

/** What the parent is told about the Aadhaar that goes with their consent. */
export function renderApaarParentIdLines(rows: { child: string; state: ApaarParentIdState }[], consenterName: string, hindi: boolean): string[] {
  const out: string[] = [];
  const onFile = rows.filter((r) => r.state.kind === "consenter_on_file");
  const other = rows.filter((r) => r.state.kind === "other_parent_on_file");
  if (onFile.length) {
    const l4 = [...new Set(onFile.map((r) => (r.state as { last4: string }).last4))].join(", …");
    out.push(hindi ? `✅ APAAR के लिए आपका आधार (…${l4}) हमारे रिकॉर्ड में है — कुछ और भेजने की ज़रूरत नहीं।` : `✅ Your Aadhaar (…${l4}) is already in our records for the APAAR ID — nothing more to send.`);
  }
  for (const r of other) {
    const s = r.state as { who: "father" | "mother"; name: string; last4: string };
    const whoHi = s.who === "father" ? "पिता" : "माता";
    const whoEn = s.who === "father" ? "father" : "mother";
    out.push(
      hindi
        ? `📄 *${r.child}*: हमारे रिकॉर्ड में ${whoHi} *${s.name}* का आधार (…${s.last4}) है, पर सहमति ${consenterName ? `*${consenterName}*` : "आपने"} ने दी है। APAAR सहमति देने वाले के अपने आधार से बनता है — कृपया *अपना आधार कार्ड* (आगे और पीछे की फ़ोटो) यहीं भेजें। अगर रिकॉर्ड में ${whoHi} का नाम गलत है, तो बता दीजिए।`
        : `📄 *${r.child}*: our record holds the ${whoEn} *${s.name}*'s Aadhaar (…${s.last4}), but the consent was given by ${consenterName ? `*${consenterName}*` : "you"}. The APAAR ID goes with the consenting parent's own Aadhaar — please send *your Aadhaar card* (photo of front and back) here. If the ${whoEn}'s name in our record is wrong, tell us.`,
    );
  }
  return out;
}

