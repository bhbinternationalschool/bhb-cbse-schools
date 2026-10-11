/**
 * Custom fields on student and staff records (old SStudy ERP: Configuration
 * → Custom Field). Masters → Custom fields defines them; the student and
 * staff edit pages show the active ones under "More details"; the register
 * exports and the student import carry them as optional columns.
 *
 * Pure rules only — no storage. Tables: custom_field_defs and
 * custom_field_values (migration 20261011190000), server half in
 * customFields.server.ts.
 *
 * Two rules shape everything here:
 *
 * 1. A value is stored apart from the record, one row per (record, field),
 *    and written by compare-and-set on its own updated_at. Editing "House"
 *    can never rewrite a child's Aadhaar, and a tab opened yesterday cannot
 *    put back yesterday's answer over today's.
 *
 * 2. Dates are typed DD/MM/YYYY and stored ISO, and day-first is a RULE, not
 *    a guess. The student import once read "08/04/2020" by guessing and
 *    overwrote the day of 296 birth dates with their month
 *    (erp-dob-parser-corruption). parseCustomDate never guesses: two-digit
 *    years, month-first and impossible dates are refused, not repaired.
 */

export type CustomFieldEntity = "student" | "staff";
export type CustomFieldType = "text" | "number" | "date" | "choice" | "yes_no";

export const CUSTOM_FIELD_ENTITIES: { id: CustomFieldEntity; label: string }[] = [
  { id: "student", label: "Students" },
  { id: "staff", label: "Staff" },
];

export const CUSTOM_FIELD_TYPES: { id: CustomFieldType; label: string; hint: string }[] = [
  { id: "text", label: "Text", hint: "Any short answer" },
  { id: "number", label: "Number", hint: "Digits only, e.g. 42 or 3.5" },
  { id: "date", label: "Date", hint: "Typed DD/MM/YYYY" },
  { id: "choice", label: "Single choice", hint: "One answer from a list you set" },
  { id: "yes_no", label: "Yes / No", hint: "Yes or No" },
];

export const CUSTOM_LABEL_MAX = 60;
export const CUSTOM_OPTION_MAX = 50;
export const CUSTOM_OPTIONS_MAX = 50;
export const CUSTOM_TEXT_MAX = 500;

export type CustomFieldDef = {
  id: string;
  entityType: CustomFieldEntity;
  labelEn: string;
  labelHi: string;
  fieldType: CustomFieldType;
  options: string[];
  requiredOnNew: boolean;
  active: boolean;
  sortOrder: number;
  /** Server stamp — the version this copy was loaded at. */
  updatedAt: string;
  /** How many records hold a value (server-counted; -1 = not known). */
  valueCount: number;
};

/** One stored value with the stamp it was read at. */
export type CustomFieldValueRow = {
  entityId: string;
  fieldId: string;
  value: string;
  updatedAt: string;
};

export function isCustomFieldEntity(v: unknown): v is CustomFieldEntity {
  return v === "student" || v === "staff";
}

export function isCustomFieldType(v: unknown): v is CustomFieldType {
  return CUSTOM_FIELD_TYPES.some((t) => t.id === v);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** Label comparison key — the same rule as the DB's unique index. */
export const labelKey = (s: string) => squash(s).toLowerCase();

/** Active fields of one entity, in display order. */
export function activeDefsFor(defs: CustomFieldDef[], entity: CustomFieldEntity): CustomFieldDef[] {
  return defs
    .filter((d) => d.entityType === entity && d.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.labelEn.localeCompare(b.labelEn));
}

// ─── Dates ────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {};
[
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
].forEach((m, i) => {
  MONTHS[m] = i + 1;
  MONTHS[m.slice(0, 3)] = i + 1;
});
MONTHS.sept = 9;

function isoIfReal(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Typed or imported date → ISO `YYYY-MM-DD`, or null when it is not a date.
 * Accepted: DD/MM/YYYY (also - or . between), ISO YYYY-MM-DD, and
 * DD-Month-YYYY (what our own exports write). Day first, always.
 */
export function parseCustomDate(raw: string): string | null {
  const s = squash(raw ?? "");
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})$/.exec(s);
  if (m) return isoIfReal(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s\-/]+([A-Za-z]{3,9})\.?[\s\-/,]+(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    return month ? isoIfReal(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

/** ISO → DD/MM/YYYY for the form. Anything else is returned untouched. */
export function isoToDdMmYyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso ?? "";
}

/**
 * ISO → DD-Month-YYYY for exports: one reading in any country, and our own
 * import reads it back unchanged (same form as lib/dobFormat).
 */
export function isoToLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return iso ?? "";
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${m[3]}-${names[Number(m[2]) - 1]}-${m[1]}`;
}

// ─── Values ───────────────────────────────────────────────────────────

const YES = new Set(["yes", "y", "true", "1", "हाँ", "हां", "ha", "haan"]);
const NO = new Set(["no", "n", "false", "0", "नहीं", "nahi", "nahin"]);

export type NormalizeResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * What the office typed (or the import read) → the stored canonical form.
 * Blank is a valid answer ("" = not filled); everything else must fit the
 * field's type or it is refused with a reason — never coerced.
 */
export function normalizeCustomValue(def: Pick<CustomFieldDef, "fieldType" | "options" | "labelEn">, raw: string): NormalizeResult {
  const s = squash(String(raw ?? ""));
  if (!s) return { ok: true, value: "" };
  const name = def.labelEn || "This field";
  switch (def.fieldType) {
    case "text":
      return s.length > CUSTOM_TEXT_MAX
        ? { ok: false, error: `${name}: at most ${CUSTOM_TEXT_MAX} characters` }
        : { ok: true, value: s };
    case "number": {
      const t = s.replace(/,/g, "").replace(/\s/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, error: `${name}: "${s}" is not a number` };
      const n = Number(t);
      if (!Number.isFinite(n)) return { ok: false, error: `${name}: "${s}" is not a number` };
      return { ok: true, value: String(n) };
    }
    case "date": {
      const iso = parseCustomDate(s);
      return iso ? { ok: true, value: iso } : { ok: false, error: `${name}: "${s}" is not a date — type DD/MM/YYYY` };
    }
    case "choice": {
      const hit = def.options.find((o) => labelKey(o) === labelKey(s));
      return hit
        ? { ok: true, value: hit }
        : { ok: false, error: `${name}: "${s}" is not one of ${def.options.join(", ") || "(no options set)"}` };
    }
    case "yes_no": {
      const k = s.toLowerCase();
      if (YES.has(k)) return { ok: true, value: "yes" };
      if (NO.has(k)) return { ok: true, value: "no" };
      return { ok: false, error: `${name}: answer Yes or No` };
    }
  }
}

/** Stored value → what the screen shows in an input (dates DD/MM/YYYY). */
export function valueForInput(def: Pick<CustomFieldDef, "fieldType">, stored: string): string {
  return def.fieldType === "date" ? isoToDdMmYyyy(stored) : stored ?? "";
}

/** Stored value → export cell (dates DD-Month-YYYY, yes/no as words). */
export function valueForExport(def: Pick<CustomFieldDef, "fieldType">, stored: string): string {
  if (!stored) return "";
  if (def.fieldType === "date") return isoToLongDate(stored);
  if (def.fieldType === "yes_no") return stored === "yes" ? "Yes" : stored === "no" ? "No" : stored;
  return stored;
}

/** Active fields marked required-on-new that a new record leaves blank. */
export function missingRequiredOnNew(defs: CustomFieldDef[], values: Record<string, string>): CustomFieldDef[] {
  return defs.filter((d) => d.active && d.requiredOnNew && !squash(values[d.id] ?? ""));
}

// ─── Definitions ──────────────────────────────────────────────────────

export type CustomFieldDefInput = {
  entityType: CustomFieldEntity;
  labelEn: string;
  labelHi?: string;
  fieldType: CustomFieldType;
  options?: string[];
  requiredOnNew?: boolean;
  active?: boolean;
  sortOrder?: number;
};

export type CleanDefInput = Required<CustomFieldDefInput>;

/**
 * Check and tidy a field definition. `others` = the entity's other fields
 * (for label clashes); `current` = the stored copy when editing, so the
 * type cannot change under values already saved.
 */
export function validateDefInput(
  input: CustomFieldDefInput,
  others: Pick<CustomFieldDef, "id" | "entityType" | "labelEn" | "labelHi">[],
  current?: Pick<CustomFieldDef, "id" | "fieldType" | "valueCount" | "entityType"> | null,
  reservedLabels: (label: string) => boolean = () => false,
): { ok: true; def: CleanDefInput } | { ok: false; error: string } {
  if (!isCustomFieldEntity(input.entityType)) return { ok: false, error: "Choose Students or Staff" };
  if (!isCustomFieldType(input.fieldType)) return { ok: false, error: "Choose a field type" };
  const labelEn = squash(input.labelEn ?? "");
  const labelHi = squash(input.labelHi ?? "");
  if (!labelEn) return { ok: false, error: "Give the field a name" };
  if (labelEn.length > CUSTOM_LABEL_MAX || labelHi.length > CUSTOM_LABEL_MAX) {
    return { ok: false, error: `Names are at most ${CUSTOM_LABEL_MAX} characters` };
  }
  if (current && current.entityType !== input.entityType) {
    return { ok: false, error: "A field cannot move between students and staff — add a new one" };
  }
  const mine = new Set([labelKey(labelEn), labelHi ? labelKey(labelHi) : ""].filter(Boolean));
  const clash = others.find(
    (o) => o.entityType === input.entityType && o.id !== current?.id && (mine.has(labelKey(o.labelEn)) || (o.labelHi && mine.has(labelKey(o.labelHi)))),
  );
  if (clash) return { ok: false, error: `"${clash.labelEn}" already uses that name — the import matches columns by name` };
  if (reservedLabels(labelEn) || (labelHi && reservedLabels(labelHi))) {
    return { ok: false, error: `"${labelEn}" is already a built-in column of the register — pick another name` };
  }
  if (current && current.fieldType !== input.fieldType && current.valueCount !== 0) {
    return {
      ok: false,
      error:
        current.valueCount > 0
          ? `${current.valueCount} record(s) already hold a value, so the type cannot change. Add a new field instead.`
          : "Could not check whether records hold a value, so the type cannot change just now.",
    };
  }
  let options: string[] = [];
  if (input.fieldType === "choice") {
    const seen = new Set<string>();
    for (const o of input.options ?? []) {
      const t = squash(String(o ?? ""));
      if (!t || seen.has(labelKey(t))) continue;
      if (t.length > CUSTOM_OPTION_MAX) return { ok: false, error: `Each choice is at most ${CUSTOM_OPTION_MAX} characters` };
      seen.add(labelKey(t));
      options.push(t);
    }
    if (!options.length) return { ok: false, error: "A single-choice field needs at least one choice" };
    if (options.length > CUSTOM_OPTIONS_MAX) return { ok: false, error: `At most ${CUSTOM_OPTIONS_MAX} choices` };
  } else {
    options = [];
  }
  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.max(0, Math.min(9999, Math.round(Number(input.sortOrder)))) : 0;
  return {
    ok: true,
    def: {
      entityType: input.entityType,
      labelEn,
      labelHi,
      fieldType: input.fieldType,
      options,
      requiredOnNew: Boolean(input.requiredOnNew),
      active: input.active !== false,
      sortOrder,
    },
  };
}

// ─── Reading values across a child's yearly rows ──────────────────────

/**
 * SIS keeps one row per child per academic year and promotion mints a new
 * id (erp-stale-academic-year-rows), so "House: Red" saved on last year's
 * row must still show this year. The rows of one child = same admission
 * number AND same name (an admission number typed twice is an office error;
 * merging those two children would hide one). The given row comes first.
 */
export function studentAliasIds(
  students: { id: string; admissionNo?: string; fullName?: string }[],
  student: { id: string; admissionNo?: string; fullName?: string },
): string[] {
  const adm = squash(student.admissionNo ?? "").toUpperCase();
  const name = labelKey(student.fullName ?? "");
  const out = [student.id];
  if (!adm || !name) return out;
  for (const s of students) {
    if (s.id === student.id) continue;
    if (squash(s.admissionNo ?? "").toUpperCase() === adm && labelKey(s.fullName ?? "") === name) out.push(s.id);
  }
  return out;
}

export type ResolvedValue = {
  value: string;
  /** The row the value was read from. */
  fromEntityId: string;
  /** Stamp of THIS record's own row ("" = none yet → a save inserts). */
  ownStamp: string;
};

/**
 * Per field: this record's own value when it has a row (even a blank one —
 * a blank the office saved is an answer); otherwise the newest non-blank
 * value from the child's other yearly rows, shown but not yet owned.
 */
export function resolveEntityValues(rows: CustomFieldValueRow[], ids: string[]): Map<string, ResolvedValue> {
  const primary = ids[0] ?? "";
  const aliases = new Set(ids.slice(1));
  const out = new Map<string, ResolvedValue>();
  const own = rows.filter((r) => r.entityId === primary);
  for (const r of own) out.set(r.fieldId, { value: r.value, fromEntityId: primary, ownStamp: r.updatedAt });
  const inherited = rows
    .filter((r) => aliases.has(r.entityId) && r.value)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const r of inherited) {
    if (!out.has(r.fieldId)) out.set(r.fieldId, { value: r.value, fromEntityId: r.entityId, ownStamp: "" });
  }
  return out;
}

export type ValueChange = { entityId: string; fieldId: string; value: string; base: string };

/**
 * The edits worth sending: only fields whose canonical value differs from
 * what was loaded, each with the stamp of the record's own row. Returns
 * errors instead when any edited value does not fit its type.
 */
export function diffCustomValues(
  entityId: string,
  defs: CustomFieldDef[],
  loaded: Map<string, ResolvedValue>,
  edited: Record<string, string>,
): { ok: true; changes: ValueChange[] } | { ok: false; errors: string[] } {
  const changes: ValueChange[] = [];
  const errors: string[] = [];
  for (const d of defs) {
    if (!(d.id in edited)) continue;
    const n = normalizeCustomValue(d, edited[d.id] ?? "");
    if (!n.ok) {
      errors.push(n.error);
      continue;
    }
    const was = loaded.get(d.id);
    const ownValue = was && was.fromEntityId === entityId ? was.value : null;
    // Unchanged against this record's own row → nothing to write. An
    // inherited value the office left alone is not written either: it is
    // still read through the child's other row.
    if (ownValue !== null ? n.value === ownValue : n.value === (was?.value ?? "")) continue;
    changes.push({ entityId, fieldId: d.id, value: n.value, base: was?.ownStamp ?? "" });
  }
  return errors.length ? { ok: false, errors } : { ok: true, changes };
}

// ─── Export & import ──────────────────────────────────────────────────

export const customColumnKey = (def: Pick<CustomFieldDef, "id">) => `cf_${def.id}`;

/** Extra export columns for these fields (headers = English label). */
export function customExportColumns(defs: CustomFieldDef[]): { key: string; header: string }[] {
  return defs.map((d) => ({ key: customColumnKey(d), header: d.labelEn }));
}

/** Export cells for one record from resolved values. */
export function customExportCells(defs: CustomFieldDef[], resolved: Map<string, ResolvedValue> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of defs) out[customColumnKey(d)] = valueForExport(d, resolved?.get(d.id)?.value ?? "");
  return out;
}

const headerKey = (h: string) => labelKey(h).replace(/[*:]+$/, "").trim();

/**
 * File headers → custom fields, matched by English or Hindi label
 * (case/space-insensitive). A header the built-in import already reads is
 * never taken; unmatched headers are simply not custom columns.
 */
export function matchCustomImportHeaders(
  headers: string[],
  defs: CustomFieldDef[],
  isBuiltIn: (header: string) => boolean,
): { columns: { index: number; def: CustomFieldDef }[]; shadowed: string[] } {
  const byLabel = new Map<string, CustomFieldDef>();
  for (const d of defs) {
    byLabel.set(headerKey(d.labelEn), d);
    if (d.labelHi) byLabel.set(headerKey(d.labelHi), d);
  }
  const columns: { index: number; def: CustomFieldDef }[] = [];
  const shadowed: string[] = [];
  const taken = new Set<string>();
  headers.forEach((h, index) => {
    const def = byLabel.get(headerKey(h));
    if (!def) return;
    if (isBuiltIn(h)) {
      shadowed.push(def.labelEn);
      return;
    }
    if (taken.has(def.id)) return; // same field twice: the first column wins
    taken.add(def.id);
    columns.push({ index, def });
  });
  return { columns, shadowed };
}

export type ImportCellPlan = {
  changes: ValueChange[];
  errors: { lineNo: number; message: string }[];
};

/**
 * Import cells → value changes. A blank cell is SKIPPED, never written as
 * blank: an empty column in a file means "not in this file", not "erase".
 * `stamps` = the current own-row stamp per `${entityId}|${fieldId}` (read
 * just before), `current` = the stored value, so unchanged cells send
 * nothing.
 */
export function planCustomImport(
  rows: { lineNo: number; entityId: string | null; cells: { def: CustomFieldDef; raw: string }[] }[],
  stamps: Map<string, { value: string; updatedAt: string }>,
): ImportCellPlan {
  const changes: ValueChange[] = [];
  const errors: { lineNo: number; message: string }[] = [];
  for (const r of rows) {
    const filled = r.cells.filter((c) => squash(c.raw));
    if (!filled.length) continue;
    if (!r.entityId) {
      errors.push({ lineNo: r.lineNo, message: "more-details columns skipped — student not found after import" });
      continue;
    }
    for (const c of filled) {
      const n = normalizeCustomValue(c.def, c.raw);
      if (!n.ok) {
        errors.push({ lineNo: r.lineNo, message: n.error });
        continue;
      }
      const cur = stamps.get(`${r.entityId}|${c.def.id}`);
      if (cur && cur.value === n.value) continue;
      changes.push({ entityId: r.entityId, fieldId: c.def.id, value: n.value, base: cur?.updatedAt ?? "" });
    }
  }
  return { changes, errors };
}

