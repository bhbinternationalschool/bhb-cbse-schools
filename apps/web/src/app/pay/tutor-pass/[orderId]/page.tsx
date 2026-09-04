import { getTutorPassOrder } from "@/lib/tutorPasses.server";
import { formatPaise, passValidLabel } from "@/lib/tutorPlans";
import { TENANT } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Where Cashfree sends a parent back after paying for a tutor pass. The
 * webhook does the activating; this page only reports what it finds, and
 * tells a parent whose webhook has not landed yet to give it a minute.
 */
export default async function TutorPassReturnPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const order = /^tutp_[a-z0-9]+$/.test(orderId) ? await getTutorPassOrder(orderId) : null;
  const paid = order?.status === "paid" && order.endsAt;
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-[#5c6478]">{TENANT.nameDisplay}</p>
      <h1 className="mt-3 text-2xl font-bold text-[#203050]">
        {paid ? "Tutor pass active" : order ? "Payment being confirmed" : "Order not found"}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[#203050]">
        {paid
          ? `${passValidLabel(order.endsAt!)}. Open the app — the full tutor is unlocked.`
          : order
            ? `We are waiting for the bank to confirm ${formatPaise(order.amountPaise)}. This usually takes under a minute; the pass switches on by itself.`
            : "This link does not match a tutor pass order."}
      </p>
      <p className="mt-8 text-sm text-[#5c6478]">You can close this page and return to the app.</p>
    </main>
  );
}
