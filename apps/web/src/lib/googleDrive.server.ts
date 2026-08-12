/**
 * Google Drive API — core upload/read/delete primitives for document storage.
 * See docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md. Plain REST calls, no googleapis
 * package, matching googleClassroom.server.ts's style. drive.file scope only
 * — every folder/file this touches was created by this app.
 */

import { TENANT } from "@/lib/types";
import { refreshGoogleAccessToken } from "@/lib/googleOAuth.server";
import {
  getDriveConnection,
  updateDriveAccessToken,
} from "@/lib/googleDrive.store.server";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const ROOT_FOLDER_NAME = `${TENANT.shortName} — Documents`;

async function ensureDriveAccessToken(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const conn = await getDriveConnection();
  if (!conn) {
    return { ok: false, error: "Google Drive not connected" };
  }
  const expires = new Date(conn.expiresAt).getTime();
  if (expires > Date.now() + 60_000) {
    return { ok: true, accessToken: conn.accessToken };
  }
  const refreshed = await refreshGoogleAccessToken(conn.refreshToken);
  if (!refreshed.ok) {
    return {
      ok: false,
      error: `${refreshed.error} — reconnect Google Drive`,
    };
  }
  const expiresAt = new Date(
    Date.now() + refreshed.expiresIn * 1000,
  ).toISOString();
  await updateDriveAccessToken(refreshed.accessToken, expiresAt);
  return { ok: true, accessToken: refreshed.accessToken };
}

function escapeDriveQueryValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFetch<T>(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return {
        ok: false,
        error: body.error?.message || `Drive HTTP ${res.status}`,
        status: res.status,
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Drive request failed",
      status: 0,
    };
  }
}

/** Find or create one folder under `parentId` (or Drive root when null). */
async function ensureFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
): Promise<string | null> {
  const q = [
    `name='${escapeDriveQueryValue(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `'${parentId || "root"}' in parents`,
  ].join(" and ");
  const params = new URLSearchParams({
    q,
    fields: "files(id,name)",
    pageSize: "1",
  });
  const found = await driveFetch<{ files?: { id: string }[] }>(
    accessToken,
    `${DRIVE_API}/files?${params.toString()}`,
  );
  if (found.ok && found.data.files?.[0]?.id) {
    return found.data.files[0].id;
  }
  if (!found.ok) console.warn("[googleDrive] folder search failed:", found.error);

  const created = await driveFetch<{ id: string }>(
    accessToken,
    `${DRIVE_API}/files?fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : undefined,
      }),
    },
  );
  if (!created.ok) console.warn("[googleDrive] folder create failed:", created.error);
  return created.ok ? created.data.id : null;
}

async function resolveFolderPath(
  accessToken: string,
  segments: string[],
): Promise<{ ok: true; folderId: string } | { ok: false; error: string }> {
  let parent: string | null = null;
  for (const seg of [ROOT_FOLDER_NAME, ...segments]) {
    const id = await ensureFolder(accessToken, seg, parent);
    if (!id) {
      return { ok: false, error: `Could not create/find Drive folder "${seg}"` };
    }
    parent = id;
  }
  return { ok: true, folderId: parent as string };
}

export type DriveFileMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
};

export async function uploadFileToDrive(input: {
  /** Folder segments under the tenant root, e.g. ["students", studentId]. */
  folderPath: string[];
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<
  | { ok: true; driveFileId: string }
  | { ok: false; error: string }
> {
  const token = await ensureDriveAccessToken();
  if (!token.ok) return token;

  const folder = await resolveFolderPath(token.accessToken, input.folderPath);
  if (!folder.ok) return folder;

  const boundary = `bhbdrive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: input.fileName,
    parents: [folder.folderId],
  });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    ),
    input.data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await driveFetch<{ id: string }>(
    token.accessToken,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, driveFileId: res.data.id };
}

export async function getDriveFileMeta(
  driveFileId: string,
): Promise<{ ok: true; meta: DriveFileMeta } | { ok: false; error: string }> {
  const token = await ensureDriveAccessToken();
  if (!token.ok) return token;

  const res = await driveFetch<{
    id: string;
    name: string;
    mimeType: string;
    size?: string;
  }>(
    token.accessToken,
    `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?fields=id,name,mimeType,size`,
  );
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    meta: {
      id: res.data.id,
      name: res.data.name,
      mimeType: res.data.mimeType,
      size: res.data.size ? Number(res.data.size) : null,
    },
  };
}

export async function getDriveFileContent(driveFileId: string): Promise<
  | { ok: true; meta: DriveFileMeta; body: ReadableStream<Uint8Array> }
  | { ok: false; error: string }
> {
  const token = await ensureDriveAccessToken();
  if (!token.ok) return token;

  const meta = await getDriveFileMeta(driveFileId);
  if (!meta.ok) return meta;

  try {
    const res = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } },
    );
    if (!res.ok || !res.body) {
      return { ok: false, error: `Drive content HTTP ${res.status}` };
    }
    return { ok: true, meta: meta.meta, body: res.body };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Drive content request failed",
    };
  }
}

export async function deleteDriveFile(
  driveFileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await ensureDriveAccessToken();
  if (!token.ok) return token;

  // Drive returns 204 No Content on success — bypass driveFetch, whose
  // res.json() would throw on an empty body. 404 (already gone) also
  // counts as success — delete is idempotent.
  try {
    const res = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(driveFileId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token.accessToken}` },
      },
    );
    if (res.ok || res.status === 404) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    return { ok: false, error: body.error?.message || `Drive HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Drive delete request failed",
    };
  }
}
