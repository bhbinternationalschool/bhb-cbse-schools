import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertParentOwnsChild } from "@/lib/api/v1/household";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import { loadHomework } from "@/lib/homework";
import { loadSis } from "@/lib/sis";
import { isStudentAsset } from "@/lib/pinnacleAssets";
import { publisherAssetsFor, readPinnacleAssets } from "@/lib/pinnacleAssets.server";

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
      assertParentOwnsChild(ctx, student);
      classId = student.classId;
      sectionId = student.sectionId;
    } else {
      assertPermission(ctx, "homework", "view");
      if (!classId || !sectionId) {
        throw new ApiError("bad_request", "classId and sectionId required", 400);
      }
    }
    // Staff: only a section they teach (or school-wide leadership/office).
    const scope =
      ctx.session.persona === "staff"
        ? await assertSectionScope(ctx, classId, sectionId)
        : null;

    const ay = ctx.session.academicYearCode;
    const subjectNameOf = (id: string) =>
      ctx.masters.subjects.find((s) => s.id === id)?.nameEn || "";

    const state = loadHomework();
    const shown = state.posts
      .filter(
        (p) =>
          p.status === "published" &&
          p.classId === classId &&
          p.sectionId === sectionId &&
          (!p.academicYearCode || p.academicYearCode === ay),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);

    // "Revise in the LEAD app" (director, 12 Oct 2026): homework that names
    // a chapter ("Ch 7 — …" in the AI tutor hint) and whose book has
    // publisher assets gets the ones a child opens in the LEAD Group Student
    // App — animations, games, mind maps. Titles only; the app plays them.
    // Any failure just leaves the card out.
    const className = ctx.masters.classes.find((c) => c.id === classId)?.name || "";
    const revision = new Map<string, { book: string; chapter: string; items: { type: string; title: string }[] }>();
    const index = (await readPinnacleAssets().catch(() => null))?.books ?? [];
    if (index.length && className) {
      for (const p of shown) {
        const m = /(?:ch|chapter|अध्याय|पाठ)\s*(\d{1,2})/i.exec(p.aiTutorHint || "");
        if (!m) continue;
        const pos = Number(m[1]);
        const hit = (await publisherAssetsFor(className, subjectNameOf(p.subjectId), [pos], index).catch(() => null))?.get(pos);
        const items = hit?.assets.filter(isStudentAsset).slice(0, 5) ?? [];
        if (hit && items.length) revision.set(p.id, { book: hit.bookTitle, chapter: `Ch ${pos} · ${hit.chapter}`, items });
      }
    }

    const posts = shown.map((p) => ({
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
        leadRevision: revision.get(p.id) ?? null,
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
    const mySection =
      scope && !scope.unrestricted
        ? scope.teaching.find((t) => t.classId === classId && t.sectionId === sectionId)
        : null;
    if (scope && !scope.unrestricted && !(mySection?.isClassTeacher && !mySection.subjects.length)) {
      // A teacher composes for the subjects they teach here (a class
      // teacher: every subject of the class) — the same rule the post
      // route enforces, so the list never offers what will be refused.
      subjects = (mySection?.subjects ?? []).map((x) => ({ id: x.id, name: x.name }));
    } else if (ctx.session.persona === "staff") {
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
