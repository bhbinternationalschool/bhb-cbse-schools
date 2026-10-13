import { NextResponse } from "next/server";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  deniedSliceGuard,
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

function recentlyPublished(at: string | undefined): boolean {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) && Date.now() - t < 24 * 3600 * 1000;
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
  // Whole-module holder: refused only where the office has turned one of
  // this desk's functions off for them (Masters → Roles → Assign to user).
  if (gate.mode === "full") {
    const refused = await deniedSliceGuard(
      req,
      "notices",
      async () => {
        const s = await fetchSchoolCommsDeskFromDb();
        return s.ok ? (canonicalCommsDesk(s.bundle) as unknown as Record<string, unknown>) : null;
      },
      canonicalCommsDesk(body),
    );
    if (refused) return refused;
  }
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

  // Phones: a notice this save published (13 Oct 2026). Read back from the
  // database — the desk is "newer wins", so the row that stands is the one to
  // trust — and pushed once per notice (lib/noticePush.server).
  const justPublished = (body.notices ?? []).filter((n) => n.status === "published" && recentlyPublished(n.publishedAt));
  if (justPublished.length) {
    const stored = await fetchSchoolCommsDeskFromDb();
    if (stored.ok) {
      const { pushPublishedNotice } = await import("@/lib/noticePush.server");
      for (const n of justPublished) {
        const saved = stored.bundle.notices.find((x) => x.id === n.id);
        if (saved?.status === "published") await pushPublishedNotice(saved);
      }
    }
  }

  if (gate.mode === "feature") return featureSavedResponse(true);
  return NextResponse.json({
    ok: true,
    noticeCount: body.notices?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
