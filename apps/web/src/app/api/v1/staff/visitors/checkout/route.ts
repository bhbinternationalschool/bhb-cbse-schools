import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { gateCheckOut, toGateVisitor } from "@/lib/api/v1/staffVisitors.server";

export const runtime = "nodejs";

type Body = { id?: string };

/**
 * POST /api/v1/staff/visitors/checkout — mark a visitor gone.
 *
 * A visit already closed comes back with `alreadyOut: true` and its original
 * out-time intact, rather than being re-stamped to now — the log should say
 * when they actually left, not when somebody tapped the button again.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "visitor_gate");

    const body = (await request.json().catch(() => ({}))) as Body;
    const id = (body.id || "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);

    const { entry, alreadyOut } = await gateCheckOut(id);

    if (!alreadyOut) {
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "visitors",
        action: "edit",
        entityType: "visitor_entry",
        entityId: entry.id,
        summary: `Checked out ${entry.visitorNo || entry.id} · ${entry.visitorName} at the gate`,
        after: { outTime: entry.outTime },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return apiOk({ visitor: toGateVisitor(entry), alreadyOut });
  } catch (e) {
    return apiErr(e);
  }
}
