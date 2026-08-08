import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB

/** extension -> safe content-type; anything not listed is rejected. */
const ALLOWED_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

function sanitizePath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9._\-/]/g, "_");
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
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
    const rawPath = (formData.get("path") as string) || "";
    const path = sanitizePath(rawPath || (file ? file.name : "upload.bin"));

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit` },
        { status: 413 },
      );
    }
    const ext = extensionOf(path);
    const safeContentType = ALLOWED_TYPES[ext];
    if (!safeContentType) {
      return NextResponse.json(
        { error: `File type .${ext || "?"} is not allowed` },
        { status: 415 },
      );
    }
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const { error: uploadErr } = await ctx.sb.storage
      .from("school-files")
      .upload(path, buffer, {
        contentType: safeContentType,
        upsert: true,
      });

    if (uploadErr) {
      console.warn("[api/upload] Supabase upload failed:", uploadErr.message);
      return NextResponse.json(
        { error: uploadErr.message || "Storage upload failed" },
        { status: 500 },
      );
    }

    const { data } = ctx.sb.storage.from("school-files").getPublicUrl(path);

    return NextResponse.json({
      ok: true,
      url: data.publicUrl,
      mode: "supabase",
      path,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
