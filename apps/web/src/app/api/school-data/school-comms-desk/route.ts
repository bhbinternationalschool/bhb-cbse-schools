import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { SchoolCommsState } from "@/lib/schoolComms";
import { schoolCommsDualWriteDbEnabled } from "@/lib/schoolCommsDbConfig";
import {
  fetchSchoolCommsDeskFromDb,
  pushSchoolCommsDeskToDb,
} from "@/lib/schoolCommsNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  return !!(await getDemoSession());
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchSchoolCommsDeskFromDb();
  return NextResponse.json({
    ok: true,
    ...bundle,
    noticeCount: bundle.notices.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!schoolCommsDualWriteDbEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let body: Pick<SchoolCommsState, "notices" | "news" | "albums" | "photos">;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushSchoolCommsDeskToDb({
    version: 1,
    notices: body.notices ?? [],
    news: body.news ?? [],
    albums: body.albums ?? [],
    photos: body.photos ?? [],
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    noticeCount: body.notices?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
