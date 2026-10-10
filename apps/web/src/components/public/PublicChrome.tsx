import Link from "next/link";
import { BhashiniTranslate } from "@/components/public/BhashiniTranslate";
import { SiteJsonLd } from "@/components/public/SiteJsonLd";
import {
  ADDRESS_ONE_LINE,
  CONTACT,
  RECOGNITION_STATEMENT,
  TRADING_NAME,
  displayLegalName,
} from "@/lib/publicOrgProfile";
import type { SiteLang } from "@/lib/website";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/fee-structure", label: "Fees & services" },
  { href: "/about", label: "About us" },
  { href: "/contact", label: "Contact" },
];

const LEGAL_NAV = [
  { href: "/terms", label: "Terms & conditions" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/refund-policy", label: "Cancellation & refund policy" },
  { href: "/cookie-policy", label: "Cookie policy" },
  { href: "/data-deletion", label: "Account & data deletion" },
  { href: "/contact", label: "Contact us" },
];

/**
 * Header + footer wrapper shared by every public (unauthenticated) page.
 * The footer carries the registered legal name and address on every page,
 * which is what payment-gateway onboarding reviews look for.
 *
 * `lang` is the language the page is written in. The BHASHINI translation
 * widget is offered on English pages only (see BhashiniTranslate). The legal
 * name, address and recognition statement carry `bhashini-skip-translation`:
 * they are quoted exactly as registered, and a machine rendering of them is
 * not the school's statement.
 */
export function PublicChrome({
  children,
  lang = "en",
}: {
  children: React.ReactNode;
  lang?: SiteLang;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      {/* Once, on every public page — the chrome is what they all share. */}
      <SiteJsonLd />
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link
            href="/"
            className="bhashini-skip-translation font-semibold text-slate-900"
          >
            {TRADING_NAME}
          </Link>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-slate-600 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {lang === "en" ? <BhashiniTranslate /> : null}
            <Link
              href="/login"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Parent / staff login
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-16 border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-10 text-sm leading-6 text-slate-600">
          <p className="bhashini-skip-translation font-semibold text-slate-900">
            {displayLegalName()}
          </p>
          <p className="bhashini-skip-translation mt-1">{ADDRESS_ONE_LINE}</p>
          <p className="mt-1">
            Email:{" "}
            <a
              className="text-blue-700 underline"
              href={`mailto:${CONTACT.email}`}
            >
              {CONTACT.email}
            </a>
            {CONTACT.phone ? (
              <>
                {" · "}Phone:{" "}
                <a
                  className="text-blue-700 underline"
                  href={`tel:${CONTACT.phone}`}
                >
                  {CONTACT.phone}
                </a>
              </>
            ) : null}
          </p>

          {/*
            Stated on every page, not just About. An automated merchant review
            reads whatever page it lands on; if the recognition is only on one
            of them it is a coin toss whether the reviewer ever sees why no
            central-board affiliation number is published.
          */}
          <p className="bhashini-skip-translation mt-4 max-w-3xl text-slate-600">
            {RECOGNITION_STATEMENT}
          </p>
          <nav className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-slate-600 underline hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="mt-5 text-xs text-slate-500">
            © {new Date().getFullYear()} {displayLegalName()}. All rights
            reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
