import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  MEDIA_BUCKETS,
  type MediaBucket,
  contentTypeFor,
  describeLimit,
  maxBytesFor,
  privateMediaUrl,
  publicMediaUrl,
  sanitizeMediaPath,
} from "@/lib/media";
import { archiveToDrive } from "@/lib/driveArchive.server";
import { mediaArchiveFileName, mediaArchiveFolder } from "@/lib/driveArchive";

export const runtime = "nodejs";

/**
 * Take a file and hand back a URL that will still work tomorrow.
 *
 * This route used to return `getPublicUrl()` for a bucket that is private,
 * which 403s for everyone — so every upload appeared to succeed and produced
 * a dead link, and the pickers fell back to writing base64 into the database.
 * The two things it now gets right:
 *
 *   - it uploads into the bucket that matches the file's audience, and
 *   - it returns the URL that bucket is actually served from — Supabase's
 *     public URL for `site-media`, our own `/api/file` path for
 *     `school-files`, never an expiring signed URL.
 */

function bucketFromRequest(raw: string | null): MediaBucket | null {
  if (!raw) return "school-files"; // the historical default
  return raw === "site-media" || raw === "school-files" ? raw : null;
}

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Supabase service role not configured" },
      { status: 503 },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const bucket = bucketFromRequest(formData.get("bucket") as string | null);
    if (!bucket) {
      return NextResponse.json({ error: "Unknown bucket" }, { status: 400 });
    }

    const rawPath = (formData.get("path") as string) || file.name || "upload.bin";
    const path = sanitizeMediaPath(rawPath);
    if (!path || path.endsWith("/")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const contentType = contentTypeFor(bucket, path);
    if (!contentType) {
      const allowed = Object.keys(MEDIA_BUCKETS[bucket].types).join(", ");
      return NextResponse.json(
        {
          error: `Cannot store a .${path.split(".").pop() || "?"} file here. Allowed: ${allowed}.`,
        },
        { status: 415 },
      );
    }

    const limit = maxBytesFor(bucket, contentType);
    if (limit === 0) {
      return NextResponse.json(
        { error: "Video is not allowed in this bucket" },
        { status: 415 },
      );
    }
    if (file.size > limit) {
      return NextResponse.json(
        {
          error: `File is ${describeLimit(file.size)} — the limit here is ${describeLimit(limit)}.`,
        },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await ctx.sb.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType,
        upsert: true,
        // A year. Callers version the filename when the content changes, so a
        // stale copy is never the answer to a request for the new one.
        cacheControl: "31536000",
      });

    if (uploadErr) {
      console.warn("[api/upload] storage rejected the file:", uploadErr.message);
      return NextResponse.json(
        { error: uploadErr.message || "Storage upload failed" },
        { status: 500 },
      );
    }

    const url =
      MEDIA_BUCKETS[bucket].visibility === "public"
        ? publicMediaUrl(
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
            path,
          )
        : privateMediaUrl(path);

    // The bucket is what serves the file; the school's Drive gets a copy it
    // can browse without the ERP. Drive being down does not undo the upload
    // — the row records the failure and the caller is told.
    const drive = await archiveToDrive({
      kind: "media",
      ref: `${bucket}/${path}`,
      folderPath: mediaArchiveFolder(bucket, new Date()),
      fileName: mediaArchiveFileName(path),
      mimeType: contentType,
      data: buffer,
    });
    if (!drive.ok) console.warn("[api/upload] drive archive failed:", drive.error);

    return NextResponse.json({
      ok: true,
      url,
      bucket,
      path,
      contentType,
      bytes: file.size,
      drive: drive.ok
        ? { ok: true, fileId: drive.driveFileId, url: drive.driveUrl }
        : { ok: false, error: drive.error },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
