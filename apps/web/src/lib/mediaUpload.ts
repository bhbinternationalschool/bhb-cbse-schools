"use client";

/**
 * Put a file in storage and get back a URL worth saving.
 *
 * The one rule: this never invents a fallback. The old image pickers read the
 * file into a base64 `data:` URL and handed that to `onChange`, so an upload
 * that had failed — or had never been attempted — looked exactly like one
 * that worked. The picture appeared on screen, the form saved, and 45 kB of
 * base64 went into the database. Every caller believed it had a URL.
 *
 * So: it uploads, or it returns an error the caller must show. There is no
 * third outcome.
 */

import {
  bucketFor,
  describeLimit,
  maxBytesFor,
  type MediaVisibility,
} from "@/lib/media";

export type MediaUploadResult =
  | { ok: true; url: string; path: string; bytes: number }
  | { ok: false; error: string };

/** Longest edge, in pixels, for a photograph we are about to store. */
const MAX_EDGE = 1600;
/** Aim for this; a still above it gets re-encoded rather than refused. */
const TARGET_IMAGE_BYTES = 600_000;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * A storage key that changes whenever the content does.
 *
 * Files are served with a one-year cache header, so re-uploading over the
 * same key would leave the old picture on screens and printed pages for
 * months. A fresh key per upload sidesteps cache invalidation entirely.
 */
export function mediaKey(prefix: string, filename: string): string {
  const ext = (filename.split(".").pop() || "jpg").toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);
  return `${prefix.replace(/\/+$/, "")}/${stamp}-${randomSuffix()}.${ext}`;
}

async function blobFromCanvas(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Shrink a photograph before it leaves the device.
 *
 * Parents and staff upload straight from a phone camera, which means 4 MB of
 * 4000-pixel JPEG for a passport photo shown at 96 pixels. Resizing here
 * saves their data as well as ours. Anything that is not a raster photo — a
 * PNG with transparency, a PDF, a video — is passed through untouched.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  const passThrough =
    !file.type.startsWith("image/") ||
    file.type === "image/gif" ||
    file.type === "image/avif";
  if (passThrough) return file;

  // A logo or a signature is usually a PNG whose transparency matters, and
  // re-encoding it to JPEG would put a white box behind it.
  const keepAlpha = file.type === "image/png" || file.type === "image/webp";

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // Not decodable here; let the server judge it.
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const smallEnough = scale === 1 && file.size <= TARGET_IMAGE_BYTES;
  if (smallEnough) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const type = keepAlpha ? "image/png" : "image/jpeg";
  let quality = 0.85;
  let out = await blobFromCanvas(canvas, type, quality);
  while (out && out.size > TARGET_IMAGE_BYTES && quality > 0.45 && !keepAlpha) {
    quality -= 0.1;
    out = await blobFromCanvas(canvas, type, quality);
  }
  // If re-encoding made it bigger — common for flat PNG logos — keep the
  // original rather than paying for our own work.
  return out && out.size < file.size ? out : file;
}

/**
 * Upload one file and return its stored URL.
 *
 * `pathPrefix` is a folder, e.g. `brand` or `staff/BHB001`; the filename is
 * generated so repeat uploads never collide or serve a cached predecessor.
 */
export async function uploadMedia(input: {
  file: File;
  visibility: MediaVisibility;
  pathPrefix: string;
  /** Skip the client-side resize — for a file that must be stored verbatim. */
  verbatim?: boolean;
}): Promise<MediaUploadResult> {
  const bucket = bucketFor(input.visibility);

  const blob = input.verbatim ? input.file : await shrinkImage(input.file);
  const limit = maxBytesFor(bucket, input.file.type || "application/octet-stream");
  if (limit === 0) {
    return {
      ok: false,
      error: "This kind of file cannot be stored here.",
    };
  }
  if (blob.size > limit) {
    return {
      ok: false,
      error: `That file is ${describeLimit(blob.size)}. The limit is ${describeLimit(limit)}.`,
    };
  }

  const path = mediaKey(input.pathPrefix, input.file.name || "upload.jpg");
  const form = new FormData();
  form.append(
    "file",
    new File([blob], path.split("/").pop() as string, {
      type: blob.type || input.file.type,
    }),
  );
  form.append("path", path);
  form.append("bucket", bucket);

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
      error: "Could not reach the server. Check the connection and try again.",
    };
  }

  let body: { ok?: boolean; url?: string; path?: string; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* fall through to the status-based message */
  }

  if (!res.ok || !body.ok || !body.url) {
    return {
      ok: false,
      error:
        body.error ||
        `Upload failed (${res.status}). The file was not saved.`,
    };
  }

  return {
    ok: true,
    url: body.url,
    path: body.path || path,
    bytes: blob.size,
  };
}
