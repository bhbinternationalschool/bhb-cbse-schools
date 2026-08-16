import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import {
  assertPermission,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  ensureTeachingHydratedServer,
  pushTeachingRemoteServer,
} from "@/lib/teachingPersistence";
import {
  importSyllabusUnits,
  loadTeaching,
  writeTeachingLocalRaw,
  type SyllabusImportChapter,
} from "@/lib/teaching";

export const runtime = "nodejs";

type Body = {
  classId?: string;
  subjectId?: string;
  chapters?: SyllabusImportChapter[];
};

/**
 * POST /api/v1/teaching/syllabus-import — save the chapters a teacher
 * confirmed after scanning a contents page.
 *
 * The class and subject must exist in masters; the import itself skips
 * anything already in the plan, so a repeated save is harmless.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "edit");

    const body = (await request.json()) as Body;
    const classId = String(body.classId || "");
    const subjectId = String(body.subjectId || "");
    const chapters = Array.isArray(body.chapters) ? body.chapters : [];

    if (!ctx.masters.classes.some((c) => c.id === classId)) {
      throw new ApiError("bad_request", "Unknown class", 400);
    }
    if (!ctx.masters.subjects.some((s) => s.id === subjectId)) {
      throw new ApiError("bad_request", "Unknown subject", 400);
    }
    if (chapters.length === 0) {
      throw new ApiError("bad_request", "No chapters to import", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureTeachingHydratedServer();

    const result = importSyllabusUnits(loadTeaching(), {
      academicYearCode: ctx.session.academicYearCode,
      classId,
      subjectId,
      chapters,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    writeTeachingLocalRaw(result.value.state);
    const push = await pushTeachingRemoteServer(result.value.state);
    if (!push.ok) {
      console.warn("[teaching-v1] syllabus import push failed", push.error);
      throw new ApiError(
        "server_error",
        "Could not reach the school server — try again",
        502,
      );
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "teaching",
      action: "create",
      entityType: "syllabus_import",
      entityId: `${classId}:${subjectId}`,
      summary: `Imported ${result.value.summary.chaptersAdded} chapter(s) from a scanned page`,
      after: result.value.summary,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk(result.value.summary);
  } catch (e) {
    return apiErr(e);
  }
}
