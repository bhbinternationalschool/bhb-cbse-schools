import Link from "next/link";
import { PublicChrome } from "@/components/public/PublicChrome";
import {
  ADDRESS_ONE_LINE,
  CONTACT,
  ENTITY_TYPE,
  LEGAL_ADDRESS_ONE_LINE,
  displayLegalName,
} from "@/lib/publicOrgProfile";

/**
 * Shared shell for the three published policies — privacy, terms, refund.
 *
 * A payment gateway's risk review reads all three together, so they have to
 * look like one document set from one entity: same typography, same numbered
 * sections, the same registered name and address block at the foot of each,
 * and cross-links between them. Keeping the frame here is what stops the
 * three pages drifting apart the next time one of them is edited.
 */

const LEGAL_PAGES = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms & conditions" },
  { href: "/refund-policy", label: "Cancellation & refund policy" },
] as const;

export function LegalPage({
  title,
  updated,
  summary,
  current,
  children,
}: {
  title: string;
  /** Human-readable date, e.g. "30 August 2026". */
  updated: string;
  /** The one-paragraph answer, for a reviewer who reads nothing else. */
  summary: React.ReactNode;
  /** Path of this page, so it is not linked to itself. */
  current: string;
  children: React.ReactNode;
}) {
  return (
    <PublicChrome>
      <article className="mx-auto max-w-3xl px-6 py-14 text-[15px] leading-7 text-slate-700">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {displayLegalName()}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Last updated: {updated} · Applies to bhbinternational.school and the
            parent portal
          </p>
        </header>

        <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            In short
          </h2>
          <div className="mt-2 text-slate-800">{summary}</div>
        </div>

        <div className="mt-10 space-y-10">{children}</div>

        <section className="mt-12 border-t border-slate-200 pt-8">
          <h2 className="text-lg font-semibold text-slate-900">
            Who you are contracting with
          </h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[10rem_1fr]">
            <dt className="text-sm font-medium text-slate-500">Legal entity</dt>
            <dd className="text-slate-800">
              {displayLegalName()}
              {ENTITY_TYPE ? `, a ${ENTITY_TYPE}` : ""}
            </dd>

            <dt className="text-sm font-medium text-slate-500">
              Registered office
            </dt>
            <dd className="text-slate-800">{LEGAL_ADDRESS_ONE_LINE}</dd>

            <dt className="text-sm font-medium text-slate-500">Campus</dt>
            <dd className="text-slate-800">{ADDRESS_ONE_LINE}</dd>

            <dt className="text-sm font-medium text-slate-500">Email</dt>
            <dd>
              <a
                className="text-blue-700 underline"
                href={`mailto:${CONTACT.email}`}
              >
                {CONTACT.email}
              </a>
            </dd>

            <dt className="text-sm font-medium text-slate-500">Office hours</dt>
            <dd className="text-slate-800">{CONTACT.hours}</dd>
          </dl>

          <nav className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {LEGAL_PAGES.filter((p) => p.href !== current).map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="text-blue-700 underline"
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </section>
      </article>
    </PublicChrome>
  );
}

/** One numbered clause of a policy. */
export function LegalSection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-lg font-semibold text-slate-900">
        <span className="mr-2 text-slate-400 tabular-nums">{n}.</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** Bulleted list with the spacing the policies use throughout. */
export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6">{children}</ul>;
}

/** A clause that must not be missed — used sparingly, for the refund rule. */
export function LegalCallout({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border-l-4 border-slate-900 bg-slate-50 px-4 py-3 text-slate-900">
      {children}
    </p>
  );
}
