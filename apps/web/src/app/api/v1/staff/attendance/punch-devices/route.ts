import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertSchoolWide } from "@/lib/api/v1/staffScope";
import {
  createPunchDisplay,
  decidePunchDevice,
  listPunchDevices,
  listPunchDisplays,
  revokePunchDisplay,
} from "@/lib/punchDevices.server";

export const runtime = "nodejs";

/**
 * GET  /api/v1/staff/attendance/punch-devices — the office's view: every
 *      staff member's registered punch phone, phones waiting for approval,
 *      and the QR screens that are switched on.
 * POST {action: approve|reject|reset, id} — decide a phone.
 * POST {action: screen_create, label} → {token} — switch THIS device on as
 *      a QR screen; POST {action: screen_revoke, id} switches one off.
 * Office / principal / admin only.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await assertSchoolWide(ctx);
    const [devices, screens] = await Promise.all([listPunchDevices(), listPunchDisplays()]);
    if (!devices || !screens) {
      throw new ApiError("server_error", "Could not read punch phones right now", 503);
    }
    const nameOf = new Map(ctx.masters.staff.map((s) => [s.id, s.fullName]));
    return apiOk({
      devices: devices.map((d) => ({ ...d, staffName: nameOf.get(d.staff_id) || d.staff_id })),
      screens,
      staffWithoutPhone: ctx.masters.staff
        .filter((s) => s.status !== "inactive" && !devices.some((d) => d.staff_id === s.id && d.status === "active"))
        .map((s) => ({ id: s.id, name: s.fullName })),
    });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = { action?: string; id?: string; label?: string };

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await assertSchoolWide(ctx);
    const body = (await request.json().catch(() => ({}))) as Body;
    const by = ctx.session.fullName || "Office";
    const meta = requestMeta(request);

    if (body.action === "screen_create") {
      const r = await createPunchDisplay(String(body.label || "Office screen"), by);
      if (!r.ok) throw new ApiError("server_error", r.error, 503);
      await writeAudit({
        session: ctx.session,
        module: "staff_attendance",
        action: "create",
        entityType: "punch_screen",
        entityId: "",
        summary: `Switched on a punch QR screen: ${body.label || "Office screen"}`,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ token: r.token });
    }
    if (body.action === "screen_revoke") {
      if (!body.id || !(await revokePunchDisplay(body.id))) {
        throw new ApiError("server_error", "Could not switch that screen off", 503);
      }
      return apiOk({ revoked: body.id });
    }
    if (body.action === "approve" || body.action === "reject" || body.action === "reset") {
      if (!body.id) throw new ApiError("bad_request", "Which phone?", 400);
      const r = await decidePunchDevice(body.id, body.action, by);
      if (!r.ok) throw new ApiError("conflict", r.error, 409);
      await writeAudit({
        session: ctx.session,
        module: "staff_attendance",
        action: "edit",
        entityType: "punch_phone",
        entityId: body.id,
        summary: `Punch phone ${body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "reset"}`,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ id: body.id, action: body.action });
    }
    throw new ApiError("bad_request", "Unknown action", 400);
  } catch (e) {
    return apiErr(e);
  }
}
