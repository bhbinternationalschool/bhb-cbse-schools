import { NextResponse } from "next/server";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
} from "@/lib/deskFeatureGate.server";
import type { SchoolCommsState } from "@/lib/schoolComms";
import { schoolCommsDualWriteDbEnabled } from "@/lib/schoolCommsDbConfig";
import {
  canonicalCommsDesk,
  fetchSchoolCommsDeskFromDb,
  pushSchoolCommsDeskToDb,
  SCHOOL_COMMS_DELETABLE_TABLES,
  SCHOOL_COMMS_TABLE_SLICES,
} from "@/lib/schoolCommsNormalized.server";
import { readNamedDeletes } from "@/lib/deskNamedDeletes.server";
import { featureAuthorizedDeletes } from "@/lib/deskNamedDeletesFeature.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // The whole desk, or — holding Notices functions only — their slices.
  // News, albums and photos ride on this desk too; they are read through
  // the news and gallery desks, under those modules' own grants.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["school-comms-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta, ok } = await fetchSchoolCommsDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch school comms desk" },
      { status: 503 },
    );
  }
  const bundle = gate.mode === "feature" ? stripDeskForFeatures("notices", full, gate) : full;
  return NextResponse.json({
    ok: true,
    ...bundle,
    noticeCount: bundle.notices.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["school-comms-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (!schoolCommsDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Pick<SchoolCommsState, "notices" | "news" | "albums" | "photos"> & { deletes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Deletions are named by the desk, never inferred from what it lacks.
  let deletes = readNamedDeletes(body.deletes, SCHOOL_COMMS_DELETABLE_TABLES);

  // Function-only writers (Notices → Notices & circulars): merged onto the
  // stored desk, their notices only — never the body as sent. Their copy of
  // news and albums is empty (GET serves them only their slices), and this
  // push would otherwise prune the school's news and gallery with it.
  if (gate.mode === "feature") {
    const stored = await fetchSchoolCommsDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved notices — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(
      gate,
      "notices",
      canonicalCommsDesk(stored.bundle),
      canonicalCommsDesk(body),
    );
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    deletes = featureAuthorizedDeletes(deletes, SCHOOL_COMMS_TABLE_SLICES, canonicalCommsDesk(stored.bundle), merged.state);
    body = merged.state as unknown as typeof body;
  }

  const result = await pushSchoolCommsDeskToDb({
    version: 1,
    notices: body.notices ?? [],
    news: body.news ?? [],
    albums: body.albums ?? [],
    photos: body.photos ?? [],
  }, deletes);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  if (gate.mode === "feature") return featureSavedResponse(true);
  return NextResponse.json({
    ok: true,
    noticeCount: body.notices?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
