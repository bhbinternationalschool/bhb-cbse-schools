import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { getSession } from "@/lib/onlineClasses.server";
import {
  generateSummary,
  getSummary,
  postSummaryHomework,
  saveSummary,
} from "@/lib/onlineClassQa.server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

async function load(request: Request, params: Params["params"], action: "view" | "edit") {
  const ctx = await resolveApiAuth(request);
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Staff session required", 403);
  }
  assertPermission(ctx, "online_classes", action);
  await ensureSchoolMirrorHydrated();
  const { id } = await params;
  const s = await getSession(id);
  if (!s) throw new ApiError("not_found", "Class not found", 404);
  await assertSectionScope(ctx, s.classId, s.sectionId);
  return { ctx, s };
}

function canPostHomework(ctx: Awaited<ReturnType<typeof load>>["ctx"]): boolean {
  try {
    assertPermission(ctx, "homework", "edit");
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { ctx, s } = await load(request, params, "view");
    const summary = await getSummary(s.id);
    return apiOk({ sessionId: s.id, summary, canPostHomework: canPostHomework(ctx) });
  } catch (e) {
    return apiErr(e);
  }
}

/** POST { taughtNote } — draft the note and the homework from the teacher's line. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { s } = await load(request, params, "edit");
    const body = (await request.json().catch(() => ({}))) as { taughtNote?: unknown };
    const taughtNote = String(body.taughtNote ?? "").replace(/\s+/g, " ").trim();
    if (taughtNote.length < 3) {
      throw new ApiError("bad_request", "Say in a line what was taught", 400);
    }
    const r = await generateSummary(s, taughtNote);
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);
    return apiOk({ summary: r.value });
  } catch (e) {
    return apiErr(e);
  }
}

/**
 * PATCH { patch: {...} } to keep edits, or { post: true } to publish the
 * homework to the diary (needs homework.edit — the diary's own permission).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { ctx, s } = await load(request, params, "edit");
    const body = (await request.json().catch(() => ({}))) as {
      patch?: Record<string, unknown>; post?: unknown;
    };
    if (body.patch) {
      const p = body.patch;
      const str = (k: string, max: number) =>
        p[k] === undefined ? undefined : String(p[k] ?? "").trim().slice(0, max);
      const saved = await saveSummary(s.id, {
        taughtNote: str("taughtNote", 1200),
        topic: str("topic", 80),
        summaryEn: str("summaryEn", 2000),
        homeworkTitle: str("homeworkTitle", 60),
        homeworkBody: str("homeworkBody", 1200),
        homeworkDue: str("homeworkDue", 10),
      });
      if (!saved) throw new ApiError("bad_request", "Could not save", 400);
      return apiOk({ summary: saved });
    }
    if (body.post === true) {
      assertPermission(ctx, "homework", "edit");
      const summary = await getSummary(s.id);
      if (!summary) throw new ApiError("bad_request", "Draft the summary first", 400);
      const r = await postSummaryHomework({
        session: s, summary, demoSession: ctx.session, masters: ctx.masters,
      });
      if (!r.ok) throw new ApiError("bad_request", r.error, 400);
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "homework",
        action: "edit",
        entityType: "post",
        entityId: r.value.homeworkPostId,
        summary: `Posted homework "${r.value.homeworkTitle}" from online class ${s.id}`,
        after: { date: s.date, subjectId: s.subjectId, onlineClassId: s.id },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ summary: r.value });
    }
    throw new ApiError("bad_request", "patch or post required", 400);
  } catch (e) {
    return apiErr(e);
  }
}
