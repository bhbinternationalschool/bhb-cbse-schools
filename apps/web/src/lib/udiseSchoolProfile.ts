/**
 * UDISE+ School Profile ↔ ERP — the school-level half of the two-way sync.
 *
 * The UDISE+ School Profile module (profile.udiseplus.gov.in, studied
 * read-only on 7 Oct 2026) is eight tabbed sections. Its data API carries an
 * Authorization header built from an ENCRYPTED localStorage token, so the
 * Office Robot never calls it: a person opens a section and the robot reads
 * the DOM of that form (formcontrolname, label, value) and sends a snapshot
 * here. For AY 2026-27 only Section 1A was "Completed"; the other seven said
 * "Needs Updation" and were pre-filled with last year's answers (last
 * modified 31/07/2025). Keeping each year's capture is what lets next year's
 * empty boxes be offered last year's answer — labelled as such, never as fact.
 *
 * Unknown must not become fact:
 *  - an ERP fact is used only when the ERP really holds it (the stored
 *    Masters slice, not a code default — defaultSchoolProfile() carries TENANT
 *    constants and a guessed pincode that would read as "the ERP says");
 *  - a fill plan only ever targets a box the captured snapshot shows EMPTY;
 *  - a last-year answer is offered as "last year's answer — check".
 *
 * A finding behind the compare: 1A item 1.21 "Respondent Details" showed the
 * email brcharhua@gmail.com and a mobile that look like the Block Resource
 * Centre's, not the school's. respondentWarnings() flags any respondent
 * contact that is not one of the school's own (ERP Masters → School profile).
 *
 * Stored in module_local_state under "udise_school_profile" (server truth,
 * written only by /api/v1/udise/robot/school-profile).
 */

export const UDISE_SCHOOL_PROFILE_KEY = "udise_school_profile" as const;

export type ProfileFieldType = "text" | "number" | "date" | "textarea" | "select" | "radio" | "checkbox" | "custom";

export type ProfileField = {
  /** The question text as the portal prints it, with the nearest serial heading. */
  label: string;
  /** DCF serial such as "2.3" or "1.58.4"; "" when the page shows none. */
  serial: string;
  type: ProfileFieldType;
  /** Raw value: select/radio option value, "true"/"false" for a checkbox. */
  value: string;
  /** What a person sees: the chosen option's text; "" for plain boxes. */
  text: string;
  /** The box was disabled / read-only on the portal (1A is maintained by the Block). */
  locked?: boolean;
};

export type SectionCapture = {
  title: string;
  capturedAt: string;
  capturedBy: string;
  fields: Record<string, ProfileField>;
  /** Form status the portal printed ("Completed", "Needs Updation"), "" if unseen. */
  formStatus: string;
  /** The section's visible text, capped — some 1A items render as text, not boxes. */
  text: string;
};

/** {[academicYear]: {[sectionKey]: capture}} — earlier years are kept on purpose. */
export type SchoolProfileStore = Record<string, Record<string, SectionCapture>>;

export type ProfileSectionDef = { key: string; tab: string; title: string; maintainedElsewhere?: boolean };

/** The eight tabs, as labelled on 7 Oct 2026. key = the tab's serial range. */
export const UDISE_PROFILE_SECTIONS: ProfileSectionDef[] = [
  { key: "1.1-1.30", tab: "1.1 to 1.30", title: "Section 1A · Basic School Profile", maintainedElsewhere: true },
  { key: "1.31-1.39", tab: "1.31 to 1.39", title: "School Others Details" },
  { key: "1.58.1-1.58.20", tab: "1.58.1 to 1.58.20", title: "Section 1B · School Safety and Other Parameters" },
  { key: "1.59-1.62", tab: "1.59 to 1.62", title: "Section 1(c) · Receipts and Expenditure" },
  { key: "2.1-2.6", tab: "2.1 to 2.6", title: "Physical Facilities" },
  { key: "2.7-2.19", tab: "2.7 to 2.19", title: "Toilet and Other Facilities" },
  { key: "2.20-2.23", tab: "2.20 to 2.23", title: "Physical Facilities and Equipments" },
  { key: "2.24-2.28", tab: "2.24 to 2.28", title: "Computers and Digital Initiatives" },
];
export const SECTION_1A_KEY = "1.1-1.30";

const SERIAL = String.raw`\d+(?:\.\d+)*`;

/** "1.58.1 to 1.58.20" / "1.58.1-1.58.20" → "1.58.1-1.58.20"; "" when no range. */
export function sectionKeyFromLabel(label: string): string {
  const m = String(label || "").match(new RegExp(`(${SERIAL})\\s*(?:to|-|–)\\s*(${SERIAL})`, "i"));
  return m ? `${m[1]}-${m[2]}` : "";
}

export function sectionTitle(key: string): string {
  return UDISE_PROFILE_SECTIONS.find((s) => s.key === key)?.title || key;
}

/** "2026-27" / "2026-2027" → "2026-27"; "" unless the two years are consecutive. */
export function normalizeAcademicYear(raw: unknown): string {
  const m = String(raw ?? "").trim().match(/^(20\d\d)\s*[-–/]\s*(\d{2}|20\d\d)$/);
  if (!m) return "";
  const a = Number(m[1]);
  const b = m[2]!.length === 2 ? Math.floor(a / 100) * 100 + Number(m[2]) : Number(m[2]);
  return b === a + 1 ? `${a}-${String(b).slice(2)}` : "";
}

/**
 * The session a date falls in (April–March, as UDISE+ counts it). Only a
 * fallback: the robot sends the year the portal shows.
 */
export function academicYearForDate(d: Date): string {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/** Earlier-year order: "2025-26" < "2026-27". */
const yearStart = (ay: string) => Number(ay.slice(0, 4)) || 0;

// ─── Normalising what the extension sends ──────────────────────────────

const TYPES = new Set<ProfileFieldType>(["text", "number", "date", "textarea", "select", "radio", "checkbox", "custom"]);
const MAX_FIELDS = 600;
const MAX_TEXT = 30_000;
const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function normalizeProfileField(raw: unknown): ProfileField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = TYPES.has(r.type as ProfileFieldType) ? (r.type as ProfileFieldType) : "text";
  const field: ProfileField = {
    label: str(r.label, 400),
    serial: (str(r.serial, 20).match(new RegExp(`^${SERIAL}$`)) || [""])[0]!,
    type,
    value: str(r.value, 1000),
    text: str(r.text, 400),
  };
  if (r.locked === true) field.locked = true;
  return field;
}

export function normalizeFields(raw: unknown): Record<string, ProfileField> {
  const out: Record<string, ProfileField> = {};
  if (!raw || typeof raw !== "object") return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = str(k, 120);
    if (!key || n >= MAX_FIELDS) continue;
    const f = normalizeProfileField(v);
    if (!f) continue;
    out[key] = f;
    n++;
  }
  return out;
}

export function normalizeCapture(raw: unknown): SectionCapture | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const capturedAt = str(r.capturedAt, 40);
  if (!capturedAt) return null;
  return {
    title: str(r.title, 200),
    capturedAt,
    capturedBy: str(r.capturedBy, 120),
    fields: normalizeFields(r.fields),
    formStatus: str(r.formStatus, 60),
    text: String(r.text ?? "").slice(0, MAX_TEXT),
  };
}

export function normalizeProfileStore(raw: unknown): SchoolProfileStore {
  const out: SchoolProfileStore = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [ay, sections] of Object.entries(raw as Record<string, unknown>)) {
    const year = normalizeAcademicYear(ay);
    if (!year || !sections || typeof sections !== "object") continue;
    for (const [key, cap] of Object.entries(sections as Record<string, unknown>)) {
      const c = normalizeCapture(cap);
      if (!c || !sectionKeyFromLabel(key)) continue;
      (out[year] ??= {})[key] = c;
    }
  }
  return out;
}

/** A new snapshot replaces only that year's section; every other capture stays. */
export function withCapture(store: SchoolProfileStore, ay: string, key: string, capture: SectionCapture): SchoolProfileStore {
  return { ...store, [ay]: { ...(store[ay] ?? {}), [key]: capture } };
}

// ─── Emptiness ─────────────────────────────────────────────────────────

/**
 * Is this box unanswered on the portal? A number box holding "0" IS an answer
 * (no ramps, no computers). An unticked checkbox is never "empty" — it may
 * mean "no" — and a select is empty only on its placeholder option.
 */
export function isEmptyField(f: ProfileField): boolean {
  const v = f.value.trim();
  if (f.type === "checkbox") return false;
  if (f.type === "select") {
    if (!v || v === "null" || v === "undefined") return true;
    return (v === "0" || v === "-1") && /select|--|choose/i.test(f.text || "");
  }
  if (f.type === "custom") return !v && !f.text.trim();
  return !v;
}

// ─── What the ERP truly knows ──────────────────────────────────────────

export type ErpSchoolFacts = {
  schoolName?: string;
  address?: string;
  pincode?: string;
  phone?: string;
  mobile?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  udiseCode?: string;
  principalName?: string;
  lowestClass?: string;
  highestClass?: string;
  sessionStart?: string;
  sessionEnd?: string;
  /** Only from the office's confirmed "medium English for every child" answer. */
  medium?: string;
};

/** A placeholder ("213XXXX") is not a fact. */
function real(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return !s || /X{3,}/i.test(s) ? "" : s;
}

type RawClass = { name?: unknown; sortOrder?: unknown; isActive?: unknown };
type RawYear = { code?: unknown; startsOn?: unknown; endsOn?: unknown };

/**
 * Facts from the STORED Masters slices (raw payloads, not normalised: the
 * normaliser fills blanks with code defaults). Any argument may be undefined
 * when that slice was never saved — its facts are then simply absent.
 */
export function erpSchoolFacts(input: {
  profile?: unknown;
  classes?: unknown;
  academicYears?: unknown;
  academicYear: string;
  principalName?: string;
  mediumEnglishConfirmed?: boolean;
}): ErpSchoolFacts {
  const p = (input.profile && typeof input.profile === "object" ? input.profile : {}) as Record<string, unknown>;
  const f: ErpSchoolFacts = {};
  const put = <K extends keyof ErpSchoolFacts>(k: K, v: string) => {
    if (v) f[k] = v;
  };
  put("schoolName", real(p.legalName) || real(p.displayName));
  // The live profile's address already ends "…, Varanasi, Uttar Pradesh 221202"
  // (checked 7 Oct 2026); the city is added only when the address lacks it.
  const addr = real(p.address);
  const city = real(p.city);
  put("address", city && !addr.toLowerCase().includes(city.toLowerCase()) ? [addr, city].filter(Boolean).join(", ") : addr);
  put("pincode", real(p.pincode).replace(/\D/g, "").length === 6 ? real(p.pincode).replace(/\D/g, "") : "");
  put("phone", real(p.phone));
  put("mobile", real(p.mobile));
  put("whatsapp", real(p.whatsapp));
  put("email", real(p.email).toLowerCase());
  put("website", real(p.website));
  put("udiseCode", real(p.udiseCode));
  put("principalName", real(input.principalName));
  const classes = (Array.isArray(input.classes) ? (input.classes as RawClass[]) : [])
    .filter((c) => c && c.isActive !== false && real(c.name))
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  if (classes.length) {
    put("lowestClass", real(classes[0]!.name));
    put("highestClass", real(classes[classes.length - 1]!.name));
  }
  const year = (Array.isArray(input.academicYears) ? (input.academicYears as RawYear[]) : []).find(
    (y) => y && normalizeAcademicYear(y.code) === input.academicYear,
  );
  if (year) {
    put("sessionStart", real(year.startsOn));
    put("sessionEnd", real(year.endsOn));
  }
  if (input.mediumEnglishConfirmed) f.medium = "English";
  return f;
}

// ─── Label rules: which portal question is which ERP fact ──────────────

/** Contact questions about someone other than the school — never filled from the school's own details. */
const NOT_THE_SCHOOL = /respondent|brc|crc|block|cluster|district|nodal|smc|sdmc|parent|teacher'?s|bank|ifsc/i;
/** The head's own phone / email is theirs, not the school's. */
const HEAD = /head|principal|\bhm\b|in-?charge/i;

type Rule = { fact: keyof ErpSchoolFacts; label: string; test: (l: string) => boolean; fill: boolean };

const RULES: Rule[] = [
  { fact: "schoolName", label: "School name", test: (l) => /school\s*name|name\s*of\s*(the\s*)?school/i.test(l), fill: true },
  { fact: "pincode", label: "Pincode", test: (l) => /pin\s*code/i.test(l), fill: true },
  { fact: "address", label: "Address", test: (l) => /address/i.test(l) && !/e-?mail|web|pin/i.test(l), fill: true },
  { fact: "email", label: "School email", test: (l) => /e-?mail/i.test(l) && !HEAD.test(l), fill: true },
  { fact: "website", label: "Website", test: (l) => /web\s*site|url/i.test(l), fill: true },
  {
    fact: "phone",
    label: "Landline",
    test: (l) => /landline|std\s*code|telephone|phone/i.test(l) && !/mobile/i.test(l) && !HEAD.test(l),
    fill: true,
  },
  // A bare "Mobile" could be the head's own number; only a box that says it
  // is the school's is the school's.
  { fact: "mobile", label: "School mobile", test: (l) => /mobile/i.test(l) && /school/i.test(l), fill: true },
  {
    fact: "principalName",
    label: "Head / principal name",
    test: (l) =>
      /(head\s*-?\s*master|head\s*teacher|principal|\bhm\b|in-?charge).*name|name\s*of\s*(the\s*)?(head|principal|hm)/i.test(l),
    fill: true,
  },
  { fact: "udiseCode", label: "UDISE code", test: (l) => /udise\s*(\+\s*)?code/i.test(l), fill: false },
  { fact: "lowestClass", label: "Lowest class", test: (l) => /lowest\s*class|class\s*from/i.test(l), fill: false },
  { fact: "highestClass", label: "Highest class", test: (l) => /highest\s*class|class\s*to\b/i.test(l), fill: false },
  { fact: "medium", label: "Medium of instruction", test: (l) => /medium/i.test(l), fill: false },
  { fact: "sessionStart", label: "Session start", test: (l) => /session|academic\s*year/i.test(l) && /start|commenc|begin/i.test(l), fill: false },
  { fact: "sessionEnd", label: "Session end", test: (l) => /session|academic\s*year/i.test(l) && /end/i.test(l), fill: false },
];

function ruleFor(label: string): Rule | undefined {
  if (NOT_THE_SCHOOL.test(label)) return undefined;
  return RULES.find((r) => r.test(label));
}

// ─── Fill plan ─────────────────────────────────────────────────────────

export type ProfileFillField = {
  control: string;
  label: string;
  kind: ProfileFieldType;
  value: string;
  /** Option text for a select/radio — the robot falls back to it when the value is not on the page. */
  text: string;
  source: "erp" | "last-year";
  note: string;
};

export type ProfileFillPlan = {
  section: string;
  academicYear: string;
  /** The current-year capture the plan was built against ("" when none — send the section first). */
  basedOn: string;
  earlierYear: string;
  fields: ProfileFillField[];
  /** Empty boxes nobody can answer from the ERP or last year. */
  leftForYou: string[];
};

/** The text a plain box gets from an ERP fact: a phone/pincode box wants digits. */
function factForBox(fact: keyof ErpSchoolFacts, value: string, f: ProfileField): string {
  if (fact === "pincode" || ((fact === "phone" || fact === "mobile") && f.type === "number")) return value.replace(/\D/g, "");
  if (fact === "mobile") return value.replace(/\D/g, "").slice(-10);
  return value;
}

export function buildProfileFillPlan(
  store: SchoolProfileStore,
  academicYear: string,
  section: string,
  facts: ErpSchoolFacts,
  /** Section-specific ERP figures (1(c): the office's confirmed annual figures, lib/udiseSchoolFinance). */
  extraRules: { label: string; value: string; test: (label: string) => boolean }[] = [],
): ProfileFillPlan {
  const current = store[academicYear]?.[section];
  const earlierYear =
    Object.keys(store)
      .filter((y) => yearStart(y) < yearStart(academicYear) && store[y]?.[section])
      .sort((a, b) => yearStart(b) - yearStart(a))[0] ?? "";
  const plan: ProfileFillPlan = {
    section,
    academicYear,
    basedOn: current?.capturedAt ?? "",
    earlierYear,
    fields: [],
    leftForYou: [],
  };
  if (!current) return plan;
  const prev = earlierYear ? store[earlierYear]![section]!.fields : {};
  for (const [control, f] of Object.entries(current.fields)) {
    if (f.locked || !isEmptyField(f)) continue;
    const extra = f.type === "text" || f.type === "textarea" || f.type === "number" ? extraRules.find((r) => r.test(f.label)) : undefined;
    if (extra) {
      plan.fields.push({
        control,
        label: f.label,
        kind: f.type,
        value: f.type === "number" ? extra.value.replace(/[^\d.]/g, "") : extra.value,
        text: "",
        source: "erp",
        note: `ERP (${extra.label}) — check`,
      });
      continue;
    }
    const rule = ruleFor(f.label);
    const factValue = rule?.fill ? facts[rule.fact] : undefined;
    // An ERP fact goes only into a plain box: a select's codes are the
    // portal's, and guessing which option "English" is would invent one.
    if (factValue && (f.type === "text" || f.type === "textarea" || f.type === "number")) {
      plan.fields.push({
        control,
        label: f.label,
        kind: f.type,
        value: factForBox(rule!.fact, factValue, f),
        text: "",
        source: "erp",
        note: `ERP (Masters → School profile): ${rule!.label}`,
      });
      continue;
    }
    const old = prev[control];
    if (old && old.type === f.type && !isEmptyField(old) && f.type !== "checkbox" && f.type !== "custom") {
      plan.fields.push({
        control,
        label: f.label,
        kind: f.type,
        value: old.value,
        text: old.text,
        source: "last-year",
        note: `last year's answer (${earlierYear}) — check`,
      });
      continue;
    }
    plan.leftForYou.push(f.label || control);
  }
  return plan;
}

// ─── 1A vs ERP ─────────────────────────────────────────────────────────

export type ProfileDiffStatus = "same" | "differs" | "erp-unknown" | "portal-unknown";
export type ProfileDiff = { item: string; portal: string; erp: string; status: ProfileDiffStatus };

const COMPARE: { item: string; fact: keyof ErpSchoolFacts | null; test: (l: string) => boolean; kind: "name" | "phone" | "email" | "pin" | "text" }[] = [
  { item: "School name", fact: "schoolName", test: (l) => /school\s*name|name\s*of\s*(the\s*)?school/i.test(l), kind: "name" },
  { item: "Address", fact: "address", test: (l) => /address/i.test(l) && !/e-?mail|web|pin/i.test(l), kind: "text" },
  { item: "Pincode", fact: "pincode", test: (l) => /pin\s*code/i.test(l), kind: "pin" },
  { item: "Landline", fact: "phone", test: (l) => /landline|std\s*code|telephone|phone/i.test(l) && !/mobile/i.test(l) && !HEAD.test(l), kind: "phone" },
  { item: "School mobile", fact: "mobile", test: (l) => /mobile/i.test(l) && !HEAD.test(l), kind: "phone" },
  { item: "School email", fact: "email", test: (l) => /e-?mail/i.test(l) && !HEAD.test(l), kind: "email" },
  {
    item: "Head / principal name",
    fact: "principalName",
    test: (l) =>
      /(head\s*-?\s*master|head\s*teacher|principal|\bhm\b|in-?charge).*name|name\s*of\s*(the\s*)?(head|principal|hm)/i.test(l),
    kind: "name",
  },
  { item: "Management", fact: null, test: (l) => /management/i.test(l), kind: "text" },
  { item: "School category", fact: null, test: (l) => /category/i.test(l) && !/social/i.test(l), kind: "text" },
  { item: "Lowest class", fact: "lowestClass", test: (l) => /lowest\s*class|class\s*from/i.test(l), kind: "text" },
  { item: "Highest class", fact: "highestClass", test: (l) => /highest\s*class|class\s*to\b/i.test(l), kind: "text" },
  { item: "Medium of instruction", fact: "medium", test: (l) => /medium/i.test(l), kind: "text" },
  { item: "Session start", fact: "sessionStart", test: (l) => /session|academic\s*year/i.test(l) && /start|commenc|begin/i.test(l), kind: "text" },
  { item: "Session end", fact: "sessionEnd", test: (l) => /session|academic\s*year/i.test(l) && /end/i.test(l), kind: "text" },
];

const shown = (f: ProfileField) => (f.text || f.value).trim();
const digits = (s: string) => s.replace(/\D/g, "");
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function sameValue(kind: string, a: string, b: string): boolean {
  if (kind === "phone") {
    const x = digits(a);
    const y = digits(b);
    return !!x && !!y && x.slice(-10) === y.slice(-10);
  }
  if (kind === "pin") return digits(a) === digits(b);
  if (kind === "email") return a.trim().toLowerCase() === b.trim().toLowerCase();
  // Names and classes: the portal prints CAPITALS and abbreviations; compare
  // on letters and digits only. Medium "19-English" vs "English" matches too.
  const x = words(a);
  const y = words(b);
  return !!x && !!y && (x === y || x.endsWith(` ${y}`) || x.replace(/^\d+\s*/, "") === y);
}

/** The 1A items the ERP can be checked against — one row per item found on the portal. */
export function compareProfile1A(capture: SectionCapture | undefined, facts: ErpSchoolFacts): ProfileDiff[] {
  if (!capture) return [];
  const out: ProfileDiff[] = [];
  const fields = Object.values(capture.fields).filter((f) => !NOT_THE_SCHOOL.test(f.label));
  for (const c of COMPARE) {
    const f = fields.find((x) => c.test(x.label));
    const erp = c.fact ? facts[c.fact] ?? "" : "";
    if (!f) continue;
    const portal = shown(f);
    let status: ProfileDiffStatus;
    if (!portal) status = "portal-unknown";
    else if (!erp) status = "erp-unknown";
    else status = sameValue(c.kind, portal, erp) ? "same" : "differs";
    out.push({ item: c.item, portal, erp, status });
  }
  return out;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MOBILE_RE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g;

/**
 * 1.21 Respondent Details — contacts that are not the school's own. The
 * respondent is meant to be the school; on 7 Oct 2026 it held the BRC's
 * Gmail, so every portal message about this school went to the Block.
 */
export function respondentWarnings(capture: SectionCapture | undefined, facts: ErpSchoolFacts): string[] {
  if (!capture) return [];
  const parts: string[] = [];
  for (const f of Object.values(capture.fields)) {
    if (/respondent/i.test(f.label) || f.serial === "1.21" || f.serial.startsWith("1.21.")) parts.push(shown(f));
  }
  // Some 1A items render as text, not boxes: read the block after the heading.
  const at = capture.text.search(/respondent/i);
  if (at >= 0) parts.push(capture.text.slice(at, at + 400).split(/\b1\.22\b/)[0]!);
  const blob = parts.join(" ");
  const emails = [...new Set((blob.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
  const mobiles = [...new Set((blob.match(MOBILE_RE) ?? []).map((m) => digits(m).slice(-10)))];
  const ours = new Set([facts.phone, facts.mobile, facts.whatsapp].filter(Boolean).map((p) => digits(p!).slice(-10)));
  const out: string[] = [];
  for (const e of emails) {
    const blockLike = /^(brc|crc|beo|abs?a|bsa|block)|brc|blockresource/i.test(e.split("@")[0]!);
    if (facts.email && e === facts.email) continue;
    out.push(
      `Respondent email ${e} is not the school's own${facts.email ? ` (ERP: ${facts.email})` : " — the ERP has no school email to compare"}` +
        (blockLike ? "; it looks like the Block Resource Centre's." : "."),
    );
  }
  for (const m of mobiles) {
    if (ours.has(m)) continue;
    out.push(
      `Respondent mobile ${m} is not one of the school's numbers in the ERP` +
        (ours.size ? ` (${[...ours].join(", ")}).` : " — the ERP has no school phone to compare."),
    );
  }
  return out;
}
