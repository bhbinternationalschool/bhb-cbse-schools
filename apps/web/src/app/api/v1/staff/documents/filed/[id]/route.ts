import { NextResponse } from "next/server";
import { apiErr, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import { getDriveFileContent } from "@/lib/googleDrive.server";
import { loadSisForStaff } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { readStudentDocTypes } from "@/lib/studentDocTypes.server";

export const runtime = "nodejs";

function safeAsciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

/**
 * GET /api/v1/staff/documents/filed/<id> — a document verified off the
 * child's slots (a parent's Aadhaar, a custom type), served through the
 * ERP like /api/documents/student/…: the Drive id never reaches the phone,
 * and only staff who may see the child (students.view + their section) get it.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveApiAuth(request);
    if (auth.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    assertPermission(auth, "students", "view");
    const { id } = await ctx.params;
    const state = await readStudentDocTypes();
    if (!state) throw new ApiError("server_error", "Could not read the document list just now", 503);
    const entry = state.filed.find((f) => f.id === id);
    if (!entry || !entry.driveFileId) throw new ApiError("not_found", "Not found", 404);
    // The SIS alone says whose document it is; the masters come with the session.
    await ensureSisHydratedServer();
    const student = loadSisForStaff().students.find((s) => s.id === entry.studentId);
    if (!student) throw new ApiError("not_found", "Not found", 404);
    const scope = await staffSectionScope(auth);
    if (!scopeAllows(scope, student.classId, student.sectionId)) throw new ApiError("forbidden", "Not a student of your class", 403);
    const content = await getDriveFileContent(entry.driveFileId);
    if (!content.ok) return NextResponse.json({ error: content.error }, { status: 502 });
    return new Response(content.body, {
      headers: {
        "Content-Type": content.meta.mimeType || entry.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeAsciiFilename(entry.fileName || content.meta.name)}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return apiErr(e);
  }
}
