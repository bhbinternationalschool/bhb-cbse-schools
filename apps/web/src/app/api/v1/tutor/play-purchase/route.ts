import { createHash } from "crypto";

import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import {
  activateTutorPassOrder,
  getTutorPassOrder,
  insertTutorPassOrder,
  tutorPlans,
} from "@/lib/tutorPasses.server";
import { resolveTutorStudent } from "@/lib/tutorApi.server";
import {
  acknowledgePlayPurchase,
  verifyPlayPurchase,
} from "@/lib/playBilling.server";

export const runtime = "nodejs";

/** One purchase token, one order — see the note at the insert below. */
function playOrderId(purchaseToken: string): string {
  return `tp_play_${createHash("sha256").update(purchaseToken).digest("hex").slice(0, 24)}`;
}

type Body = {
  productId?: string;
  purchaseToken?: string;
  studentId?: string;
};

/**
 * POST /api/v1/tutor/play-purchase — grant a tutor pass bought through
 * Google Play Billing.
 *
 * The Play build of the parent app cannot use Cashfree for this: Play
 * requires its own billing for digital content consumed inside the app.
 * School fees are a real-world service and stay on Cashfree everywhere; only
 * the tutor pass changes rail, and only in the Play build.
 *
 * The client sends a purchase token, which proves nothing by itself — a
 * modified app can post any string. It becomes a purchase only when Google
 * confirms it, so the token is verified against the Play Developer API
 * BEFORE any pass is granted, and an unverifiable one is refused rather than
 * given the benefit of the doubt.
 *
 * The grant itself reuses activateTutorPassOrder, the same status-filtered
 * atomic flip the Cashfree webhook uses, so a retried purchase — Play redelivers
 * until the client acknowledges — extends the pass once and reports the same
 * end date afterwards.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as Body;

    const productId = (body.productId ?? "").trim();
    const purchaseToken = (body.purchaseToken ?? "").trim();
    if (!productId) throw new ApiError("bad_request", "productId required", 400);
    if (!purchaseToken) {
      throw new ApiError("bad_request", "purchaseToken required", 400);
    }

    // The Play product id IS the plan code — one catalogue, two rails.
    const plan = tutorPlans().find((p) => p.code === productId);
    if (!plan) throw new ApiError("bad_request", "Unknown tutor pass", 400);

    const student = await resolveTutorStudent(
      householdId,
      (body.studentId ?? "").trim(),
    );

    const verified = await verifyPlayPurchase({ productId, purchaseToken });
    if (!verified.ok) {
      // A purchase Google will not confirm is not a purchase. 402 rather than
      // 500 for "not configured" would tell the parent to try again, which is
      // wrong — nobody can fix it from a phone.
      throw new ApiError(
        verified.code === "invalid" ? "forbidden" : "server_error",
        verified.error,
        verified.code === "invalid" ? 403 : 503,
      );
    }

    // The order id is DERIVED from the purchase token, not minted fresh.
    // Play redelivers a purchase until the client acknowledges it, and the
    // app retries on a dropped connection, so the same token arrives more
    // than once as a matter of course. A random id per POST would create a
    // second order each time and grant the days again; a derived id makes the
    // primary key itself the idempotency guarantee, and the duplicate insert
    // is the signal that we have already served this purchase.
    const orderId = playOrderId(purchaseToken);
    const ins = await insertTutorPassOrder({
      id: orderId,
      householdId,
      studentId: student.id,
      plan,
      createdBy: "Google Play",
    });
    if (!ins.ok) {
      const existing = await getTutorPassOrder(orderId);
      if (!existing) throw new ApiError("server_error", ins.error, 500);
      // Acknowledge again — the first attempt may be why Play resent it.
      await acknowledgePlayPurchase({ productId, purchaseToken });
      return apiOk({
        ok: true,
        alreadyGranted: true,
        endsAt: existing.endsAt ?? "",
        planLabel: plan.label,
        studentName: student.name,
        acknowledged: true,
      });
    }

    const granted = await activateTutorPassOrder({
      id: orderId,
      paymentRef: verified.orderId || `play:${purchaseToken.slice(0, 24)}`,
    });
    if (!granted.ok) throw new ApiError("server_error", granted.error, 500);

    // Play refunds an unacknowledged purchase after three days. Acknowledge
    // only AFTER the pass exists, and never let a failure here undo it.
    const acknowledged = await acknowledgePlayPurchase({
      productId,
      purchaseToken,
    });

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "tutor",
      action: "create",
      entityType: "tutor_pass_order",
      entityId: orderId,
      summary: `Tutor pass ${plan.label} for ${student.name} via Google Play (${verified.orderId || "no order id"})`,
      after: {
        productId,
        playOrderId: verified.orderId,
        endsAt: granted.endsAt,
        acknowledged,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      ok: true,
      alreadyGranted: granted.alreadyPaid,
      endsAt: granted.endsAt,
      planLabel: plan.label,
      studentName: student.name,
      acknowledged,
    });
  } catch (e) {
    return apiErr(e);
  }
}
