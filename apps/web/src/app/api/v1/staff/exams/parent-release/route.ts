import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { writeAudit } from "@/lib/audit.server";
import {
  isReleaseKind,
  isReleasedToParents,
  withReleaseSwitch,
} from "@/lib/examParentRelease";
import {
  readExamParentRelease,
  writeExamParentRelease,
} from "@/lib/examParentRelease.server";
import { loadExams } from "@/lib/exams";
import { ensureExamsHydratedServer } from "@/lib/examsPersistence";

export const runtime = "nodejs";

/**
 * The exams desk's "Show to parents" switches, per exam term:
 *   results   — the term's report cards in the parent app and /parent portal
 *   dateSheet — the term's date sheet there.
 * Both start OFF; nothing about an exam reaches a family until a person with
 * exams.edit switches it on here. Every switch is audited.
 *
 * GET  → { state, updatedAt }                       (exams.view)
 * POST { termId, kind: "results"|"dateSheet", on }  (exams.edit)
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "exams", "view");
    const read = await readExamParentRelease();
    if (!read) throw new ApiError("server_error", "Could not read the release switches", 503);
    return apiOk(read);
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "exams", "edit");

    const body = (await request.json().catch(() => null)) as
      | { termId?: unknown; kind?: unknown; on?: unknown }
      | null;
    const termId = typeof body?.termId === "string" ? body.termId.trim() : "";
    const kind = body?.kind;
    if (!termId || !isReleaseKind(kind) || typeof body?.on !== "boolean") {
      throw new ApiError("bad_request", "termId, kind (results | dateSheet) and on (true/false) are required", 400);
    }
    const on = body.on;

    await ensureExamsHydratedServer();
    const term = loadExams().terms.find((t) => t.id === termId);
    if (!term) throw new ApiError("not_found", "Exam not found", 404);

    // Read-modify-write over the copy just read; one retry if another tab
    // switched a different exam in between.
    let saved: { updatedAt: string } | null = null;
    let before = false;
    for (let attempt = 0; attempt < 2 && !saved; attempt += 1) {
      const read = await readExamParentRelease();
      if (!read) throw new ApiError("server_error", "Could not read the release switches", 503);
      before = isReleasedToParents(read.state, termId, kind);
      const next = withReleaseSwitch(read.state, {
        termId,
        kind,
        on,
        at: new Date().toISOString(),
        by: ctx.session.fullName || "",
      });
      const w = await writeExamParentRelease(next, read.updatedAt);
      if (w.ok) saved = { updatedAt: w.updatedAt };
      else if (!w.conflict) throw new ApiError("server_error", w.error, 500);
    }
    if (!saved) {
      throw new ApiError("conflict", "Someone else changed the release switches meanwhile — try again.", 409);
    }

    const what = kind === "results" ? "results" : "date sheet";
    const meta = requestMeta(request);
    const audit = await writeAudit({
      session: ctx.session,
      module: "exams",
      action: "edit",
      entityType: "exam_parent_release",
      entityId: `${termId}:${kind}`,
      summary: `${on ? "Released" : "Withdrew"} ${term.label} (${term.academicYearCode}) ${what} ${on ? "to" : "from"} parents`,
      before: { on: before },
      after: { on },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const after = await readExamParentRelease();
    return apiOk({
      state: after?.state ?? null,
      updatedAt: after?.updatedAt ?? saved.updatedAt,
      auditRecorded: audit.ok,
    });
  } catch (e) {
    return apiErr(e);
  }
}
