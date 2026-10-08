"use client";

import {
  schoolAddressLine,
  schoolContactLine,
  schoolCrestUrl,
  schoolPrintName,
  schoolTagline,
} from "@/lib/schoolIdentity";
import type { MastersState } from "@/lib/masters";

/**
 * The school's letterhead for every sheet the ERP prints in HTML.
 *
 * It is the fee receipt's header, made shareable: the crest, the school's name
 * in the brand navy, the gold tagline, the address and contact lines.
 * Payslips, report cards, certificates and the rest each grew their own
 * header — most with the name and no logo, the payslip with neither the logo
 * nor its colours (it forced the name to black on paper). A document that
 * leaves the building should say whose it is the same way on all of them.
 *
 * `erp-print-brand` keeps the colours on paper: browsers drop text and
 * background colour when printing unless told otherwise.
 */
export function SchoolLetterhead({
  title,
  subtitle,
  size = "md",
  printOnly = false,
  showContact = true,
  masters,
  className = "",
}: {
  /** The document's own name, under the rule — "Salary slip", "Report card". */
  title?: string;
  /** One line under the title — the month, the term, the class. */
  subtitle?: string;
  /** `sm` for half-page slips and passes, `md` for A4 sheets. */
  size?: "sm" | "md";
  /** For screens printed as-is: show the letterhead on paper only. */
  printOnly?: boolean;
  showContact?: boolean;
  masters?: MastersState | null;
  className?: string;
}) {
  const sm = size === "sm";
  // The crest on both sides, not the full logo: the logo is a lockup with the
  // name and tagline under the shield, and at letterhead size that text is a
  // smudge beside the same name printed large in the middle.
  const crest = sm ? 40 : 58;
  const address = schoolAddressLine(masters);
  const contact = showContact ? schoolContactLine(masters) : "";

  return (
    <header
      className={`erp-print-brand ${printOnly ? "hidden print:block" : ""} ${className}`}
    >
      <div className="flex items-center gap-3 border-b-2 border-[var(--brand-deep)] pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={schoolCrestUrl(masters)}
          alt=""
          width={crest}
          height={crest}
          style={{ width: crest, height: crest }}
          className="shrink-0 object-contain"
        />
        <div className="min-w-0 flex-1 text-center">
          <p
            className={`font-brand-name font-bold leading-tight text-[var(--brand-deep)] ${sm ? "text-[14px]" : "text-[19px]"}`}
          >
            {schoolPrintName(masters)}
          </p>
          <p
            className={`font-semibold uppercase tracking-[0.16em] text-[var(--brand-gold)] ${sm ? "text-[8px]" : "text-[10px]"}`}
          >
            {schoolTagline(masters)}
          </p>
          {address ? (
            <p className={`mt-0.5 leading-snug text-[var(--muted)] ${sm ? "text-[8px]" : "text-[10px]"}`}>
              {address}
            </p>
          ) : null}
          {contact ? (
            <p className={`leading-snug text-[var(--muted)] ${sm ? "text-[8px]" : "text-[10px]"}`}>
              {contact}
            </p>
          ) : null}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={schoolCrestUrl(masters)}
          alt=""
          width={crest}
          height={crest}
          style={{ width: crest, height: crest }}
          className="shrink-0 object-contain"
        />
      </div>
      {title ? (
        <p
          className={`mt-2 text-center font-bold uppercase tracking-wide text-[var(--brand-deep)] ${sm ? "text-[11px]" : "text-sm"}`}
        >
          {title}
        </p>
      ) : null}
      {subtitle ? (
        <p className={`text-center text-[var(--muted)] ${sm ? "text-[9px]" : "text-xs"}`}>{subtitle}</p>
      ) : null}
    </header>
  );
}
