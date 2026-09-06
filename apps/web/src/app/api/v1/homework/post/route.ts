import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import {
  assertPermission,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { postHomeworkServer } from "@/lib/homeworkPost.server";

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

    // Scope is this route's own guard: a teacher may only post to a
    // section they teach. It needs masters loaded, so it runs before the
    // shared helper (which hydrates again, idempotently).
    await ensureSchoolMirrorHydrated();
    await assertSectionScope(ctx, body.classId || "", body.sectionId || "");

    // Create + persist + notify live in one server-side helper, shared with
    // the ERP command desk so both cannot drift apart.
    const result = await postHomeworkServer({
      session: ctx.session,
      masters: ctx.masters,
      classId: body.classId || "",
      sectionId: body.sectionId || "",
      subjectId: body.subjectId || "",
      title: body.title || "",
      bodyEn: body.bodyEn || "",
      bodyHi: body.bodyHi || "",
      date: body.date,
      dueAt: body.dueAt,
      requiresSubmit: body.requiresSubmit,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

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
      push: result.push,
    });
  } catch (e) {
    return apiErr(e);
  }
}
