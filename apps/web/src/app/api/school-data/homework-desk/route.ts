import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { HomeworkState } from "@/lib/homework";
import { homeworkDualWriteDbEnabled } from "@/lib/homeworkDbConfig";
import {
  fetchHomeworkDeskFromDb,
  pushHomeworkDeskToDb,
} from "@/lib/homeworkNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull homework desk from normalized tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, meta } = await fetchHomeworkDeskFromDb();
  return NextResponse.json({
    ok: true,
    posts: bundle.posts,
    diary: bundle.diary,
    submissions: bundle.submissions,
    seen: bundle.seen,
    settings: bundle.settings,
    postCount: bundle.posts.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type HomeworkDeskPostBody = Pick<
  HomeworkState,
  "posts" | "diary" | "submissions" | "seen" | "settings"
>;

/** POST — push full homework desk snapshot */
export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!homeworkDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "HOMEWORK_DUAL_WRITE_DB disabled",
    });
  }

  let body: HomeworkDeskPostBody;
  try {
    body = (await req.json()) as HomeworkDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await pushHomeworkDeskToDb({
    version: 1,
    posts: Array.isArray(body.posts) ? body.posts : [],
    diary: Array.isArray(body.diary) ? body.diary : [],
    submissions: Array.isArray(body.submissions) ? body.submissions : [],
    seen: Array.isArray(body.seen) ? body.seen : [],
    settings: body.settings ?? { examModeFreeze: false },
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    postCount: body.posts?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
