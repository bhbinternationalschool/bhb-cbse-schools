import { CashfreeCheckoutLauncher } from "@/components/pay/CashfreeCheckoutLauncher";
import { cashfreeSdkMode, fetchCashfreePaymentStatus } from "@/lib/cashfree.server";
import { isCashfreeOrderId } from "@/lib/cashfreeCheckout";
import {
  getCashfreeCheckout,
  settleCashfreeCheckout,
  type CheckoutKind,
} from "@/lib/cashfreeCheckouts.server";
import { formatPaise, passValidLabel } from "@/lib/tutorPlans";
import { TENANT } from "@/lib/types";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<CheckoutKind, string> = {
  fee_link: "School fees",
  registration: "Registration fee",
  event_fee: "Event entry fee",
  tutor_pass: "AI tutor pass",
};

/**
 * The school's pay page for a Cashfree order. Before payment it launches
 * Cashfree's checkout; Cashfree sends the parent back here afterwards,
 * and the page verifies with Cashfree and settles — so a receipt exists
 * even if the webhook is slow — then shows the outcome.
 */
export default async function CashfreePayPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const row = isCashfreeOrderId(orderId) ? await getCashfreeCheckout(orderId) : null;

  if (!row) {
    return (
      <Shell title="Payment not found">
        <p className="mt-3 text-[15px] text-[#203050]">This link does not match a payment. Please open it again from the app or message.</p>
      </Shell>
    );
  }

  const label = KIND_LABEL[row.kind];
  const amount = formatPaise(row.amountPaise);

  // Already settled, or Cashfree says PAID and we have not settled yet.
  let settled: Awaited<ReturnType<typeof settleCashfreeCheckout>> | null = null;
  if (row.status === "paid") {
    settled = { ok: true, alreadyPaid: true, kind: row.kind, ref: row.ref };
  } else {
    const live = await fetchCashfreePaymentStatus(orderId);
    if (live.ok && live.status === "PAID") {
      settled = await settleCashfreeCheckout({ orderId, source: "return" });
    } else if (live.ok && live.status !== "ACTIVE") {
      return (
        <Shell title={live.status === "EXPIRED" ? "Payment link expired" : "Payment not completed"}>
          <p className="mt-3 text-[15px] text-[#203050]">
            {label} · {amount}. {live.status === "EXPIRED" ? "Please start the payment again from the app." : "No money was taken. You can try again from the app."}
          </p>
        </Shell>
      );
    }
  }

  if (settled) {
    return (
      <Shell title={settled.ok ? "Payment received" : "Payment received — being recorded"}>
        <p className="mt-3 text-[15px] leading-relaxed text-[#203050]">
          {label} · {amount}.{" "}
          {settled.ok
            ? row.kind === "tutor_pass"
              ? settled.endsAt
                ? `${passValidLabel(settled.endsAt)}. Open the app — the full tutor is unlocked.`
                : "The pass is active. Open the app — the full tutor is unlocked."
              : settled.receiptNo
                ? `Receipt no. ${settled.receiptNo}.`
                : "Thank you."
            : "Cashfree has confirmed the payment; the school's record will update within a minute."}
        </p>
        {row.afterUrl && settled.ok && row.kind !== "tutor_pass" ? (
          <a
            href={row.afterUrl}
            className="mt-6 inline-block rounded-xl bg-[#203050] px-5 py-3 text-[15px] font-semibold text-white"
          >
            {row.kind === "fee_link" ? "View receipt" : "Continue"}
          </a>
        ) : null}
        <p className="mt-8 text-sm text-[#5c6478]">You can close this page and return to the app.</p>
      </Shell>
    );
  }

  return (
    <Shell title={label}>
      <p className="mt-2 text-3xl font-bold text-[#203050]">{amount}</p>
      <CashfreeCheckoutLauncher
        paymentSessionId={row.paymentSessionId}
        mode={cashfreeSdkMode()}
        amountLabel={amount}
      />
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-14 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-[#5c6478]">{TENANT.nameDisplay}</p>
      <h1 className="mt-3 text-2xl font-bold text-[#203050]">{title}</h1>
      {children}
    </main>
  );
}
