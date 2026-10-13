import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

type TargetSubject = { id: string; name: string; code: string };
type TargetClass = {
  id: string;
  name: string;
  sections: { id: string; name: string }[];
  subjects: TargetSubject[];
};

/**
 * GET /api/v1/staff/ai/targets — the classes and subjects the teacher AI
 * tools (question paper, remedial worksheet, lesson plan) may be asked
 * about: a teacher's own classes with the subjects they teach there (a class
 * teacher: every subject of the class); leadership and the office, every
 * active class with its linked subjects. The same rule the tool routes
 * enforce, so the picker never offers something the server will refuse.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "home", "view");
    await ensureSchoolMirrorHydrated();
    const scope = await staffSectionScope(ctx);
    const m = ctx.masters;
    const classOrder = new Map(m.classes.map((c) => [c.id, c.sortOrder ?? 0]));

    const byClass = new Map<string, TargetClass>();
    if (scope.unrestricted) {
      for (const c of m.classes.filter((x) => x.isActive !== false)) {
        const subjects = (m.classSubjects ?? [])
          .filter((l) => l.classId === c.id && l.isActive)
          .map((l) => m.subjects.find((s) => s.id === l.subjectId))
          .filter((s): s is NonNullable<typeof s> => !!s && s.isActive !== false)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((s) => ({ id: s.id, name: s.nameEn || s.code || s.id, code: (s.code || "").toUpperCase() }));
        byClass.set(c.id, {
          id: c.id,
          name: c.name,
          sections: m.sections
            .filter((s) => s.classId === c.id && s.isActive !== false)
            .map((s) => ({ id: s.id, name: s.name })),
          subjects,
        });
      }
    } else {
      for (const t of scope.teaching) {
        const entry =
          byClass.get(t.classId) ??
          ({ id: t.classId, name: t.className, sections: [], subjects: [] } as TargetClass);
        if (!entry.sections.some((s) => s.id === t.sectionId)) {
          entry.sections.push({ id: t.sectionId, name: t.sectionName });
        }
        for (const s of t.subjects) {
          if (!entry.subjects.some((x) => x.id === s.id)) entry.subjects.push(s);
        }
        byClass.set(t.classId, entry);
      }
    }

    const classes = [...byClass.values()]
      .filter((c) => c.subjects.length > 0)
      .sort((a, b) => (classOrder.get(a.id) ?? 0) - (classOrder.get(b.id) ?? 0));
    return apiOk({ unrestricted: scope.unrestricted, classes });
  } catch (e) {
    return apiErr(e);
  }
}
