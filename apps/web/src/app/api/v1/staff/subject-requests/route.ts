import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { classSubjectRows } from "@/lib/subjectMasters";
import type { SubjectRequestAction } from "@/lib/subjectRequests";
import { fileSubjectRequest, listSubjectRequests, subjectsSliceOf, withdrawSubjectRequest } from "@/lib/subjectRequests.server";

export const runtime = "nodejs";

/**
 * Staff app → My subjects (lib/subjectRequests). A teacher sees what each
 * of their classes studies and asks for a change; the office approves in
 * Masters → Subjects. Nothing here edits Masters.
 *
 * GET  → { classes: [{ classId, className, isClassTeacher, subjects }], schoolSubjects, requests }
 * POST { action: "file", classId, change: "add"|"remove"|"new", subjectId?, subjectName?, reason? }
 *    | { action: "withdraw", id }
 */

function teacherClasses(scope: Awaited<ReturnType<typeof staffSectionScope>>, classes: { id: string; name: string; sortOrder: number }[]) {
  if (scope.unrestricted) return classes.map((c) => ({ classId: c.id, className: c.name, isClassTeacher: false }));
  const by = new Map<string, { classId: string; className: string; isClassTeacher: boolean }>();
  for (const t of scope.teaching) {
    const prev = by.get(t.classId);
    by.set(t.classId, { classId: t.classId, className: t.className, isClassTeacher: (prev?.isClassTeacher ?? false) || t.isClassTeacher });
  }
  const order = new Map(classes.map((c) => [c.id, c.sortOrder]));
  return [...by.values()].sort((a, b) => (order.get(a.classId) ?? 999) - (order.get(b.classId) ?? 999));
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    const slice = subjectsSliceOf(ctx.masters);
    const classes = teacherClasses(scope, slice.classes.filter((c) => c.isActive !== false));
    const requests = await listSubjectRequests({ staffId: ctx.session.staffId || "-", limit: 50 });
    if (!requests) throw new ApiError("server_error", "Could not read your requests just now", 503);
    const label = (id: string) => {
      const s = slice.subjects.find((x) => x.id === id);
      return s ? s.nameEn : "";
    };
    return apiOk({
      classes: classes.map((c) => ({
        ...c,
        subjects: classSubjectRows(slice, c.classId)
          .filter((r) => r.link)
          .map((r) => ({ id: r.subject.id, code: r.subject.code, name: r.subject.nameEn, parentName: r.parent ? label(r.parent.id) : "" })),
      })),
      schoolSubjects: slice.subjects
        .filter((s) => s.isActive)
        .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
        .map((s) => ({ id: s.id, code: s.code, name: s.nameEn, parentName: s.parentId ? label(s.parentId) : "" })),
      requests,
    });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    const staffId = ctx.session.staffId || "";
    if (!staffId) throw new ApiError("forbidden", "This sign-in is not linked to a staff record", 403);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "withdraw") {
      const ok = await withdrawSubjectRequest(String(body.id ?? ""), staffId);
      if (!ok) throw new ApiError("conflict", "This request was already decided", 409);
      return apiOk({ withdrawn: true });
    }
    const change = String(body.change ?? "") as SubjectRequestAction;
    if (!["add", "remove", "new"].includes(change)) throw new ApiError("bad_request", "Choose add, remove or new", 400);
    const slice = subjectsSliceOf(ctx.masters);
    const allowed = scope.unrestricted ? ("all" as const) : new Set(scope.teaching.map((t) => t.classId));
    const filed = await fileSubjectRequest(
      slice,
      {
        classId: String(body.classId ?? ""),
        action: change,
        subjectId: String(body.subjectId ?? ""),
        subjectName: String(body.subjectName ?? ""),
        reason: String(body.reason ?? ""),
      },
      { staffId, staffName: ctx.session.fullName || "Teacher", allowedClassIds: allowed },
    );
    if (!filed.ok) throw new ApiError(filed.status === 400 ? "bad_request" : "server_error", filed.error, filed.status);
    return apiOk({ request: filed.request });
  } catch (e) {
    return apiErr(e);
  }
}
