import { NextResponse } from "next/server";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import {
  deskFeatureGateFor,
  featurePushOutcome,
  featureSavedResponse,
  stripDeskForFeatures,
  type FeatureGate,
} from "@/lib/deskFeatureGate.server";
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
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "homework", "read");
    if (!gate) return auth.response;
  }
  const { bundle: full, meta } = await fetchHomeworkDeskFromDb();
  // A function holder (Homework → Set homework, Class diary, …) gets their
  // slices; class-scoped ones only for their own classes. Checking work
  // needs the posts it answers, so a reviewer sees the posts too.
  let bundle = full;
  if (gate) {
    const g = gate;
    const holds = (id: string) =>
      (["view", "create", "edit", "delete"] as const).some((a) => g.access(id, a).allowed);
    const own = <T extends { classId: string }>(rows: T[]) =>
      g.ownClassIds ? rows.filter((r) => g.ownClassIds!.has(r.classId)) : rows;
    const cut = stripDeskForFeatures("homework", full, g);
    bundle = {
      ...cut,
      posts: holds("homework.assign") || holds("homework.review") ? own(full.posts) : [],
      diary: holds("homework.diary") ? own(full.diary) : [],
    };
  }
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
  // Without the module: a function holder's save, or refused.
  let gate: FeatureGate | null = null;
  if (!auth.ok) {
    if (auth.response.status !== 403) return auth.response;
    gate = await deskFeatureGateFor(req, "homework", "write");
    if (!gate) return auth.response;
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

  // A teacher's copy is not the whole desk: their save writes only what
  // they own and prunes nothing else (lib/homeworkNormalized.server.ts,
  // 2026-09-30). Unknown scope → refuse rather than prune on a guess.
  // The same rule for a function holder: outside the office they write
  // only their own posts, diary and the submissions to their posts.
  let teacher: HomeworkTeacherSave | undefined;
  const scopeCtx = gate ? gate.ctx : auth.ok && !auth.viaMirrorSecret ? auth.ctx : null;
  if (scopeCtx) {
    const scope = await staffSectionScope(scopeCtx).catch(() => null);
    if (!scope) {
      return NextResponse.json({ ok: false, error: "Could not work out your classes — try again" }, { status: 503 });
    }
    if (!scope.unrestricted) {
      teacher = {
        staffId: scopeCtx.session.staffId || "",
        allows: (classId, sectionId) => scopeAllows(scope, classId, sectionId),
      };
    }
  }

  // Function holders: merged onto the stored desk, only their functions'
  // slices, class-scoped rows only in their classes — never the body as sent.
  if (gate) {
    const stored = await fetchHomeworkDeskFromDb();
    if (!stored.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not read the saved homework desk — nothing was written. Try again." },
        { status: 503 },
      );
    }
    const merged = featurePushOutcome(gate, "homework", stored.bundle, body);
    if (!merged.ok) return merged.response;
    if (!merged.changed) return featureSavedResponse(false);
    body = merged.state as unknown as HomeworkDeskPostBody;
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

  if (gate) return featureSavedResponse(true);
  return NextResponse.json({
    ok: true,
    postCount: body.posts?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
