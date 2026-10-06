import { NextResponse } from "next/server";
import { SCHOOL_DATA_DESK_RBAC } from "@/lib/apiRouteAuth.server";
import {
  deskReadGate,
  deskWriteGate,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
} from "@/lib/deskFeatureGate.server";
import { newsDualWriteDbEnabled } from "@/lib/newsDbConfig";
import type { NewsDeskBundle } from "@/lib/schoolCommsNormalized.server";
import {
  canonicalCommsDesk,
  fetchNewsDeskFromDb,
  pushNewsDeskToDb,
} from "@/lib/schoolCommsNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // The whole desk, or — holding News functions only — their slices.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["news-desk"]);
  if (gate.mode === "deny") return gate.response;
  const { bundle: full, meta, ok } = await fetchNewsDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "News desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  const bundle = gate.mode === "feature" ? stripDeskForFeatures("news", full, gate) : full;
  return NextResponse.json({
    ok: true,
    news: bundle.news,
    newsCount: bundle.news.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const gate = await deskWriteGate(req, SCHOOL_DATA_DESK_RBAC["news-desk"]);
  if (gate.mode === "deny") return gate.response;
  if (!newsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "NEWS_DUAL_WRITE_DB disabled",
    });
  }

  let body: NewsDeskBundle;
  try {
    body = (await req.json()) as NewsDeskBundle;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Function-only writers (News → News stories): merged onto the stored
  // desk, row by row — never the body as sent.
  if (gate.mode === "feature") {
    const stored = await fetchNewsDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved news — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(
      gate,
      "news",
      canonicalCommsDesk(stored.bundle),
      canonicalCommsDesk({ news: Array.isArray(body.news) ? body.news : [] }),
    );
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    body = merged.state as unknown as NewsDeskBundle;
  }

  const result = await pushNewsDeskToDb({
    news: Array.isArray(body.news) ? body.news : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  if (gate.mode === "feature") return featureSavedResponse(true);
  return NextResponse.json({
    ok: true,
    newsCount: body.news?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
