import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { llmStatus } from "@/lib/aiLlm.server";
import { listTutorPassOrders, tutorAllowance, tutorPlans } from "@/lib/tutorPasses.server";
import { householdLanguage } from "@/lib/householdPrefs";
import { loadSis } from "@/lib/sis";
import { resolveTutorStudent } from "@/lib/tutorApi.server";
import { formatPaise, passValidLabel, TUTOR_MODES } from "@/lib/tutorPlans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/tutor/status?studentId= — what the parent app shows before
 * the first question, for one child: the modes and which need a pass,
 * today's free hints left, that child's pass ("Valid till 12 Sep"), the
 * passes on sale, and the child's recent orders.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const studentId = new URL(request.url).searchParams.get("studentId") ?? "";
    const student = await resolveTutorStudent(householdId, studentId);
    const [allowance, allOrders] = await Promise.all([
      tutorAllowance(householdId, student),
      listTutorPassOrders(householdId, 30),
    ]);
    const orders = allOrders.filter((o) => o.studentId === student.id).slice(0, 10);
    const status = llmStatus();
    // Families who told the school they prefer Hindi (or a regional
    // language) start in Hindi; the app's toggle overrides per session.
    const hh = loadSis().households.find((h) => h.id === householdId);
    const defaultLanguage = householdLanguage(hh ?? {}).language === "en" ? "en" : "hi";
    return apiOk({
      configured: status.tutorEngine !== "none",
      engine: status.tutorEngine,
      defaultLanguage,
      videosAvailable: !!(process.env.YOUTUBE_API_KEY || "").trim(),
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
        `Hints are free within the family's daily allowance and never give the final answer. The full tutor — teaching, worked examples, practice, checking answers, homework help, exam preparation — is open for the length of a pass: a day, a week or a month. A pass is for one child and covers ${student.name}'s class (${student.classLabel}) only; a brother or sister needs their own.`,
    });
  } catch (e) {
    return apiErr(e);
  }
}
