import type { Metadata } from "next";
import Link from "next/link";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  ADDRESS_ONE_LINE,
  CONTACT,
  displayLegalName,
} from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Refund & cancellation policy",
  description:
    "When fees paid to BHB International School are refundable, how to request a refund, and how long it takes.",
};

export default function RefundPolicyPage() {
  return (
    <PublicChrome>
      <div className="mx-auto max-w-3xl px-6 py-14 text-[15px] leading-7">
        <h1 className="text-3xl font-bold text-slate-900">
          Refund &amp; cancellation policy
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Last updated: 20 August 2026
        </p>

        <p className="mt-6">
          This policy applies to payments made to {displayLegalName()} through
          bhbinternational.school. It sits alongside our{" "}
          <Link href="/terms" className="text-blue-700 underline">
            terms &amp; conditions
          </Link>
          .
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Failed and duplicate payments
        </h2>
        <p className="mt-3">
          If your bank account was debited but the portal did not issue a
          receipt, or you were charged twice for the same instalment, the
          amount is refunded in full. Most gateway-side failures reverse
          automatically within 5 to 7 working days. If it has not reversed,
          write to us with the transaction reference and we will raise it with
          the payment gateway; the refund is credited to the original payment
          method.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Fees charged in error
        </h2>
        <p className="mt-3">
          If a charge was raised in error — a head that does not apply to your
          child, an approved concession that was not applied, or an amount
          above the notified fee — the excess is either refunded or adjusted
          against the next instalment, at your choice. Tell us within 30 days
          of the receipt date.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Withdrawal from the school
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong>Security deposit.</strong> The refundable security deposit
            collected on new admission is returned in full on withdrawal, after
            all outstanding dues and any recoverable damages are adjusted.
          </li>
          <li>
            <strong>Tuition fee.</strong> Tuition is charged monthly. Tuition
            for months after the month in which written withdrawal is submitted
            to the school office is not charged; tuition already paid for those
            months is refunded.
          </li>
          <li>
            <strong>Admission, registration, amenity, communication,
            miscellaneous and examination charges.</strong> These are
            non-refundable once the session has begun, as the corresponding
            costs are incurred at the start of the session.
          </li>
        </ul>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Transport
        </h2>
        <p className="mt-3">
          Transport is billed monthly and may be cancelled with written notice
          to the school office. Charges stop from the month following the
          notice; amounts already paid for later months are refunded. Part
          months are not pro-rated.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Admission registration charge
        </h2>
        <p className="mt-3">
          The charge paid at the time of an admission enquiry or registration
          covers processing of the application and is non-refundable, whether
          or not admission is granted or taken up.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          How to request a refund
        </h2>
        <p className="mt-3">
          Email{" "}
          <a className="text-blue-700 underline" href={`mailto:${CONTACT.email}`}>
            {CONTACT.email}
          </a>{" "}
          or apply at the accounts office, giving the student&rsquo;s name,
          class and admission number, the receipt or transaction reference, the
          amount, and the reason. We acknowledge within 3 working days and
          decide within 10 working days.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          How refunds are paid
        </h2>
        <p className="mt-3">
          Approved refunds go back to the original payment method wherever the
          payment gateway allows it, and otherwise by bank transfer to the
          account of the parent who paid. Online reversals normally reach your
          account within 5 to 7 working days of approval, subject to your
          bank&rsquo;s processing time. We do not refund in cash.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">Contact</h2>
        <p className="mt-3">
          {displayLegalName()}, {ADDRESS_ONE_LINE}. Email:{" "}
          <a className="text-blue-700 underline" href={`mailto:${CONTACT.email}`}>
            {CONTACT.email}
          </a>
          . {CONTACT.hours}
        </p>
      </div>
    </PublicChrome>
  );
}
