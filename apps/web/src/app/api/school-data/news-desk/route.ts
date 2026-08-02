import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { newsDualWriteDbEnabled } from "@/lib/newsDbConfig";
import type { NewsDeskBundle } from "@/lib/schoolCommsNormalized.server";
import {
  fetchNewsDeskFromDb,
  pushNewsDeskToDb,
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
  const { bundle, meta } = await fetchNewsDeskFromDb();
  return NextResponse.json({
    ok: true,
    news: bundle.news,
    newsCount: bundle.news.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
