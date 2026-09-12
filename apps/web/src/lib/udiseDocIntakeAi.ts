/**
 * UDISE+ documents over WhatsApp — the pure half.
 *
 * A parent replies to the school's request with a photo of an Aadhaar card,
 * a birth certificate or an address proof. The model reads the document
 * into a fixed set of fields; this module decides what may be written:
 *
 *   - an Aadhaar number only when its Verhoeff checksum holds;
 *   - a date of birth only when the document states a full date;
 *   - a name only as a SPELLING correction of the name the school already
 *     holds — a different person's name is flagged for the office, never
 *     applied (the wrong child's Aadhaar is the failure this stops);
 *   - an address only with a six-digit PIN.
 *
 * Everything else is reported, not written. The plan says, field by field,
 * what changes, what was there before, and why a change was refused — that
 * is what the office reads on WhatsApp and what goes to the UDISE+ portal.
 */

import { aadhaarChecksumValid, aadhaarDigits, maskAadhaar } from "@/lib/aadhaar";
import type { StudentDocKey } from "@/lib/sis";

export type UdiseDocType = "aadhaar" | "birth_certificate" | "address_proof" | "payment_proof" | "other";
export type UdiseDocPerson = "child" | "father" | "mother" | "unknown";

export type UdiseDocExtract = {
  docType: UdiseDocType;
  /** Whose document it is, from the card itself (a parent's Aadhaar names an adult). */
  person: UdiseDocPerson;
  nameOnDoc: string;
  /** ISO date, only when the document prints day, month and year. */
  dob: string;
  /** 12 digits that pass the checksum, else "". */
  aadhaarNumber: string;
  gender: "M" | "F" | "";
  fatherName: string;
  motherName: string;
  address: string;
  pincode: string;
  /**
   * A payment the parent is showing us: a UPI screenshot, a bank slip, or a
   * photo of one of our own receipts. Read, never acted on — money is
   * recorded at the counter by a person, never by a photograph.
   */
  payment: {
    amountPaise: number;
    /** ISO date of the payment, "" when the screenshot does not print one. */
    dateIso: string;
    /** UTR / transaction id / receipt number, "" when unreadable. */
    reference: string;
    /** "UPI", "PhonePe", "cash", "bank transfer"… as printed. */
    method: string;
    /** Who the money went to, as printed — the check that it came to us. */
    payeeName: string;
  } | null;
  /** Field names the model could not read. */
  missing: string[];
  notes: string;
};

export const UDISE_DOC_EXTRACT_SYSTEM = [
  "You read one Indian identity document photographed by a parent for a school's records: an Aadhaar card, a birth certificate, or an address proof (ration card, voter ID, electricity bill).",
  "Copy what is PRINTED. Never guess, never complete a partly hidden number, never infer a date from an age.",
  "docType: aadhaar | birth_certificate | address_proof | payment_proof | other. payment_proof is a UPI/bank payment screenshot, a bank slip, or a photo of a school fee receipt. person: child | father | mother | unknown — an Aadhaar of an adult is father or mother only if the card says so or the relation is printed; else unknown.",
  "nameOnDoc: the holder's name exactly as printed (Latin letters; transliterate Devanagari). dob: YYYY-MM-DD only when day, month and year are all printed; a 'Year of Birth' alone is NOT a dob — leave it empty and add 'dob' to missing.",
  "aadhaarNumber: the 12 digits only when all twelve are clearly legible; otherwise empty and add 'aadhaarNumber' to missing. Never output a partial number.",
  "gender: M or F when printed, else empty. fatherName / motherName: only from a birth certificate that prints them. address and pincode: only from the document's own address block.",
  "payment (payment_proof only, else null): amount (the rupee figure paid, digits only), dateIso (YYYY-MM-DD, empty if the screenshot shows no full date), reference (UTR / transaction id / UPI ref / receipt no, exactly as printed, empty if unreadable), method (UPI, PhonePe, Google Pay, cash, NEFT…), payeeName (who received it, as printed). Never guess an amount or a reference: a wrong figure here becomes a wrong claim about money.",
  "missing: names of fields you could not read. notes: one short line — quality issues, a hidden corner, a mismatch you noticed.",
  'Respond with JSON only: {"docType":"aadhaar","person":"child","nameOnDoc":"","dob":"","aadhaarNumber":"","gender":"","fatherName":"","motherName":"","address":"","pincode":"","payment":null,"missing":[],"notes":""}'
].join("\n");

export const UDISE_DOC_EXTRACT_PROMPT = "Read this document and return the JSON.";

const clean = (v: unknown, max = 160) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Validate every field; a value that fails its rule becomes "" and joins `missing`. */
export function parseUdiseDocExtract(text: string): UdiseDocExtract | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const missing = new Set<string>(Array.isArray(o.missing) ? o.missing.map((m) => clean(m, 40)).filter(Boolean) : []);
  const docTypeRaw = clean(o.docType, 30).toLowerCase();
  const docType: UdiseDocType =
    docTypeRaw === "aadhaar" || docTypeRaw === "birth_certificate" || docTypeRaw === "address_proof" || docTypeRaw === "payment_proof"
      ? (docTypeRaw as UdiseDocType)
      : "other";
  const personRaw = clean(o.person, 20).toLowerCase();
  const person: UdiseDocPerson = personRaw === "child" || personRaw === "father" || personRaw === "mother" ? (personRaw as UdiseDocPerson) : "unknown";
  let dob = clean(o.dob, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(`${dob}T00:00:00Z`))) {
    if (dob) missing.add("dob");
    dob = "";
  }
  const aadhaarRaw = aadhaarDigits(clean(o.aadhaarNumber, 40));
  const aadhaarNumber = aadhaarRaw && aadhaarChecksumValid(aadhaarRaw) ? aadhaarRaw : "";
  if (clean(o.aadhaarNumber, 40) && !aadhaarNumber) missing.add("aadhaarNumber");
  const genderRaw = clean(o.gender, 10).toUpperCase();
  const gender: UdiseDocExtract["gender"] = genderRaw.startsWith("M") ? "M" : genderRaw.startsWith("F") ? "F" : "";
  let pincode = clean(o.pincode, 10).replace(/\D/g, "");
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    if (pincode) missing.add("pincode");
    pincode = "";
  }
  return {
    docType,
    person,
    nameOnDoc: clean(o.nameOnDoc, 120),
    dob,
    aadhaarNumber,
    gender,
    fatherName: clean(o.fatherName, 120),
    motherName: clean(o.motherName, 120),
    address: clean(o.address, 240),
    pincode,
    payment: parsePaymentBlock(o.payment, docType, missing),
    missing: [...missing],
    notes: clean(o.notes, 200),
  };
}

/**
 * The payment block, or null. Every field is checked, because each one
 * becomes a sentence the office reads about somebody's money:
 *   - an amount must be a positive figure under ₹10,00,000 (a school fee
 *     is not larger, and a mis-read "2500000" for ₹2,500 would be);
 *   - a date must be a real date and not in the future;
 *   - a reference must look like one — six characters or more — because a
 *     two-character scrap matches half the fee book.
 * Anything that fails is dropped and named in `missing`, never guessed.
 */
function parsePaymentBlock(raw: unknown, docType: UdiseDocType, missing: Set<string>): UdiseDocExtract["payment"] {
  if (docType !== "payment_proof") return null;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const digits = String(o.amount ?? o.amountPaise ?? "").replace(/[^\d.]/g, "");
  const rupees = Number(digits);
  let amountPaise = 0;
  if (Number.isFinite(rupees) && rupees > 0 && rupees <= 1_000_000) amountPaise = Math.round(rupees * 100);
  else missing.add("amount");

  let dateIso = clean(o.dateIso ?? o.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || Number.isNaN(Date.parse(`${dateIso}T00:00:00Z`)) || dateIso > new Date().toISOString().slice(0, 10)) {
    if (dateIso) missing.add("paymentDate");
    dateIso = "";
  }
  let reference = clean(o.reference, 40).replace(/\s+/g, "");
  if (reference.length < 6) {
    if (reference) missing.add("reference");
    reference = "";
  }
  return {
    amountPaise,
    dateIso,
    reference,
    method: clean(o.method, 30),
    payeeName: clean(o.payeeName, 80),
  };
}

/** Which vault slot the document belongs in. */
export function docSlotFor(docType: UdiseDocType): StudentDocKey | null {
  if (docType === "aadhaar") return "aadhaar";
  if (docType === "birth_certificate") return "birthCert";
  if (docType === "address_proof") return "addressProof";
  return null;
}

export const DOC_TYPE_LABEL: Record<UdiseDocType, string> = {
  aadhaar: "Aadhaar card",
  birth_certificate: "Birth certificate",
  address_proof: "Address proof",
  payment_proof: "Payment proof",
  other: "Document",
};

/* ── names ───────────────────────────────────────────────────────── */

export function normalizeName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\b(kumar|kumari|singh|devi|md|mohd|mohammad|shri|smt|master|miss|mr|mrs)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

export type NameRelation = "same" | "spelling" | "different";

/**
 * "Aarav Sharma" vs "Arav Sarma" is a spelling variant; "Aarav Sharma" vs
 * "Riya Sharma" is a different person. Compared after stripping honorifics
 * and common suffixes, on the joined letters and on the first token.
 */
export function compareNames(sis: string, doc: string): NameRelation {
  const a = normalizeName(sis);
  const b = normalizeName(doc);
  if (!a || !b) return "different";
  if (a === b) return "same";
  const ja = a.replace(/\s/g, "");
  const jb = b.replace(/\s/g, "");
  const budget = Math.max(2, Math.floor(Math.max(ja.length, jb.length) * 0.25));
  if (levenshtein(ja, jb) <= budget) return "spelling";
  // First names agree closely and one side merely adds or drops a surname.
  const fa = a.split(" ")[0]!;
  const fb = b.split(" ")[0]!;
  if (fa.length >= 3 && fb.length >= 3 && levenshtein(fa, fb) <= 1 && (a.includes(b) || b.includes(a))) return "spelling";
  return "different";
}

/* ── the plan ────────────────────────────────────────────────────── */

export type UdiseFieldChange = {
  /** SIS field on the student or household. */
  field: "fullName" | "dob" | "gender" | "aadhaarNumber" | "fatherName" | "motherName" | "fatherAadhaarNumber" | "motherAadhaarNumber" | "address" | "pincode";
  target: "student" | "household";
  before: string;
  after: string;
  /** Written now, or left for the office. */
  apply: boolean;
  reason: string;
};

export type StudentLike = {
  id: string;
  fullName: string;
  dob: string;
  gender: string;
  aadhaarNumber: string;
  aadhaarLast4: string;
  fatherName: string;
  motherName: string;
  fatherAadhaarNumber: string;
  motherAadhaarNumber: string;
};

export type HouseholdLike = { address: string; pincode: string };

export type UdiseCorrectionPlan = {
  docType: UdiseDocType;
  person: UdiseDocPerson;
  docKey: StudentDocKey | null;
  changes: UdiseFieldChange[];
  /** Human sentences for the office beyond the field list. */
  flags: string[];
};

function display(v: string, field: UdiseFieldChange["field"]): string {
  return field.toLowerCase().includes("aadhaar") ? maskAadhaar(v) : v || "—";
}

/**
 * Decide the writes. Deterministic; the model's output is only an input.
 * `person` decides whose record a name or Aadhaar belongs to.
 */
export function planUdiseCorrections(input: { extract: UdiseDocExtract; student: StudentLike; household: HouseholdLike | null }): UdiseCorrectionPlan {
  const { extract: e, student: s, household: h } = input;
  const changes: UdiseFieldChange[] = [];
  const flags: string[] = [];
  const person: UdiseDocPerson = e.person === "unknown" && e.docType === "birth_certificate" ? "child" : e.person;
  const put = (c: UdiseFieldChange) => {
    if ((c.before || "") === (c.after || "")) return;
    changes.push(c);
  };

  if (e.docType === "other") {
    flags.push("The document could not be recognised as an Aadhaar card, birth certificate or address proof; filed for the office to look at.");
    return { docType: e.docType, person, docKey: null, changes, flags };
  }

  // Whose name is on the document, and does it match the person we hold?
  const nameTarget: { field: UdiseFieldChange["field"]; current: string } | null =
    person === "child" ? { field: "fullName", current: s.fullName } : person === "father" ? { field: "fatherName", current: s.fatherName } : person === "mother" ? { field: "motherName", current: s.motherName } : null;
  let nameRelation: NameRelation | null = null;
  if (e.nameOnDoc && nameTarget) {
    nameRelation = nameTarget.current ? compareNames(nameTarget.current, e.nameOnDoc) : "spelling";
    if (nameRelation === "spelling") {
      put({ field: nameTarget.field, target: "student", before: nameTarget.current, after: e.nameOnDoc, apply: true, reason: nameTarget.current ? "spelling corrected from the document" : "filled from the document" });
    } else if (nameRelation === "different") {
      put({ field: nameTarget.field, target: "student", before: nameTarget.current, after: e.nameOnDoc, apply: false, reason: "the name on the document is a different name — office to confirm whose document this is" });
      flags.push(`Name on document "${e.nameOnDoc}" does not match "${nameTarget.current}" on record. Nothing else from this document was applied.`);
      return { docType: e.docType, person, docKey: docSlotFor(e.docType), changes, flags };
    }
  } else if (e.nameOnDoc && !nameTarget) {
    flags.push(`Document names "${e.nameOnDoc}" but does not say whose it is; nothing applied.`);
    return { docType: e.docType, person, docKey: docSlotFor(e.docType), changes, flags };
  }

  if (e.aadhaarNumber) {
    const field: UdiseFieldChange["field"] = person === "father" ? "fatherAadhaarNumber" : person === "mother" ? "motherAadhaarNumber" : "aadhaarNumber";
    const before = field === "aadhaarNumber" ? s.aadhaarNumber || (s.aadhaarLast4 ? `********${s.aadhaarLast4}` : "") : field === "fatherAadhaarNumber" ? s.fatherAadhaarNumber : s.motherAadhaarNumber;
    const sameLast4 = before && before.slice(-4) === e.aadhaarNumber.slice(-4);
    put({ field, target: "student", before, after: e.aadhaarNumber, apply: true, reason: before ? (sameLast4 ? "full number completed from the document" : "corrected from the document (checksum valid)") : "filled from the document (checksum valid)" });
  } else if (e.missing.includes("aadhaarNumber")) {
    flags.push("The Aadhaar number was not fully legible or failed its checksum; not written.");
  }

  if (person === "child") {
    if (e.dob) {
      put({ field: "dob", target: "student", before: s.dob, after: e.dob, apply: true, reason: s.dob ? "date of birth corrected from the document" : "date of birth filled from the document" });
    } else if (e.missing.includes("dob") && e.docType !== "address_proof") {
      flags.push("The document shows no full date of birth (year only, or unreadable); DOB unchanged.");
    }
    if (e.gender && !s.gender) put({ field: "gender", target: "student", before: s.gender, after: e.gender, apply: true, reason: "filled from the document" });
    else if (e.gender && s.gender && s.gender.toUpperCase()[0] !== e.gender) {
      put({ field: "gender", target: "student", before: s.gender, after: e.gender, apply: false, reason: "document and record disagree on gender — office to confirm" });
    }
    if (e.docType === "birth_certificate") {
      for (const [field, cur, val] of [["fatherName", s.fatherName, e.fatherName], ["motherName", s.motherName, e.motherName]] as const) {
        if (!val) continue;
        const rel = cur ? compareNames(cur, val) : "spelling";
        if (rel === "spelling") put({ field, target: "student", before: cur, after: val, apply: true, reason: cur ? "spelling corrected from the birth certificate" : "filled from the birth certificate" });
        else if (rel === "different") put({ field, target: "student", before: cur, after: val, apply: false, reason: "a different name on the birth certificate — office to confirm" });
      }
    }
  }

  if ((e.docType === "aadhaar" || e.docType === "address_proof") && e.address && e.pincode && h) {
    put({ field: "address", target: "household", before: h.address, after: e.address, apply: true, reason: h.address ? "address updated from the document" : "address filled from the document" });
    put({ field: "pincode", target: "household", before: h.pincode, after: e.pincode, apply: true, reason: h.pincode ? "PIN updated from the document" : "PIN filled from the document" });
  } else if (e.address && !e.pincode && h) {
    flags.push("An address was read but without a six-digit PIN; address unchanged.");
  }

  return { docType: e.docType, person, docKey: docSlotFor(e.docType), changes, flags };
}

/* ── a payment the parent is showing us ──────────────────────────── */

/** One receipt, as much of it as matching needs. */
export type ReceiptForMatch = {
  receiptNo: string;
  collectionDate: string;
  totalPaise: number;
  /** Every tender reference on the receipt: UTR, cheque no, auth code. */
  refs: string[];
};

export type PaymentMatch =
  | { kind: "by_reference"; receiptNo: string }
  | { kind: "by_amount_and_date"; receiptNo: string }
  | { kind: "none"; reason: "no_receipt_matches" | "nothing_readable" };

function normRef(s: string): string {
  return String(s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function daysApart(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 9999;
  return Math.abs(t1 - t2) / 86_400_000;
}

/**
 * Is this payment already in the fee book?
 *
 * The reference decides when there is one: a UTR is unique, and a match on
 * it is the only kind worth calling certain. Failing that, the same amount
 * within three days of the same family is offered as a likely match — and
 * labelled as likely, because two siblings' fees are often equal and a
 * parent who paid twice in a week would otherwise be told their second
 * payment was already recorded.
 *
 * It never decides anything. Booking money stays a person's job; this only
 * tells the office where to look.
 */
export function matchPaymentToReceipts(input: {
  amountPaise: number;
  dateIso: string;
  reference: string;
  receipts: ReceiptForMatch[];
}): PaymentMatch {
  const ref = normRef(input.reference);
  if (ref.length >= 6) {
    const hit = input.receipts.find((r) => r.refs.some((x) => normRef(x) === ref));
    if (hit) return { kind: "by_reference", receiptNo: hit.receiptNo };
  }
  if (input.amountPaise > 0 && input.dateIso) {
    const hit = input.receipts.find(
      (r) => r.totalPaise === input.amountPaise && daysApart(r.collectionDate, input.dateIso) <= 3,
    );
    if (hit) return { kind: "by_amount_and_date", receiptNo: hit.receiptNo };
  }
  if (!input.amountPaise && !ref) return { kind: "none", reason: "nothing_readable" };
  return { kind: "none", reason: "no_receipt_matches" };
}

function inr(paise: number): string {
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

/**
 * What the parent hears. Never "your payment is recorded" — we have seen a
 * picture, not the bank. What it promises is that a person will check, and
 * by when.
 */
export function renderPaymentProofAck(input: {
  payment: NonNullable<UdiseDocExtract["payment"]>;
  match: PaymentMatch;
  childName: string;
  language: "en" | "hi";
}): string {
  const { payment: p, match } = input;
  const hi = input.language === "hi";
  const bits: string[] = [];
  if (p.amountPaise) bits.push(hi ? `राशि ${inr(p.amountPaise)}` : `${inr(p.amountPaise)}`);
  if (p.dateIso) bits.push(hi ? `तारीख ${ddmmyyyy(p.dateIso)}` : `on ${ddmmyyyy(p.dateIso)}`);
  if (p.reference) bits.push(hi ? `संदर्भ ${p.reference}` : `ref ${p.reference}`);
  const read = bits.join(hi ? ", " : " · ");

  if (match.kind === "by_reference") {
    return hi
      ? `धन्यवाद 🙏 यह भुगतान हमारे रिकॉर्ड में पहले से दर्ज है — रसीद *${match.receiptNo}*.\n\nयदि आपको रसीद नहीं मिली हो तो बताइए, हम दोबारा भेज देंगे।`
      : `Thank you 🙏 This payment is already in our records — receipt *${match.receiptNo}*.\n\nIf you did not get the receipt, tell us and we will send it again.`;
  }
  if (match.kind === "by_amount_and_date") {
    return hi
      ? `धन्यवाद 🙏 ${read ? read + " — " : ""}संभवतः यह रसीद *${match.receiptNo}* वाला ही भुगतान है। कार्यालय पुष्टि करके आपको बताएगा।`
      : `Thank you 🙏 ${read ? read + " — " : ""}this looks like receipt *${match.receiptNo}*. The office will confirm and come back to you.`;
  }
  if (!read) {
    return hi
      ? "धन्यवाद 🙏 स्क्रीनशॉट मिल गया, पर उसमें राशि/संदर्भ पढ़ा नहीं जा सका।\n\nकृपया *राशि*, *तारीख* और *UTR/संदर्भ संख्या* लिख भेजें — कार्यालय तुरंत जाँच कर देगा।"
      : "Thank you 🙏 We have the screenshot, but could not read the amount or reference from it.\n\nPlease type the *amount*, the *date* and the *UTR / reference number* — the office will check straight away.";
  }
  return hi
    ? `धन्यवाद 🙏 मिल गया: ${read}।\n\nयह भुगतान अभी हमारी रसीदों में नहीं मिला — कार्यालय बैंक से मिलान करके आज ही आपसे संपर्क करेगा। तब तक कोई स्मरण संदेश नहीं आएगा।`
    : `Thank you 🙏 Received: ${read}.\n\nWe could not find this payment in our receipts yet — the office will check it against the bank and come back to you today. No reminders will go out meanwhile.`;
}

/** What the office reads: the figures, the match, and what to do. */
export function renderPaymentProofOfficeAlert(input: {
  payment: NonNullable<UdiseDocExtract["payment"]>;
  match: PaymentMatch;
  childName: string;
  classLabel: string;
  guardianName: string;
  openDuesPaise: number;
  fileUrl: string | null;
}): { text: string; oneLine: string } {
  const { payment: p, match } = input;
  const lines = [
    `💸 *Payment proof* · ${input.childName} (${input.classLabel})`,
    `From: ${input.guardianName || "parent"} on WhatsApp`,
    "",
    `Amount: *${p.amountPaise ? inr(p.amountPaise) : "not readable"}*`,
    `Date: ${p.dateIso ? ddmmyyyy(p.dateIso) : "not readable"}`,
    `Reference: ${p.reference || "not readable"}${p.method ? ` · ${p.method}` : ""}`,
  ];
  if (p.payeeName) lines.push(`Paid to: ${p.payeeName}`);
  lines.push("", `Open dues on record: *${inr(input.openDuesPaise)}*`);
  if (match.kind === "by_reference") {
    lines.push("", `✅ Already booked — receipt *${match.receiptNo}* carries this reference. Nothing to do beyond telling the family.`);
  } else if (match.kind === "by_amount_and_date") {
    lines.push("", `🔎 Probably receipt *${match.receiptNo}* (same amount, within three days). CONFIRM before replying — siblings' fees are often equal.`);
  } else if (match.reason === "nothing_readable") {
    lines.push("", "⚠️ Neither an amount nor a reference could be read. The parent has been asked to type them.");
  } else {
    lines.push("", "❗ *No receipt matches.* Check the bank statement and the counter book, then either book it or tell the family what is missing.");
  }
  lines.push("", "Nothing was posted to the fee book — a photograph never books money.");
  if (input.fileUrl) lines.push("", `Screenshot: ${input.fileUrl}`);
  const oneLine = `Payment proof from ${input.guardianName || "a parent"} for ${input.childName}: ${p.amountPaise ? inr(p.amountPaise) : "amount unreadable"}${match.kind === "none" ? " — no receipt matches" : ` — ${match.receiptNo}`}`;
  return { text: lines.join("\n"), oneLine };
}

/* ── what people read ────────────────────────────────────────────── */

export function renderParentAck(input: { plan: UdiseCorrectionPlan; childName: string; language: "en" | "hi" }): string {
  const applied = input.plan.changes.filter((c) => c.apply);
  const label = DOC_TYPE_LABEL[input.plan.docType];
  const who = input.plan.person === "father" ? (input.language === "hi" ? "पिता" : "father") : input.plan.person === "mother" ? (input.language === "hi" ? "माता" : "mother") : input.childName;
  if (input.language === "hi") {
    const lines = [`📄 मिल गया: ${input.childName} के लिए ${label}${input.plan.person === "father" || input.plan.person === "mother" ? ` (${who})` : ""}। धन्यवाद 🙏`];
    if (applied.length) lines.push("", "रिकॉर्ड में अपडेट:", ...applied.map((c) => `• ${FIELD_LABEL_HI[c.field]}: ${display(c.after, c.field)}`));
    else if (input.plan.docType !== "other") lines.push("", "रिकॉर्ड पहले से सही था; कोई बदलाव नहीं।");
    if (input.plan.flags.length) lines.push("", "कार्यालय एक बात की जाँच करेगा और ज़रूरत हो तो आपसे संपर्क करेगा।");
    return lines.join("\n");
  }
  const lines = [`📄 Received: ${label} for ${input.childName}${input.plan.person === "father" || input.plan.person === "mother" ? ` (${who})` : ""}. Thank you 🙏`];
  if (applied.length) lines.push("", "Updated in the school record:", ...applied.map((c) => `• ${FIELD_LABEL_EN[c.field]}: ${display(c.after, c.field)}`));
  else if (input.plan.docType !== "other") lines.push("", "The record already matched; nothing changed.");
  if (input.plan.flags.length) lines.push("", "The office will check one detail and contact you if needed.");
  return lines.join("\n");
}

export const FIELD_LABEL_EN: Record<UdiseFieldChange["field"], string> = {
  fullName: "Student name",
  dob: "Date of birth",
  gender: "Gender",
  aadhaarNumber: "Student Aadhaar",
  fatherName: "Father's name",
  motherName: "Mother's name",
  fatherAadhaarNumber: "Father's Aadhaar",
  motherAadhaarNumber: "Mother's Aadhaar",
  address: "Address",
  pincode: "PIN code",
};
export const FIELD_LABEL_HI: Record<UdiseFieldChange["field"], string> = {
  fullName: "छात्र का नाम",
  dob: "जन्म तिथि",
  gender: "लिंग",
  aadhaarNumber: "छात्र आधार",
  fatherName: "पिता का नाम",
  motherName: "माता का नाम",
  fatherAadhaarNumber: "पिता का आधार",
  motherAadhaarNumber: "माता का आधार",
  address: "पता",
  pincode: "पिन कोड",
};

/** Fields the UDISE+ portal holds, in the words the portal uses. */
const PORTAL_FIELD: Partial<Record<UdiseFieldChange["field"], string>> = {
  fullName: "Student Name",
  dob: "Date of Birth (dd/mm/yyyy)",
  gender: "Gender",
  aadhaarNumber: "Aadhaar Number (re-verify)",
  fatherName: "Father's Name",
  motherName: "Mother's Name",
  address: "Address",
  pincode: "Pin Code",
};

function ddmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function renderOfficeAlert(input: { plan: UdiseCorrectionPlan; childName: string; classLabel: string; guardianName: string; fileUrl: string | null }): { text: string; oneLine: string; portalChanges: string[] } {
  const label = DOC_TYPE_LABEL[input.plan.docType];
  const applied = input.plan.changes.filter((c) => c.apply);
  const held = input.plan.changes.filter((c) => !c.apply);
  const portalChanges = applied
    .filter((c) => PORTAL_FIELD[c.field])
    .map((c) => `${PORTAL_FIELD[c.field]} → ${c.field === "dob" ? ddmmyyyy(c.after) : display(c.after, c.field)}`);
  const lines = [`📄 *${label} received* · ${input.childName} (${input.classLabel})`, `From: ${input.guardianName || "parent"} on WhatsApp${input.plan.person === "father" || input.plan.person === "mother" ? ` · ${input.plan.person}'s document` : ""}`];
  if (applied.length) {
    lines.push("", "*Updated in SIS:*", ...applied.map((c) => `• ${FIELD_LABEL_EN[c.field]}: ${display(c.before, c.field)} → *${display(c.after, c.field)}* (${c.reason})`));
  } else lines.push("", "SIS unchanged — the record already matched.");
  if (held.length) lines.push("", "*Needs your decision:*", ...held.map((c) => `• ${FIELD_LABEL_EN[c.field]}: record "${display(c.before, c.field)}" vs document "${display(c.after, c.field)}" — ${c.reason}`));
  if (input.plan.flags.length) lines.push("", ...input.plan.flags.map((f) => `⚠️ ${f}`));
  if (portalChanges.length) lines.push("", "*Change in UDISE+ portal:*", ...portalChanges.map((p) => `• ${p}`));
  else if (applied.length === 0 && held.length === 0) lines.push("", "UDISE+: nothing to change from this document.");
  if (input.fileUrl) lines.push("", `Document: ${input.fileUrl}`);
  const oneLine = `${label} for ${input.childName}: ${applied.length} field${applied.length === 1 ? "" : "s"} updated${held.length ? `, ${held.length} for review` : ""}`;
  return { text: lines.join("\n"), oneLine, portalChanges };
}

/** The "please send" list for a family, from the child's gaps and record. */
export function missingDocsFor(input: { gaps: string[]; hasDob: boolean; hasAddress: boolean; language: "en" | "hi" }): string {
  const out: string[] = [];
  const hi = input.language === "hi";
  if (input.gaps.includes("student_aadhaar") || input.gaps.includes("student_aadhaar_unverified")) out.push(hi ? "बच्चे का आधार कार्ड" : "child's Aadhaar card");
  if (input.gaps.includes("parent_aadhaar")) out.push(hi ? "पिता या माता का आधार कार्ड" : "father's or mother's Aadhaar card");
  if (!input.hasDob) out.push(hi ? "जन्म प्रमाणपत्र" : "birth certificate");
  if (!input.hasAddress) out.push(hi ? "पते का प्रमाण (राशन कार्ड / बिजली बिल)" : "address proof (ration card / electricity bill)");
  return out.join(hi ? ", " : ", ");
}
