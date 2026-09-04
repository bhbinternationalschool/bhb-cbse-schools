import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalCallout,
  LegalList,
  LegalPage,
  LegalSection,
} from "@/components/public/LegalPage";
import { CONTACT, TRADING_NAME } from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "How BHB International School collects, stores and protects parent details, student profiles and online transaction data — and who it is shared with.",
};

/**
 * Public privacy policy — linked from the site footer, the Play Store / App
 * Store listings, the sign-in screen, and submitted to the payment gateway
 * during merchant onboarding. Static content, no auth, no client JS.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="30 August 2026"
      current="/privacy"
      summary={
        <p>
          We collect parent contact details, student profiles and online
          transaction records only to run the school and to process the fees you
          pay us. This data is held on encrypted, access-controlled systems. We
          do not sell it, rent it, or share it for advertising. It is disclosed
          to nobody outside the school except the regulated service providers
          that operate the service for us — chiefly our payment processor, who
          needs it to complete your transaction — and where Indian law compels
          us.
        </p>
      }
    >
      <LegalSection n={1} title="Who this policy is from">
        <p>
          This policy covers the {TRADING_NAME} website at
          bhbinternational.school, the parent and staff portal on it, and the
          school&rsquo;s mobile app. The entity responsible for your data is
          named in the block at the foot of this page. It applies to parents,
          guardians, students and staff.
        </p>
      </LegalSection>

      <LegalSection n={2} title="What we collect">
        <LegalList>
          <li>
            <strong>Parent and guardian details.</strong> Name, relationship to
            the student, mobile number, email address and postal address, so we
            can identify you as the person entitled to a child&rsquo;s records
            and reach you about the child.
          </li>
          <li>
            <strong>Student profiles.</strong> Name, date of birth, class,
            section, roll and admission number, attendance, marks, homework, fee
            dues and receipts, transport stop, and the notices and
            parent-teacher meetings that concern the child. These are school
            records we already keep in order to provide education.
          </li>
          <li>
            <strong>Online transaction details.</strong> For each fee payment:
            the amount, the fee heads it settles, the date, the payment method
            you chose, the gateway&rsquo;s transaction reference, and whether
            the payment succeeded or failed. We use these to issue your receipt
            and to reconcile the money against your child&rsquo;s account.
          </li>
          <li>
            <strong>Staff location — staff app only, optional.</strong> When a
            staff member chooses to mark attendance from the app, their location
            is read once, at that moment, to confirm they are on campus.
            Location is never read in the background and never tracked
            continuously.
          </li>
          <li>
            <strong>Device and session data.</strong> A signed sign-in token is
            stored on your device so you stay logged in. It contains no
            password. We use no advertising identifiers, no third-party
            analytics and no ad networks.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={3} title="Card and bank details are never seen by us">
        <p>
          Fee payments are completed on the payment gateway&rsquo;s own secure,
          PCI-DSS compliant page. Your card number, CVV, UPI PIN, net-banking
          user ID and net-banking password are entered there, not here. They are
          never transmitted to the school, never stored on our systems, and are
          not available to any member of school staff.
        </p>
        <p>
          What comes back to us is the outcome of the transaction and its
          reference number — enough to issue a receipt and to trace the payment
          if something goes wrong, and nothing more.
        </p>
      </LegalSection>

      <LegalSection n={4} title="Who your data is shared with">
        <LegalCallout>
          We do not sell, rent, trade or licence parent data, student profiles
          or transaction records to anyone. We do not share them with
          advertisers, data brokers, coaching centres, publishers or any other
          commercial third party.
        </LegalCallout>
        <p>
          Data leaves the school&rsquo;s own systems only in these narrow cases,
          each limited to what the recipient needs to do its job:
        </p>
        <LegalList>
          <li>
            <strong>Our payment processor,</strong> to take your fee payment,
            settle it to the school&rsquo;s bank account, and process any refund
            or chargeback. This is the only third party that handles your
            payment instrument, and it does so under its own published privacy
            terms and RBI regulation.
          </li>
          <li>
            <strong>Our hosting providers</strong> (Google Cloud and Supabase),
            which store the school&rsquo;s database under contract. They process
            data on our instructions and have no right to use it for their own
            purposes.
          </li>
          <li>
            <strong>Our messaging provider</strong> (Meta&rsquo;s WhatsApp
            Business API), to deliver one-time passwords, absence alerts and fee
            reminders to the mobile number you registered with the school.
          </li>
          <li>
            <strong>Government and regulatory bodies,</strong> where we are
            required by Indian law to report or produce records — for example
            statutory returns for the education department, or a lawful order
            from a court or authority.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={5} title="How it is kept secure">
        <LegalList>
          <li>
            All traffic between your device and the portal is encrypted in
            transit over HTTPS, and data is encrypted at rest on the hosting
            provider&rsquo;s infrastructure.
          </li>
          <li>
            Access is role-based. A parent account can reach only that
            family&rsquo;s own children. Staff see only the records their role
            requires, and administrative actions are recorded in an audit trail.
          </li>
          <li>
            Sign-in is by one-time password to your registered mobile number, so
            an account cannot be opened by someone who does not control that
            number.
          </li>
          <li>
            If a breach affecting your data occurs, we will inform affected
            families and the relevant authority without undue delay.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={6} title="How long we keep it">
        <p>
          Student academic and financial records are retained for as long as the
          school&rsquo;s statutory record-keeping obligations require, because a
          former student may need a transfer certificate, a mark sheet or a fee
          certificate years after leaving. Portal access for a family ends when
          the student leaves. Transaction records are retained for the period
          required by tax and audit law.
        </p>
      </LegalSection>

      <LegalSection n={7} title="Children&rsquo;s data">
        <p>
          The portal and app are used by parents, guardians and staff, not by
          children directly. Student records shown in them are school records
          held under the school&rsquo;s custodianship and processed for
          legitimate educational purposes only.
        </p>
      </LegalSection>

      <LegalSection n={8} title="Your choices and rights">
        <LegalList>
          <li>
            You can sign out at any time, which removes the sign-in token from
            your device.
          </li>
          <li>
            You may ask what data the school holds about your family, ask for a
            correction, or update your registered mobile number, by writing to
            the school office.
          </li>
          <li>
            Fee reminders and absence alerts are part of the school service
            rather than marketing, so they continue while your child is
            enrolled. We send no promotional messages.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection n={9} title="Changes to this policy">
        <p>
          If our practices change we will update this page and move the date at
          the top. Material changes are also announced in the portal&rsquo;s
          Notices section. Questions about this policy go to{" "}
          <a
            className="text-blue-700 underline"
            href={`mailto:${CONTACT.email}`}
          >
            {CONTACT.email}
          </a>
          , or see our{" "}
          <Link href="/contact" className="text-blue-700 underline">
            contact page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
