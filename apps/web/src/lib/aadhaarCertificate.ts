/**
 * UIDAI's "Certificate for Aadhaar Enrolment/ Update", filled in by the school.
 *
 * The form is UIDAI's own (List of Acceptable Documents for Enrolment and
 * Update, the blank on page 15), kept as an image in public/docs and printed
 * as the page background, with the details typed into its boxes. The school
 * may certify its own students on it: "Head of recognised educational
 * institution (only for the institute students concerned)", item 13(v).
 *
 * What this never fills in, because a person has to: the child's photograph
 * (pasted, then cross-signed and cross-stamped by the certifier), the
 * child's or parent's signature, the certifier's signature and stamp, and
 * the certifier's checklist. The certificate is valid for three months from
 * the date of issue, so the date printed is the day it is generated — the
 * office generates it on the day the principal signs.
 *
 * UIDAI's instructions followed: block capitals, one letter per box, one
 * empty box between words, nothing written as "NA" — an unknown field is
 * left empty for the office to fill by pen.
 *
 * Pure. Coordinates are PDF points on A4 (595.276 × 841.89), top-left origin,
 * measured from the blank form at 200 dpi.
 */

export const A4 = { w: 595.276, h: 841.89 };

/** Every text row is a strip of boxes this wide, starting at X0. */
const X0 = 132.3;
const PITCH = 18.54;

type Row = { y: number; boxes: number };

/** Vertical centres (pt) and box counts, from the blank form. */
export const ROWS = {
  aadhaar: { y: 225.2, boxes: 12 },
  name1: { y: 246.3, boxes: 23 },
  name2: { y: 267.3, boxes: 23 },
  house: { y: 287.9, boxes: 23 },
  street: { y: 308.6, boxes: 23 },
  landmark: { y: 329.2, boxes: 23 },
  area: { y: 349.8, boxes: 23 },
  village: { y: 370.4, boxes: 23 },
  postOffice: { y: 391.5, boxes: 17 },
  district: { y: 412.1, boxes: 17 },
  state1: { y: 432.7, boxes: 17 },
  state2: { y: 453.8, boxes: 7 },
  pin: { y: 474.4, boxes: 6 },
  certName: { y: 556.5, boxes: 23 },
  designation: { y: 577.1, boxes: 23 },
  office1: { y: 597.7, boxes: 23 },
  office2: { y: 618.8, boxes: 23 },
  contact: { y: 639.4, boxes: 23 },
} satisfies Record<string, Row>;

/** Date of issue boxes: D D · M M · Y Y Y Y (centres, pt). */
const DATE_X = [418.1, 433.8, 460.2, 476.0, 503.5, 519.3, 535.1, 550.8];
const DATE_Y = 149.4;

/** Tick boxes (centres, pt). */
export const TICKS = {
  resident: { x: 42.5, y: 198.3 },
  newEnrolment: { x: 415.8, y: 198.3 },
  updateRequest: { x: 495.0, y: 198.3 },
  headOfInstitution: { x: 39.6, y: 745.0 },
};

export type Placement = { x: number; y: number; text: string };

/** Block letters UIDAI accepts: A–Z, 0–9 and a few marks; everything else is a space. */
export function blockLetters(s: string): string {
  return (s || "")
    .toUpperCase()
    // No commas: UIDAI's own example uses none, and each one costs a box.
    .replace(/[^A-Z0-9 ./\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lay words into rows of boxes: one letter per box, one empty box between
 * words, a word never split across rows unless it is longer than a row.
 * Returns the text of each row (a space is an empty box); what did not fit
 * is returned as `overflow` so the caller can say so rather than drop it.
 */
export function fitToRows(text: string, rowBoxes: number[]): { rows: string[]; overflow: string } {
  const words = blockLetters(text).split(" ").filter(Boolean);
  const rows: string[] = rowBoxes.map(() => "");
  let r = 0;
  let i = 0;
  while (i < words.length && r < rows.length) {
    const w = words[i]!;
    const cap = rowBoxes[r]!;
    const cur = rows[r]!;
    const need = cur ? cur.length + 1 + w.length : w.length;
    if (need <= cap) {
      rows[r] = cur ? `${cur} ${w}` : w;
      i += 1;
    } else if (!cur && w.length > cap) {
      rows[r] = w.slice(0, cap);
      words[i] = w.slice(cap);
      r += 1;
    } else {
      r += 1;
    }
  }
  return { rows, overflow: words.slice(i).join(" ") };
}

function rowPlacements(row: Row, text: string): Placement[] {
  const out: Placement[] = [];
  [...text].slice(0, row.boxes).forEach((ch, k) => {
    if (ch !== " ") out.push({ x: X0 + (k + 0.5) * PITCH, y: row.y, text: ch });
  });
  return out;
}

export type CertificateInput = {
  issueDateIso: string;
  childName: string;
  /** Full 12 digits when the child already has an Aadhaar (then it is an update). */
  aadhaarNumber: string;
  address: {
    house: string;
    street: string;
    landmark: string;
    area: string;
    village: string;
    postOffice: string;
    district: string;
    state: string;
    pin: string;
  };
  certifier: {
    name: string;
    designation: string;
    officeAddress: string;
    contact: string;
  };
};

export type CertificateLayout = {
  text: Placement[];
  ticks: { x: number; y: number }[];
  /** Fields that did not fit their boxes — the office writes the rest by pen. */
  overflow: { field: string; rest: string }[];
  /** Fields left empty because the school does not hold them. */
  blank: string[];
};

/** Where every letter and tick goes. */
export function certificateLayout(input: CertificateInput): CertificateLayout {
  const text: Placement[] = [];
  const overflow: { field: string; rest: string }[] = [];
  const blank: string[] = [];
  const put = (field: string, rows: Row[], value: string) => {
    if (!blockLetters(value)) {
      blank.push(field);
      return;
    }
    const fit = fitToRows(value, rows.map((r) => r.boxes));
    fit.rows.forEach((t, i) => text.push(...rowPlacements(rows[i]!, t)));
    if (fit.overflow) overflow.push({ field, rest: fit.overflow });
  };

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.issueDateIso);
  if (m) {
    const digits = `${m[3]}${m[2]}${m[1]}`;
    [...digits].forEach((d, i) => text.push({ x: DATE_X[i]!, y: DATE_Y, text: d }));
  }

  const ticks = [TICKS.resident];
  const aadhaar = (input.aadhaarNumber || "").replace(/\D/g, "");
  if (aadhaar.length === 12) {
    ticks.push(TICKS.updateRequest);
    text.push(...rowPlacements(ROWS.aadhaar, aadhaar));
  } else {
    ticks.push(TICKS.newEnrolment);
  }

  put("Full name", [ROWS.name1, ROWS.name2], input.childName);
  const a = input.address;
  put("House No.", [ROWS.house], a.house);
  put("Street", [ROWS.street], a.street);
  put("Landmark", [ROWS.landmark], a.landmark);
  put("Area/ Locality", [ROWS.area], a.area);
  put("Village/ Town/ City", [ROWS.village], a.village);
  put("Post Office", [ROWS.postOffice], a.postOffice);
  put("District", [ROWS.district], a.district);
  put("State", [ROWS.state1, ROWS.state2], a.state);
  put("PIN Code", [ROWS.pin], (a.pin || "").replace(/\D/g, "").slice(0, 6));

  const c = input.certifier;
  put("Name of the Certifier", [ROWS.certName], c.name);
  put("Designation", [ROWS.designation], c.designation);
  put("Office Address", [ROWS.office1, ROWS.office2], c.officeAddress);
  put("Contact Number", [ROWS.contact], (c.contact || "").replace(/\D/g, "").slice(-10));
  ticks.push(TICKS.headOfInstitution);

  return { text, ticks, overflow, blank };
}

/**
 * The school's free-text address split into the form's fields as well as
 * it honestly can: "VILLAGE- MAHADEPUR ,PO. -PUARIKALAN" → village
 * MAHADEPUR, post office PUARIKALAN. Anything not recognised goes to
 * Area/ Locality rather than being guessed into the wrong box.
 */
export function splitSchoolAddress(address: string): { village: string; postOffice: string; area: string } {
  let rest = (address || "").replace(/\s+/g, " ").trim();
  let village = "";
  let postOffice = "";
  const po = /(?:^|[\s,])(?:p\.?\s?o\.?|post(?:\s*office)?)\s*[-:.]*\s*([A-Za-z][A-Za-z ]{1,30}?)(?=\s*(?:,|$|dist|district|varanasi|$))/i.exec(rest);
  if (po) {
    postOffice = po[1]!.trim();
    rest = rest.replace(po[0], " ");
  }
  const vil = /(?:^|[\s,])(?:vill(?:age)?|viilage|gram|ग्राम)\.?\s*[-:.]*\s*([A-Za-z][A-Za-z ]{1,30}?)(?=\s*(?:,|$))/i.exec(rest);
  if (vil) {
    village = vil[1]!.trim();
    rest = rest.replace(vil[0], " ");
  }
  const area = rest
    .replace(/\bvaranasi\b|\buttar pradesh\b|\bu\.?p\.?\b|\bindia\b/gi, " ")
    .replace(/[,\s]+/g, " ")
    .trim();
  if (!village && area) {
    // The first place name is where they live; the rest is the locality.
    const parts = (address || "").split(",").map((p) => p.replace(/\bvaranasi\b/gi, "").trim()).filter(Boolean);
    if (parts.length) {
      village = parts[0]!.replace(/^(vill(age)?|viilage|gram)\s*[-:.]*\s*/i, "").trim();
      return { village, postOffice, area: parts.slice(1).join(" ").replace(/(p\.?o\.?|post)\s*[-:.]*\s*[A-Za-z ]+/i, "").trim() };
    }
  }
  return { village, postOffice, area };
}

// ─── A parent asking for it ────────────────────────────────────────────

const CERT_WORD = /(?<![\p{L}])(certificate|certifcate|certficate|sertificate|सर्टिफिकेट|सर्टिफ़िकेट|प्रमाण\s?-?\s?पत्र|praman\s?-?\s?patra|pramaan\s?-?\s?patra)(?![\p{L}])/iu;
const AADHAAR_WORD = /(?<![\p{L}])(aa?dh?aa?r|आधार|uidai)(?![\p{L}])/iu;
/** Other certificates a parent may mean — not this one. */
const OTHER_CERT = /(?<![\p{L}])(birth|janm|जन्म|bonafide|bona\s?fide|character|charitra|चरित्र|tc|transfer|स्थानांतरण|fee|fees|फीस|income|आय|caste|jati|जाति|domicile|niwas|निवास|marksheet|result|रिजल्ट)(?![\p{L}])/iu;

/**
 * "aadhaar certificate", "आधार के लिए प्रमाण पत्र", "school certificate
 * aadhaar banwane ke liye", "आधार सर्टिफिकेट" — the school's UIDAI
 * certificate. A birth certificate, TC, bonafide or fee certificate is
 * something else and never matches.
 */
export function isAadhaarCertificateRequest(text: string): boolean {
  const t = (text || "").trim();
  if (!t || t.length > 200) return false;
  if (OTHER_CERT.test(t)) return false;
  return CERT_WORD.test(t) && AADHAAR_WORD.test(t);
}

/** What the parent is told once the request has gone to the office. */
export function composeCertificateRequestAck(input: {
  childNames: string[];
  hindi: boolean;
  alreadyRequested: boolean;
}): string {
  const names = input.childNames.join(", ");
  if (input.hindi) {
    if (input.alreadyRequested) {
      return `🙏 ${names} के आधार प्रमाणपत्र का अनुरोध पहले से कार्यालय में है। प्रधानाचार्य के हस्ताक्षर होते ही यहीं सूचना मिलेगी।`;
    }
    return [
      `🙏 अनुरोध मिल गया। स्कूल *${names}* के लिए UIDAI के निर्धारित प्रारूप में *आधार प्रमाणपत्र* तैयार कर रहा है।`,
      "",
      "• प्रधानाचार्य के हस्ताक्षर व मुहर के बाद उसकी फ़ोटो यहीं भेजी जाएगी।",
      "• आधार केंद्र पर *मूल (original) प्रमाणपत्र* ले जाना होता है — इसे स्कूल कार्यालय से ले लें।",
      "• प्रमाणपत्र पर बच्चे की *हाल की रंगीन पासपोर्ट साइज़ फ़ोटो* लगती है — एक फ़ोटो यहीं भेजें या कार्यालय में दें।",
      "• प्रमाणपत्र जारी होने की तारीख से *3 महीने* तक मान्य है।",
    ].join("\n");
  }
  if (input.alreadyRequested) {
    return `🙏 The Aadhaar certificate for ${names} is already with the office. You will hear here as soon as the principal signs it.`;
  }
  return [
    `🙏 Request received. The school is preparing the *Aadhaar certificate* (UIDAI's standard format) for *${names}*.`,
    "",
    "• Once the principal signs and stamps it, a photo of it will be sent here.",
    "• The Aadhaar centre needs the *original* — please collect it from the school office.",
    "• It carries a *recent colour passport-size photo* of the child — send one here or give it to the office.",
    "• It is valid for *3 months* from the date of issue.",
  ].join("\n");
}
