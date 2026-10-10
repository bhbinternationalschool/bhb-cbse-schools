import { NextResponse } from "next/server";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
} from "@/lib/deskFeatureGate.server";
import { galleryDualWriteDbEnabled } from "@/lib/galleryDbConfig";
import type { GalleryDeskBundle } from "@/lib/schoolCommsNormalized.server";
import {
  canonicalCommsDesk,
  fetchGalleryDeskFromDb,
  pushGalleryDeskToDb,
  SCHOOL_COMMS_DELETABLE_TABLES,
  SCHOOL_COMMS_TABLE_SLICES,
} from "@/lib/schoolCommsNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { featureAuthorizedDeletes } from "@/lib/deskNamedDeletesFeature.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // The whole desk, or — holding Gallery functions only — their slices.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["gallery-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta, ok } = await fetchGalleryDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Gallery desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  const bundle = gate.mode === "feature" ? stripDeskForFeatures("gallery", full, gate) : full;
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
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["gallery-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (!galleryDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "GALLERY_DUAL_WRITE_DB disabled",
    });
  }

  let body: GalleryDeskBundle & { deletes?: unknown };
  try {
    body = (await req.json()) as GalleryDeskBundle;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Deletions are named by the desk, never inferred from what it lacks.
  let deletes = readNamedDeletes(body.deletes, SCHOOL_COMMS_DELETABLE_TABLES);

  // Function-only writers (Gallery → Albums & photos): merged onto the
  // stored desk, row by row — never the body as sent.
  if (gate.mode === "feature") {
    const stored = await fetchGalleryDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved gallery — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(
      gate,
      "gallery",
      canonicalCommsDesk(stored.bundle),
      canonicalCommsDesk({
        albums: Array.isArray(body.albums) ? body.albums : [],
        photos: Array.isArray(body.photos) ? body.photos : [],
      }),
    );
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    deletes = featureAuthorizedDeletes(deletes, SCHOOL_COMMS_TABLE_SLICES, canonicalCommsDesk(stored.bundle), merged.state);
    body = merged.state as unknown as GalleryDeskBundle;
  }

  const result = await pushGalleryDeskToDb({
    albums: Array.isArray(body.albums) ? body.albums : [],
    photos: Array.isArray(body.photos) ? body.photos : [],
  }, deletes);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  if (gate.mode === "feature") return featureSavedResponse(true);
  return NextResponse.json({
    ok: true,
    albumCount: body.albums?.length ?? 0,
    photoCount: body.photos?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
