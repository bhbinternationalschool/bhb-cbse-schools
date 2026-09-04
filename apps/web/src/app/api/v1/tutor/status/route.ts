import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { llmStatus } from "@/lib/aiLlm.server";
import { listTutorPassOrders, tutorAllowance, tutorPlans } from "@/lib/tutorPasses.server";
import { formatPaise, passValidLabel, TUTOR_MODES } from "@/lib/tutorPlans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/tutor/status — what the parent app shows before the first
 * question: the modes and which need a pass, today's free hints left, the
 * pass in force ("Valid till 12 Sep"), the passes on sale, and the
 * household's recent orders.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const [allowance, orders] = await Promise.all([
      tutorAllowance(householdId),
      listTutorPassOrders(householdId, 10),
    ]);
    const status = llmStatus();
    return apiOk({
      configured: status.tutorEngine !== "none",
      engine: status.tutorEngine,
      modes: TUTOR_MODES.map((m) => ({
        code: m.code,
        label: m.label,
        blurb: m.blurb,
        paid: m.paid,
        prompt: m.prompt,
      })),
      allowance: {
        ...allowance,
        passValidLabel: allowance.pass ? passValidLabel(allowance.pass.endsAt) : "",
      },
      plans: tutorPlans().map((p) => ({ ...p, priceLabel: formatPaise(p.pricePaise) })),
      orders: orders.map((o) => ({
        id: o.id,
        planCode: o.planCode,
        days: o.days,
        amountPaise: o.amountPaise,
        amountLabel: formatPaise(o.amountPaise),
        status: o.status,
        checkoutUrl: o.status === "pending" ? o.checkoutUrl : "",
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        endsAt: o.endsAt,
        validLabel: o.endsAt ? passValidLabel(o.endsAt) : "",
      })),
      note:
        "Hints are free within the daily allowance and never give the final answer. The full tutor — teaching, worked examples, practice, checking answers, homework help, exam preparation — is open for the length of a pass: a day, a week or a month.",
    });
  } catch (e) {
    return apiErr(e);
  }
}
