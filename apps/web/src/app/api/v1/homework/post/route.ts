import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import {
  assertPermission,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import {
  classLabel,
  createHomeworkPost,
  loadHomework,
  rosterForSection,
  subjectLabel,
  writeHomeworkLocalRaw,
} from "@/lib/homework";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { sendPushToSubjects } from "@/lib/webPush.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

type PostBody = {
  classId: string;
  sectionId: string;
  subjectId: string;
  title: string;
  bodyEn: string;
  bodyHi?: string;
  date?: string;
  dueAt?: string;
  requiresSubmit?: boolean;
};

/** POST /api/v1/homework/post — teacher publishes homework for a section */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "homework", "edit");

    const body = (await request.json()) as PostBody;

    await ensureSchoolMirrorHydrated();
    await assertSectionScope(ctx, body.classId || "", body.sectionId || "");
    await ensureHomeworkHydratedServer();

    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });

    const result = createHomeworkPost({
      academicYearCode: ctx.session.academicYearCode,
      classId: body.classId || "",
      sectionId: body.sectionId || "",
      subjectId: body.subjectId || "",
      teacherStaffId: ctx.session.staffId || "",
      teacherName: ctx.session.fullName,
      date: body.date || today,
      title: body.title || "",
      bodyEn: body.bodyEn || "",
      bodyHi: body.bodyHi || "",
      dueAt: body.dueAt || "",
      requiresSubmit: !!body.requiresSubmit,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    // saveHomework() inside createHomeworkPost is a no-op on the server
    // (localStorage-first design), so persist the mutation into the server
    // cache explicitly before pushing the bundle to the DB.
    const prior = loadHomework();
    const state = prior.posts.some((p) => p.id === result.post.id)
      ? prior
      : { ...prior, posts: [result.post, ...prior.posts] };
    writeHomeworkLocalRaw(state);

    const { pushHomeworkDeskToDb } = await import(
      "@/lib/homeworkNormalized.server"
    );
    const dbPush = await pushHomeworkDeskToDb({
      version: 1,
      posts: state.posts,
      diary: state.diary,
      submissions: state.submissions,
      seen: state.seen,
      settings: state.settings,
    });
    if (!dbPush.ok) {
      console.warn("[homework-v1] db push failed", dbPush.error);
    }

    // Push to every household with an active child in the section
    // (best-effort; app installs + PWA subscriptions).
    let push = { sent: 0, expired: 0, failed: 0 };
    try {
      await ensureSisHydratedServer();
      const households = rosterForSection(
        loadSis(),
        result.post.sectionId,
        result.post.academicYearCode,
      ).map((stu) => stu.householdId);
      const subject = subjectLabel(ctx.masters, result.post.subjectId);
      push = await sendPushToSubjects("parent", households, {
        title: `Homework · ${classLabel(ctx.masters, result.post.classId, result.post.sectionId)}`,
        body: `${subject ? `${subject}: ` : ""}${result.post.title}`,
        url: "/homework",
        data: { kind: "homework", postId: result.post.id },
      });
    } catch (e) {
      console.warn("[homework-v1] push failed", (e as Error)?.message);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "homework",
      action: "edit",
      entityType: "post",
      entityId: result.post.id,
      summary: `Posted homework "${result.post.title}" for section ${body.sectionId}`,
      after: { date: result.post.date, subjectId: result.post.subjectId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      postId: result.post.id,
      date: result.post.date,
      title: result.post.title,
      push,
    });
  } catch (e) {
    return apiErr(e);
  }
}
