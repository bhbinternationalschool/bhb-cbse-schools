/**
 * POST { docKey, file } — the signed-in member of staff submits one of their
 * OWN documents (already uploaded through /api/documents/upload, which only
 * stores the file) for the office's check: docs.<key> on their record becomes
 * "pending" and appears in Staff → Doc verify. A photo is also shown at once
 * as their photo (as /api/v1/staff/me/photo).
 *
 * Data-layer 2.2d: the web "My docs" tab saved this through the whole-book
 * Masters save, which a member without Masters · edit could never send — the
 * screen said "Submitted" and nothing was saved. Only ever the caller's own
 * row: the staff id comes from the session, never from the body; only that
 * one document key is written, laid on the record as stored now.
 */

import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { STAFF_DOC_LABELS } from "@/lib/foundationMasters";
import { patchStaffRow, readOwnStaff } from "@/lib/staffSelfProfile.server";

export const runtime = "nodejs";

const DOC_KEYS = new Set<string>(STAFF_DOC_LABELS.map((d) => d.key));

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staffId = ctx.session.persona === "staff" ? ctx.session.staffId || "" : "";
    if (!staffId) throw new ApiError("forbidden", "Staff login required", 403);
    assertPermission(ctx, "home", "view"); // self service, like My payslips
    const body = (await request.json().catch(() => null)) as { docKey?: unknown; file?: Record<string, unknown> } | null;
    const docKey = typeof body?.docKey === "string" ? body.docKey : "";
    if (!DOC_KEYS.has(docKey)) throw new ApiError("bad_request", "Unknown document", 400);
    const f = body?.file && typeof body.file === "object" ? body.file : null;
    const fileUrl = str(f?.fileUrl, 2048);
    if (!fileUrl || fileUrl.startsWith("data:")) {
      throw new ApiError("bad_request", "Upload the file first — nothing was submitted", 400);
    }

    const own = await readOwnStaff(staffId);
    if (!own) throw new ApiError("server_error", "Could not read your record — nothing was submitted. Try again.", 503);
    const now = new Date().toISOString();
    const submitted = {
      status: "pending",
      fileName: str(f?.fileName, 200),
      mimeType: str(f?.mimeType, 120),
      size: typeof f?.size === "number" && Number.isFinite(f.size) ? f.size : 0,
      fileUrl,
      ...(str(f?.driveFileId, 200) ? { driveFileId: str(f?.driveFileId, 200) } : {}),
      uploadedAt: str(f?.uploadedAt, 40) || now,
      submittedBy: own.staff.fullName,
      submittedAt: now,
      reviewedBy: "",
      reviewedAt: "",
      reviewNote: "",
    };
    const w = await patchStaffRow(staffId, (profile) => {
      const docs = { ...((profile.docs as Record<string, unknown>) || {}) };
      docs[docKey] = submitted;
      return docKey === "photo" ? { docs, photoUrl: fileUrl } : { docs };
    });
    if (!w.ok) throw new ApiError("server_error", `Not submitted — ${w.error}`, 503);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff",
      action: "edit",
      entityType: "staff",
      entityId: staffId,
      summary: `Own document submitted for the office's check: ${docKey}`,
      after: { docKey, fileName: submitted.fileName },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ docKey, doc: submitted, updatedAt: w.updatedAt });
  } catch (e) {
    return apiErr(e);
  }
}
