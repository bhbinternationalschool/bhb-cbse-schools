import { AutopayApproveLauncher } from "@/components/pay/AutopayApproveLauncher";
import { cashfreeSdkMode } from "@/lib/cashfree.server";
import { isAutopayId, isTerminalMandate, mandateStatusLabel, rupeesLabel } from "@/lib/feeAutopay";
import { getMandate, syncMandate } from "@/lib/feeAutopay.server";
import { TENANT } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The parent's page for fee auto-pay: what they are agreeing to, then
 * Cashfree's approval. Cashfree sends them back here afterwards, and the page
 * re-reads the mandate from Cashfree to say where it stands.
 */
export default async function AutopayPage({
  params,
}: {
  params: Promise<{ subscriptionId: string }>;
}) {
  const { subscriptionId } = await params;
  const stored = isAutopayId(subscriptionId) ? await getMandate(subscriptionId) : null;
  if (!stored) {
    return (
      <Shell title="Link not found">
        <p className="mt-3 text-[15px] text-[var(--foreground)]">This auto-pay link does not match any set-up. Please ask the school office for a new one.</p>
      </Shell>
    );
  }
  const m = isTerminalMandate(stored.status) ? stored : (await syncMandate(subscriptionId)) ?? stored;
  const limit = rupeesLabel(m.maxPaise);
  const status = m.status.toUpperCase();

  if (status === "ACTIVE") {
    return (
      <Shell title="Auto-pay is on ✅">
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--foreground)]">
          Thank you. Each month&apos;s school fee will be paid automatically, up to {limit} a month. You will get a WhatsApp message the day before every debit, and the receipt after it.
        </p>
        <p className="mt-6 text-sm text-[var(--muted)]">To stop it, reply to the school&apos;s WhatsApp message or cancel it in your UPI app.</p>
      </Shell>
    );
  }
  if (status === "BANK_APPROVAL_PENDING") {
    return (
      <Shell title="Approved — bank confirming">
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--foreground)]">
          Thank you. Your bank is confirming the auto-pay, which can take 1–2 working days. Nothing more is needed from you; the school will see it once it is active.
        </p>
      </Shell>
    );
  }
  if (isTerminalMandate(status) || status === "ON_HOLD" || status === "PAUSED" || status === "CUSTOMER_PAUSED") {
    return (
      <Shell title={mandateStatusLabel(status)}>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--foreground)]">
          {isTerminalMandate(status)
            ? "This auto-pay is no longer active. If you would like to set it up again, please ask the school office for a new link."
            : "Auto-pay is paused at the moment. Please contact the school office if you have a question."}
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="School fee auto-pay">
      <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">Up to {limit} a month</p>
      <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-[14px] leading-relaxed text-[var(--foreground)]">
        <li>• Each month the school debits only the fee that is due — never more than {limit}.</li>
        <li>• You get a WhatsApp message the day before every debit, and the receipt after it.</li>
        <li>• No counter visit and no missed dates.</li>
        <li>• You can stop it any time from your UPI app or by telling the school.</li>
      </ul>
      {m.sessionId ? (
        <AutopayApproveLauncher sessionId={m.sessionId} mode={cashfreeSdkMode()} limitLabel={limit} />
      ) : (
        <p className="mt-6 text-sm text-[var(--danger)]">This link is not ready. Please ask the school office to send it again.</p>
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-6 py-14 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{TENANT.nameDisplay}</p>
      <h1 className="mt-3 text-2xl font-bold text-[var(--foreground)]">{title}</h1>
      {children}
    </main>
  );
}
