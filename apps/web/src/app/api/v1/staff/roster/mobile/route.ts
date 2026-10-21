import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import {
  assertPermission,
  invalidateServerMastersCache,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { resetStaffPersistenceCache } from "@/lib/staffPersistence";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { isBlankMobile, mobileFillCheck, mobileKey, staffHoldsPowerfulAccess, staffSensitiveAuthority } from "@/lib/staffProtectedFields";
import { signInMobilesInUse } from "@/lib/data/server/repo";
import { logMobileFills } from "@/lib/staffMobileFillLog.server";

export const runtime = "nodejs";

type Body = { staffId?: string; mobile?: string };

/**
 * POST /api/v1/staff/roster/mobile {staffId, mobile} — leadership / office
 * records (or corrects) a staff member's mobile from the phone. The number
 * is what staff OTP login resolves on, so this is what lets a peon or
 * driver without one into the app. Writes the roster row's column and its
 * profile copy together, the way the staff desk does.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "staff", "edit");
    const scope = await staffSectionScope(ctx);
    if (!scope.unrestricted) {
      throw new ApiError("forbidden", "Only leadership and the office can edit the roster", 403);
    }
    const body = (await request.json().catch(() => ({}))) as Body;
    const staffId = (body.staffId || "").trim();
    const mobile = (body.mobile || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!staffId) throw new ApiError("bad_request", "staffId required", 400);
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      throw new ApiError("bad_request", "Enter a 10-digit Indian mobile number", 400);
    }

    await ensureSchoolMirrorHydrated();
    const staff = ctx.masters.staff.find((s) => s.id === staffId);
    if (!staff) throw new ApiError("not_found", "Staff member not found", 404);
    // The mobile is a sign-in link (staff OTP). Director, 21 Oct 2026:
    // recording a MISSING one is the office's — if no other member, family or
    // login already has the number (compared as the last 10 digits) and the
    // member holds no powerful access; changing a set one is the owner's.
    const isOwner =
      staffSensitiveAuthority(ctx.session, ctx.masters, ctx.rbac, { rbacKnown: ctx.rbacKnown !== false }) === "owner";
    let inUse: Set<string>;
    try {
      inUse = await signInMobilesInUse(staffId);
    } catch {
      throw new ApiError("server_error", "Could not check the mobile numbers in use — nothing was saved. Try again.", 503);
    }
    let isFill = false;
    if (mobileKey(staff.mobile) !== mobile) {
      if (isOwner) {
        if (inUse.has(mobile)) {
          throw new ApiError("bad_request", "That number is already another member's, a family's or a login's — a sign-in number must be one person's", 400);
        }
      } else if (isBlankMobile(staff.mobile)) {
        const fill = mobileFillCheck(staff as unknown as Record<string, unknown>, { mobile }, {
          inUse,
          powerful: staffHoldsPowerfulAccess(staff, ctx.masters, ctx.rbac),
          name: staff.fullName,
        });
        if (fill.kind === "refuse") throw new ApiError("forbidden", fill.message, 403);
        isFill = fill.kind === "fill";
      } else {
        throw new ApiError("forbidden", `${staff.fullName} already has a registered mobile — only the owner changes a sign-in link.`, 403);
      }
    }

    const tctx = await getServerTenantContext();
    if (!tctx) throw new ApiError("server_error", "Tenant unavailable", 503);
    const { data: row, error: readErr } = await tctx.sb
      .from("sis_staff")
      .select("profile")
      .eq("tenant_id", tctx.tenantId)
      .eq("id", staffId)
      .maybeSingle();
    if (readErr) throw new ApiError("server_error", readErr.message, 503);
    const profile = { ...((row?.profile as Record<string, unknown>) || {}), mobile };
    const { error } = await tctx.sb
      .from("sis_staff")
      .update({ mobile, profile, updated_at: new Date().toISOString() })
      .eq("tenant_id", tctx.tenantId)
      .eq("id", staffId);
    if (error) throw new ApiError("server_error", error.message, 503);

    // Three caches hold the roster: the staff persistence layer, the school
    // mirror, and the API auth masters cache the roster route reads through.
    resetStaffPersistenceCache();
    invalidateServerMastersCache();
    await ensureSchoolMirrorHydrated({ force: true }).catch(() => undefined);

    if (isFill) await logMobileFills(ctx.session, [staffId], "roster mobile, staff app");
    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff",
      action: "edit",
      entityType: "staff",
      entityId: staffId,
      summary: `Mobile ${staff.mobile ? "changed" : "added"} for ${staff.fullName} from the app`,
      // A sign-in number is not written to the audit log (director, 21 Oct 2026).
      before: { mobile: isBlankMobile(staff.mobile) ? "blank" : "set" },
      after: { mobile: "set" },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ staffId, mobile, fullName: staff.fullName });
  } catch (e) {
    return apiErr(e);
  }
}
