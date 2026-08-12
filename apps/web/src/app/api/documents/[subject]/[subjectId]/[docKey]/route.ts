import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getDriveFileContent } from "@/lib/googleDrive.server";
import { fetchSisStudentDocsById } from "@/lib/sisNormalized.server";
import { fetchStaffDocsById } from "@/lib/staffPersistence";
import type { StudentDocKey } from "@/lib/sis";
import type { StaffDocKey } from "@/lib/foundationMasters";
import {
  isDocumentSubject,
  isValidDocKey,
  subjectRbacModule,
} from "@/lib/documentsRouting";

export const runtime = "nodejs";

type RouteCtx = {
  params: Promise<{ subject: string; subjectId: string; docKey: string }>;
};

function safeAsciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

/**
 * Serve a student/staff document. Never a direct Drive link — RBAC-checked
 * proxy fetch against the SAME rules already gating student/staff record
 * access, matching docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md §3. The driveFileId
 * itself never reaches the client; the URL only carries subject/subjectId/
 * docKey, and the server resolves those against the actual stored record
 * so a caller can't request an arbitrary Drive file id.
 */
export async function GET(request: Request, ctx: RouteCtx) {
  const { subject, subjectId, docKey } = await ctx.params;

  if (!isDocumentSubject(subject) || !isValidDocKey(subject, docKey)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const auth = await requireStaffPermission(
    request,
    subjectRbacModule(subject),
    "view",
  );
  if (!auth.ok) return auth.response;

  const file =
    subject === "student"
      ? (await fetchSisStudentDocsById(subjectId))?.[docKey as StudentDocKey]
      : (await fetchStaffDocsById(subjectId))?.[docKey as StaffDocKey];
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const driveFileId = file.driveFileId;
  if (!driveFileId) {
    return NextResponse.json({ error: "No file on record" }, { status: 404 });
  }

  const content = await getDriveFileContent(driveFileId);
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
