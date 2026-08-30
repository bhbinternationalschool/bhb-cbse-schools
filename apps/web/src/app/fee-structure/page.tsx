import type { Metadata } from "next";
import Link from "next/link";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  CLASS_RANGE,
  CONTACT,
  PUBLIC_SERVICES,
  RECOGNITION_STATEMENT,
  displayLegalName,
} from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Fees & services",
  description:
    "Published fees and charges for every programme and service offered by BHB International School for the 2026-27 academic session.",
};

/**
 * The product/service catalogue. Payment-gateway onboarding requires a
 * publicly reachable list of what the customer is paying for, with amounts.
 * Amounts come from `publicOrgProfile`, which mirrors the self-tested
 * 2026-27 fee structures used by the ERP.
 */
export default function FeesPage() {
  return (
    <PublicChrome>
      <div className="mx-auto max-w-4xl px-6 py-14 text-[15px] leading-7">
        <h1 className="text-3xl font-bold text-slate-900">
          Fees &amp; services
        </h1>
        <p className="mt-3 text-slate-600">
          Published charges for the 2026-27 academic session (April 2026 to
          March 2027), for {CLASS_RANGE}. All amounts are in Indian Rupees and
          include all applicable taxes; education services provided by a school
          are exempt from GST.
        </p>
        <p className="mt-3 text-sm text-slate-500">{RECOGNITION_STATEMENT}</p>

        <div className="mt-10 space-y-6">
          {PUBLIC_SERVICES.map((service) => (
            <article
              key={service.code}
              className="rounded-lg border border-slate-200 p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <h2 className="text-lg font-semibold text-slate-900">
                  {service.name}
                </h2>
                <div className="text-right">
                  <p className="text-xl font-semibold text-slate-900">
                    {service.price}
                  </p>
                  <p className="text-xs text-slate-500">{service.cadence}</p>
                </div>
              </div>
              <p className="mt-3 text-slate-700">{service.summary}</p>
              <p className="mt-2 text-sm text-slate-600">{service.detail}</p>
            </article>
          ))}
        </div>

        <h2 className="mt-12 text-lg font-semibold text-slate-900">
          How to pay
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            Enrolled families sign in to the{" "}
            <Link href="/login" className="text-blue-700 underline">
              parent portal
            </Link>{" "}
            with their registered mobile number, open the Fees section, and pay
            the outstanding instalment by UPI, net banking, debit card or credit
            card.
          </li>
          <li>
            A receipt is generated immediately on successful payment and stays
            available for download in the portal.
          </li>
          <li>
            Applicants who are not yet enrolled pay the admission registration
            charge through the link issued with their{" "}
            <Link href="/apply" className="text-blue-700 underline">
              admission enquiry
            </Link>
            .
          </li>
          <li>
            Fees may also be paid in cash or by cheque at the school accounts
            office during office hours.
          </li>
        </ul>

        <h2 className="mt-10 text-lg font-semibold text-slate-900">
          Service delivery
        </h2>
        <p className="mt-3">
          These are education services delivered at the school campus over the
          academic session. Nothing is shipped. Payment is credited to the
          student&rsquo;s fee ledger immediately on confirmation from the
          payment gateway, and the corresponding service — tuition, transport or
          examination — is delivered on the school calendar for the session.
        </p>

        <h2 className="mt-10 text-lg font-semibold text-slate-900">
          Questions about a charge
        </h2>
        <p className="mt-3">
          Write to{" "}
          <a
            className="text-blue-700 underline"
            href={`mailto:${CONTACT.email}`}
          >
            {CONTACT.email}
          </a>{" "}
          or visit the accounts office. Refunds and cancellations are governed
          by our{" "}
          <Link href="/refund-policy" className="text-blue-700 underline">
            refund and cancellation policy
          </Link>
          .
        </p>

        <p className="mt-10 text-sm text-slate-500">
          Fees shown are those notified by {displayLegalName()} for the 2026-27
          session and are subject to revision for subsequent sessions, with
          notice to parents.
        </p>
      </div>
    </PublicChrome>
  );
}
