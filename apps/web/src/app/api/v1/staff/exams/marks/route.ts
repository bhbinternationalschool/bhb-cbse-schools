import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensureExamsHydratedServer, pushExamsRemoteServer } from "@/lib/examsPersistence";
import { findMarkSheet, loadExams, saveMarkSheet } from "@/lib/exams";
import { assertSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

type Body = {
  termId?: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  marks?: { studentId: string; marksObtained: number | null }[];
};

/**
 * POST /api/v1/staff/exams/marks — save one subject's marks for a section
 * and exam. Merges into the section's mark sheet (other subjects untouched),
 * validates against max marks the way the exams desk does, and pushes the
 * sheet to the desk tables. null = not entered / absent.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "exams", "edit");
    const body = (await request.json().catch(() => ({}))) as Body;
    const termId = (body.termId || "").trim();
    const classId = (body.classId || "").trim();
    const sectionId = (body.sectionId || "").trim();
    const subjectId = (body.subjectId || "").trim();
    const entries = Array.isArray(body.marks) ? body.marks : [];
    if (!termId || !classId || !sectionId || !subjectId) {
      throw new ApiError("bad_request", "termId, classId, sectionId, subjectId required", 400);
    }
    if (!entries.length) throw new ApiError("bad_request", "No marks to save", 400);
    for (const e of entries) {
      if (e.marksObtained != null && (!Number.isFinite(e.marksObtained) || e.marksObtained < 0)) {
        throw new ApiError("bad_request", "Marks must be a number ≥ 0 or blank", 400);
      }
    }
    await assertSectionScope(ctx, classId, sectionId);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensureExamsHydratedServer()]);
    const ay = ctx.session.academicYearCode;
    const existing = findMarkSheet(ay, termId, sectionId);
    if (existing?.lockedAt) {
      throw new ApiError("forbidden", "This mark sheet is locked by the exams desk", 403);
    }

    const byKey = new Map(
      (existing?.marks ?? []).map((m) => [`${m.studentId}:${m.subjectId}`, m]),
    );
    for (const e of entries) {
      const key = `${e.studentId}:${subjectId}`;
      const prev = byKey.get(key);
      byKey.set(key, {
        studentId: e.studentId,
        subjectId,
        marksObtained: e.marksObtained == null ? null : Math.round(e.marksObtained * 2) / 2,
        grade: prev?.grade ?? "",
        remark: prev?.remark ?? "",
        remarkSource: prev?.remarkSource ?? "manual",
      });
    }

    const result = saveMarkSheet({
      academicYearCode: ay,
      examTermId: termId,
      classId,
      sectionId,
      marks: [...byKey.values()],
      enteredBy: ctx.session.fullName || "Teacher",
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);
    const pushed = await pushExamsRemoteServer(loadExams());
    if (!pushed.ok) {
      console.warn("[staff-exams-v1] push failed", pushed.error);
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "exams",
      action: "edit",
      entityType: "mark_sheet",
      entityId: result.sheet.id,
      summary: `Marks entered from app: ${entries.length} students, subject ${subjectId}, section ${sectionId}`,
      after: { termId, subjectId, count: entries.length },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const saved = result.sheet.marks.filter((m) => m.subjectId === subjectId);
    return apiOk({
      sheetId: result.sheet.id,
      updatedAt: result.sheet.updatedAt,
      marks: saved.map((m) => ({
        studentId: m.studentId,
        marksObtained: m.marksObtained,
        grade: m.grade,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
