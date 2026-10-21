/**
 * Photos the staff app reads for a form (2026-10-20): an ID card and a number
 * plate at the visitor gate, a fuel bill in the vehicle log book.
 *
 * Each reading is a DRAFT that lands in the phone's form, marked "read from
 * … — check"; the staff member confirms or edits and saves the normal way.
 * Nothing here saves anything.
 *
 * The rules this file is built on:
 *
 *   - Unknown must not become fact. A field the model could not read, or read
 *     into a shape that cannot be right (a 7-digit Aadhaar, a fuel rate of
 *     ₹3/L, a bill dated next week), is left EMPTY — never patched, never
 *     derived from the other fields. A low-confidence reading empties every
 *     field and says so in one short note.
 *   - A full Aadhaar number never leaves the server. UIDAI allows the last
 *     four digits to be kept; the reader masks the number before anything —
 *     the phone, the visitor log, the AI audit row — sees it.
 *
 * Pure: no network, no model call. The call is readStaffScanImage in
 * aiLlm.server.ts; see staffScanReading.selftest.ts.
 */

export const STAFF_SCAN_PROMPT_VERSION = "staff-scan/2026-10-20";

export type StaffScanKind = "visitor_id" | "vehicle_plate" | "fuel_bill";
export const STAFF_SCAN_KINDS: readonly StaffScanKind[] = ["visitor_id", "vehicle_plate", "fuel_bill"];

/** ~1600 px JPEG is 300–500 kB; this refuses a raw camera file sent by mistake. */
export const STAFF_SCAN_MAX_BASE64 = 4_000_000;
/** Refused before the body is even parsed (base64 + JSON envelope). */
export const STAFF_SCAN_MAX_BODY_BYTES = 4_200_000;
/** Per staff member: a gate is busy at 8 am, but not 30 photos in 10 minutes busy. */
export const STAFF_SCAN_RATE = { windowMs: 10 * 60_000, max: 30 } as const;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/* ── small validators shared with the gate check-in ─────────────────── */

/**
 * An Indian mobile: 10 digits starting 6–9, with +91 / 0 tolerated in front.
 * Blank is allowed (the visitor register never required one) and comes back
 * as "". Anything else is refused with the reason.
 */
export function cleanIndianMobile(raw: unknown): { ok: true; mobile: string } | { ok: false; error: string } {
  const s = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  if (!s) return { ok: true, mobile: "" };
  let d = s.replace(/[\s\-()]/g, "");
  if (!/^\+?\d+$/.test(d)) return { ok: false, error: "Mobile number should be 10 digits" };
  d = d.replace(/^\+/, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10) return { ok: false, error: "Mobile number should be 10 digits" };
  if (!/^[6-9]/.test(d)) return { ok: false, error: "An Indian mobile number starts with 6, 7, 8 or 9" };
  return { ok: true, mobile: d };
}

/** Number of people in the party: a whole number 1–99; blank means 1. */
export function cleanPeopleCount(raw: unknown): { ok: true; count: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, count: 1 };
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: "Number of people should be a whole number" };
  if (n < 1) return { ok: false, error: "Number of people should be at least 1" };
  if (n > 99) return { ok: false, error: "Number of people looks too large — check it" };
  return { ok: true, count: n };
}

/** "XXXX XXXX 1234" — the UIDAI-permitted form. "" when there are no 4 digits. */
export function maskAadhaarDigits(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `XXXX XXXX ${d.slice(-4)}` : "";
}

/**
 * Masks every Aadhaar-shaped run (12 digits, optionally grouped 4-4-4 by
 * spaces or hyphens) and every 16-digit Aadhaar VID in free text. Idempotent:
 * an already-masked "XXXX XXXX 1234" has no 12-digit run left to match.
 */
export function maskAadhaarInText(text: string): string {
  const s = String(text ?? "");
  return s
    .replace(/(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, (m) => `XXXX XXXX XXXX ${m.replace(/\D/g, "").slice(-4)}`)
    .replace(/(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, (m) => maskAadhaarDigits(m));
}

const STATE_CODES = new Set(
  "AN AP AR AS BR CH CG DD DL DN GA GJ HR HP JK JH KA KL LA LD MP MH MN ML MZ NL OD OR PB PY RJ SK TN TS TG TR UP UK UA WB".split(" "),
);

/**
 * An Indian registration number in its printed form, "UP 32 AB 1234"
 * (or Bharat series "22 BH 1234 AA"). Case, spaces, dots and hyphens are
 * ignored; no character is ever swapped for a look-alike (0/O, 1/I) — that
 * would be a guess. Returns "" when it is not a registration number.
 */
export function normalizePlate(raw: string): string {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const bh = /^(\d{2})BH(\d{4})([A-Z]{1,2})$/.exec(s);
  if (bh) return `${bh[1]} BH ${bh[2]} ${bh[3]}`;
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(s);
  if (!m || !STATE_CODES.has(m[1]!)) return "";
  if (/^0+$/.test(m[4]!)) return "";
  return [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ");
}

/**
 * What the visitor log stores for a typed vehicle number: the normalised
 * plate when it is one, otherwise the guard's own text, upper-cased and
 * trimmed (a tractor or a cart may carry no standard plate).
 */
export function cleanVehicleNo(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  return normalizePlate(s) || s.toUpperCase().replace(/\s+/g, " ").slice(0, 20);
}

/* ── request body ───────────────────────────────────────────────────── */

export type StaffScanInput = {
  kind: StaffScanKind;
  base64: string;
  mimeType: string;
  /** fuel_bill only */
  vehicleId: string;
  date: string;
};

export function cleanStaffScanInput(body: unknown, allowed: readonly StaffScanKind[]): StaffScanInput | string {
  if (!body || typeof body !== "object") return "Send the photo";
  const o = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const kind = str(o.kind) as StaffScanKind;
  if (!allowed.includes(kind)) return "Unknown kind of photo";
  const base64 = str(o.imageBase64).replace(/^data:[^,]*,/, "");
  const mimeType = str(o.mimeType).toLowerCase() || "image/jpeg";
  if (!base64) return "The photo is empty";
  if (!IMAGE_TYPES.has(mimeType)) return "Send a JPG or PNG photo";
  if (base64.length > STAFF_SCAN_MAX_BASE64) return "The photo is too large — retake it";
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64.slice(0, 2000))) return "The photo is not readable";
  return { kind, base64, mimeType, vehicleId: str(o.vehicleId), date: str(o.date) };
}

/** What ai_generations gets instead of the photo: its shape, never its bytes. */
export function staffScanAuditDescriptor(input: { kind: StaffScanKind; mimeType: string; base64: string }): string {
  return `staff scan — ${input.kind} · ${input.mimeType} · ~${Math.round((input.base64.length * 3) / 4 / 1024)} kB`;
}

/* ── prompts ────────────────────────────────────────────────────────── */

const COMMON = [
  "Report ONLY what is printed and legible in the photo. Never guess, never complete a partly hidden value, never infer one value from another.",
  "For any value you cannot read with certainty, return \"\" (or null for numbers).",
  "confidence: \"high\" when the photo is sharp and every value you return is plainly printed, \"medium\" when some are hard to read, \"low\" when the photo is blurred, dark, cut off or not the expected document.",
  "If the photo is not the expected document, set readable to false and say why in unreadableReason (simple English), and leave every other value empty.",
];

export function buildStaffScanSystem(kind: StaffScanKind): string {
  if (kind === "visitor_id") {
    return [
      "You read a photograph of an Indian identity document shown by a visitor at a school gate.",
      ...COMMON,
      "idType: one of aadhaar, pan, driving_licence, voter_id, passport, other.",
      "name: the holder's name exactly as printed (not a father's/husband's name).",
      "idNumber: the document number as printed. For an Aadhaar card return ONLY the LAST FOUR digits of the Aadhaar number — never the full number, never the VID.",
      "address: the address as printed, if the document prints one; else \"\".",
      'Respond with JSON only: {"readable":true,"unreadableReason":"","confidence":"high","idType":"","name":"","idNumber":"","address":""}',
    ].join("\n");
  }
  if (kind === "vehicle_plate") {
    return [
      "You read a photograph of an Indian vehicle number plate at a school gate.",
      ...COMMON,
      "plate: the registration number exactly as printed, letters and digits only (e.g. UP32AB1234). Do not correct or complete it.",
      'Respond with JSON only: {"readable":true,"unreadableReason":"","confidence":"high","plate":""}',
    ].join("\n");
  }
  return [
    "You read a photograph of a fuel bill / petrol-pump receipt for a school vehicle.",
    ...COMMON,
    "amountRupees: the total amount paid in rupees (number).",
    "date: the bill date as YYYY-MM-DD, only if printed in full; else \"\".",
    "quantity: litres (or kg for CNG) filled (number).",
    "ratePerUnit: price per litre / kg in rupees (number).",
    "odometerKm: the vehicle odometer reading if the bill prints one (number); else null.",
    "vendor: the pump / vendor name as printed.",
    "billNo: the bill, receipt or invoice number as printed.",
    'Respond with JSON only: {"readable":true,"unreadableReason":"","confidence":"high","amountRupees":null,"date":"","quantity":null,"ratePerUnit":null,"odometerKm":null,"vendor":"","billNo":""}',
  ].join("\n");
}

export function buildStaffScanPrompt(kind: StaffScanKind): string {
  if (kind === "visitor_id") return "Read this identity document.";
  if (kind === "vehicle_plate") return "Read this number plate.";
  return "Read this fuel bill.";
}

/* ── parsing the model's reply ──────────────────────────────────────── */

export type IdType = "aadhaar" | "pan" | "driving_licence" | "voter_id" | "passport" | "other";
const ID_LABEL: Record<IdType, string> = {
  aadhaar: "Aadhaar",
  pan: "PAN",
  driving_licence: "Driving licence",
  voter_id: "Voter ID",
  passport: "Passport",
  other: "ID",
};

export type VisitorIdReading = {
  readable: boolean;
  /** Shown to the guard when something was left empty — never a guess. */
  note: string;
  idType: IdType | "";
  idTypeLabel: string;
  name: string;
  /** Masked for Aadhaar ("XXXX XXXX 1234"); as printed for the others. */
  idNumber: string;
  address: string;
  /** Ready for the visitor's "ID shown" field, e.g. "Aadhaar XXXX XXXX 1234". */
  idProofNote: string;
};

export type PlateReading = { readable: boolean; note: string; plate: string };

export type FuelBillReading = {
  readable: boolean;
  note: string;
  amountRupees: number | null;
  date: string;
  quantity: number | null;
  ratePerUnit: number | null;
  odometerKm: number | null;
  vendor: string;
  billNo: string;
  /** Checks a person should look at (e.g. the total does not equal qty × rate). */
  warnings: string[];
};

function jsonObject(text: string): Record<string, unknown> | null {
  const t = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[₹,\s]|Rs\.?|INR/gi, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** null = not usable as a reading at all; readable:false = a true answer about the photo. */
function gate(o: Record<string, unknown> | null, what: string): { ok: true } | { ok: false; note: string } | null {
  if (!o) return null;
  if (o.readable === false) {
    return { ok: false, note: txt(o.unreadableReason, 160) || `The ${what} could not be read — type it in.` };
  }
  const conf = txt(o.confidence).toLowerCase();
  if (conf !== "high" && conf !== "medium") {
    return { ok: false, note: `The ${what} was not clear enough to read safely — type it in, or retake the photo.` };
  }
  return { ok: true };
}

function cleanIdNumber(type: IdType | "", raw: string): string {
  const compact = raw.toUpperCase().replace(/[\s-]/g, "");
  if (!compact) return "";
  if (type === "aadhaar") {
    // Last four (what we ask for), the last four behind X's, or the full
    // twelve (what a model may send anyway) — only the last four survive.
    if (!/^[X*•\d]+$/.test(compact)) return "";
    const d = compact.replace(/\D/g, "");
    return d.length === 4 || d.length === 12 ? maskAadhaarDigits(d) : "";
  }
  if (type === "pan") return /^[A-Z]{5}\d{4}[A-Z]$/.test(compact) ? compact : "";
  if (type === "voter_id") return /^[A-Z]{3}\d{7}$/.test(compact) ? compact : "";
  if (type === "passport") return /^[A-Z]\d{7}$/.test(compact) ? compact : "";
  if (type === "driving_licence") return /^[A-Z]{2}\d[A-Z0-9]{8,17}$/.test(compact) ? compact : "";
  // Unknown type: keep a plausible number, but never a bare 12-digit run.
  if (/^\d{12}$/.test(compact) || /^\d{16}$/.test(compact)) return maskAadhaarDigits(compact);
  return /^[A-Z0-9/]{4,20}$/.test(compact) ? compact : "";
}

const NAME_RE = /^[A-Za-zऀ-ॿ][A-Za-zऀ-ॿ .'-]{1,79}$/;

export function parseVisitorIdReading(text: string): VisitorIdReading | null {
  const o = jsonObject(text);
  const g = gate(o, "ID card");
  if (!g || !o) return null;
  const empty: VisitorIdReading = { readable: false, note: "", idType: "", idTypeLabel: "", name: "", idNumber: "", address: "", idProofNote: "" };
  if (!g.ok) return { ...empty, note: g.note };

  const t = txt(o.idType).toLowerCase().replace(/[\s-]/g, "_");
  const idType: IdType | "" = (Object.keys(ID_LABEL) as IdType[]).includes(t as IdType) ? (t as IdType) : "";
  const rawName = txt(o.name, 80);
  const name = NAME_RE.test(rawName) ? rawName : "";
  const idNumber = cleanIdNumber(idType, txt(o.idNumber, 40));
  const address = maskAadhaarInText(txt(o.address, 200));
  const missing = [
    !name && "name",
    !idNumber && "ID number",
  ].filter(Boolean) as string[];
  const label = idType ? ID_LABEL[idType] : "";
  const idProofNote = idNumber ? `${label || "ID"} ${idNumber}` : label;
  if (!name && !idNumber && !address) {
    return { ...empty, note: "Nothing on the card could be read clearly — type it in." };
  }
  return {
    readable: true,
    note: missing.length ? `Could not read the ${missing.join(" or ")} — type it in.` : "",
    idType,
    idTypeLabel: label,
    name,
    idNumber,
    address,
    idProofNote,
  };
}

export function parsePlateReading(text: string): PlateReading | null {
  const o = jsonObject(text);
  const g = gate(o, "number plate");
  if (!g || !o) return null;
  if (!g.ok) return { readable: false, note: g.note, plate: "" };
  const plate = normalizePlate(txt(o.plate, 30));
  if (!plate) return { readable: false, note: "That does not read as a number plate — type it in.", plate: "" };
  return { readable: true, note: "", plate };
}

const BILL_BOUNDS = {
  amount: [1, 200_000],
  quantity: [0.1, 2000],
  rate: [30, 300],
  odometer: [1, 2_000_000],
} as const;

function inRange(n: number | null, [lo, hi]: readonly [number, number]): number | null {
  return n != null && n >= lo && n <= hi ? n : null;
}

function isoDate(raw: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return "";
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return "";
  if (raw > today) return "";
  return raw;
}

/** `today` is the IST date (YYYY-MM-DD): a bill dated in the future is a misreading. */
export function parseFuelBillReading(text: string, today: string): FuelBillReading | null {
  const o = jsonObject(text);
  const g = gate(o, "bill");
  if (!g || !o) return null;
  const empty: FuelBillReading = {
    readable: false, note: "", amountRupees: null, date: "", quantity: null, ratePerUnit: null,
    odometerKm: null, vendor: "", billNo: "", warnings: [],
  };
  if (!g.ok) return { ...empty, note: g.note };

  const amountRupees = inRange(num(o.amountRupees), BILL_BOUNDS.amount);
  const quantity = inRange(num(o.quantity), BILL_BOUNDS.quantity);
  const ratePerUnit = inRange(num(o.ratePerUnit), BILL_BOUNDS.rate);
  const odo = inRange(num(o.odometerKm), BILL_BOUNDS.odometer);
  const odometerKm = odo == null ? null : Math.round(odo);
  const date = isoDate(txt(o.date, 10), today);
  const vendor = txt(o.vendor, 80);
  const billRaw = txt(o.billNo, 30);
  const billNo = /^[A-Za-z0-9/._-]{1,30}$/.test(billRaw) ? billRaw : "";

  if (amountRupees == null && quantity == null && ratePerUnit == null && !date && !vendor && !billNo && odometerKm == null) {
    return { ...empty, note: "Nothing on the bill could be read clearly — fill it in by hand." };
  }
  const warnings: string[] = [];
  if (amountRupees != null && quantity != null && ratePerUnit != null) {
    const expected = quantity * ratePerUnit;
    if (Math.abs(expected - amountRupees) > Math.max(2, amountRupees * 0.02)) {
      warnings.push("The total does not equal quantity × rate — check the bill.");
    }
  }
  const missing = [amountRupees == null && "amount", quantity == null && "quantity"].filter(Boolean) as string[];
  return {
    readable: true,
    note: missing.length ? `Could not read the ${missing.join(" or ")} — type it in.` : "",
    amountRupees,
    date,
    quantity: quantity == null ? null : Math.round(quantity * 100) / 100,
    ratePerUnit,
    odometerKm,
    vendor,
    billNo,
    warnings,
  };
}

export type StaffScanReading =
  | { kind: "visitor_id"; reading: VisitorIdReading }
  | { kind: "vehicle_plate"; reading: PlateReading }
  | { kind: "fuel_bill"; reading: FuelBillReading };

export function parseStaffScanReading(kind: StaffScanKind, text: string, today: string): StaffScanReading | null {
  if (kind === "visitor_id") {
    const r = parseVisitorIdReading(text);
    return r ? { kind, reading: r } : null;
  }
  if (kind === "vehicle_plate") {
    const r = parsePlateReading(text);
    return r ? { kind, reading: r } : null;
  }
  const r = parseFuelBillReading(text, today);
  return r ? { kind, reading: r } : null;
}

/**
 * The ai_generations output column. An ID card names a person and carries an
 * address, so only the document type is kept; a plate and a bill are not
 * personal and are kept as read.
 */
export function staffScanAuditOutput(r: StaffScanReading): string {
  if (r.kind === "visitor_id") return r.reading.readable ? `idType=${r.reading.idType || "?"}` : "unreadable";
  if (r.kind === "vehicle_plate") return r.reading.readable ? r.reading.plate : "unreadable";
  return JSON.stringify(r.reading);
}
