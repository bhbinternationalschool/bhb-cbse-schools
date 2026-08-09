import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { newsDualWriteDbEnabled } from "@/lib/newsDbConfig";
import type { NewsDeskBundle } from "@/lib/schoolCommsNormalized.server";
import {
  fetchNewsDeskFromDb,
  pushNewsDeskToDb,
} from "@/lib/schoolCommsNormalized.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["news-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta, ok } = await fetchNewsDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "News desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    news: bundle.news,
    newsCount: bundle.news.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["news-desk"], "POST");
  if (!auth.ok) return auth.response
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

  const result = await pushNewsDeskToDb({
    news: Array.isArray(body.news) ? body.news : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    newsCount: body.news?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
