/**
 * The UDISE+ working sheet, on the server so it follows the login.
 *
 * The rows are stored AS UPLOADED and never the matched table. That is the
 * whole design: the table the office sees is derived from these rows against
 * SIS as it stands right now, so a child settled since the upload reports
 * itself settled and drops off the list. Storing the derived view would
 * freeze it, and the office would keep being shown names they had already
 * dealt with — which is the complaint this answers.
 *
 * One row per child rather than one document per sheet. Merging a second
 * export changes a handful of rows; rewriting a 700-child document to add
 * three of them is both slow and impossible to reason about afterwards.
 */

import { readAll } from "@/lib/data/client/query";
import { writeRecords } from "@/lib/data/client/mutate";
import { udiseRowKey } from "@/lib/udiseUploadStore";

export type SheetFile = { name: string; at: string; rows: number };

export type ServerSheet = {
  id: string;
  academicYearCode: string;
  head: unknown[][];
  headerRowIndex: number;
  files: SheetFile[];
  updatedAt: string;
};

export type LoadedSheet = {
  sheet: ServerSheet;
  /** head rows and body rows, reassembled into the shape the parser wants. */
  matrix: unknown[][];
};

/** One sheet per session, addressed so two machines land on the same row. */
export function sheetIdFor(academicYearCode: string): string {
  return `udise-${(academicYearCode || "none").replace(/[^A-Za-z0-9-]/g, "")}`;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
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

  const rows = await readAll<Record<string, unknown>>("udise.rows", {
    maxPages: 10,
  });
  if (!rows.ok) return { ok: false, error: rows.error };

  const body = rows.rows
    .filter((r) => str(r.sheet_id) === id)
    .sort((a, b) => Number(a.ord ?? 0) - Number(b.ord ?? 0))
    .map((r) => (Array.isArray(r.cells) ? (r.cells as unknown[]) : []));

  const head = Array.isArray(row.head) ? (row.head as unknown[][]) : [];
  const files = Array.isArray(row.files) ? (row.files as SheetFile[]) : [];

  return {
    ok: true,
    sheet: {
      sheet: {
        id,
        academicYearCode: str(row.academic_year_code),
        head,
        headerRowIndex: Number(row.header_row_index ?? 0),
        files,
        updatedAt: str(row.updated_at),
      },
      matrix: [...head, ...body],
    },
  };
}

/**
 * Write a merged sheet back.
 *
 * Rows are addressed by their own key, so a second upload UPDATES the child's
 * row rather than adding a second one — the unique index on
 * (tenant, sheet, row_key) is the same rule stated in the database, where it
 * cannot be forgotten.
 *
 * Only the rows in the merged matrix are written. Nothing is deleted here: a
 * class-wise export does not mention other classes, and removing what it does
 * not mention is precisely the wipe that made this feature necessary.
 */
export async function saveServerSheet(input: {
  academicYearCode: string;
  head: unknown[][];
  headerRowIndex: number;
  body: unknown[][];
  files: SheetFile[];
  cols: { pen: number; apaar: number; name: number; dob: number };
  actor: string;
}): Promise<{ ok: true; written: number } | { ok: false; error: string }> {
  const id = sheetIdFor(input.academicYearCode);
  const now = new Date().toISOString();

  const sheetWrite = await writeRecords("udise.sheets", [
    {
      op: "upsert",
      id,
      row: {
        id,
        academic_year_code: input.academicYearCode,
        head: input.head,
        header_row_index: input.headerRowIndex,
        files: input.files,
        updated_by: input.actor,
        updated_at: now,
      },
    },
  ] as never);
  if (!sheetWrite.ok) return { ok: false, error: sheetWrite.message };

  // Chunked: one op per child, and a whole school in a single request would
  // be a batch big enough to time out — which is a batch that gets retried
  // for ever.
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < input.body.length; i += CHUNK) {
    const slice = input.body.slice(i, i + CHUNK);
    const ops = slice.map((cells, j) => {
      const ord = i + j;
      const key = udiseRowKey(cells, input.cols);
      return {
        op: "upsert" as const,
        id: `${id}:${key}`,
        row: {
          id: `${id}:${key}`,
          sheet_id: id,
          row_key: key,
          ord,
          cells,
          updated_at: now,
        },
      };
    });
    const res = await writeRecords("udise.rows", ops as never);
    if (!res.ok) return { ok: false, error: res.message };
    written += ops.length;
  }

  return { ok: true, written };
}

/** Put the sheet away. Soft delete, so a misclick is not a lost day. */
export async function clearServerSheet(
  academicYearCode: string,
): Promise<{ ok: boolean; error?: string }> {
  const id = sheetIdFor(academicYearCode);
  const res = await writeRecords("udise.sheets", [
    { op: "delete", id },
  ] as never);
  return res.ok ? { ok: true } : { ok: false, error: res.message };
}
