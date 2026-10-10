import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalCallout,
  LegalList,
  LegalPage,
  LegalSection,
} from "@/components/public/LegalPage";
import { CONTACT, displayLegalName } from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Cancellation & refund policy",
  description:
    "School fees, registration deposits and online transport fees paid to BHB International School are non-refundable once processed, except where a duplicate or failed transaction has occurred.",
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Cancellation & refund policy"
      updated="30 August 2026"
      current="/refund-policy"
      summary={
        <p>
          School fees, registration deposits and online transport fees are{" "}
          <strong>non-refundable</strong> once the payment has been processed
          and credited to the bank account of {displayLegalName()}. The one
          exception is a transaction error — a duplicate charge, or money
          debited from your bank without a receipt being issued. Those are
          returned in full to the account you paid from.
        </p>
      }
    >
      <LegalSection n={1} title="What this policy covers">
        <p>
          This policy applies to every payment made to {displayLegalName()}{" "}
          (&ldquo;the trust&rdquo;) through bhbinternational.school, the parent
          portal, the school&rsquo;s mobile app, or a payment link issued by the
          school. It forms part of our{" "}
          <Link href="/terms" className="text-blue-700 underline">
            terms &amp; conditions
          </Link>
          . Please read it before you pay.
        </p>
      </LegalSection>

      <LegalSection n={2} title="Fees are non-refundable once processed">
        <LegalCallout>
          School fees, registration deposits and online transport fees are not
          refundable once the transaction has been processed and the money has
          been credited to the bank account of {displayLegalName()}. This
          applies whether the payment was made online or at the school office,
          and whether or not the student subsequently attends.
        </LegalCallout>
        <p>Specifically, and for the avoidance of doubt:</p>
        <LegalList>
          <li>
            <strong>School fees</strong> — tuition, amenity, examination,
            communication and miscellaneous charges — are charged for the
            session or instalment to which they relate. The corresponding costs
            are committed by the school when the session begins, so paid fees
            are not returned, and no part of a month or term is pro-rated.
          </li>
          <li>
            <strong>Registration and admission deposits</strong> pay for
            processing the application and reserving the place. They are not
            refundable, and not transferable to another student, whether or not
            admission is granted and whether or not the place is taken up.
          </li>
          <li>
            <strong>Online transport fees</strong> are charged monthly for the
            route and stop assigned to the student. Once a month&rsquo;s
            transport fee is paid it is not refunded, including where the
            student stops using the bus part-way through that month.
          </li>
          <li>
            <strong>Withdrawal from the school</strong> does not create a right
            to a refund of any amount already paid under the heads above.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection
        n={3}
        title="The exception: duplicate and failed transactions"
      >
        <p>
          A transaction error is not a fee, and money taken by mistake is always
          returned. We refund in full where:
        </p>
        <LegalList>
          <li>
            <strong>You were charged twice.</strong> The same instalment was
            paid more than once — for example the page was submitted twice, or
            the app retried after a timeout. The duplicate amount is refunded in
            full.
          </li>
          <li>
            <strong>Your bank was debited but no receipt was issued.</strong>{" "}
            The payment did not complete at the gateway, so no fee was ever
            recorded against your child. The debit is reversed in full.
          </li>
        </LegalList>
        <p>
          Most gateway-side failures reverse automatically within 5 to 7 working
          days without any action from you. If yours has not reversed within
          that time, write to us with the transaction reference and we will
          raise it with the payment gateway.
        </p>
        <p>
          Where a duplicate payment is confirmed, you may instead ask us to hold
          the amount as a credit against your child&rsquo;s next instalment.
          That is your choice, not a substitute for the refund.
        </p>
      </LegalSection>

      <LegalSection n={4} title="Amounts charged in error">
        <p>
          If a charge was raised against your child in error — a fee head that
          does not apply, an approved concession that was not applied, or an
          amount above the notified fee — tell us within 30 days of the receipt
          date. Once verified, the excess is credited against your child&rsquo;s
          next instalment. This is a correction of your account rather than a
          refund of processed fees.
        </p>
      </LegalSection>

      <LegalSection n={5} title="Refundable security deposit">
        <p>
          The refundable security deposit collected on new admission is not a
          fee. It is held against damage and outstanding dues, and is returned
          in full on withdrawal from the school, after any dues and recoverable
          damages have been adjusted. It is claimed at the school office on
          production of the original admission receipt.
        </p>
      </LegalSection>

      <LegalSection n={6} title="How to raise a claim">
        <p>
          Email{" "}
          <a
            className="text-blue-700 underline"
            href={`mailto:${CONTACT.email}`}
          >
            {CONTACT.email}
          </a>{" "}
          or apply at the accounts office, giving:
        </p>
        <LegalList>
          <li>the student&rsquo;s name, class and admission number;</li>
          <li>
            the gateway transaction reference or the portal receipt number, and
            the date;
          </li>
          <li>the amount, and what went wrong.</li>
        </LegalList>
        <p>
          We acknowledge within 3 working days and decide within 10 working
          days. If we decline a claim we will tell you why, in writing.
        </p>
      </LegalSection>

      <LegalSection n={7} title="How approved refunds are paid">
        <p>
          An approved refund is returned to the original payment method wherever
          the payment gateway allows it, and otherwise by bank transfer to the
          account of the parent who made the payment. Reversals normally reach
          your account within 5 to 7 working days of approval, subject to your
          bank&rsquo;s processing time. We do not refund in cash, and we do not
          refund to a third party&rsquo;s account.
        </p>
      </LegalSection>

      <LegalSection n={8} title="Cancelling a service">
        <p>
          Transport may be discontinued by written notice to the school office;
          billing stops from the month following the notice, and the current
          month&rsquo;s paid fee is not refunded. Withdrawal from the school is
          by written application to the school office in accordance with the
          school&rsquo;s admission terms. Cancelling a service stops future
          charges; it does not reverse charges already processed.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
