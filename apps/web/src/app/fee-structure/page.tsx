import type { Metadata } from "next";
import Link from "next/link";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  CONTACT,
  PUBLIC_SERVICES,
  RECOGNITION_STATEMENT,
  displayLegalName,
  type PublicService,
} from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Fees & services",
  description:
    "Published fees and charges for every programme and service offered by BHB International School for the 2026-27 academic session.",
};

const MAILTO = `mailto:${CONTACT.email}`;

const LINK =
  "font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-2 rounded-sm";

// The four session programmes vs. the optional/line-item charges. Splitting
// them lets the page lead with "what it costs to enrol" and keep the add-ons
// in their own, lighter group.
const PROGRAMME_CODES = ["FOUNDATION", "PRIMARY", "MIDDLE", "SECONDARY"];
const programmes = PUBLIC_SERVICES.filter((s) =>
  PROGRAMME_CODES.includes(s.code),
);
const otherCharges = PUBLIC_SERVICES.filter(
  (s) => !PROGRAMME_CODES.includes(s.code),
);

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

function ServiceCard({
  service,
  priceClass,
}: {
  service: PublicService;
  priceClass: string;
}) {
  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="text-base font-semibold text-[var(--brand-deep)]">
        {service.name}
      </h3>
      <p className={`mt-3 font-bold text-[var(--brand-deep)] ${priceClass}`}>
        {service.price}
      </p>
      <p className="mt-1 text-xs text-slate-500">{service.cadence}</p>
      <p className="mt-4 text-sm font-medium text-slate-700">
        {service.summary}
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{service.detail}</p>
    </article>
  );
}

function PayItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[var(--brand-deep)]"
        aria-hidden
      >
        <IconCheck className="h-3 w-3" />
      </span>
      <span className="text-slate-600">{children}</span>
    </li>
  );
}

export default function FeesPage() {
  return (
    <PublicChrome>
      {/* Hero — what this page is and the one tax fact people ask about. */}
      <section className="mx-auto max-w-5xl px-6 pb-10 pt-14 sm:pt-20">
        <h1 className="text-4xl font-bold tracking-tight text-[var(--brand-deep)] sm:text-5xl">
          Fees &amp; services
        </h1>
        <div
          className="mt-5 h-1 w-16 rounded-full bg-[var(--brand-gold)]"
          aria-hidden
        />
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Published charges for the 2026-27 academic session (April 2026 to
          March 2027). All amounts are in Indian Rupees and include every
          applicable tax — education services provided by a school are exempt
          from GST.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-500">
          {RECOGNITION_STATEMENT}
        </p>
      </section>

      {/* Session programmes — the headline prices. */}
      <section className="mx-auto max-w-5xl px-6">
        <h2 className="text-sm font-medium text-slate-500">
          Session fees by programme
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {programmes.map((service) => (
            <ServiceCard
              key={service.code}
              service={service}
              priceClass="text-3xl"
            />
          ))}
        </div>
      </section>

      {/* Optional and line-item charges. */}
      <section className="mx-auto max-w-5xl px-6 pt-10">
        <h2 className="text-sm font-medium text-slate-500">Other charges</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {otherCharges.map((service) => (
            <ServiceCard
              key={service.code}
              service={service}
              priceClass="text-2xl"
            />
          ))}
        </div>
      </section>

      {/* How to pay. */}
      <section className="mx-auto max-w-5xl px-6 pt-12">
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-[var(--brand-gold)] bg-slate-50 p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
            How to pay
          </h2>
          <ul className="mt-4 space-y-3 text-[15px] leading-7">
            <PayItem>
              Enrolled families sign in to the{" "}
              <Link href="/login" className={LINK}>
                parent portal
              </Link>{" "}
              with their registered mobile number, open the Fees section, and
              pay the outstanding instalment by UPI, net banking, debit card or
              credit card.
            </PayItem>
            <PayItem>
              A receipt is generated immediately on successful payment and stays
              available for download in the portal.
            </PayItem>
            <PayItem>
              Applicants not yet enrolled pay the admission registration charge
              through the link issued with their{" "}
              <Link href="/apply" className={LINK}>
                admission enquiry
              </Link>
              .
            </PayItem>
            <PayItem>
              Fees may also be paid in cash or by cheque at the school accounts
              office during office hours.
            </PayItem>
          </ul>
        </div>
      </section>

      {/* The two notes a payment reviewer looks for, side by side. */}
      <section className="mx-auto max-w-5xl px-6 pt-10">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-[var(--brand-deep)]">
              Service delivery
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              These are education services delivered at the school campus over
              the academic session. Nothing is shipped. Payment is credited to
              the student&rsquo;s fee ledger immediately on confirmation from the
              payment gateway, and the corresponding service — tuition, transport
              or examination — is delivered on the school calendar for the
              session.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-[var(--brand-deep)]">
              Questions about a charge
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Write to{" "}
              <a href={MAILTO} className={LINK}>
                {CONTACT.email}
              </a>{" "}
              or visit the accounts office. Refunds and cancellations are
              governed by our{" "}
              <Link href="/refund-policy" className={LINK}>
                refund and cancellation policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Closing notice. */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-10">
        <p className="max-w-3xl text-sm leading-6 text-slate-500">
          Fees shown are those notified by {displayLegalName()} for the 2026-27
          session and are subject to revision for subsequent sessions, with
          notice to parents.
        </p>
      </section>
    </PublicChrome>
  );
}
