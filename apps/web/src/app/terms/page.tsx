import type { Metadata } from "next";
import Link from "next/link";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  ADDRESS_ONE_LINE,
  CONTACT,
  displayLegalName,
} from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Terms & conditions",
  description:
    "Terms governing use of the BHB International School website and its online fee payment facility.",
};

export default function TermsPage() {
  return (
    <PublicChrome>
      <div className="mx-auto max-w-3xl px-6 py-14 text-[15px] leading-7">
        <h1 className="text-3xl font-bold text-slate-900">
          Terms &amp; conditions
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Last updated: 20 August 2026
        </p>

        <p className="mt-6">
          These terms govern your use of bhbinternational.school and the online
          fee payment facility on it, operated by {displayLegalName()},{" "}
          {ADDRESS_ONE_LINE} (&ldquo;the School&rdquo;, &ldquo;we&rdquo;). By
          using the site or making a payment through it, you accept these
          terms.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Who may use the portal
        </h2>
        <p className="mt-3">
          Portal accounts are issued by the School to the registered parent or
          guardian of an enrolled student, and to staff. You are responsible
          for keeping your sign-in access secure and for activity carried out
          under your account. Tell us immediately if you believe your account
          has been misused.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Fees and payments
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            Charges are those published on our{" "}
            <Link href="/fee-structure" className="text-blue-700 underline">
              fees &amp; services
            </Link>{" "}
            page and notified to parents for the academic session. All amounts
            are in Indian Rupees.
          </li>
          <li>
            Payments are processed by a third-party payment gateway. We do not
            store your card, UPI or bank credentials; those are handled by the
            gateway and your bank under their own terms.
          </li>
          <li>
            A payment is complete only when the gateway confirms success to us
            and a receipt is issued in the portal. A debit from your bank
            without such confirmation is treated as a failed payment and is
            handled under our{" "}
            <Link href="/refund-policy" className="text-blue-700 underline">
              refund and cancellation policy
            </Link>
            .
          </li>
          <li>
            You are responsible for paying by the due date for each
            instalment. Late payment may attract the late fee notified in the
            school calendar and, if dues remain outstanding, withdrawal of
            services such as transport.
          </li>
        </ul>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          What we provide
        </h2>
        <p className="mt-3">
          The School provides education and related services on its campus for
          the academic session, in accordance with CBSE requirements and the
          school calendar. The website and portal are tools for accessing
          school records and paying fees; they are provided on an
          &ldquo;as is&rdquo; basis and may be unavailable during maintenance
          or for reasons outside our control.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Acceptable use
        </h2>
        <p className="mt-3">
          Do not attempt to access records belonging to another family, probe
          or disrupt the service, scrape it, or reproduce its content for
          commercial purposes. Content on this site belongs to the School
          unless stated otherwise.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Personal data
        </h2>
        <p className="mt-3">
          How we handle student, parent and staff data is set out in our{" "}
          <Link href="/privacy" className="text-blue-700 underline">
            privacy policy
          </Link>
          .
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Liability
        </h2>
        <p className="mt-3">
          To the extent permitted by law, our liability arising from use of
          this website or the payment facility is limited to the amount of the
          transaction concerned. Nothing in these terms limits liability that
          cannot be limited under Indian law.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Changes
        </h2>
        <p className="mt-3">
          We may update these terms; the revised version takes effect when
          published on this page, and material changes are also announced in
          the portal&rsquo;s Notices section.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Governing law
        </h2>
        <p className="mt-3">
          These terms are governed by the laws of India. Disputes are subject
          to the exclusive jurisdiction of the courts at Varanasi, Uttar
          Pradesh.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">Contact</h2>
        <p className="mt-3">
          {displayLegalName()}, {ADDRESS_ONE_LINE}. Email:{" "}
          <a className="text-blue-700 underline" href={`mailto:${CONTACT.email}`}>
            {CONTACT.email}
          </a>
          .
        </p>
      </div>
    </PublicChrome>
  );
}
