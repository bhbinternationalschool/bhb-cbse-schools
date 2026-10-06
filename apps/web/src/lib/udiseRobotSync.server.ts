/**
 * The UDISE robot's pull, landed on the working sheet.
 *
 * The extension reads the portal's own student list in the office's
 * logged-in tab and posts it here. Each record becomes the canonical
 * `UdiseStudentRow` an uploaded export becomes (lib/udisePortalApi), and is
 * merged into the session's sheet with the SAME `mergeUdiseRecords` the
 * upload uses — so the import panel shows it next time it opens, and the
 * office reviews and applies exactly as before. Nothing here writes to SIS.
 *
 * Rules carried over from the upload (lib/udiseUploadServer):
 *  - every upsert sends `deleted_at: null`, or a sheet put away with
 *    "start a fresh sheet" would stay deleted for ever;
 *  - nothing is removed for being absent from a pull — only the rows the
 *    merge proves to be the same child as another are retired;
 *  - reads are paged: PostgREST caps a request at 1000 rows and calls the
 *    truncation success.
 */

import "server-only";
import { getServerTenantContext } from "@/lib/serverTenant";
import { mergeUdiseRecords, type UdiseSheetRecord } from "@/lib/udiseUploadStore";
import { sheetIdFor, type SheetFile } from "@/lib/udiseUploadServer";
import {
  UDISE_CANONICAL_MARKER,
  udiseEmptyRow,
  type UdiseStudentRow,
} from "@/lib/udiseStudentDetails";
import {
  pickPortalFields,
  portalStudentToUdiseRow,
  summarisePortalRows,
  type UdisePortalSyncSummary,
} from "@/lib/udisePortalApi";

/** The sheet's file list carries one entry for the robot, replaced each pull. */
export const UDISE_ROBOT_FILE_NAME = "UDISE+ portal — fetched by the UDISE robot";

const PAGE = 1000;
const CHUNK = 200;

export type UdiseRobotSyncResult =
  | {
      ok: true;
      summary: UdisePortalSyncSummary;
      added: number;
      updated: number;
      unchanged: number;
      retired: number;
      at: string;
    }
  | { ok: false; status: number; error: string };

export async function syncUdisePortalPull(input: {
  academicYearCode: string;
  students: unknown[];
  actor: string;
}): Promise<UdiseRobotSyncResult> {
  const ay = input.academicYearCode;
  if (!/^\d{4}-\d{2}$/.test(ay)) return { ok: false, status: 400, error: "academicYearCode must look like 2026-27" };
  if (!Array.isArray(input.students) || !input.students.length) {
    // An empty pull is a failed read on the portal side, never "no children".
    return { ok: false, status: 400, error: "No students in the pull — nothing was changed." };
  }
  if (input.students.length > 5000) return { ok: false, status: 413, error: "Too many records in one pull" };

  const rows: UdiseStudentRow[] = input.students
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
    .map((s) => portalStudentToUdiseRow(pickPortalFields(s)))
    .filter((r) => r.fullName);
  if (!rows.length) return { ok: false, status: 400, error: "No readable student records in the pull." };

  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, status: 503, error: "Database not configured" };
  const sheetId = sheetIdFor(ay);

  const sheetRes = await ctx.sb
    .from("udise_upload_sheets")
    .select("id, files")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sheetId)
    .maybeSingle();
  if (sheetRes.error) return { ok: false, status: 500, error: sheetRes.error.message };

  const existing: UdiseSheetRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await ctx.sb
      .from("udise_upload_rows")
      .select("row_key, ord, cells")
      .eq("tenant_id", ctx.tenantId)
      .eq("sheet_id", sheetId)
      .is("deleted_at", null)
      .order("ord", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) return { ok: false, status: 500, error: res.error.message };
    for (const r of res.data ?? []) {
      // Pre-canonical rows stored raw portal cells as an array; they read as nothing.
      if (!r.cells || typeof r.cells !== "object" || Array.isArray(r.cells)) continue;
      existing.push({
        key: String(r.row_key),
        ord: Number(r.ord ?? 0),
        fields: { ...udiseEmptyRow(), ...(r.cells as Partial<UdiseStudentRow>) },
      });
    }
    if ((res.data ?? []).length < PAGE) break;
  }

  const merged = mergeUdiseRecords({ existing, incoming: rows });
  const now = new Date().toISOString();

  const priorFiles = Array.isArray(sheetRes.data?.files) ? (sheetRes.data!.files as SheetFile[]) : [];
  const files: SheetFile[] = [
    ...priorFiles.filter((f) => f && f.name !== UDISE_ROBOT_FILE_NAME),
    { name: UDISE_ROBOT_FILE_NAME, at: now, rows: rows.length },
  ];
  const sheetUp = await ctx.sb.from("udise_upload_sheets").upsert(
    {
      id: sheetId,
      tenant_id: ctx.tenantId,
      academic_year_code: ay,
      head: [[UDISE_CANONICAL_MARKER]],
      header_row_index: 0,
      files,
      updated_by: input.actor,
      updated_at: now,
      deleted_at: null,
    },
    { onConflict: "id" },
  );
  if (sheetUp.error) return { ok: false, status: 500, error: sheetUp.error.message };

  for (let i = 0; i < merged.changed.length; i += CHUNK) {
    const batch = merged.changed.slice(i, i + CHUNK).map((rec) => ({
      id: `${sheetId}:${rec.key}`,
      tenant_id: ctx.tenantId,
      sheet_id: sheetId,
      row_key: rec.key,
      ord: rec.ord,
      cells: rec.fields,
      updated_at: now,
      deleted_at: null,
    }));
    const up = await ctx.sb.from("udise_upload_rows").upsert(batch, { onConflict: "id" });
    if (up.error) return { ok: false, status: 500, error: up.error.message };
  }

  if (merged.removed.length) {
    const ids = merged.removed.map((k) => `${sheetId}:${k}`);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const del = await ctx.sb
        .from("udise_upload_rows")
        .update({ deleted_at: now, updated_at: now })
        .eq("tenant_id", ctx.tenantId)
        .in("id", ids.slice(i, i + CHUNK));
      if (del.error) return { ok: false, status: 500, error: del.error.message };
    }
  }

  return {
    ok: true,
    summary: summarisePortalRows(rows),
    added: merged.added,
    updated: merged.updated,
    unchanged: merged.unchanged,
    retired: merged.removed.length,
    at: now,
  };
}
