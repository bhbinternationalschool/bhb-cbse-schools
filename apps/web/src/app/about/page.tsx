import type { Metadata } from "next";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  ADDRESS_ONE_LINE,
  CONTACT,
  ENTITY_TYPE,
  LEGAL_ADDRESS,
  LEGAL_ENTITY_NAME,
  PARENT_BODY_LEGAL_NAME,
  POSTAL_ADDRESS,
  REGISTERED_OFFICE_ADDRESS,
  PARENT_BODY_DEED_SPELLING,
  REGISTRATION_DETAILS,
  SETTLEMENT_ACCOUNT_NAME,
  TRADING_NAME,
  displayLegalName,
} from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "About us — legal and business information",
  description:
    "Registered legal name, address and contact details of the entity that operates BHB International School.",
};

const MAILTO = `mailto:${CONTACT.email}`;
const TEL = CONTACT.phone ? `tel:${CONTACT.phone.replace(/\s/g, "")}` : null;

const LINK =
  "font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-2 rounded-sm";

const STRONG = "font-semibold text-[var(--brand-deep)]";

type IconProps = { className?: string };

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

function IconPhone({ className }: IconProps) {
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
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" />
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

function AddressCard({
  title,
  name,
  children,
}: {
  title: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[var(--brand-deep)]">
          <IconPin className="h-5 w-5" />
        </span>
        <h2 className="text-sm font-medium text-slate-500">{title}</h2>
      </div>
      <address className="mt-4 not-italic leading-7 text-slate-700">
        <span className="font-medium text-[var(--brand-deep)]">{name}</span>
        <br />
        {children}
      </address>
    </div>
  );
}

export default function AboutPage() {
  return (
    <PublicChrome>
      {/* Hero — name the page's job for the reviewer who lands here. */}
      <section className="mx-auto max-w-5xl px-6 pb-10 pt-14 sm:pt-20">
        <h1 className="text-4xl font-bold tracking-tight text-[var(--brand-deep)] sm:text-5xl">
          About us
        </h1>
        <div
          className="mt-5 h-1 w-16 rounded-full bg-[var(--brand-gold)]"
          aria-hidden
        />
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Legal and business information for the entity that owns and operates{" "}
          {TRADING_NAME} and the online fee payment facility on this website.
        </p>
      </section>

      {/* Legal name — the disclosure a payment gateway is sent here to find. */}
      <section className="mx-auto max-w-5xl px-6">
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-[var(--brand-gold)] bg-slate-50 p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
            Legal name of the business
          </h2>
          <div className="mt-3 max-w-3xl space-y-3 leading-7 text-slate-600">
            <p>
              This website and the online fee payment facility on it are owned
              and operated by <strong className={STRONG}>{displayLegalName()}</strong>
              {ENTITY_TYPE ? <>, a {ENTITY_TYPE},</> : null}
              {PARENT_BODY_LEGAL_NAME ? (
                <>
                  {ENTITY_TYPE ? " which" : ", which"} runs the school under the
                  name <strong className={STRONG}>{LEGAL_ENTITY_NAME}</strong>
                </>
              ) : null}
              .
              {TRADING_NAME !== LEGAL_ENTITY_NAME &&
              TRADING_NAME !== displayLegalName() ? (
                <>
                  {" "}
                  The school operates publicly under the name{" "}
                  <strong className={STRONG}>{TRADING_NAME}</strong>.
                </>
              ) : null}
            </p>
            {PARENT_BODY_DEED_SPELLING &&
            PARENT_BODY_DEED_SPELLING !== displayLegalName() ? (
              <p>
                The trust&rsquo;s deed of declaration spells the name{" "}
                <strong className={STRONG}>{PARENT_BODY_DEED_SPELLING}</strong>,
                and the trust&rsquo;s PAN spells it{" "}
                <strong className={STRONG}>{displayLegalName()}</strong>. They
                are the same trust. This site uses the spelling on the PAN,
                because that is the record banks and payment processors verify
                against; the deed&rsquo;s spelling is the one you will see where
                an entity is identified from its registration papers instead.
              </p>
            ) : null}
            <p>
              Fees paid through this website are collected by {displayLegalName()}
              {SETTLEMENT_ACCOUNT_NAME !== displayLegalName() ? (
                <>
                  {" "}
                  into the school&rsquo;s own bank account, held in the name{" "}
                  <strong className={STRONG}>{SETTLEMENT_ACCOUNT_NAME}</strong>.
                  That is the name you will see against the transaction on your
                  card or bank statement.
                </>
              ) : (
                <>
                  , and that is the name you will see against the transaction on
                  your card or bank statement.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Registration particulars as a clean label/value table. */}
      {REGISTRATION_DETAILS.length > 0 ? (
        <section className="mx-auto max-w-5xl px-6 pt-10">
          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
              Registration particulars
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-[13rem_1fr]">
              {REGISTRATION_DETAILS.map((row) => (
                <div key={row.label} className="sm:contents">
                  <dt className="font-medium text-[var(--brand-deep)]">
                    {row.label}
                  </dt>
                  <dd className="text-slate-600">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}

      {/* The addresses, side by side. */}
      <section className="mx-auto max-w-5xl px-6 pt-10">
        <div className="grid gap-4 md:grid-cols-2">
          <AddressCard title="Registered address" name={displayLegalName()}>
            {LEGAL_ADDRESS.line1}
            <br />
            {LEGAL_ADDRESS.line2}
            <br />
            {LEGAL_ADDRESS.state}
            {LEGAL_ADDRESS.pin ? ` ${LEGAL_ADDRESS.pin}` : null}
            <br />
            {LEGAL_ADDRESS.country}
          </AddressCard>

          {REGISTERED_OFFICE_ADDRESS ? (
            <AddressCard title="School campus" name={TRADING_NAME}>
              {POSTAL_ADDRESS.line1}
              <br />
              {POSTAL_ADDRESS.line2}
              <br />
              {POSTAL_ADDRESS.state} {POSTAL_ADDRESS.pin}
              <br />
              {POSTAL_ADDRESS.country}
            </AddressCard>
          ) : null}
        </div>
      </section>

      {/* Nature of business. */}
      <section className="mx-auto max-w-5xl px-6 pt-10">
        <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
          Nature of business
        </h2>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">
          {TRADING_NAME} is a co-educational English-medium school recognised by
          the State Government of Uttar Pradesh, operating at {ADDRESS_ONE_LINE}{" "}
          and following the standard NCERT/CBSE curriculum framework. Payments
          accepted through this website are academic fees and related school
          charges billed to enrolled students and to applicants for admission —
          session fees, transport, and examination and amenity charges. The
          school does not sell physical goods online.
        </p>
      </section>

      {/* Customer contact. */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-10">
        <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
            Contact for customers
          </h2>
          <dl className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[var(--brand-deep)]">
                <IconMail className="h-5 w-5" />
              </span>
              <div>
                <dt className="text-xs font-medium text-slate-500">Email</dt>
                <dd>
                  <a href={MAILTO} className={`${LINK} break-words`}>
                    {CONTACT.email}
                  </a>
                </dd>
              </div>
            </div>
            {CONTACT.phone ? (
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[var(--brand-deep)]">
                  <IconPhone className="h-5 w-5" />
                </span>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Phone</dt>
                  <dd>
                    {TEL ? (
                      <a href={TEL} className={LINK}>
                        {CONTACT.phone}
                      </a>
                    ) : (
                      <span className="font-medium text-[var(--brand-deep)]">
                        {CONTACT.phone}
                      </span>
                    )}
                  </dd>
                </div>
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[var(--brand-deep)]">
                <IconClock className="h-5 w-5" />
              </span>
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Office hours
                </dt>
                <dd className="text-slate-700">{CONTACT.hours}</dd>
              </div>
            </div>
          </dl>
        </div>
      </section>
    </PublicChrome>
  );
}
