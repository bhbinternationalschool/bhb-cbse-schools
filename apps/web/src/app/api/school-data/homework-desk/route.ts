import { NextResponse } from "next/server";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { HomeworkState } from "@/lib/homework";
import { homeworkDualWriteDbEnabled } from "@/lib/homeworkDbConfig";
import {
  fetchHomeworkDeskFromDb,
  pushHomeworkDeskToDb,
  type HomeworkTeacherSave,
} from "@/lib/homeworkNormalized.server";

export const runtime = "nodejs";

/** GET — pull homework desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["homework-desk"], "GET");
  if (!auth.ok) return auth.response
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
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["homework-desk"], "POST");
  if (!auth.ok) return auth.response
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

  // A teacher's copy is not the whole desk: their save writes only what
  // they own and prunes nothing else (lib/homeworkNormalized.server.ts,
  // 2026-09-30). Unknown scope → refuse rather than prune on a guess.
  let teacher: HomeworkTeacherSave | undefined;
  if (!auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx).catch(() => null);
    if (!scope) {
      return NextResponse.json({ ok: false, error: "Could not work out your classes — try again" }, { status: 503 });
    }
    if (!scope.unrestricted) {
      teacher = {
        staffId: auth.ctx.session.staffId || "",
        allows: (classId, sectionId) => scopeAllows(scope, classId, sectionId),
      };
    }
  }

  const result = await pushHomeworkDeskToDb({
    version: 1,
    posts: Array.isArray(body.posts) ? body.posts : [],
    diary: Array.isArray(body.diary) ? body.diary : [],
    submissions: Array.isArray(body.submissions) ? body.submissions : [],
    seen: Array.isArray(body.seen) ? body.seen : [],
    settings: body.settings ?? { examModeFreeze: false },
  }, teacher);
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
