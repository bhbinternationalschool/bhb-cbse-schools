/**
 * A member of staff's own profile, from the staff app (director, 13 Oct 2026).
 *
 * Split by sensitivity:
 *  - DIRECT fields (contact and personal) save at once;
 *  - APPROVAL fields (identity, bank, statutory — what payroll, PF/ESIC,
 *    UDISE+ and the staff OTP login rely on) go to the office as a request
 *    and change only when the office approves it;
 *  - a new photo shows at once and goes to the office's document queue
 *    (docs.photo "pending"), as the web "My docs" already does.
 *
 * Nothing here reads or writes; the routes do. Pure, so the split and the
 * checks are tested once and used by the API, the office screen and tests.
 */

import type { StaffRecord } from "@/lib/foundationMasters";

export type ProfileFieldKind = "text" | "mobile" | "email" | "pincode" | "date" | "number" | "aadhaar" | "pan" | "ifsc" | "account" | "select";

export type ProfileField = {
  key: keyof StaffRecord & string;
  label: string;
  hindi: string;
  kind: ProfileFieldKind;
  group: "Contact" | "Personal" | "Qualification" | "Identity" | "Bank" | "Statutory";
  /** true = needs the office's approval */
  approval: boolean;
  options?: string[];
  /** Show only the last digits outside the office (Aadhaar, bank account). */
  masked?: boolean;
};

export const STAFF_PROFILE_FIELDS: ProfileField[] = [
  // Save at once
  { key: "altMobile", label: "Alternate mobile", hindi: "दूसरा मोबाइल", kind: "mobile", group: "Contact", approval: false },
  { key: "email", label: "Email", hindi: "ईमेल", kind: "email", group: "Contact", approval: false },
  { key: "addressCurrent", label: "Current address", hindi: "वर्तमान पता", kind: "text", group: "Contact", approval: false },
  { key: "addressPermanent", label: "Permanent address", hindi: "स्थायी पता", kind: "text", group: "Contact", approval: false },
  { key: "city", label: "City / village", hindi: "शहर / गाँव", kind: "text", group: "Contact", approval: false },
  { key: "state", label: "State", hindi: "राज्य", kind: "text", group: "Contact", approval: false },
  { key: "pincode", label: "PIN code", hindi: "पिन कोड", kind: "pincode", group: "Contact", approval: false },
  { key: "emergencyContactName", label: "Emergency contact name", hindi: "आपातकालीन संपर्क नाम", kind: "text", group: "Contact", approval: false },
  { key: "emergencyContactMobile", label: "Emergency contact mobile", hindi: "आपातकालीन संपर्क मोबाइल", kind: "mobile", group: "Contact", approval: false },
  { key: "emergencyRelation", label: "Relation", hindi: "संबंध", kind: "text", group: "Contact", approval: false },
  { key: "fatherName", label: "Father's name", hindi: "पिता का नाम", kind: "text", group: "Personal", approval: false },
  { key: "spouseName", label: "Spouse's name", hindi: "पति/पत्नी का नाम", kind: "text", group: "Personal", approval: false },
  { key: "bloodGroup", label: "Blood group", hindi: "ब्लड ग्रुप", kind: "select", group: "Personal", approval: false, options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
  { key: "maritalStatus", label: "Marital status", hindi: "वैवाहिक स्थिति", kind: "select", group: "Personal", approval: false, options: ["single", "married", "widowed", "other"] },
  { key: "qualification", label: "Qualification", hindi: "योग्यता", kind: "text", group: "Qualification", approval: false },
  { key: "experienceYears", label: "Experience (years)", hindi: "अनुभव (वर्ष)", kind: "number", group: "Qualification", approval: false },
  { key: "experienceDetail", label: "Experience detail", hindi: "अनुभव विवरण", kind: "text", group: "Qualification", approval: false },
  // Office approves
  { key: "fullName", label: "Full name", hindi: "पूरा नाम", kind: "text", group: "Identity", approval: true },
  { key: "mobile", label: "Registered mobile (login)", hindi: "पंजीकृत मोबाइल (लॉगिन)", kind: "mobile", group: "Identity", approval: true },
  { key: "dateOfBirth", label: "Date of birth", hindi: "जन्म तिथि", kind: "date", group: "Identity", approval: true },
  { key: "gender", label: "Gender", hindi: "लिंग", kind: "select", group: "Identity", approval: true, options: ["M", "F", "O"] },
  { key: "aadhaarNo", label: "Aadhaar number", hindi: "आधार संख्या", kind: "aadhaar", group: "Identity", approval: true, masked: true },
  { key: "panNo", label: "PAN", hindi: "पैन", kind: "pan", group: "Identity", approval: true },
  { key: "bankName", label: "Bank name", hindi: "बैंक का नाम", kind: "text", group: "Bank", approval: true },
  { key: "bankBranch", label: "Bank branch", hindi: "बैंक शाखा", kind: "text", group: "Bank", approval: true },
  { key: "bankAccountName", label: "Account holder name", hindi: "खाताधारक का नाम", kind: "text", group: "Bank", approval: true },
  { key: "bankAccountNo", label: "Account number", hindi: "खाता संख्या", kind: "account", group: "Bank", approval: true, masked: true },
  { key: "bankIfsc", label: "IFSC", hindi: "आईएफएससी", kind: "ifsc", group: "Bank", approval: true },
  { key: "upiId", label: "UPI ID", hindi: "यूपीआई आईडी", kind: "text", group: "Bank", approval: true },
  { key: "uanNumber", label: "UAN", hindi: "यूएएन", kind: "number", group: "Statutory", approval: true },
  { key: "pfNumber", label: "PF number", hindi: "पीएफ नंबर", kind: "text", group: "Statutory", approval: true },
  { key: "esicNumber", label: "ESIC number", hindi: "ईएसआईसी नंबर", kind: "text", group: "Statutory", approval: true },
];

export const PROFILE_FIELD = new Map(STAFF_PROFILE_FIELDS.map((f) => [f.key, f]));

/** "XXXX XXXX 1234" — never the whole number outside the office. */
export function maskTail(value: string, keep = 4): string {
  const v = String(value ?? "").replace(/\s/g, "");
  if (!v) return "";
  if (v.length <= keep) return v;
  return `${"•".repeat(Math.min(8, v.length - keep))}${v.slice(-keep)}`;
}

/** Clean and check one value; the error is shown to the person who typed it. */
export function checkProfileValue(f: ProfileField, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? "").trim();
  if (v.length > 300) return { ok: false, error: `${f.label} is too long` };
  if (!v) {
    // Clearing is allowed for optional contact/personal fields, never for identity.
    return f.approval && ["fullName", "mobile"].includes(f.key) ? { ok: false, error: `${f.label} cannot be empty` } : { ok: true, value: "" };
  }
  switch (f.kind) {
    case "mobile": {
      const d = v.replace(/\D/g, "");
      const m = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
      return /^[6-9]\d{9}$/.test(m) ? { ok: true, value: m } : { ok: false, error: `${f.label}: enter a 10-digit mobile number` };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { ok: true, value: v.toLowerCase() } : { ok: false, error: "Enter a valid email" };
    case "pincode":
      return /^\d{6}$/.test(v) ? { ok: true, value: v } : { ok: false, error: "PIN code is 6 digits" };
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true, value: v } : { ok: false, error: `${f.label}: use the date picker` };
    case "number":
      return /^\d{1,20}$/.test(v.replace(/\s/g, "")) ? { ok: true, value: v.replace(/\s/g, "") } : { ok: false, error: `${f.label}: digits only` };
    case "aadhaar": {
      const d = v.replace(/\D/g, "");
      return /^[2-9]\d{11}$/.test(d) ? { ok: true, value: d } : { ok: false, error: "Aadhaar is 12 digits" };
    }
    case "pan": {
      const p = v.toUpperCase().replace(/\s/g, "");
      return /^[A-Z]{5}\d{4}[A-Z]$/.test(p) ? { ok: true, value: p } : { ok: false, error: "PAN looks like ABCDE1234F" };
    }
    case "ifsc": {
      const p = v.toUpperCase().replace(/\s/g, "");
      return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(p) ? { ok: true, value: p } : { ok: false, error: "IFSC looks like SBIN0001234" };
    }
    case "account": {
      const d = v.replace(/\s/g, "");
      return /^\d{6,20}$/.test(d) ? { ok: true, value: d } : { ok: false, error: "Account number: 6–20 digits" };
    }
    case "select":
      return !f.options || f.options.includes(v) ? { ok: true, value: v } : { ok: false, error: `${f.label}: choose from the list` };
    default:
      return { ok: true, value: v.replace(/\s+/g, " ") };
  }
}

/**
 * Split a submitted set of changes: what to save now, what to send to the
 * office, unknown fields and errors. A value equal to the current one is
 * dropped (no request for "no change").
 */
export function splitProfileChanges(
  current: Partial<Record<string, unknown>>,
  submitted: Record<string, unknown>,
): {
  direct: Record<string, string>;
  approval: Record<string, { from: string; to: string }>;
  errors: string[];
} {
  const direct: Record<string, string> = {};
  const approval: Record<string, { from: string; to: string }> = {};
  const errors: string[] = [];
  for (const [key, raw] of Object.entries(submitted ?? {})) {
    const f = PROFILE_FIELD.get(key as ProfileField["key"]);
    if (!f) {
      errors.push(`${key} cannot be changed from the app`);
      continue;
    }
    const c = checkProfileValue(f, raw);
    if (!c.ok) {
      errors.push(c.error);
      continue;
    }
    const was = String(current[key] ?? "").trim();
    if (c.value === was) continue;
    if (f.approval) approval[key] = { from: was, to: c.value };
    else direct[key] = c.value;
  }
  return { direct, approval, errors };
}

/** What the staff member sees of their own record: masked where it must be. */
export function ownProfileView(s: StaffRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of STAFF_PROFILE_FIELDS) {
    const v = String((s as unknown as Record<string, unknown>)[f.key] ?? "");
    out[f.key] = f.masked ? maskTail(v) : v;
  }
  return out;
}

/* ─── change requests (office approves) ─────────────────────────────── */

export const STAFF_PROFILE_REQUESTS_KEY = "staff_profile_requests";

export type StaffProfileRequest = {
  id: string;
  staffId: string;
  staffName: string;
  fields: Record<string, { from: string; to: string }>;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  createdAt: string;
  decidedAt: string;
  decidedBy: string;
  note: string;
};

export type StaffProfileRequestsState = { version: 1; requests: StaffProfileRequest[] };

export function normalizeProfileRequests(raw: unknown): StaffProfileRequestsState {
  const r = raw && typeof raw === "object" ? (raw as Partial<StaffProfileRequestsState>) : {};
  const list = Array.isArray(r.requests) ? r.requests : [];
  return {
    version: 1,
    requests: list
      .filter((x): x is StaffProfileRequest => !!x && typeof x === "object" && typeof (x as StaffProfileRequest).id === "string")
      .map((x) => ({
        id: x.id,
        staffId: String(x.staffId || ""),
        staffName: String(x.staffName || ""),
        fields: x.fields && typeof x.fields === "object" ? x.fields : {},
        status: (["pending", "approved", "rejected", "withdrawn"] as const).includes(x.status) ? x.status : "pending",
        createdAt: String(x.createdAt || ""),
        decidedAt: String(x.decidedAt || ""),
        decidedBy: String(x.decidedBy || ""),
        note: String(x.note || ""),
      })),
  };
}

/**
 * A staff member's new request. One open request per person: a second
 * submission folds into the pending one (latest value per field wins), so
 * the office reviews one card, not five.
 */
export function addProfileRequest(
  state: StaffProfileRequestsState,
  input: { staffId: string; staffName: string; fields: Record<string, { from: string; to: string }>; now: string; id: string },
): StaffProfileRequestsState {
  const requests = [...state.requests];
  const i = requests.findIndex((r) => r.staffId === input.staffId && r.status === "pending");
  if (i >= 0) {
    const prev = requests[i]!;
    const fields = { ...prev.fields };
    for (const [k, v] of Object.entries(input.fields)) fields[k] = { from: prev.fields[k]?.from ?? v.from, to: v.to };
    requests[i] = { ...prev, fields, createdAt: input.now };
  } else {
    requests.unshift({ id: input.id, staffId: input.staffId, staffName: input.staffName, fields: input.fields, status: "pending", createdAt: input.now, decidedAt: "", decidedBy: "", note: "" });
  }
  // Keep the open ones and the last 200 decided.
  const open = requests.filter((r) => r.status === "pending");
  const done = requests.filter((r) => r.status !== "pending").slice(0, 200);
  return { version: 1, requests: [...open, ...done] };
}

/** The request as the staff member or the office sees it — masked "from"/"to" for masked fields outside the office. */
export function requestForStaff(r: StaffProfileRequest): StaffProfileRequest {
  const fields: StaffProfileRequest["fields"] = {};
  for (const [k, v] of Object.entries(r.fields)) {
    const f = PROFILE_FIELD.get(k as ProfileField["key"]);
    fields[k] = f?.masked ? { from: maskTail(v.from), to: maskTail(v.to) } : v;
  }
  return { ...r, fields };
}

/**
 * What leadership sees of a colleague (the app's Staff list → a person,
 * request mr_mv9yf8qf6y0j): contact, personal and qualification fields only.
 * Identity numbers, bank and statutory fields stay with the office and the
 * person themselves — never on a principal's phone.
 */
export const COLLEAGUE_VIEW_GROUPS: ProfileField["group"][] = ["Contact", "Personal", "Qualification"];

export function colleagueProfileView(
  s: StaffRecord,
): { key: string; label: string; hindi: string; group: ProfileField["group"]; value: string }[] {
  const out: { key: string; label: string; hindi: string; group: ProfileField["group"]; value: string }[] = [];
  for (const f of STAFF_PROFILE_FIELDS) {
    if (!COLLEAGUE_VIEW_GROUPS.includes(f.group) || f.masked) continue;
    const value = String((s as unknown as Record<string, unknown>)[f.key] ?? "").trim();
    if (!value) continue;
    out.push({ key: f.key, label: f.label, hindi: f.hindi, group: f.group, value });
  }
  return out;
}
