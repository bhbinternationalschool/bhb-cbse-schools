import type { Metadata } from "next";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  ADDRESS_ONE_LINE,
  CONTACT,
  POSTAL_ADDRESS,
  RECOGNITION_STATEMENT,
  TRADING_NAME,
  displayLegalName,
} from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Address, email and office hours for BHB International School, Varanasi.",
};

const MAILTO = `mailto:${CONTACT.email}`;
const TEL = CONTACT.phone ? `tel:${CONTACT.phone.replace(/\s/g, "")}` : null;
// personal-whatsapp-allow: CONTACT.phone is the school's OWN WhatsApp Business
// number (publicOrgProfile), so this public link lets a visitor start a chat TO
// the office — an inbound contact link, not a staff member messaging a family
// from a personal number, which is what this ratchet guards against.
const WHATSAPP = CONTACT.phone
  ? `https://wa.me/${CONTACT.phone.replace(/[^0-9]/g, "")}`
  : null;

// Shared button/link styles — one primary style, one secondary style.
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--brand-deep)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-mid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-2 motion-reduce:transition-none";
const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-[var(--brand-deep)] transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-2 motion-reduce:transition-none";
const LINK =
  "font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-2 rounded-sm";

type IconProps = { className?: string };

function IconMail({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function IconChat({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 20l1.4-4.2A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
    </svg>
  );
}

function IconClock({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function IconPin({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function MethodCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[var(--brand-deep)]">
          {icon}
        </span>
        <h2 className="text-sm font-medium text-slate-500">{label}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function ContactPage() {
  return (
    <PublicChrome>
      {/* Hero — one idea: reach the office, with the two real ways to do it. */}
      <section className="mx-auto max-w-5xl px-6 pb-10 pt-14 sm:pt-20">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-[var(--brand-deep)] sm:text-5xl">
          Contact the school office
        </h1>
        <div
          className="mt-5 h-1 w-16 rounded-full bg-[var(--brand-gold)]"
          aria-hidden
        />
        <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
          Admissions, fees, payments, or anything about your child&rsquo;s time
          at {TRADING_NAME} — reach us directly, and we reply within three
          working days.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={MAILTO} className={BTN_PRIMARY}>
            <IconMail className="h-4 w-4" />
            Email the office
          </a>
          {WHATSAPP ? (
            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className={BTN_SECONDARY}
            >
              <IconChat className="h-4 w-4" />
              Message on WhatsApp
            </a>
          ) : null}
        </div>
      </section>

      {/* The four ways to reach or find us. */}
      <section className="mx-auto max-w-5xl px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <MethodCard icon={<IconMail className="h-5 w-5" />} label="Email">
            <a href={MAILTO} className={`${LINK} break-words`}>
              {CONTACT.email}
            </a>
            <p className="mt-1 text-sm text-slate-500">
              The quickest written channel for anything on record.
            </p>
          </MethodCard>

          {CONTACT.phone ? (
            <MethodCard
              icon={<IconChat className="h-5 w-5" />}
              label="Phone & WhatsApp"
            >
              {TEL ? (
                <a href={TEL} className={LINK}>
                  {CONTACT.phone}
                </a>
              ) : (
                <span className="font-medium text-[var(--brand-deep)]">
                  {CONTACT.phone}
                </span>
              )}
              <p className="mt-1 text-sm text-slate-500">
                Also on WhatsApp — the line the office answers fastest.
              </p>
            </MethodCard>
          ) : null}

          <MethodCard
            icon={<IconClock className="h-5 w-5" />}
            label="Office hours"
          >
            <p className="font-medium text-slate-800">{CONTACT.hours}</p>
          </MethodCard>

          <MethodCard
            icon={<IconPin className="h-5 w-5" />}
            label="Visit the campus"
          >
            <address className="not-italic leading-7 text-slate-800">
              {displayLegalName()}
              <br />
              {POSTAL_ADDRESS.line1}, {POSTAL_ADDRESS.line2}
              <br />
              {POSTAL_ADDRESS.state} {POSTAL_ADDRESS.pin}
            </address>
            <p className="mt-2 text-sm text-slate-500">
              Visitors check in at the gate; please call ahead for an
              appointment.
            </p>
          </MethodCard>
        </div>
      </section>

      {/* Billing is the reason most people write — give it its own weight. */}
      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-[var(--brand-gold)] bg-slate-50 p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
            Payment and billing queries
          </h2>
          <p className="mt-3 max-w-3xl leading-7 text-slate-600">
            For a question about a fee charged, a payment that did not reflect,
            or a refund request, email{" "}
            <a href={MAILTO} className={LINK}>
              {CONTACT.email}
            </a>{" "}
            with the student&rsquo;s name, class and admission number, and the
            transaction reference. We respond within three working days.
          </p>
        </div>
      </section>

      {/* Recognition — stated on the page a reviewer may land on, quietly. */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <p className="max-w-3xl text-sm leading-6 text-slate-500">
          {RECOGNITION_STATEMENT} The campus is at {ADDRESS_ONE_LINE}.
        </p>
      </section>
    </PublicChrome>
  );
}
