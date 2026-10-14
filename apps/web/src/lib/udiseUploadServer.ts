/**
 * The UDISE+ working sheet, on the server so it follows the login.
 *
 * One canonical record per child, stored AS PARSED and never the matched
 * table. That is the whole design: the table the office sees is derived from
 * these records against SIS as it stands right now, so a child settled since
 * the upload reports itself settled and drops off the list. Storing the
 * derived view would freeze it, and the office would keep being shown names
 * they had already dealt with — which is the complaint this answers.
 *
 * One row per child rather than one document per sheet. Merging a second
 * export changes a handful of rows; rewriting a 700-child document to add
 * three of them is both slow and impossible to reason about afterwards.
 */

import { readAll, readRevisions } from "@/lib/data/client/query";
import { writeRecords } from "@/lib/data/client/mutate";
import { asRevision, type Revision, type WriteResult } from "@/lib/data/types";
import {
  UDISE_CANONICAL_MARKER,
  udiseEmptyRow,
  type UdiseStudentRow,
} from "@/lib/udiseStudentDetails";
import type { UdiseSheetRecord } from "@/lib/udiseUploadStore";

export type SheetFile = { name: string; at: string; rows: number };

export type ServerSheet = {
  id: string;
  academicYearCode: string;
  files: SheetFile[];
  updatedAt: string;
};

export type LoadedSheet = {
  sheet: ServerSheet;
  records: UdiseSheetRecord[];
};

/** One sheet per session, addressed so two machines land on the same row. */
export function sheetIdFor(academicYearCode: string): string {
  return `udise-${(academicYearCode || "none").replace(/[^A-Za-z0-9-]/g, "")}`;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function rowId(sheetId: string, key: string): string {
  return `${sheetId}:${key}`;
}

/** Batches: a whole school in one request is a request that times out. */
const CHUNK = 200;

/**
 * The revision this page last read or wrote for each sheet / row id — the
 * base its next write of that record sends (data-layer 1.5: the server
 * refuses a null base on a record that exists). Filled by loadServerSheet
 * and by every write's answer; nothing else. Not a copy of the data.
 */
const knownRevisions = new Map<string, Revision>();

/**
 * Bases for writing `ids`. A record this page loaded or wrote: the revision
 * it holds. Any other: asked of the server (soft-deleted rows included) —
 *  - a delete ("start a fresh sheet") takes the current revision: putting
 *    the sheet away is meant for whatever is on it;
 *  - an upsert takes it only for a soft-deleted row (reviving a sheet or a
 *    child put away with "start a fresh sheet" — 212 such rows in
 *    production, 14 Oct 2026); for a live row this page never loaded it
 *    sends no base, and the server refuses rather than overwrite a row
 *    someone else wrote (the UDISE robot, another machine).
 */
async function basesFor(
  collection: "udise.sheets" | "udise.rows",
  ids: readonly string[],
  op: "upsert" | "delete",
): Promise<{ ok: true; bases: Map<string, Revision | null> } | { ok: false; error: string }> {
  const unknown = ids.filter((id) => !knownRevisions.has(id));
  let fetched = new Map<string, { revision: Revision; deleted: boolean }>();
  if (unknown.length) {
    const r = await readRevisions(collection, unknown);
    if (!r.ok) return { ok: false, error: r.error };
    fetched = r.revisions;
  }
  const bases = new Map<string, Revision | null>();
  for (const id of ids) {
    const known = knownRevisions.get(id);
    if (known) {
      bases.set(id, known);
      continue;
    }
    const f = fetched.get(id);
    bases.set(id, f && (op === "delete" || f.deleted) ? f.revision : null);
  }
  return { ok: true, bases };
}

/** Keep the revisions a write returned as the next bases. */
function remember<T>(res: WriteResult<T>): void {
  if (!res.ok) return;
  for (const [id, rev] of Object.entries(res.versions)) {
    if (rev) knownRevisions.set(id, rev);
  }
}

/**
 * Read the working sheet for this session.
 *
 * Rows are paged. PostgREST caps a request at 1000 rows and reports the
 * truncation as SUCCESS — the fault that cost this system 134 receipts' worth
 * of lines — and a school's UDISE+ export is exactly the size where that
 * bites.
 */
export async function loadServerSheet(
  academicYearCode: string,
): Promise<{ ok: true; sheet: LoadedSheet | null } | { ok: false; error: string }> {
  const id = sheetIdFor(academicYearCode);

  const sheets = await readAll<Record<string, unknown>>("udise.sheets", {
    maxPages: 2,
  });
  if (!sheets.ok) return { ok: false, error: sheets.error };

  const row = sheets.rows.find((r) => str(r.id) === id);
  if (!row) return { ok: true, sheet: null };
  if (str(row.updated_at)) knownRevisions.set(id, asRevision(str(row.updated_at)));

  const rows = await readAll<Record<string, unknown>>("udise.rows", {
    maxPages: 10,
  });
  if (!rows.ok) return { ok: false, error: rows.error };
  for (const r of rows.rows) {
    if (str(r.sheet_id) === id && str(r.id) && str(r.updated_at)) {
      knownRevisions.set(str(r.id), asRevision(str(r.updated_at)));
    }
  }

  const records: UdiseSheetRecord[] = rows.rows
    .filter((r) => str(r.sheet_id) === id)
    // The first design stored raw portal cells as an array. Those rows read
    // as nothing now rather than as pupils called "Female".
    .filter((r) => r.cells && typeof r.cells === "object" && !Array.isArray(r.cells))
    .map((r) => ({
      key: str(r.row_key),
      ord: Number(r.ord ?? 0),
      fields: { ...udiseEmptyRow(), ...(r.cells as Partial<UdiseStudentRow>) },
    }))
    .sort((a, b) => a.ord - b.ord);

  const files = Array.isArray(row.files) ? (row.files as SheetFile[]) : [];

  return {
    ok: true,
    sheet: {
      sheet: {
        id,
        academicYearCode: str(row.academic_year_code),
        files,
        updatedAt: str(row.updated_at),
      },
      records,
    },
  };
}

/**
 * Write what changed.
 *
 * Rows are addressed by the child's key, so a second upload UPDATES the
 * child's row rather than adding a second one — the unique index on
 * (tenant, sheet, row_key) is the same rule stated in the database, where it
 * cannot be forgotten. Only the changed records are sent; a re-upload of a
 * file already merged writes nothing.
 *
 * `deleted_at: null` travels with every upsert on purpose. The write RPC
 * patches an existing row with the fields it is given, so a sheet the office
 * had put away with "start a fresh sheet" stayed deleted when the next upload
 * upserted it, and the server never handed it back again (2026-09-05).
 *
 * Nothing on the sheet is deleted for being absent from a file: a class-wise
 * export does not mention other classes, and removing what it does not
 * mention is precisely the wipe that made this feature necessary. The only
 * rows retired are those the merge proved to be the same child as another.
 */
export async function saveServerSheet(input: {
  academicYearCode: string;
  files: SheetFile[];
  changed: UdiseSheetRecord[];
  removed: string[];
  actor: string;
}): Promise<{ ok: true; written: number } | { ok: false; error: string }> {
  const id = sheetIdFor(input.academicYearCode);
  const now = new Date().toISOString();

  const sheetBase = await basesFor("udise.sheets", [id], "upsert");
  if (!sheetBase.ok) return { ok: false, error: sheetBase.error };
  const sheetWrite = await writeRecords("udise.sheets", [
    {
      op: "upsert",
      id,
      base: sheetBase.bases.get(id) ?? null,
      row: {
        id,
        academic_year_code: input.academicYearCode,
        head: [[UDISE_CANONICAL_MARKER]],
        header_row_index: 0,
        files: input.files,
        updated_by: input.actor,
        updated_at: now,
        deleted_at: null,
      },
    },
  ] as never);
  remember(sheetWrite);
  if (!sheetWrite.ok) return { ok: false, error: sheetWrite.message };

  let written = 0;
  for (let i = 0; i < input.changed.length; i += CHUNK) {
    const chunk = input.changed.slice(i, i + CHUNK);
    const b = await basesFor("udise.rows", chunk.map((rec) => rowId(id, rec.key)), "upsert");
    if (!b.ok) return { ok: false, error: b.error };
    const ops = chunk.map((rec) => ({
      op: "upsert" as const,
      id: rowId(id, rec.key),
      base: b.bases.get(rowId(id, rec.key)) ?? null,
      row: {
        id: rowId(id, rec.key),
        sheet_id: id,
        row_key: rec.key,
        ord: rec.ord,
        cells: rec.fields,
        updated_at: now,
        deleted_at: null,
      },
    }));
    const res = await writeRecords("udise.rows", ops as never);
    remember(res);
    if (!res.ok) return { ok: false, error: res.message };
    written += ops.length;
  }

  for (let i = 0; i < input.removed.length; i += CHUNK) {
    const ids = input.removed.slice(i, i + CHUNK).map((key) => rowId(id, key));
    const b = await basesFor("udise.rows", ids, "delete");
    if (!b.ok) return { ok: false, error: b.error };
    const ops = ids.map((rid) => ({ op: "delete" as const, id: rid, base: b.bases.get(rid) ?? null }));
    const res = await writeRecords("udise.rows", ops as never);
    remember(res);
    if (!res.ok) return { ok: false, error: res.message };
  }

  return { ok: true, written };
}

/**
 * Put the sheet away: the rows and then the sheet. Soft delete, so a misclick
 * is not a lost day. Deleting only the sheet row, as the first version did,
 * left every child's row alive to come back with the next upload.
 */
export async function clearServerSheet(
  academicYearCode: string,
  rowKeys: string[],
): Promise<{ ok: boolean; error?: string }> {
  const id = sheetIdFor(academicYearCode);
  for (let i = 0; i < rowKeys.length; i += CHUNK) {
    const ids = rowKeys.slice(i, i + CHUNK).map((key) => rowId(id, key));
    const b = await basesFor("udise.rows", ids, "delete");
    if (!b.ok) return { ok: false, error: b.error };
    const ops = ids.map((rid) => ({ op: "delete" as const, id: rid, base: b.bases.get(rid) ?? null }));
    const res = await writeRecords("udise.rows", ops as never);
    remember(res);
    if (!res.ok) return { ok: false, error: res.message };
  }
  const b = await basesFor("udise.sheets", [id], "delete");
  if (!b.ok) return { ok: false, error: b.error };
  const res = await writeRecords("udise.sheets", [
    { op: "delete", id, base: b.bases.get(id) ?? null },
  ] as never);
  remember(res);
  return res.ok ? { ok: true } : { ok: false, error: res.message };
}
