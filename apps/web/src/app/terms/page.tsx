import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalList,
  LegalPage,
  LegalSection,
} from "@/components/public/LegalPage";
import { CONTACT, displayLegalName } from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Terms & conditions",
  description:
    "Rules for using the BHB International School website, the parent and staff portal, and the online fee payment module.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & conditions"
      updated="30 August 2026"
      current="/terms"
      summary={
        <p>
          Portal accounts are issued by the school to enrolled families and to
          staff, and must be used only by the person they were issued to. Fees
          shown in the portal are payable by their due date. An online payment
          counts as made only when the gateway confirms it and the portal issues
          a receipt. Using this site or paying through it means you accept these
          terms.
        </p>
      }
    >
      <LegalSection n={1} title="Scope and acceptance">
        <p>
          These terms govern bhbinternational.school, the parent and staff
          portal hosted on it, the school&rsquo;s mobile app, and the online fee
          payment module within them. The service is operated by{" "}
          {displayLegalName()}, identified in full at the foot of this page
          (&ldquo;the school&rdquo;, &ldquo;we&rdquo;). By accessing the site,
          signing in to the portal or making a payment, you accept these terms.
          If you do not accept them, do not use the portal; fees may still be
          paid at the school office.
        </p>
      </LegalSection>

      <LegalSection n={2} title="Who may hold a portal account">
        <LegalList>
          <li>
            Accounts are issued by the school. They cannot be self-registered,
            and there is no public sign-up.
          </li>
          <li>
            A parent account is issued to the parent or guardian recorded
            against an enrolled student, and gives access to that family&rsquo;s
            children only.
          </li>
          <li>
            A staff account is issued to a serving member of staff and carries
            only the permissions their role requires.
          </li>
          <li>
            Access ends when the student leaves the school or the staff member
            ceases to serve. The school may suspend an account at any time to
            protect the service or another family&rsquo;s records.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={3} title="Keeping your access secure">
        <LegalList>
          <li>
            Sign-in uses a one-time password sent to the mobile number
            registered with the school. Do not disclose that code to anyone,
            including anyone claiming to be from the school — we will never ask
            you for it.
          </li>
          <li>
            You are responsible for everything done under your account. Keep
            your registered number and device secure.
          </li>
          <li>
            Tell the school office at once if your mobile number changes, if you
            lose the device, or if you believe your account has been used by
            someone else.
          </li>
          <li>
            Do not share an account with other families, and do not attempt to
            sign in on behalf of another family.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={4} title="Acceptable use of the portal">
        <p>You must not:</p>
        <LegalList>
          <li>
            attempt to view, alter or download records belonging to a student
            who is not your own child;
          </li>
          <li>
            probe, scan, overload or otherwise interfere with the service, or
            attempt to bypass its authentication or role permissions;
          </li>
          <li>
            scrape, bulk-download or republish content, or use the site or its
            data for any commercial purpose;
          </li>
          <li>
            upload anything unlawful, or anything containing malware, into a
            form or message in the portal;
          </li>
          <li>
            submit false information, including a payment reference for a
            payment you did not make.
          </li>
        </LegalList>
        <p>
          Content and design on this site belong to the school unless stated
          otherwise. Misuse may lead to withdrawal of portal access and, where
          warranted, referral to the authorities.
        </p>
      </LegalSection>

      <LegalSection n={5} title="The online fee module">
        <LegalList>
          <li>
            <strong>What you can pay.</strong> The module accepts school fees,
            registration and admission charges, examination and amenity charges,
            and school transport charges, as raised against your child in the
            portal. Charges are those published on our{" "}
            <Link href="/fee-structure" className="text-blue-700 underline">
              fees &amp; services
            </Link>{" "}
            page and notified to parents for the academic session. All amounts
            are in Indian Rupees and include any applicable taxes.
          </li>
          <li>
            <strong>Check before you pay.</strong> The dues shown are for the
            student named on the screen. You are responsible for confirming the
            student, the fee heads and the amount before authorising a payment.
          </li>
          <li>
            <strong>We never handle your credentials.</strong> Payments are
            processed by a third-party payment gateway on its own secure page.
            The school does not receive or store your card, UPI or net-banking
            details. Those are handled by the gateway and your bank under their
            own terms.
          </li>
          <li>
            <strong>When a payment counts.</strong> A payment is complete only
            when the gateway confirms success to us and the portal issues a
            receipt against the student&rsquo;s account. A debit from your bank
            without such confirmation is a failed payment, not a paid fee, and
            is handled under our{" "}
            <Link href="/refund-policy" className="text-blue-700 underline">
              cancellation &amp; refund policy
            </Link>
            .
          </li>
          <li>
            <strong>Keep your receipt.</strong> The receipt issued in the
            portal, and the gateway&rsquo;s transaction reference, are the
            record of payment. Quote them in any query.
          </li>
          <li>
            <strong>Availability.</strong> The module may be unavailable during
            maintenance, or because of a gateway or bank outage. Where that
            prevents payment by a due date, pay at the school office; we will
            not charge a late fee for a delay caused by our own outage.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={6} title="Due dates, late payment and dues">
        <p>
          Fees are payable by the due date notified for each instalment. Late
          payment may attract the late fee notified in the school calendar.
          Where dues remain outstanding, the school may withhold optional
          services such as transport, and may withhold documents to the extent
          permitted by law, after giving notice to the parent.
        </p>
      </LegalSection>

      <LegalSection n={7} title="What the school provides">
        <p>
          The school provides education and related services on its campus for
          the academic session, in accordance with the school calendar and the
          requirements of the board and authorities to which the school is
          answerable. The website, portal and app are tools for viewing school
          records and paying fees. They are provided on an &ldquo;as is&rdquo;
          basis, and access to them is not itself the service you are paying
          for.
        </p>
      </LegalSection>

      <LegalSection n={8} title="Cancellation and refunds">
        <p>
          Whether a payment can be cancelled or refunded is governed entirely by
          our{" "}
          <Link href="/refund-policy" className="text-blue-700 underline">
            cancellation &amp; refund policy
          </Link>
          , which forms part of these terms. Please read it before paying.
        </p>
      </LegalSection>

      <LegalSection n={9} title="Personal data">
        <p>
          How we handle parent details, student profiles and transaction records
          is set out in our{" "}
          <Link href="/privacy" className="text-blue-700 underline">
            privacy policy
          </Link>
          , which also forms part of these terms.
        </p>
      </LegalSection>

      <LegalSection n={10} title="Liability">
        <p>
          To the extent permitted by law, our liability arising from your use of
          this website, the portal or the payment module is limited to the
          amount of the transaction concerned. We are not liable for failures of
          your bank, your network or the payment gateway, though we will help
          you pursue them. Nothing in these terms limits liability that cannot
          be limited under Indian law, including liability for the
          school&rsquo;s own fraud.
        </p>
      </LegalSection>

      <LegalSection n={11} title="Changes to these terms">
        <p>
          We may update these terms. The revised version takes effect when
          published on this page, and material changes are announced in the
          portal&rsquo;s Notices section. Continuing to use the portal after
          that means you accept the change.
        </p>
      </LegalSection>

      <LegalSection n={12} title="Grievances and governing law">
        <p>
          Raise any complaint about the site, the portal or a payment by writing
          to{" "}
          <a
            className="text-blue-700 underline"
            href={`mailto:${CONTACT.email}`}
          >
            {CONTACT.email}
          </a>{" "}
          or at the school office. We acknowledge within 3 working days and aim
          to resolve within 10 working days. These terms are governed by the
          laws of India, and disputes are subject to the exclusive jurisdiction
          of the courts at Varanasi, Uttar Pradesh.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
