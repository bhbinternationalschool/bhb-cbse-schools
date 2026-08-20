import type { Metadata } from "next";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  ADDRESS_ONE_LINE,
  CONTACT,
  POSTAL_ADDRESS,
  displayLegalName,
} from "@/lib/publicOrgProfile";

export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Address, email and office hours for BHB International School, Varanasi.",
};

export default function ContactPage() {
  return (
    <PublicChrome>
      <div className="mx-auto max-w-3xl px-6 py-14 text-[15px] leading-7">
        <h1 className="text-3xl font-bold text-slate-900">Contact us</h1>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          School office
        </h2>
        <address className="mt-3 not-italic">
          {displayLegalName()}
          <br />
          {POSTAL_ADDRESS.line1}
          <br />
          {POSTAL_ADDRESS.line2}
          <br />
          {POSTAL_ADDRESS.state} {POSTAL_ADDRESS.pin}
          <br />
          {POSTAL_ADDRESS.country}
        </address>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Email and phone
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
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Office hours
        </h2>
        <p className="mt-3">{CONTACT.hours}</p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Payment and billing queries
        </h2>
        <p className="mt-3">
          For a question about a fee charged, a payment that did not reflect,
          or a refund request, write to{" "}
          <a className="text-blue-700 underline" href={`mailto:${CONTACT.email}`}>
            {CONTACT.email}
          </a>{" "}
          with the student&rsquo;s name, class and admission number, and the
          transaction reference. We respond within three working days.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-slate-900">
          Visiting the campus
        </h2>
        <p className="mt-3">
          The school is at {ADDRESS_ONE_LINE}. Visitors check in at the gate on
          arrival. Please call or email ahead for an appointment with the
          principal or the accounts office.
        </p>
      </div>
    </PublicChrome>
  );
}
