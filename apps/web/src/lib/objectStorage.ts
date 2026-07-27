/**
 * School object storage — staff docs / student photos.
 * Prefer Supabase Storage bucket `school-files`; else GCS env; else local data URL.
 */

import { createBrowserSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

export type ObjectUploadResult =
  | { ok: true; url: string; mode: "supabase" | "gcs" | "local"; path: string }
  | { ok: false; error: string };

function sanitizePath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9._\-/]/g, "_");
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Upload a blob under tenant-scoped path.
 * @param path e.g. `staff/BHB001/photo.jpg` or `students/adm123/id.jpg`
 */
export async function uploadSchoolObject(input: {
  path: string;
  blob: Blob;
  contentType?: string;
  upsert?: boolean;
}): Promise<ObjectUploadResult> {
  const path = sanitizePath(input.path);
  if (!path) return { ok: false, error: "Invalid path" };
  const contentType =
    input.contentType || input.blob.type || "application/octet-stream";

  if (isSupabaseConfigured()) {
    const sb = createBrowserSupabase();
    if (sb) {
      const { error } = await sb.storage.from("school-files").upload(path, input.blob, {
        contentType,
        upsert: input.upsert !== false,
      });
      if (!error) {
        const { data } = sb.storage.from("school-files").getPublicUrl(path);
        return {
          ok: true,
          url: data.publicUrl,
          mode: "supabase",
          path,
        };
      }
      // Fall through if bucket missing / RLS — local still works for desk
      if (!/not found|Bucket not found/i.test(error.message || "")) {
        // signed URL path for private buckets
        const signed = await sb.storage
          .from("school-files")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (!signed.error && signed.data?.signedUrl) {
          return {
            ok: true,
            url: signed.data.signedUrl,
            mode: "supabase",
            path,
          };
        }
      }
    }
  }

  const gcsBucket = process.env.NEXT_PUBLIC_GCS_BUCKET || process.env.GCS_BUCKET;
  const gcsBase =
    process.env.NEXT_PUBLIC_GCS_PUBLIC_BASE_URL ||
    process.env.GCS_PUBLIC_BASE_URL;
  if (gcsBucket && gcsBase && typeof window === "undefined") {
    // Server-side GCS would need @google-cloud/storage — not bundled for browser.
    // Expose a note; clients use local until a signed-upload API exists.
  }

  try {
    const url = await blobToDataUrl(input.blob);
    return { ok: true, url, mode: "local", path };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Upload failed",
    };
  }
}

export function objectStorageHint(): string {
  if (isSupabaseConfigured()) {
    return "Uploads go to Supabase Storage bucket school-files when available; otherwise stored as local data URLs.";
  }
  return "Supabase not configured — uploads stay as local data URLs on this device.";
}
