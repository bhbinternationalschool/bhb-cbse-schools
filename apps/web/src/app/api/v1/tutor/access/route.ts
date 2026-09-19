import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { writeAudit } from "@/lib/audit.server";
import {
  loadTutorAccessRules,
  loadTutorPlans,
  saveTutorAccessRule,
  saveTutorPlanPrice,
  setTutorAccessRuleActive,
} from "@/lib/tutorAccess.server";

export const runtime = "nodejs";

/** GET /api/v1/tutor/access — the price list and every grant. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "fees", "view");
    const [plans, rules] = await Promise.all([loadTutorPlans(), loadTutorAccessRules(true)]);
    return apiOk({ plans, rules });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  action?: "price" | "grant" | "toggle";
  // price
  code?: string;
  label?: string;
  days?: number;
  priceRupees?: number;
  sortOrder?: number;
  // grant
  kind?: "free" | "discount";
  scope?: "all" | "class" | "student";
  scopeIds?: string[];
  freeUntil?: string | null;
  discountPercent?: number;
  note?: string;
  // toggle
  id?: string;
  isActive?: boolean;
};

/**
 * POST /api/v1/tutor/access — set a price, grant free access or a discount,
 * or switch a grant off.
 *
 * This is money: what a family is charged, and what the school gives away.
 * It takes "fees: approve", which is the same authority that writes off a
 * fee — an exam-week giveaway to the whole school is the same kind of
 * decision, and it is audited like one.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "fees", "approve");
    const body = (await request.json()) as Body;
    const by = ctx.session.fullName || ctx.session.roleCode || "Staff";
    const meta = requestMeta(request);

    if (body.action === "price") {
      const rupees = Number(body.priceRupees);
      if (!Number.isFinite(rupees) || rupees < 0) {
        throw new ApiError("bad_request", "A price cannot be negative", 400);
      }
      const r = await saveTutorPlanPrice({
        code: String(body.code || ""),
        label: String(body.label || ""),
        days: Number(body.days),
        pricePaise: Math.round(rupees * 100),
        sortOrder: body.sortOrder ?? 0,
        by,
      });
      if (!r.ok) throw new ApiError("bad_request", r.error || "Could not save", 400);
      await writeAudit({
        session: ctx.session,
        module: "fees",
        action: "update",
        entityType: "tutor_plan_price",
        entityId: String(body.code || ""),
        summary: `Tutor pass "${body.code}" priced at ₹${rupees}`,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ saved: true });
    }

    if (body.action === "toggle") {
      if (!body.id) throw new ApiError("bad_request", "Which grant?", 400);
      const r = await setTutorAccessRuleActive(body.id, !!body.isActive);
      if (!r.ok) throw new ApiError("bad_request", r.error || "Could not change it", 400);
      await writeAudit({
        session: ctx.session,
        module: "fees",
        action: "update",
        entityType: "tutor_access_rule",
        entityId: body.id,
        summary: body.isActive ? "Tutor grant switched on" : "Tutor grant withdrawn",
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ saved: true });
    }

    const r = await saveTutorAccessRule({
      kind: body.kind === "discount" ? "discount" : "free",
      scope: body.scope === "class" || body.scope === "student" ? body.scope : "all",
      scopeIds: body.scopeIds,
      freeUntil: body.freeUntil ?? null,
      discountPercent: body.discountPercent ?? null,
      note: body.note,
      by,
    });
    if (!r.ok) throw new ApiError("bad_request", r.error || "Could not save", 400);
    await writeAudit({
      session: ctx.session,
      module: "fees",
      action: "create",
      entityType: "tutor_access_rule",
      entityId: `${body.kind}:${body.scope}`,
      summary:
        body.kind === "discount"
          ? `Tutor discount ${body.discountPercent}% for ${r.written} ${body.scope}`
          : `Tutor free until ${body.freeUntil} for ${r.written} ${body.scope}`,
      after: { kind: body.kind, scope: body.scope, written: r.written, freeUntil: body.freeUntil },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ written: r.written });
  } catch (e) {
    return apiErr(e);
  }
}
