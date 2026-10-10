/**
 * Upload a blob to school object storage and get back a URL to store.
 *
 * This used to end with a `local` mode: when no bucket was reachable it
 * returned the file as a base64 `data:` URL and reported `ok: true`. Every
 * caller that checked only for failure then persisted the image itself into
 * whatever row it was filling. That mode is gone. An upload that does not
 * reach storage now fails, and says why.
 *
 * The work happens in `/api/upload`, which holds the service-role key; the
 * browser never talks to Supabase Storage directly.
 */

import type { MediaVisibility } from "@/lib/media";
import { bucketFor, sanitizeMediaPath } from "@/lib/media";

export type ObjectUploadResult =
  | { ok: true; url: string; bucket: string; path: string }
  | { ok: false; error: string };

/**
 * @param path   tenant-scoped key, e.g. `staff/BHB001/photo.jpg`
 * @param visibility `private` (default) keeps it behind a staff session;
 *                   `public` publishes it at a permanent URL.
 */
export async function uploadSchoolObject(input: {
  path: string;
  blob: Blob;
  contentType?: string;
  visibility?: MediaVisibility;
}): Promise<ObjectUploadResult> {
  const path = sanitizeMediaPath(input.path);
  if (!path) return { ok: false, error: "Invalid path" };

  const visibility = input.visibility ?? "private";
  const contentType =
    input.contentType || input.blob.type || "application/octet-stream";
  const filename = path.split("/").pop() || "upload.bin";

  const form = new FormData();
  form.append("file", new File([input.blob], filename, { type: contentType }));
  form.append("path", path);
  form.append("bucket", bucketFor(visibility));

  let res: Response;
  try {
    res = await fetch("/api/upload", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
  } catch {
    return {
      ok: false,
      error: "Could not reach the server — the file was not saved.",
    };
  }

  let body: {
    ok?: boolean;
    url?: string;
    bucket?: string;
    path?: string;
    error?: string;
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* status alone will have to explain it */
  }

  if (!res.ok || !body.ok || !body.url) {
    return {
      ok: false,
      error: body.error || `Upload failed (${res.status}) — nothing was saved.`,
    };
  }

  return {
    ok: true,
    url: body.url,
    bucket: body.bucket || bucketFor(visibility),
    path: body.path || path,
  };
}

export function objectStorageHint(): string {
  return "Files go to Supabase Storage. An upload that fails is reported — nothing is stored on the device instead.";
}
