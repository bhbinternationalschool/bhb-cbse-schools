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

/**
 * The page a payment gateway is sent to when it asks "where is your legal
 * name published?". Keep the legal name, the address and the contact route
 * on this page — do not move them behind a tab or an accordion.
 */
export default function AboutPage() {
  return (
    <PublicChrome>
      <div className="mx-auto max-w-3xl px-6 py-14 text-[15px] leading-7">
        <h1 className="text-3xl font-bold text-slate-900">
          About us — legal and business information
        </h1>

        <h2 className="mt-10 text-lg font-semibold text-slate-900">
          Legal name of the business
        </h2>
        <p className="mt-3">
          This website and the online fee payment facility on it are owned and
          operated by{" "}
          <strong className="text-slate-900">{displayLegalName()}</strong>
          {ENTITY_TYPE ? <>, a {ENTITY_TYPE},</> : null}
          {PARENT_BODY_LEGAL_NAME ? (
            <>
              {ENTITY_TYPE ? " which" : ", which"} runs the school under the
              name{" "}
              <strong className="text-slate-900">{LEGAL_ENTITY_NAME}</strong>
            </>
          ) : null}
          .
          {TRADING_NAME !== LEGAL_ENTITY_NAME &&
          TRADING_NAME !== displayLegalName() ? (
            <>
              {" "}
              The school operates publicly under the name{" "}
              <strong className="text-slate-900">{TRADING_NAME}</strong>.
            </>
          ) : null}
        </p>
        <p className="mt-3">
          Fees paid through this website are collected by{" "}
          {displayLegalName()}
          {SETTLEMENT_ACCOUNT_NAME !== displayLegalName() ? (
            <>
              {" "}
              into the school&rsquo;s own bank account, held in the name{" "}
              <strong className="text-slate-900">
                {SETTLEMENT_ACCOUNT_NAME}
              </strong>
              . That is the name you will see against the transaction on your
              card or bank statement.
            </>
          ) : (
            <>
              , and that is the name you will see against the transaction on
              your card or bank statement.
            </>
          )}
        </p>

        {REGISTRATION_DETAILS.length > 0 ? (
          <>
            <h2 className="mt-8 text-lg font-semibold text-slate-900">
              Registration particulars
            </h2>
            <dl className="mt-3 space-y-2">
              {REGISTRATION_DETAILS.map((row) => (
                <div key={row.label} className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-slate-900">{row.label}:</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Registered address
        </h2>
        <address className="mt-3 not-italic">
          {displayLegalName()}
          <br />
          {LEGAL_ADDRESS.line1}
          <br />
          {LEGAL_ADDRESS.line2}
          <br />
          {LEGAL_ADDRESS.state}
          {LEGAL_ADDRESS.pin ? ` ${LEGAL_ADDRESS.pin}` : null}
          <br />
          {LEGAL_ADDRESS.country}
        </address>

        {REGISTERED_OFFICE_ADDRESS ? (
          <>
            <h2 className="mt-8 text-lg font-semibold text-slate-900">
              School campus
            </h2>
            <address className="mt-3 not-italic">
              {TRADING_NAME}
              <br />
              {POSTAL_ADDRESS.line1}
              <br />
              {POSTAL_ADDRESS.line2}
              <br />
              {POSTAL_ADDRESS.state} {POSTAL_ADDRESS.pin}
              <br />
              {POSTAL_ADDRESS.country}
            </address>
          </>
        ) : null}

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Nature of business
        </h2>
        <p className="mt-3">
          {TRADING_NAME} is a co-educational English-medium school following
          the CBSE curriculum, offering classes from Nursery to Class X at{" "}
          {ADDRESS_ONE_LINE}. Payments accepted through this website are
          academic fees and related school charges billed to enrolled students
          and to applicants for admission — session fees, transport, and
          examination and amenity charges. The school does not sell physical
          goods online.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Contact for customers
        </h2>
        <p className="mt-3">
          Email:{" "}
          <a className="text-blue-700 underline" href={`mailto:${CONTACT.email}`}>
            {CONTACT.email}
          </a>
          {CONTACT.phone ? (
            <>
              <br />
              Phone:{" "}
              <a className="text-blue-700 underline" href={`tel:${CONTACT.phone}`}>
                {CONTACT.phone}
              </a>
            </>
          ) : null}
          <br />
          {CONTACT.hours}
        </p>
      </div>
    </PublicChrome>
  );
}
