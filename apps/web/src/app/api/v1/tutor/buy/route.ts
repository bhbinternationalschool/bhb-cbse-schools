import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { writeAudit } from "@/lib/audit.server";
import { shouldUseCashfreeCheckout } from "@/lib/cashfree.server";
import { createCashfreeCheckout } from "@/lib/cashfreeCheckouts.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { householdWhatsApp, loadSis } from "@/lib/sis";
import {
  insertTutorPassOrder,
  newTutorOrderId,
  setTutorOrderCheckoutUrl,
  tutorPlans,
} from "@/lib/tutorPasses.server";
import { formatPaise } from "@/lib/tutorPlans";
import { TENANT } from "@/lib/types";
import { publicAppOrigin } from "@/lib/waSisBotServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/tutor/buy { planCode } — a parent starts buying a tutor
 * pass. The amount comes from the plan on the server, never the client.
 * A pending order is written first, then a Cashfree payment link whose
 * link_id is the order id; the webhook activates the pass once the link
 * is verifiably PAID (see /api/payments/cashfree/webhook).
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as { planCode?: string };
    const planCode = (body.planCode ?? "").trim();
    const plan = tutorPlans().find((p) => p.code === planCode);
    if (!plan) throw new ApiError("bad_request", "Unknown tutor pass", 400);
    if (!shouldUseCashfreeCheckout()) {
      throw new ApiError("conflict", "Online payment is not enabled yet. Please ask the school office.", 409);
    }

    await ensureSchoolMirrorHydrated();
    const hh = loadSis().households.find((h) => h.id === householdId);
    if (!hh) throw new ApiError("not_found", "Household not found", 404);
    const mobile = householdWhatsApp(hh) || hh.mobile || "";
    if (mobile.replace(/\D/g, "").slice(-10).length !== 10) {
      throw new ApiError("conflict", "The school needs your mobile number on record before online payment. Please ask the office.", 409);
    }

    const orderId = newTutorOrderId();
    const ins = await insertTutorPassOrder({
      id: orderId,
      householdId,
      plan,
      createdBy: hh.guardianName || "Parent app",
    });
    if (!ins.ok) throw new ApiError("server_error", ins.error, 500);

    const origin = publicAppOrigin();
    const link = await createCashfreeCheckout({
      kind: "tutor_pass",
      ref: orderId,
      preferredId: orderId,
      amountPaise: plan.pricePaise,
      purpose: `AI tutor pass · ${plan.label} · ${TENANT.nameDisplay}`,
      customerId: householdId,
      customerName: hh.guardianName || "Parent",
      customerMobile: mobile,
      afterUrl: `${origin}/pay/tutor-pass/${orderId}`,
      origin,
      notes: { householdId, planCode: plan.code },
    });
    if (!link.ok) throw new ApiError("server_error", link.error, 502);
    await setTutorOrderCheckoutUrl(orderId, link.checkoutUrl);

    const meta = requestMeta(request);
    await writeAudit({
      module: "tutor",
      action: "pass.order",
      entityId: orderId,
      summary: `${plan.label} tutor pass · ${formatPaise(plan.pricePaise)} · ${hh.guardianName || householdId}`,
      session: ctx.session,
      entityType: "tutor_pass_order",
      ...meta,
    });

    return apiOk({
      orderId,
      planCode: plan.code,
      planLabel: plan.label,
      amountPaise: plan.pricePaise,
      amountLabel: formatPaise(plan.pricePaise),
      checkoutUrl: link.checkoutUrl,
    });
  } catch (e) {
    return apiErr(e);
  }
}
