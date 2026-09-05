/**
 * The UDISE+ workbook the office is working through, kept between sittings.
 *
 * Reconciling a UDISE+ export against SIS is days of work, not minutes: the
 * office chases a PEN, verifies a child on the portal, comes back. What is
 * kept is ONE CANONICAL RECORD PER CHILD, never the matched preview and never
 * the raw portal rows:
 *
 *   The preview is DERIVED from the records plus the current state of SIS.
 *   Store the preview and it is a photograph — it would still show a child as
 *   missing a PEN long after somebody wrote one in. Store the records and the
 *   table is recomputed against SIS every time it is opened, so a child that
 *   has since been settled simply reports itself settled and drops out.
 *
 *   Raw portal rows were the first design, and they broke the day the office
 *   uploaded both exports UDISE+ offers. "Students Details" is 23 columns and
 *   carries the PEN; "List of Active Students" is 66 columns and carries the
 *   birth date, parents and profile but no PEN. Rows of one read under the
 *   header of the other gave a pupil called "Female" with a birth date of
 *   "AARVI SINGH". So each file is parsed on arrival and folded, field by
 *   field, into the child's single record. A child who appears in both files
 *   ends up with a PEN AND a birth date, which is the whole point.
 *
 * A second upload MERGES rather than replaces. Exports come out class by
 * class and month by month; replacing would throw away rows the office had
 * already reconciled, and re-uploading everything to get them back is the
 * loop this exists to end. A blank in a later file never erases a value an
 * earlier one carried.
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import {
  cleanApaar,
  cleanPen,
  extractLast4,
  udiseDobKey,
  udiseEmptyRow,
  udiseIsBlank,
  udiseNamesCompatible,
  udiseNormName,
  type UdiseStudentRow,
} from "@/lib/udiseStudentDetails";

const KEY = "bhb_udise_upload_v2";

/** One child on the working sheet. `key` is the row's identity in the DB. */
export type UdiseSheetRecord = {
  key: string;
  /** Upload order, kept so the table reads the way the office last saw it. */
  ord: number;
  fields: UdiseStudentRow;
};

export type StoredUdiseUpload = {
  version: 2;
  /** The academic session these records belong to. */
  academicYearCode: string;
  /** Every file that has fed this working set, newest last. */
  files: { name: string; at: string; rows: number }[];
  records: UdiseSheetRecord[];
  updatedAt: string;
};

/**
 * The first name token only. One export writes VEER PRATAP and the other
 * VEER PRATAP MISHRA; a father is PUNEET SINGH in one and PUNEET KUMAR SINGH
 * in the other. Keys built on the first token find both; the compatibility
 * check then decides whether the two records really are one child.
 */
function nameCore(name: string): string {
  return udiseNormName(name).split(" ").filter(Boolean)[0] ?? "";
}

function clean(v: string | undefined): string {
  const s = (v ?? "").trim();
  return udiseIsBlank(s) ? "" : s;
}

function fullApaar(v: string): string {
  const a = cleanApaar(v);
  return /^\d{12}$/.test(a) ? a : "";
}

/**
 * Every way this row can be recognised again, strongest first.
 *
 * PEN is the portal's own identifier and the thing the exercise exists to
 * collect. A full APAAR next. After that the row has only what a child has:
 * a name with a birth date, a name with both parents, a name with the
 * father, and the last four digits the portal leaves visible on a masked
 * APAAR or Aadhaar, tied to the name so four digits alone never merge two
 * children. Name cores are used, not full names, because one export writes
 * VEER PRATAP and the other VEER PRATAP MISHRA.
 *
 * "NA", a dash, NOT AVAILABLE are none of these. The day that was forgotten,
 * every child without an APAAR became one row called "apaar:na".
 */
export function udiseIdentityKeys(r: UdiseStudentRow): string[] {
  const keys: string[] = [];
  const pen = cleanPen(r.pen);
  if (pen) keys.push(`pen:${pen.toLowerCase()}`);
  const apaar = fullApaar(r.apaarId);
  if (apaar) keys.push(`apaar:${apaar}`);
  const core = nameCore(r.fullName);
  if (core) {
    const dob = udiseDobKey(r.dob);
    if (dob) keys.push(`nd:${core}|${dob}`);
    const f = nameCore(clean(r.fatherName));
    const m = nameCore(clean(r.motherName));
    if (f && m) keys.push(`nfm:${core}|${f}|${m}`);
    if (f) keys.push(`nf:${core}|${f}`);
    const a4 = extractLast4(clean(r.apaarId));
    if (a4) keys.push(`ma:${a4}|${core}`);
    const aa = extractLast4(clean(r.aadhaarRaw));
    if (aa) keys.push(`aa:${aa}|${core}`);
  }
  return keys;
}

/** The identity a NEW record is filed under. */
export function udiseRowKey(r: UdiseStudentRow): string {
  const keys = udiseIdentityKeys(r);
  if (keys.length) return keys[0]!;
  const name = udiseNormName(r.fullName);
  if (name) {
    return `row:${name}|${udiseNormName(r.classHint)}|${udiseNormName(r.sectionHint)}`;
  }
  // Nothing identifying at all: keep it, but never let it collide with
  // another such row — two blank rows are not the same child.
  return `row:${JSON.stringify(r)}`;
}

/**
 * Could these two records be the same child?
 *
 * A shared government id settles it either way: two different PENs are two
 * children however alike the names. Failing that, the names must be
 * compatible and nothing the two records both state — a parent, the birth
 * date, the visible last four digits of an id — may disagree.
 */
export function udiseRecordsCompatible(a: UdiseStudentRow, b: UdiseStudentRow): boolean {
  const pa = cleanPen(a.pen);
  const pb = cleanPen(b.pen);
  if (pa && pb) return pa.toLowerCase() === pb.toLowerCase();
  const aa = fullApaar(a.apaarId);
  const ab = fullApaar(b.apaarId);
  if (aa && ab) return aa === ab;

  if (!udiseNamesCompatible(a.fullName, b.fullName)) return false;
  const conflict = (x: string, y: string) =>
    !!clean(x) && !!clean(y) && !udiseNamesCompatible(x, y);
  if (conflict(a.fatherName, b.fatherName)) return false;
  if (conflict(a.motherName, b.motherName)) return false;
  const da = udiseDobKey(a.dob);
  const db = udiseDobKey(b.dob);
  if (da && db && da !== db) return false;
  const last4Differ = (x: string, y: string) => {
    const p = extractLast4(clean(x));
    const q = extractLast4(clean(y));
    return !!p && !!q && p !== q;
  };
  if (last4Differ(a.aadhaarRaw, b.aadhaarRaw)) return false;
  if (last4Differ(a.apaarId, b.apaarId)) return false;
  return true;
}

/**
 * Fold a later row into a child's record, field by field.
 *
 * A later export is later news, so a value it carries replaces the old one.
 * A blank it carries — or NA, which is how the portal spells blank — does
 * not: the short export has no birth-date column at all, and uploading it
 * after the long one must not wipe every date the long one brought. A
 * masked id never replaces the unmasked form of the same id.
 */
const NAME_FIELDS = new Set<keyof UdiseStudentRow>([
  "fullName",
  "fatherName",
  "motherName",
  "guardianName",
  "aadhaarName",
]);

export function mergeUdiseFields(
  existing: UdiseStudentRow,
  incoming: UdiseStudentRow,
): { fields: UdiseStudentRow; changed: boolean } {
  const out: UdiseStudentRow = { ...udiseEmptyRow(), ...existing };
  let changed = false;
  for (const k of Object.keys(udiseEmptyRow()) as (keyof UdiseStudentRow)[]) {
    const v = (incoming[k] ?? "").trim();
    if (udiseIsBlank(v)) continue;
    const cur = out[k] ?? "";
    // Names: the two exports spell the same person with and without a
    // surname or middle name. Keep the fuller spelling whichever file it
    // came from; a re-upload of the shorter one must not trim it back.
    if (
      NAME_FIELDS.has(k) &&
      cur &&
      udiseNamesCompatible(cur, v) &&
      v.length <= cur.length
    ) {
      continue;
    }
    if (
      (k === "apaarId" || k === "aadhaarRaw") &&
      v.includes("*") &&
      cur &&
      !cur.includes("*") &&
      extractLast4(cur) === extractLast4(v)
    ) {
      continue;
    }
    if (cur !== v) {
      out[k] = v;
      changed = true;
    }
  }
  return { fields: out, changed };
}

export type MergeReport = {
  records: UdiseSheetRecord[];
  /** Records that are new or whose fields changed — what needs writing. */
  changed: UdiseSheetRecord[];
  /** Keys of records that turned out to be the same child as another. */
  removed: string[];
  added: number;
  updated: number;
  unchanged: number;
};

/**
 * Fold a freshly parsed file into the working set.
 *
 * Each incoming row looks for the record it belongs to by any of its
 * identity keys, and is believed only if the two are compatible. A row that
 * ties together two records that were filed separately — one from the file
 * with PENs, one from the file with birth dates — merges them into one. A
 * row nobody recognises is a new child. Nothing already on the sheet is
 * dropped for being absent from this file.
 */
export function mergeUdiseRecords(input: {
  existing: UdiseSheetRecord[];
  incoming: UdiseStudentRow[];
}): MergeReport {
  type Slot = { key: string; ord: number; fields: UdiseStudentRow; alive: boolean; dirty: boolean; isNew: boolean };
  const slots: Slot[] = input.existing.map((r) => ({
    key: r.key,
    ord: r.ord,
    fields: { ...udiseEmptyRow(), ...r.fields },
    alive: true,
    dirty: false,
    isNew: false,
  }));
  const taken = new Set(slots.map((s) => s.key));
  const index = new Map<string, number[]>();
  const indexSlot = (i: number) => {
    for (const k of udiseIdentityKeys(slots[i]!.fields)) {
      const list = index.get(k);
      if (list) {
        if (!list.includes(i)) list.push(i);
      } else index.set(k, [i]);
    }
  };
  slots.forEach((_, i) => indexSlot(i));
  let nextOrd = slots.reduce((m, s) => Math.max(m, s.ord + 1), 0);

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const removed: string[] = [];

  for (const raw of input.incoming) {
    const row: UdiseStudentRow = { ...udiseEmptyRow(), ...raw };
    if (!row.fullName.trim()) continue;

    const candidates: number[] = [];
    for (const k of udiseIdentityKeys(row)) {
      for (const i of index.get(k) ?? []) {
        if (!slots[i]!.alive || candidates.includes(i)) continue;
        if (udiseRecordsCompatible(slots[i]!.fields, row)) candidates.push(i);
      }
    }

    if (!candidates.length) {
      let key = udiseRowKey(row);
      for (let n = 2; taken.has(key); n++) key = `${udiseRowKey(row)}#${n}`;
      taken.add(key);
      slots.push({ key, ord: nextOrd++, fields: row, alive: true, dirty: true, isNew: true });
      indexSlot(slots.length - 1);
      added += 1;
      continue;
    }

    const target = slots[candidates[0]!]!;
    const before = JSON.stringify(target.fields);
    // Other records this row proves to be the same child: keep what they
    // knew, then let the record already in hand and the new row speak last.
    let base = target.fields;
    for (const i of candidates.slice(1)) {
      const other = slots[i]!;
      base = mergeUdiseFields(other.fields, base).fields;
      other.alive = false;
      removed.push(other.key);
    }
    const merged = mergeUdiseFields(base, row).fields;
    target.fields = merged;
    if (JSON.stringify(merged) !== before) {
      target.dirty = true;
      updated += 1;
    } else {
      unchanged += 1;
    }
    indexSlot(candidates[0]!);
  }

  const records = slots
    .filter((s) => s.alive)
    .sort((a, b) => a.ord - b.ord)
    .map((s) => ({ key: s.key, ord: s.ord, fields: s.fields }));
  const changed = slots
    .filter((s) => s.alive && (s.dirty || s.isNew))
    .sort((a, b) => a.ord - b.ord)
    .map((s) => ({ key: s.key, ord: s.ord, fields: s.fields }));
  return { records, changed, removed, added, updated, unchanged };
}

export function loadUdiseUpload(): StoredUdiseUpload | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // A browser with site data blocked throws on read. No working file is a
    // fine answer; a crashed panel is not.
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as StoredUdiseUpload;
    if (p?.version !== 2 || !Array.isArray(p.records)) return null;
    return p;
  } catch {
    // A corrupt working file is not worth crashing the panel over: the office
    // can upload again, and this way they are told to rather than shown a
    // blank screen.
    return null;
  }
}

export function saveUdiseUpload(value: StoredUdiseUpload): boolean {
  // Guarded: a UDISE+ export of 700 children is large, and a bare setItem
  // throws on a full origin — which is how an unrelated desk lost a roster
  // once already.
  return writeCacheOrInvalidate(KEY, JSON.stringify(value));
}

export function clearUdiseUpload(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    // The first design's copy, raw rows under one header. Never read again.
    window.localStorage.removeItem("bhb_udise_upload_v1");
  } catch {
    /* nothing useful to do — the panel treats a failed clear as cleared */
  }
}
