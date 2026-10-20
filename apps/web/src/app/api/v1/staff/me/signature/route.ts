/**
 * The signed-in member of staff's own signature (lib/staffSignature).
 *
 * GET    — { signatureUrl } ("" when none).
 * POST   multipart { file } — store it (private `school-files` bucket, served
 *        via /api/file) and put it on the person's record as signatureUrl,
 *        the field the web staff form edits. Replaces any earlier one.
 * DELETE — take it off the record.
 *
 * Only ever the caller's own row: the staff id comes from the session. A
 * request that names another member of staff (form field or ?staffId=) is
 * refused with 403 — the principal sets their own signature, not a
 * teacher's. Never a base64 fallback: it uploads, or it says it did not.
 */

import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth, type ApiAuthContext } from "@/lib/api/v1/auth";
import { privateMediaUrl } from "@/lib/media";
import { getServerTenantContext } from "@/lib/serverTenant";
import { patchStaffRow, readOwnStaff } from "@/lib/staffSelfProfile.server";
import {
  SIGNATURE_MIME,
  signatureActorRefusal,
  signatureFileRefusal,
  sniffSignatureImage,
} from "@/lib/staffSignature";

export const runtime = "nodejs";

function ownStaffId(ctx: ApiAuthContext, claimed?: string | null): string {
  const refused = signatureActorRefusal({
    persona: ctx.session.persona,
    sessionStaffId: ctx.session.staffId || "",
    claimedStaffId: claimed,
  });
  if (refused) throw new ApiError("forbidden", refused.message, refused.status);
  // Self service, like the profile photo and My payslips (Home · view).
  assertPermission(ctx, "home", "view");
  return ctx.session.staffId!;
}

async function audit(request: Request, ctx: ApiAuthContext, staffId: string, summary: string, after: Record<string, unknown>) {
  const meta = requestMeta(request);
  await writeAudit({
    session: ctx.session,
    module: "staff",
    action: "edit",
    entityType: "staff",
    entityId: staffId,
    summary,
    after,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staffId = ownStaffId(ctx, new URL(request.url).searchParams.get("staffId"));
    const own = await readOwnStaff(staffId);
    if (!own) throw new ApiError("server_error", "Could not read your record — try again.", 503);
    return apiOk({ signatureUrl: own.staff.signatureUrl || "" });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const form = await request.formData().catch(() => null);
    const claimed = form?.get("staffId");
    const staffId = ownStaffId(ctx, typeof claimed === "string" ? claimed : new URL(request.url).searchParams.get("staffId"));
    const file = form?.get("file");
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : null;
    const bad = signatureFileRefusal({ size: file instanceof File ? file.size : 0, bytes });
    if (bad) throw new ApiError("bad_request", bad.message, bad.status);
    const kind = sniffSignatureImage(bytes!)!;

    const own = await readOwnStaff(staffId);
    if (!own) throw new ApiError("server_error", "Could not read your record — the signature was not saved. Try again.", 503);
    const tenant = await getServerTenantContext();
    if (!tenant) throw new ApiError("server_error", "Storage unavailable — the signature was not saved.", 503);

    const folder = (own.staff.empCode || staffId).replace(/[^A-Za-z0-9_-]/g, "_");
    const path = `staff/${folder}/signature-${Date.now()}.${kind}`;
    const up = await tenant.sb.storage
      .from("school-files")
      .upload(path, Buffer.from(bytes!), { contentType: SIGNATURE_MIME[kind], upsert: false, cacheControl: "31536000" });
    if (up.error) throw new ApiError("server_error", `The signature was not saved — ${up.error.message}`, 500);
    const url = privateMediaUrl(path);

    const w = await patchStaffRow(staffId, () => ({ signatureUrl: url }));
    if (!w.ok) throw new ApiError("server_error", `The signature was uploaded but not put on your record — ${w.error}`, 503);
    await audit(request, ctx, staffId, "Signature set from the staff app", { signatureUrl: url, previous: own.staff.signatureUrl || "" });
    return apiOk({ signatureUrl: url });
  } catch (e) {
    return apiErr(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staffId = ownStaffId(ctx, new URL(request.url).searchParams.get("staffId"));
    const own = await readOwnStaff(staffId);
    if (!own) throw new ApiError("server_error", "Could not read your record — try again.", 503);
    if (!own.staff.signatureUrl) return apiOk({ signatureUrl: "" });
    const w = await patchStaffRow(staffId, () => ({ signatureUrl: "" }));
    if (!w.ok) throw new ApiError("server_error", `The signature was not removed — ${w.error}`, 503);
    await audit(request, ctx, staffId, "Signature removed from the staff app", { signatureUrl: "", previous: own.staff.signatureUrl });
    return apiOk({ signatureUrl: "" });
  } catch (e) {
    return apiErr(e);
  }
}
