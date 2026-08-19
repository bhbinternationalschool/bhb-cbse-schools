/**
 * Admission application form (photo / scan / PDF) → structured fields for
 * the enquiry / registration record, plus what is still missing. Pure
 * shapes, prompt and parser; the route does the vision call.
 *
 * Every field is "" unless it is legibly on the form — the model is told
 * to leave unsure fields empty and list them under `missing`; the office
 * reviews before anything is saved.
 */

export type ApplicationExtract = {
  studentName: string;
  /** YYYY-MM-DD or "" */
  dob: string;
  gender: "male" | "female" | "other" | "";
  /** As written on the form, e.g. "VI", "Nursery" */
  classSought: string;
  fatherName: string;
  motherName: string;
  guardianName: string;
  /** 10 digits or "" */
  mobile: string;
  altMobile: string;
  email: string;
  address: string;
  pincode: string;
  previousSchool: string;
  /** Last 4 digits only — never the full number */
  aadhaarLast4: string;
  category: string;
  /** Fields the form asks for but that are blank / illegible */
  missing: string[];
  /** Anything the office should double-check (overwrites, two spellings…) */
  notes: string;
};

export const APPLICATION_EXTRACT_SYSTEM = `You read a school admission application form (photo, scan or PDF) from an Indian CBSE school and extract the fields into JSON for the office to review.

Rules:
- Copy exactly what is written; do not correct spellings, do not translate names. If a field is blank, illegible or you are unsure, leave it "" and add its name to "missing".
- dob: convert to YYYY-MM-DD only if the day/month/year are unambiguous on the form; else "" and mention the raw text in notes.
- mobile / altMobile: 10-digit Indian numbers without +91; anything else → "".
- aadhaarLast4: only the last 4 digits of an Aadhaar number if visible; never output more of it.
- gender: male | female | other | "".
- notes: short; overwrites, ticked/unticked boxes, two different spellings, or a field you could not map.

JSON only, exactly these keys:
{"studentName":"","dob":"","gender":"","classSought":"","fatherName":"","motherName":"","guardianName":"","mobile":"","altMobile":"","email":"","address":"","pincode":"","previousSchool":"","aadhaarLast4":"","category":"","missing":[],"notes":""}`;

export const APPLICATION_EXTRACT_PROMPT = "Extract the admission form fields from this document.";

const KEYS = [
  "studentName", "dob", "gender", "classSought", "fatherName", "motherName", "guardianName", "mobile", "altMobile",
  "email", "address", "pincode", "previousSchool", "aadhaarLast4", "category",
] as const;

export function parseApplicationExtract(text: string): ApplicationExtract | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string, max = 200) => String(r[k] ?? "").trim().slice(0, max);
  const digits = (v: string) => v.replace(/\D/g, "");
  const mobile = digits(str("mobile")).slice(-10);
  const alt = digits(str("altMobile")).slice(-10);
  const dob = str("dob", 10);
  const g = str("gender", 10).toLowerCase();
  const out: ApplicationExtract = {
    studentName: str("studentName", 80),
    dob: /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : "",
    gender: g === "male" || g === "female" || g === "other" ? g : "",
    classSought: str("classSought", 30),
    fatherName: str("fatherName", 80),
    motherName: str("motherName", 80),
    guardianName: str("guardianName", 80),
    mobile: mobile.length === 10 ? mobile : "",
    altMobile: alt.length === 10 ? alt : "",
    email: str("email", 120),
    address: str("address", 300),
    pincode: digits(str("pincode", 10)).length === 6 ? digits(str("pincode", 10)) : "",
    previousSchool: str("previousSchool", 160),
    aadhaarLast4: digits(str("aadhaarLast4", 20)).slice(-4).length === 4 ? digits(str("aadhaarLast4", 20)).slice(-4) : "",
    category: str("category", 40),
    missing: Array.isArray(r.missing) ? r.missing.map((m) => String(m ?? "").trim()).filter(Boolean).slice(0, 20) : [],
    notes: str("notes", 500),
  };
  const filled = KEYS.filter((k) => out[k]).length;
  return filled === 0 ? null : out;
}
