/**
 * My class → Class sheet: the teacher's draft against the child's record.
 * Pure — the web sheet (components/staff/ClassSheet) keeps its state with
 * these, and the staff app follows the same rules
 * (cbse_school_mobile/lib/features/staff/my_class_screen.dart, PR #599).
 *
 * Why (14 Oct 2026): the server refuses a child whose record someone else
 * saved in between (compare-and-set on revisionAt). The sheet kept the
 * teacher's whole old draft, so after the re-read every value the other
 * person had changed looked like a "change" of the teacher's and a second
 * Save sent those stale values back over the newer record. Now:
 *  - only changed keys are sent (height and weight travel together), each
 *    child with its own revisionAt;
 *  - on every re-read a value the teacher did NOT touch follows the record;
 *  - a value the teacher typed is kept, and flagged as conflicting when the
 *    record changed underneath it, so they see the newer value before
 *    saving again;
 *  - a child just saved takes what the record holds now for the keys that
 *    were sent (the server normalises "b+" → "B+", "112.0" → "112").
 */

import {
  checkSheetRow,
  GROUP_KEYS,
  type SheetCheck,
  type SheetGroup,
  type SheetValues,
} from "@/lib/classDetailsSheet";
import { normalizeBloodGroup } from "@/lib/sis";

export type SheetRecordRow = {
  id: string;
  revisionAt: string;
  fields: Record<string, string>;
  measure: { heightCm: string; weightKg: string; measuredOn: string };
  sheet: { fatherQualification: string; motherQualification: string; isCwsn: boolean };
};

export type Draft = Required<SheetValues>;
export type SheetKey = keyof Draft;

export const SHEET_KEYS: SheetKey[] = [
  "heightCm",
  "weightKg",
  "bloodGroup",
  "motherTongue",
  "religion",
  "category",
  "fatherQualification",
  "motherQualification",
  "isCwsn",
];

/**
 * One child's draft: `seen` is the record as the sheet last read it, `draft`
 * what the box shows, `conflicts` the keys the teacher typed whose record
 * value changed underneath (key → the newer record value).
 */
export type DraftEntry = {
  seen: Draft;
  draft: Draft;
  conflicts: Partial<Record<SheetKey, Draft[SheetKey]>>;
};

/** What the record holds now. "B(+)" from the old import shows — and is kept — as "B+". */
export function draftFromRecord(r: SheetRecordRow): Draft {
  return {
    heightCm: r.measure.heightCm,
    weightKg: r.measure.weightKg,
    bloodGroup: normalizeBloodGroup(r.fields.bloodGroup || "") || r.fields.bloodGroup || "",
    motherTongue: r.fields.motherTongue || "",
    religion: r.fields.religion || "",
    category: r.fields.category || "",
    fatherQualification: r.sheet.fatherQualification,
    motherQualification: r.sheet.motherQualification,
    isCwsn: r.sheet.isCwsn,
  };
}

export function freshEntry(r: SheetRecordRow): DraftEntry {
  const now = draftFromRecord(r);
  return { seen: now, draft: { ...now }, conflicts: {} };
}

export function freshEntries(rows: SheetRecordRow[]): Record<string, DraftEntry> {
  return Object.fromEntries(rows.map((r) => [r.id, freshEntry(r)]));
}

/** The teacher typed into one box. Their own new value settles any conflict on that key. */
export function editEntry(e: DraftEntry, patch: Partial<Draft>): DraftEntry {
  const conflicts = { ...e.conflicts };
  for (const k of Object.keys(patch) as SheetKey[]) delete conflicts[k];
  return { seen: e.seen, draft: { ...e.draft, ...patch }, conflicts };
}

/**
 * The list was re-read (after a save or a refusal). For each child:
 *  - a key the teacher did not touch (draft = what was seen) takes the record value now;
 *  - a key just sent for a child that saved takes the record value now;
 *  - a key the teacher typed is kept; if the record moved to something else
 *    meanwhile it is flagged as a conflict with the newer value.
 * A child new to the list starts from its record.
 */
export function reconcileEntries(
  entries: Record<string, DraftEntry>,
  rows: SheetRecordRow[],
  saved: Record<string, SheetValues> = {},
): Record<string, DraftEntry> {
  const out: Record<string, DraftEntry> = {};
  for (const r of rows) {
    const e = entries[r.id];
    if (!e) {
      out[r.id] = freshEntry(r);
      continue;
    }
    const now = draftFromRecord(r);
    const sent = saved[r.id];
    const draft = { ...e.draft } as Record<SheetKey, Draft[SheetKey]>;
    const conflicts = { ...e.conflicts };
    for (const k of SHEET_KEYS) {
      const untouched = e.draft[k] === e.seen[k];
      const justSent = !!sent && k in sent && e.draft[k] === sent[k];
      if (untouched || justSent || e.draft[k] === now[k]) {
        draft[k] = now[k];
        delete conflicts[k];
      } else if (now[k] !== e.seen[k]) {
        conflicts[k] = now[k];
      }
    }
    out[r.id] = { seen: now, draft: draft as Draft, conflicts };
  }
  return out;
}

/**
 * What one child's row sends: for each chosen group with a change, the
 * changed keys — height and weight always together. Empty = nothing to save.
 */
export function rowToSend(base: Draft, d: Draft, groups: SheetGroup[]): SheetValues {
  const send: Record<string, unknown> = {};
  for (const g of groups) {
    const keys = GROUP_KEYS[g];
    if (!keys.some((k) => d[k] !== base[k])) continue;
    for (const k of keys) if (g === "measure" || d[k] !== base[k]) send[k] = d[k];
  }
  return send as SheetValues;
}

export type RowState = {
  r: SheetRecordRow;
  base: Draft;
  d: Draft;
  send: SheetValues;
  dirty: boolean;
  check: SheetCheck;
  conflicts: DraftEntry["conflicts"];
};

export function rowState(r: SheetRecordRow, e: DraftEntry | undefined, groups: SheetGroup[]): RowState {
  const base = draftFromRecord(r);
  const d = e?.draft ?? base;
  const send = rowToSend(base, d, groups);
  const dirty = Object.keys(send).length > 0;
  const check: SheetCheck = dirty ? checkSheetRow(send, base) : { ok: true, values: {} };
  // Only conflicts on keys still being sent matter to the teacher.
  const conflicts: DraftEntry["conflicts"] = {};
  for (const [k, v] of Object.entries(e?.conflicts ?? {})) if (k in send) conflicts[k as SheetKey] = v;
  return { r, base, d, send, dirty, check, conflicts };
}

/** The POST rows: each child that passes its check, with ITS OWN revisionAt. */
export function saveRows(states: RowState[]): { id: string; revisionAt: string; values: SheetValues }[] {
  return states
    .filter((x) => x.dirty && x.check.ok)
    .map((x) => ({ id: x.r.id, revisionAt: x.r.revisionAt, values: x.send }));
}
