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
    const clash = ctx.masters.staff.find(
      (s) => s.id !== staffId && (s.mobile || "").replace(/\D/g, "").endsWith(mobile),
    );
    if (clash) {
      throw new ApiError("bad_request", `That number is already on ${clash.fullName}'s record`, 400);
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

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff",
      action: "edit",
      entityType: "staff",
      entityId: staffId,
      summary: `Mobile ${staff.mobile ? "changed" : "added"} for ${staff.fullName} from the app`,
      before: { mobile: staff.mobile || "" },
      after: { mobile },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ staffId, mobile, fullName: staff.fullName });
  } catch (e) {
    return apiErr(e);
  }
}
