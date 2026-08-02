import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { galleryDualWriteDbEnabled } from "@/lib/galleryDbConfig";
import type { GalleryDeskBundle } from "@/lib/schoolCommsNormalized.server";
import {
  fetchGalleryDeskFromDb,
  pushGalleryDeskToDb,
} from "@/lib/schoolCommsNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchGalleryDeskFromDb();
  return NextResponse.json({
    ok: true,
    albums: bundle.albums,
    photos: bundle.photos,
    albumCount: bundle.albums.length,
    photoCount: bundle.photos.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!galleryDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "GALLERY_DUAL_WRITE_DB disabled",
    });
  }

  let body: GalleryDeskBundle;
  try {
    body = (await req.json()) as GalleryDeskBundle;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushGalleryDeskToDb({
    albums: Array.isArray(body.albums) ? body.albums : [],
    photos: Array.isArray(body.photos) ? body.photos : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    albumCount: body.albums?.length ?? 0,
    photoCount: body.photos?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
