import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis, type StudentDocKey } from "@/lib/sis";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import { DOC_LABELS } from "@/lib/api/v1/studentDocs";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/documents?status=pending — parent-uploaded documents
 * awaiting verification for the students this teacher is responsible for
 * (all students for leadership / office). Each row links to the file
 * through the school's own proxy so nothing leaves the ERP.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "students", "view");
    const url = new URL(request.url);
    const which = url.searchParams.get("status") === "reviewed" ? "reviewed" : "pending";
    const scope = await staffSectionScope(ctx);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const ay = ctx.session.academicYearCode;
    const sis = loadSis();
    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      ctx.masters.sections.find((s) => s.id === id)?.name || "";

    const rows: Record<string, unknown>[] = [];
    for (const st of sis.students) {
      if (st.status !== "active" || st.academicYearCode !== ay) continue;
      if (!scopeAllows(scope, st.classId, st.sectionId)) continue;
      for (const [key, doc] of Object.entries(st.docs || {})) {
        if (!doc) continue;
        const isPending = doc.status === "pending";
        const isReviewed = doc.status === "verified" || doc.status === "rejected";
        if (which === "pending" ? !isPending : !(isReviewed && doc.reviewedAt)) continue;
        rows.push({
          studentId: st.id,
          studentName: st.fullName,
          classLabel: `${classNameOf(st.classId)} ${sectionNameOf(st.sectionId)}`.trim(),
          key,
          label: DOC_LABELS[key as StudentDocKey] || key,
          status: doc.status,
          fileUrl: doc.fileUrl,
          mimeType: doc.mimeType,
          submittedBy: doc.submittedBy || "",
          submittedAt: doc.submittedAt || doc.uploadedAt || "",
          reviewedBy: doc.reviewedBy || "",
          reviewedAt: doc.reviewedAt || "",
          reviewNote: doc.reviewNote || "",
        });
      }
    }
    rows.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return apiOk({ status: which, rows: rows.slice(0, 200) });
  } catch (e) {
    return apiErr(e);
  }
}
