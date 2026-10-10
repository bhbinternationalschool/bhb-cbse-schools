import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { childOfHousehold, requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { documentProxyUrl, isValidDocKey } from "@/lib/documentsRouting";
import { uploadFileToDrive } from "@/lib/googleDrive.server";
import { visionConfigured, visionExtractText } from "@/lib/googleVision.server";
import {
  buildStudentDocVerificationOcr,
  type DocVerificationOcrResult,
} from "@/lib/docVerificationOcr";
import { studentDocsForParent } from "@/lib/parentProfile";
import { updateStudentDocsInDb } from "@/lib/sisProfile.server";
import { checkDocumentUpload } from "@/lib/uploadValidation";
import {
  DOC_LABELS,
  loadSis,
  type StudentDocFile,
  type StudentDocKey,
} from "@/lib/sis";

export const runtime = "nodejs";

/**
 * POST /api/v1/profile/document — multipart {studentId, docKey, file}.
 *
 * One call does the whole thing, so the app cannot leave a file in Drive
 * with no record pointing at it, or a record pointing at nothing:
 *
 *   1. the bytes are checked (real type, size, legible resolution);
 *   2. if it is an image and Vision is configured, the text on it is read
 *      and compared with the child's record — name, date of birth, Aadhaar
 *      digits — the same check the office runs from its queue. A clear
 *      mismatch is refused with the reason, so the wrong child's document
 *      never enters the queue; unreadable or ambiguous is accepted and left
 *      to the office;
 *   3. the file goes to Drive under students/<id>;
 *   4. the student's docs entry becomes "pending" — awaiting the office's
 *      verification — and the office sees it in its queue on next load.
 *
 * A passport photo also becomes the child's profile photo, as on the web.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);

    const form = await request.formData().catch(() => null);
    if (!form) throw new ApiError("bad_request", "Expected a multipart form", 400);
    const studentId = String(form.get("studentId") || "").trim();
    const docKey = String(form.get("docKey") || "").trim();
    const file = form.get("file");
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);
    if (!isValidDocKey("student", docKey)) throw new ApiError("bad_request", "Unknown document", 400);
    if (!(file instanceof File)) throw new ApiError("bad_request", "file required", 400);
    const key = docKey as StudentDocKey;
    const label = DOC_LABELS.find((d) => d.key === key)?.label ?? key;

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const student = childOfHousehold(sis, studentId, householdId);
    const household = sis.households.find((h) => h.id === householdId);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkDocumentUpload({ bytes, declaredMime: file.type, docKey: key });
    if (!check.ok) throw new ApiError("bad_request", check.error, 400);

    // ---- read what is on it, and compare with the child ------------------
    let ocr: DocVerificationOcrResult | null = null;
    let ocrRan = false;
    if (key !== "photo" && check.kind !== "pdf" && visionConfigured()) {
      const vision = await visionExtractText({
        imageBase64: Buffer.from(bytes).toString("base64"),
        mimeType: check.mimeType,
      });
      if (vision.ok) {
        ocrRan = true;
        ocr = buildStudentDocVerificationOcr(vision.text, student, key, {
          householdPincode: household?.pincode,
        });
        if (ocr.overall === "likely_mismatch") {
          const bad = ocr.checks
            .filter((c) => c.status === "mismatch")
            .map((c) => `${c.label}: document says "${c.ocrValue}", school record has "${c.recordValue}"`);
          throw new ApiError(
            "bad_request",
            `This does not look like ${student.fullName}'s ${label.toLowerCase()}. ` +
              (bad.length ? bad.join("; ") + ". " : "") +
              "Check you picked the right file, or contact the office if the school record is wrong.",
            422,
          );
        }
      }
    }

    // ---- keep it -----------------------------------------------------------
    const uploaded = await uploadFileToDrive({
      folderPath: ["students", student.id],
      fileName: `${key}-${Date.now()}.${check.kind}`,
      mimeType: check.mimeType,
      data: Buffer.from(bytes),
    });
    if (!uploaded.ok) {
      console.warn("[profile-v1] drive upload failed", uploaded.error);
      throw new ApiError("server_error", "The school's document store is not reachable right now — try again later", 503);
    }

    const now = new Date().toISOString();
    const fileUrl = documentProxyUrl("student", student.id, key);
    const next: StudentDocFile = {
      status: "pending",
      fileName: file.name || `${key}.${check.kind}`,
      mimeType: check.mimeType,
      size: bytes.length,
      fileUrl,
      driveFileId: uploaded.driveFileId,
      uploadedAt: now,
      submittedBy: ctx.session.fullName || household?.guardianName || "Parent",
      submittedAt: now,
      reviewedBy: "",
      reviewedAt: "",
      reviewNote: "",
    };
    const docs = { ...student.docs, [key]: next };
    const written = await updateStudentDocsInDb(
      student.id,
      docs,
      key === "photo" ? fileUrl : undefined,
    );
    if (!written.ok) {
      console.warn("[profile-v1] docs write failed", written.error);
      throw new ApiError("server_error", "Uploaded, but the record could not be saved — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "students",
      action: "edit",
      entityType: "student_doc",
      entityId: `${student.id}:${key}`,
      summary: `Parent uploaded ${label} for ${student.fullName} from the app${ocrRan ? ` (auto-check: ${ocr?.overall})` : ""}`,
      after: { docKey: key, size: bytes.length, mimeType: check.mimeType, ocr: ocr?.overall ?? null },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const fresh = loadSis().students.find((s) => s.id === student.id) ?? { ...student, docs };
    return apiOk({
      doc: studentDocsForParent(fresh).find((d) => d.key === key),
      validation: {
        ran: ocrRan,
        overall: ocr?.overall ?? null,
        checks: (ocr?.checks ?? [])
          .filter((c) => c.status !== "skipped")
          .map((c) => ({ label: c.label, status: c.status, note: c.note ?? "" })),
      },
      message:
        ocr?.overall === "likely_match"
          ? `${label} submitted. The details match ${student.fullName}'s record; the office will confirm it.`
          : `${label} submitted for verification. The office will check it and you will see the result here.`,
    });
  } catch (e) {
    return apiErr(e);
  }
}
