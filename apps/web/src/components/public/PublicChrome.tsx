import Link from "next/link";
import {
  ADDRESS_ONE_LINE,
  CONTACT,
  TRADING_NAME,
  displayLegalName,
} from "@/lib/publicOrgProfile";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/fee-structure", label: "Fees & services" },
  { href: "/about", label: "About us" },
  { href: "/contact", label: "Contact" },
];

const LEGAL_NAV = [
  { href: "/terms", label: "Terms & conditions" },
  { href: "/refund-policy", label: "Refund & cancellation" },
  { href: "/privacy", label: "Privacy policy" },
];

/**
 * Header + footer wrapper shared by every public (unauthenticated) page.
 * The footer carries the registered legal name and address on every page,
 * which is what payment-gateway onboarding reviews look for.
 */
export function PublicChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/" className="font-semibold text-slate-900">
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
          <Link
            href="/login"
            className="ml-auto rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Parent / staff login
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-16 border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-10 text-sm leading-6 text-slate-600">
          <p className="font-semibold text-slate-900">{displayLegalName()}</p>
          <p className="mt-1">{ADDRESS_ONE_LINE}</p>
          <p className="mt-1">
            Email:{" "}
            <a className="text-blue-700 underline" href={`mailto:${CONTACT.email}`}>
              {CONTACT.email}
            </a>
            {CONTACT.phone ? (
              <>
                {" · "}Phone:{" "}
                <a className="text-blue-700 underline" href={`tel:${CONTACT.phone}`}>
                  {CONTACT.phone}
                </a>
              </>
            ) : null}
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
