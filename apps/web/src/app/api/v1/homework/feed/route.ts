import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import { loadHomework } from "@/lib/homework";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/homework/feed?studentId= | ?classId=&sectionId= — published
 * homework posts plus diary entries for one section, newest first. Parents
 * pass studentId (scoped to their own child); staff pass classId+sectionId
 * and also get the class's subject list for the compose form.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);

    const url = new URL(request.url);
    const studentId = url.searchParams.get("studentId")?.trim() || "";
    let classId = url.searchParams.get("classId")?.trim() || "";
    let sectionId = url.searchParams.get("sectionId")?.trim() || "";
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") || "30", 10) || 30, 1),
      100,
    );

    await ensureSchoolMirrorHydrated();
    await ensureHomeworkHydratedServer();

    if (ctx.session.persona === "parent") {
      if (!studentId) {
        throw new ApiError("bad_request", "studentId required", 400);
      }
      const sis = loadSis();
      const student = sis.students.find((s) => s.id === studentId);
      if (!student) throw new ApiError("not_found", "Student not found", 404);
      if (
        ctx.session.householdId &&
        student.householdId !== ctx.session.householdId
      ) {
        throw new ApiError("forbidden", "Not your child", 403);
      }
      classId = student.classId;
      sectionId = student.sectionId;
    } else {
      assertPermission(ctx, "homework", "view");
      if (!classId || !sectionId) {
        throw new ApiError("bad_request", "classId and sectionId required", 400);
      }
    }

    const ay = ctx.session.academicYearCode;
    const subjectNameOf = (id: string) =>
      ctx.masters.subjects.find((s) => s.id === id)?.nameEn || "";

    const state = loadHomework();
    const posts = state.posts
      .filter(
        (p) =>
          p.status === "published" &&
          p.classId === classId &&
          p.sectionId === sectionId &&
          (!p.academicYearCode || p.academicYearCode === ay),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        date: p.date,
        title: p.title,
        bodyEn: p.bodyEn,
        bodyHi: p.bodyHi,
        subjectName: subjectNameOf(p.subjectId),
        teacherName: p.teacherName,
        dueAt: p.dueAt || null,
        requiresSubmit: p.requiresSubmit,
        attachmentCount: p.attachments.length,
      }));

    const diary = state.diary
      .filter(
        (d) =>
          d.classId === classId &&
          d.sectionId === sectionId &&
          (!d.academicYearCode || d.academicYearCode === ay),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit)
      .map((d) => ({
        id: d.id,
        date: d.date,
        title: d.title,
        bodyEn: d.bodyEn,
        bodyHi: d.bodyHi,
        teacherName: d.teacherName,
      }));

    // Staff composing homework need the class's subject list. Classes the
    // office hasn't mapped yet fall back to the full subject catalogue so
    // teachers aren't blocked while curriculum mapping catches up.
    let subjects: { id: string; name: string }[] | undefined;
    if (ctx.session.persona === "staff") {
      subjects = ctx.masters.classSubjects
        .filter((l) => l.classId === classId && l.isActive !== false)
        .map((l) => ({ id: l.subjectId, name: subjectNameOf(l.subjectId) }))
        .filter((s) => s.name);
      if (subjects.length === 0) {
        subjects = ctx.masters.subjects
          .filter((s) => s.isActive !== false)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => ({ id: s.id, name: s.nameEn }))
          .filter((s) => s.name);
      }
    }

    return apiOk({
      classId,
      sectionId,
      academicYearCode: ay,
      posts,
      diary,
      ...(subjects ? { subjects } : {}),
    });
  } catch (e) {
    return apiErr(e);
  }
}
