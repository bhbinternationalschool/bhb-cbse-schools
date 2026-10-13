/**
 * The signed-in member of staff's own profile (lib/staffSelfProfile).
 *
 * GET    — their record (Aadhaar / bank account masked), the editable fields,
 *          which need the office's approval, and their open request.
 * PATCH  — { fields: { key: value } }: contact and personal fields save at
 *          once; identity, bank and statutory ones become a request for the
 *          office (Staff → Requests). Only changed values count.
 * DELETE — withdraw the open request.
 *
 * Only ever the caller's own row: the staff id comes from the session, never
 * from the request.
 */

import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth, type ApiAuthContext } from "@/lib/api/v1/auth";
import {
  ownProfileView,
  requestForStaff,
  splitProfileChanges,
  STAFF_PROFILE_FIELDS,
} from "@/lib/staffSelfProfile";
import {
  changeProfileRequests,
  patchStaffRow,
  readOwnStaff,
  readProfileRequests,
  submitProfileRequest,
} from "@/lib/staffSelfProfile.server";

export const runtime = "nodejs";

function ownStaffId(ctx: ApiAuthContext): string {
  if (ctx.session.persona !== "staff" || !ctx.session.staffId) {
    throw new ApiError("forbidden", "Staff login required", 403);
  }
  return ctx.session.staffId;
}

async function view(ctx: ApiAuthContext, staffId: string) {
  const [own, reqs] = await Promise.all([readOwnStaff(staffId), readProfileRequests()]);
  if (!own) throw new ApiError("server_error", "Could not read your record — try again.", 503);
  const s = own.staff;
  const designation = ctx.masters.designations?.find((d) => d.id === s.designationId)?.name || "";
  const department = ctx.masters.departments?.find((d) => d.id === s.departmentId)?.name || "";
  const mine = (reqs?.state.requests ?? []).filter((r) => r.staffId === staffId);
  const pending = mine.find((r) => r.status === "pending") || null;
  const recent = mine.find((r) => r.status === "approved" || r.status === "rejected") || null;
  return {
    staff: {
      id: s.id,
      empCode: s.empCode,
      fullName: s.fullName,
      photoUrl: s.photoUrl || "",
      photoStatus: s.docs?.photo?.status || "",
      photoNote: s.docs?.photo?.reviewNote || "",
      designation,
      department,
      joiningDate: s.joiningDate || "",
      category: s.category || "",
      status: s.status,
    },
    values: ownProfileView(s),
    fields: STAFF_PROFILE_FIELDS.map(({ key, label, hindi, kind, group, approval, options, masked }) => ({
      key, label, hindi, kind, group, approval, options: options ?? [], masked: !!masked,
    })),
    pendingRequest: pending ? requestForStaff(pending) : null,
    lastDecision: recent ? requestForStaff(recent) : null,
    requestsUnknown: !reqs,
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    return apiOk(await view(ctx, ownStaffId(ctx)));
  } catch (e) {
    return apiErr(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staffId = ownStaffId(ctx);
    const body = (await request.json().catch(() => null)) as { fields?: Record<string, unknown> } | null;
    if (!body?.fields || typeof body.fields !== "object") throw new ApiError("bad_request", "fields required", 400);
    const own = await readOwnStaff(staffId);
    if (!own) throw new ApiError("server_error", "Could not read your record — nothing was saved. Try again.", 503);
    const split = splitProfileChanges(own.staff as unknown as Record<string, unknown>, body.fields);
    if (split.errors.length) throw new ApiError("bad_request", `Nothing was saved — ${split.errors.join("; ")}`, 400);
    const direct = Object.keys(split.direct);
    const approval = Object.keys(split.approval);
    if (!direct.length && !approval.length) return apiOk({ saved: [], sentForApproval: [], profile: await view(ctx, staffId) });

    if (direct.length) {
      const w = await patchStaffRow(staffId, () => split.direct);
      if (!w.ok) throw new ApiError("server_error", `Not saved — ${w.error}`, 503);
    }
    if (approval.length) {
      const r = await submitProfileRequest(staffId, own.staff.fullName, split.approval);
      if (!r.ok) {
        throw new ApiError(
          "server_error",
          `${direct.length ? "Your contact details were saved, but " : ""}the changes that need approval were NOT sent — ${r.error}`,
          503,
        );
      }
    }
    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff",
      action: "edit",
      entityType: "staff",
      entityId: staffId,
      summary: `Own profile from the staff app: ${direct.length ? `saved ${direct.join(", ")}` : ""}${direct.length && approval.length ? "; " : ""}${approval.length ? `sent for approval ${approval.join(", ")}` : ""}`,
      after: { saved: direct, sentForApproval: approval },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ saved: direct, sentForApproval: approval, profile: await view(ctx, staffId) });
  } catch (e) {
    return apiErr(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staffId = ownStaffId(ctx);
    const r = await changeProfileRequests((s) => {
      const i = s.requests.findIndex((x) => x.staffId === staffId && x.status === "pending");
      if (i < 0) return { error: "You have no open request." };
      const requests = [...s.requests];
      requests[i] = { ...requests[i]!, status: "withdrawn", decidedAt: new Date().toISOString(), decidedBy: ctx.session.fullName || "self" };
      return { ...s, requests };
    });
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);
    return apiOk({ withdrawn: true, profile: await view(ctx, staffId) });
  } catch (e) {
    return apiErr(e);
  }
}
