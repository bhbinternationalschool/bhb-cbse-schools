/**
 * Copy a file into the school's Google Drive and remember that it was done.
 *
 * Idempotent on (kind, ref): a second call for the same thing returns the
 * existing Drive file rather than uploading a duplicate. A failed upload is
 * recorded too — blank drive_file_id, the error, an attempt count — so the
 * receipt sweep retries it and the office can see what is missing, instead
 * of a silent gap that looks like "nothing to archive".
 *
 * This is an archive, not the serving copy: /api/upload keeps returning the
 * bucket URL, receipts keep living in the database. Drive failing must not
 * fail the thing being archived; it fails the archive row.
 */
import { uploadFileToDrive } from "@/lib/googleDrive.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { driveViewUrl, type ArchiveKind } from "@/lib/driveArchive";

export type ArchiveRow = {
  id: string;
  kind: ArchiveKind;
  ref: string;
  driveFileId: string;
  driveUrl: string;
  folder: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  archivedAt: string | null;
  error: string;
  attempts: number;
  updatedAt: string;
};

function rowToArchive(r: Record<string, unknown>): ArchiveRow {
  const driveFileId = String(r.drive_file_id || "");
  return {
    id: String(r.id),
    kind: r.kind as ArchiveKind,
    ref: String(r.ref),
    driveFileId,
    driveUrl: driveViewUrl(driveFileId),
    folder: String(r.folder || ""),
    fileName: String(r.file_name || ""),
    mimeType: String(r.mime_type || ""),
    bytes: Number(r.bytes) || 0,
    archivedAt: (r.archived_at as string | null) ?? null,
    error: String(r.error || ""),
    attempts: Number(r.attempts) || 0,
    updatedAt: String(r.updated_at || ""),
  };
}

export async function archiveToDrive(input: {
  kind: ArchiveKind;
  ref: string;
  folderPath: string[];
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<
  | { ok: true; driveFileId: string; driveUrl: string; alreadyArchived: boolean }
  | { ok: false; error: string }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;

  const { data: existing } = await sb
    .from("drive_archive")
    .select("drive_file_id, attempts")
    .eq("tenant_id", tenantId)
    .eq("kind", input.kind)
    .eq("ref", input.ref)
    .maybeSingle();
  const priorId = String((existing as { drive_file_id?: string } | null)?.drive_file_id || "");
  if (priorId) {
    return { ok: true, driveFileId: priorId, driveUrl: driveViewUrl(priorId), alreadyArchived: true };
  }
  const attempts = Number((existing as { attempts?: number } | null)?.attempts || 0) + 1;
  const folder = input.folderPath.join(" / ");
  const now = new Date().toISOString();

  const uploaded = await uploadFileToDrive({
    folderPath: input.folderPath,
    fileName: input.fileName,
    mimeType: input.mimeType,
    data: input.data,
  });

  const row: {
    tenant_id: string;
    kind: ArchiveKind;
    ref: string;
    folder: string;
    file_name: string;
    mime_type: string;
    bytes: number;
    attempts: number;
    updated_at: string;
    drive_file_id: string;
    archived_at: string | null;
    error: string;
  } = {
    tenant_id: tenantId,
    kind: input.kind,
    ref: input.ref,
    folder,
    file_name: input.fileName,
    mime_type: input.mimeType,
    bytes: input.data.length,
    attempts,
    updated_at: now,
    drive_file_id: uploaded.ok ? uploaded.driveFileId : "",
    archived_at: uploaded.ok ? now : null,
    error: uploaded.ok ? "" : uploaded.error.slice(0, 500),
  };
  const { error } = await sb
    .from("drive_archive")
    .upsert(row, { onConflict: "tenant_id,kind,ref" });
  if (error) console.warn("[drive-archive] row write failed", error.message);

  if (!uploaded.ok) return { ok: false, error: uploaded.error };
  return {
    ok: true,
    driveFileId: uploaded.driveFileId,
    driveUrl: driveViewUrl(uploaded.driveFileId),
    alreadyArchived: false,
  };
}

/** Refs already archived for a kind — the sweep's "skip these" set. */
export async function archivedRefs(kind: ArchiveKind): Promise<Set<string> | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("drive_archive")
    .select("ref")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", kind)
    .neq("drive_file_id", "");
  if (error) {
    console.warn("[drive-archive] refs read failed", error.message);
    return null;
  }
  return new Set((data ?? []).map((r) => String((r as { ref: string }).ref)));
}

export async function listArchive(opts: {
  kind?: ArchiveKind;
  limit?: number;
}): Promise<{ rows: ArchiveRow[]; counts: Record<string, { archived: number; failed: number }> } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  let q = ctx.sb
    .from("drive_archive")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  if (opts.kind) q = q.eq("kind", opts.kind);
  const { data, error } = await q;
  if (error) {
    console.warn("[drive-archive] list failed", error.message);
    return null;
  }
  const { data: all } = await ctx.sb
    .from("drive_archive")
    .select("kind, drive_file_id")
    .eq("tenant_id", ctx.tenantId);
  const counts: Record<string, { archived: number; failed: number }> = {};
  for (const r of (all ?? []) as { kind: string; drive_file_id: string }[]) {
    const c = (counts[r.kind] ??= { archived: 0, failed: 0 });
    if (r.drive_file_id) c.archived++;
    else c.failed++;
  }
  return { rows: (data ?? []).map((r) => rowToArchive(r as Record<string, unknown>)), counts };
}
