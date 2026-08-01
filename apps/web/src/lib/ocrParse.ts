/**
 * Parse OCR plain text — purchase bills & admission documents (India).
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type BillOcrConfidence =
  | "vision_high"
  | "vision_medium"
  | "vision_low"
  | "demo_high"
  | "demo_medium"
  | "demo_low";

export type BillOcrSuggestion = {
  billNo: string;
  billDate: string;
  dueOn: string;
  amountPaise: number;
  note: string;
  confidence: BillOcrConfidence;
  rawTextPreview?: string;
};

export type AdmissionDocOcrKind = "aadhaar" | "birth_cert" | "generic";

export type AdmissionDocOcrSuggestion = {
  childName: string;
  dob: string;
  aadhaar: string;
  guardianName: string;
  registrationNo: string;
  pincode: string;
  note: string;
  confidence: BillOcrConfidence;
  rawTextPreview: string;
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseIndianDateToIso(raw: string): string {
  const t = raw.trim();
  const dmy = t.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmy) {
    let dd = Number(dmy[1]);
    let mm = Number(dmy[2]);
    let yy = Number(dmy[3]);
    if (yy < 100) yy += yy < 50 ? 2000 : 1900;
    if (mm > 12 && dd <= 12) {
      const swap = dd;
      dd = mm;
      mm = swap;
    }
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  const iso = t.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return "";
}

export function extractInvoiceNumber(text: string): string {
  const blob = text.replace(/\s+/g, " ");
  const invMatch =
    blob.match(
      /(?:invoice|inv\.?|bill|tax\s*invoice)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,24})/i,
    ) || blob.match(/\b([A-Z]{2,5}[\-\/]?\d{4,12})\b/);
  return invMatch?.[1]?.toUpperCase().trim() || "";
}

export function extractAmountPaise(text: string): number | null {
  const patterns = [
    /(?:grand\s*total|total\s*amount|net\s*amount|amount\s*payable|invoice\s*total)[^\d]{0,20}₹?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /₹\s*([\d,]+(?:\.\d{1,2})?)/,
    /(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\b([\d,]{4,})\s*(?:rs\.?|inr)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
  }
  return null;
}

export function extractBillDate(text: string, fallback?: string): string {
  const blob = text.replace(/\s+/g, " ");
  const labeled =
    blob.match(
      /(?:invoice|bill)\s*date\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    ) || blob.match(/(?:dated?)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (labeled?.[1]) {
    const iso = parseIndianDateToIso(labeled[1]);
    if (iso) return iso;
  }
  const any = blob.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
  if (any?.[1]) {
    const iso = parseIndianDateToIso(any[1]);
    if (iso) return iso;
  }
  return fallback || todayIso();
}

export function parseBillOcrFromText(
  text: string,
  opts: {
    fallbackAmountPaise: number;
    billDate?: string;
    fileName?: string;
    photoNote?: string;
    engine?: "vision" | "demo";
  },
): BillOcrSuggestion {
  const engine = opts.engine || "vision";
  const blob = `${opts.fileName || ""} ${opts.photoNote || ""} ${text}`;
  const billDate = extractBillDate(text, opts.billDate || todayIso());
  const billNo =
    extractInvoiceNumber(text) ||
    extractInvoiceNumber(blob) ||
    `INV-${billDate.replace(/-/g, "").slice(2)}`;

  const amt = extractAmountPaise(text) ?? extractAmountPaise(blob);
  let amountPaise = opts.fallbackAmountPaise;
  let confidence: BillOcrConfidence =
    engine === "demo" ? "demo_low" : "vision_low";

  if (amt != null) {
    amountPaise = amt;
    confidence = engine === "demo" ? "demo_high" : "vision_high";
  } else if (opts.fallbackAmountPaise > 0) {
    confidence = engine === "demo" ? "demo_medium" : "vision_medium";
  }

  const hasInv = !!(extractInvoiceNumber(text) || extractInvoiceNumber(blob));

  return {
    billNo,
    billDate,
    dueOn: addDays(billDate, 15),
    amountPaise,
    note: hasInv || amt != null
      ? engine === "demo"
        ? "Parsed from scan / note (demo OCR)"
        : "Parsed from bill scan (Google Vision)"
      : "No invoice # or amount found — using PO line totals",
    confidence,
    rawTextPreview: text.slice(0, 400),
  };
}

export function extractAadhaar(text: string): string {
  const spaced = text.match(/\b(\d{4}\s\d{4}\s\d{4})\b/);
  if (spaced) return spaced[1]!.replace(/\s/g, "");
  const plain = text.match(/\b(\d{12})\b/);
  return plain?.[1] || "";
}

export function extractPincode(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  return m?.[1] || "";
}

function titleCaseName(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function extractPersonName(text: string, kind: AdmissionDocOcrKind): string {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (kind === "aadhaar") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/government of india|भारत सरकार|aadhaar|आधार/i.test(line)) continue;
      if (/^\d{4}\s?\d{4}\s?\d{4}$/.test(line.replace(/\s/g, ""))) continue;
      if (/^(male|female|m|f|पुरुष|महिला)$/i.test(line)) continue;
      if (/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,4}$/.test(line)) {
        return titleCaseName(line);
      }
    }
  }

  if (kind === "birth_cert") {
    const nameLine = text.match(
      /(?:name\s*of\s*(?:child|the\s*child)|child(?:'?s)?\s*name|name)\s*[:\-]\s*([A-Za-z][A-Za-z\s.]{2,60})/i,
    );
    if (nameLine?.[1]) return titleCaseName(nameLine[1]);
    for (const line of lines) {
      if (/birth|certificate|registration|municipal|नगर/i.test(line)) continue;
      if (/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,4}$/.test(line)) {
        return titleCaseName(line);
      }
    }
  }

  return "";
}

export function extractDob(text: string): string {
  const labeled = text.match(
    /(?:date\s*of\s*birth|d\.?o\.?b\.?|जन्म\s*तिथि)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
  );
  if (labeled?.[1]) return parseIndianDateToIso(labeled[1]);
  const any = text.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
  if (any?.[1]) return parseIndianDateToIso(any[1]);
  return "";
}

export function extractBirthRegistrationNo(text: string): string {
  const m = text.match(
    /(?:registration\s*(?:no\.?|number)|cert(?:ificate)?\s*no\.?)\s*[:\-]?\s*([A-Z0-9\-\/]{4,24})/i,
  );
  return m?.[1]?.toUpperCase() || "";
}

export function parseAdmissionDocFromText(
  text: string,
  kind: AdmissionDocOcrKind,
  engine: "vision" | "demo" = "vision",
): AdmissionDocOcrSuggestion {
  const aadhaar = extractAadhaar(text);
  const dob = extractDob(text);
  const childName = extractPersonName(text, kind);
  const pincode = extractPincode(text);
  const registrationNo =
    kind === "birth_cert" ? extractBirthRegistrationNo(text) : "";

  let confidence: BillOcrConfidence =
    engine === "demo" ? "demo_low" : "vision_low";
  let hits = 0;
  if (aadhaar) hits += 1;
  if (dob) hits += 1;
  if (childName) hits += 1;
  if (registrationNo) hits += 1;
  if (hits >= 2) confidence = engine === "demo" ? "demo_high" : "vision_high";
  else if (hits === 1) {
    confidence = engine === "demo" ? "demo_medium" : "vision_medium";
  }

  return {
    childName,
    dob,
    aadhaar,
    guardianName: kind === "aadhaar" ? "" : "",
    registrationNo,
    pincode,
    note:
      hits > 0
        ? `Extracted from ${kind.replace("_", " ")} scan (Google Vision)`
        : "Could not read fields — enter manually",
    confidence,
    rawTextPreview: text.slice(0, 500),
  };
}
