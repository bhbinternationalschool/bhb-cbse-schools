import { NextResponse } from "next/server";
import { uploadFileToDrive } from "@/lib/googleDrive.server";
import { fetchSisStudentDocsById } from "@/lib/sisNormalized.server";
import { fetchStaffDocsById } from "@/lib/staffPersistence";
import { authorizeDocumentAction } from "@/lib/documentsAuth.server";
import {
  documentProxyUrl,
  isDocumentSubject,
  isValidDocKey,
} from "@/lib/documentsRouting";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — real files now go to Drive, not localStorage
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Upload one document for a student or staff record to Google Drive.
 * Does NOT write the sis_students/sis_staff row itself — returns the
 * fields the client merges into its own doc record and saves through the
 * existing desk-slice sync, same as every other field on that record.
 * See docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md §Phase 3/4.
 *
 * Allowed callers: staff with edit permission on the subject's module,
 * OR a parent uploading their own child's docs (household match), OR a
 * staff member uploading their own HR docs (subjectId === their staffId).
 */
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const subject = formData.get("subject");
  const subjectId = String(formData.get("subjectId") || "").trim();
  const docKey = String(formData.get("docKey") || "").trim();
  const file = formData.get("file") as File | null;

  if (!isDocumentSubject(subject)) {
    return NextResponse.json(
      { error: "subject must be 'student' or 'staff'" },
      { status: 400 },
    );
  }
  if (!subjectId) {
    return NextResponse.json({ error: "Missing subjectId" }, { status: 400 });
  }
  if (!docKey || !isValidDocKey(subject, docKey)) {
    return NextResponse.json({ error: "Unknown docKey" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  let recordExists = false;
  let recordHouseholdId: string | undefined;
  if (subject === "student") {
    const record = await fetchSisStudentDocsById(subjectId);
    recordExists = record !== null;
    recordHouseholdId = record?.householdId;
  } else {
    recordExists = (await fetchStaffDocsById(subjectId)) !== null;
  }

  const auth = await authorizeDocumentAction(
    request,
    subject,
    subjectId,
    "edit",
    recordHouseholdId,
  );
  if (!auth.ok) return auth.response;

  if (!recordExists) {
    return NextResponse.json(
      { error: `${subject === "student" ? "Student" : "Staff"} record not found` },
      { status: 404 },
    );
  }

  const ext = ALLOWED_MIME[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Use PDF or image (JPG/PNG/WebP)" },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadFileToDrive({
    folderPath: [subject === "student" ? "students" : "staff", subjectId],
    fileName: `${docKey}-${Date.now()}.${ext}`,
    mimeType: file.type,
    data: buffer,
  });
  if (!uploaded.ok) {
    return NextResponse.json({ error: uploaded.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    driveFileId: uploaded.driveFileId,
    fileUrl: documentProxyUrl(subject, subjectId, docKey),
    fileName: file.name,
    mimeType: file.type,
    size: buffer.length,
    uploadedAt: new Date().toISOString(),
  });
}
