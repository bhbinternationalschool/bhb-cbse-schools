import { NextResponse } from "next/server";
import { getDriveFileContent } from "@/lib/googleDrive.server";
import { fetchSisStudentDocsById } from "@/lib/sisNormalized.server";
import { fetchStaffDocsById } from "@/lib/staffPersistence";
import { authorizeDocumentAction } from "@/lib/documentsAuth.server";
import type { StudentDocFile, StudentDocKey } from "@/lib/sis";
import type { StaffDocFile, StaffDocKey } from "@/lib/foundationMasters";
import { isDocumentSubject, isValidDocKey } from "@/lib/documentsRouting";

export const runtime = "nodejs";

type RouteCtx = {
  params: Promise<{ subject: string; subjectId: string; docKey: string }>;
};

function safeAsciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

/**
 * Serve a student/staff document. Never a direct Drive link — RBAC/
 * ownership-checked proxy fetch against the same rules gating student/
 * staff record access, matching docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md §3/4.
 * The driveFileId itself never reaches the client; the URL only carries
 * subject/subjectId/docKey, and the server resolves those against the
 * actual stored record so a caller can't request an arbitrary Drive file.
 *
 * Allowed callers: staff with view permission on the subject's module,
 * OR a parent viewing their own child's docs (household match), OR a
 * staff member viewing their own HR docs (subjectId === their staffId).
 */
export async function GET(request: Request, ctx: RouteCtx) {
  const { subject, subjectId, docKey } = await ctx.params;

  if (!isDocumentSubject(subject) || !isValidDocKey(subject, docKey)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let file: StudentDocFile | StaffDocFile | undefined;
  let householdId: string | undefined;
  if (subject === "student") {
    const record = await fetchSisStudentDocsById(subjectId);
    file = record?.docs[docKey as StudentDocKey];
    householdId = record?.householdId;
  } else {
    const docs = await fetchStaffDocsById(subjectId);
    file = docs?.[docKey as StaffDocKey];
  }

  const auth = await authorizeDocumentAction(
    request,
    subject,
    subjectId,
    "view",
    householdId,
  );
  if (!auth.ok) return auth.response;

  if (!file || !file.driveFileId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const content = await getDriveFileContent(file.driveFileId);
  if (!content.ok) {
    return NextResponse.json({ error: content.error }, { status: 502 });
  }

  const filename = safeAsciiFilename(file.fileName || content.meta.name);
  return new Response(content.body, {
    headers: {
      "Content-Type":
        content.meta.mimeType || file.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
      ...(content.meta.size != null
        ? { "Content-Length": String(content.meta.size) }
        : {}),
    },
  });
}
