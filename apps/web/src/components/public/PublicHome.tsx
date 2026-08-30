import Link from "next/link";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  ADDRESS_ONE_LINE,
  CLASS_RANGE,
  CONTACT,
  PUBLIC_SERVICES,
  TRADING_NAME,
  displayLegalName,
} from "@/lib/publicOrgProfile";

/** Public landing page shown to anyone who is not signed in. */
export function PublicHome() {
  return (
    <PublicChrome>
      <section className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          NCERT / CBSE curriculum framework · Varanasi, Uttar Pradesh
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight text-slate-900">
          {TRADING_NAME}
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
          A co-educational English-medium school, {CLASS_RANGE}, recognised by
          the State Government of Uttar Pradesh. Parents pay session fees,
          transport and examination charges online and download receipts from
          the parent portal.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-500">
          Operated by {displayLegalName()}, {ADDRESS_ONE_LINE}.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/fee-structure"
            className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            View fees &amp; services
          </Link>
          <Link
            href="/apply"
            className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Admission enquiry
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Parent / staff login
          </Link>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <h2 className="text-2xl font-bold text-slate-900">
            What you can pay for
          </h2>
          <p className="mt-2 text-slate-600">
            All charges are listed with their published amounts. Full details
            are on the{" "}
            <Link href="/fee-structure" className="text-blue-700 underline">
              fees &amp; services
            </Link>{" "}
            page.
          </p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PUBLIC_SERVICES.map((service) => (
              <li
                key={service.code}
                className="rounded-lg border border-slate-200 bg-white p-5"
              >
                <h3 className="font-semibold text-slate-900">{service.name}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {service.summary}
                </p>
                <p className="mt-3 text-lg font-semibold text-slate-900">
                  {service.price}
                </p>
                <p className="text-xs text-slate-500">{service.cadence}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <h2 className="text-2xl font-bold text-slate-900">Reach the school</h2>
        <p className="mt-3 leading-7 text-slate-600">
          {ADDRESS_ONE_LINE}
          <br />
          Email:{" "}
          <a
            className="text-blue-700 underline"
            href={`mailto:${CONTACT.email}`}
          >
            {CONTACT.email}
          </a>
          <br />
          {CONTACT.hours}
        </p>
      </section>
    </PublicChrome>
  );
}
