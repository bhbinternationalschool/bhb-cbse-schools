import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { addCustomDocType, docTypeCatalogue, type StudentDocTypeDef } from "@/lib/studentDocTypes";
import { readStudentDocTypes, writeStudentDocTypes } from "@/lib/studentDocTypes.server";

export const runtime = "nodejs";

const forApp = (t: StudentDocTypeDef) => ({
  id: t.id,
  label: t.label,
  labelHi: t.labelHi,
  slot: t.slot || "",
  aadhaarOf: t.aadhaarOf || "",
  custom: t.custom,
});

async function guard(request: Request) {
  const ctx = await resolveApiAuth(request);
  if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
  assertMobileFeature(ctx, "documents_verify");
  assertPermission(ctx, "students", "approve");
  return ctx;
}

/**
 * GET /api/v1/staff/documents/types — what a verifier may say a document
 * is: the built-in types (the child's slots and the parents' Aadhaar) and
 * the school's own. `customLoaded: false` when the school's own could not
 * be read — the built-ins still come, the list is not called complete.
 */
export async function GET(request: Request) {
  try {
    await guard(request);
    const state = await readStudentDocTypes();
    return apiOk({ customLoaded: !!state, types: docTypeCatalogue(state).map(forApp) });
  } catch (e) {
    return apiErr(e);
  }
}

/**
 * POST /api/v1/staff/documents/types { label } — "create a custom type"
 * while verifying. A name that matches an existing type returns that type.
 */
export async function POST(request: Request) {
  try {
    const ctx = await guard(request);
    const body = (await request.json().catch(() => ({}))) as { label?: string };
    const state = await readStudentDocTypes();
    if (!state) throw new ApiError("server_error", "The school's document types could not be read just now — try again", 503);
    const r = addCustomDocType(
      state,
      String(body.label || ""),
      ctx.session.fullName || "Staff",
      new Date().toISOString(),
      () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    );
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);
    if (r.created) {
      if (!(await writeStudentDocTypes(r.state))) throw new ApiError("server_error", "Could not save — try again", 503);
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "students",
        action: "create",
        entityType: "student_doc_type",
        entityId: r.type.id,
        summary: `New document type "${r.type.label}"`,
        after: { label: r.type.label },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }).catch(() => undefined);
    }
    return apiOk({ created: r.created, type: forApp(r.type) });
  } catch (e) {
    return apiErr(e);
  }
}
