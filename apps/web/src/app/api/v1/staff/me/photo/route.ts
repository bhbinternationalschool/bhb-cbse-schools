/**
 * POST multipart { file } — the signed-in member of staff's new profile
 * photo from the staff app. Stored in the private `school-files` bucket
 * (served via /api/file), shown at once as their photo, and put in the
 * office's document queue as docs.photo "pending" (Staff → Doc verify) —
 * the same as the web "My docs" photo. Never a base64 fallback: it uploads,
 * or it says it did not.
 */

import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { archiveToDrive } from "@/lib/driveArchive.server";
import { mediaArchiveFileName, mediaArchiveFolder } from "@/lib/driveArchive";
import { privateMediaUrl } from "@/lib/media";
import { getServerTenantContext } from "@/lib/serverTenant";
import { patchStaffRow, readOwnStaff } from "@/lib/staffSelfProfile.server";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staffId = ctx.session.persona === "staff" ? ctx.session.staffId || "" : "";
    if (!staffId) throw new ApiError("forbidden", "Staff login required", 403);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ApiError("bad_request", "Choose a photo", 400);
    const ext = TYPES[file.type];
    if (!ext) throw new ApiError("bad_request", "The photo must be a JPG, PNG or WebP image", 400);
    if (file.size > MAX_BYTES) throw new ApiError("bad_request", "The photo is larger than 5 MB — take it again at a lower size", 400);

    const own = await readOwnStaff(staffId);
    if (!own) throw new ApiError("server_error", "Could not read your record — the photo was not saved. Try again.", 503);
    const tenant = await getServerTenantContext();
    if (!tenant) throw new ApiError("server_error", "Storage unavailable — the photo was not saved.", 503);

    const folder = (own.staff.empCode || staffId).replace(/[^A-Za-z0-9_-]/g, "_");
    const path = `staff/${folder}/photo-${Date.now()}.${ext}`;
    const data = Buffer.from(await file.arrayBuffer());
    const up = await tenant.sb.storage.from("school-files").upload(path, data, { contentType: file.type, upsert: false, cacheControl: "31536000" });
    if (up.error) throw new ApiError("server_error", `The photo was not saved — ${up.error.message}`, 500);
    const url = privateMediaUrl(path);
    const now = new Date().toISOString();

    const w = await patchStaffRow(staffId, (profile) => {
      const docs = { ...((profile.docs as Record<string, unknown>) || {}) };
      docs.photo = {
        status: "pending",
        fileName: `photo.${ext}`,
        mimeType: file.type,
        size: file.size,
        fileUrl: url,
        uploadedAt: now,
        submittedBy: own.staff.fullName,
        submittedAt: now,
        reviewedBy: "",
        reviewedAt: "",
        reviewNote: "",
      };
      return { photoUrl: url, docs };
    });
    if (!w.ok) throw new ApiError("server_error", `The photo was uploaded but not put on your record — ${w.error}`, 503);

    // The school's Drive keeps a copy; Drive being down does not undo it.
    const drive = await archiveToDrive({
      kind: "media",
      ref: `school-files/${path}`,
      folderPath: mediaArchiveFolder("school-files", new Date()),
      fileName: mediaArchiveFileName(path),
      mimeType: file.type,
      data,
    }).catch(() => ({ ok: false as const }));
    if (!drive.ok) console.warn("[staff/me/photo] drive archive failed");

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff",
      action: "edit",
      entityType: "staff",
      entityId: staffId,
      summary: "New profile photo from the staff app (pending the office's check)",
      after: { photoUrl: url },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ photoUrl: url, photoStatus: "pending" });
  } catch (e) {
    return apiErr(e);
  }
}
