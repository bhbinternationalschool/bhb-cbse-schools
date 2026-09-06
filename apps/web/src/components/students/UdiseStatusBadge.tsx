"use client";

import { udisePenApaarStatus } from "@/lib/udiseCompliance";
import { hasAadhaarOnFile } from "@/lib/studentFilters";
import type { SisStudent } from "@/lib/sis";

/**
 * What UDISE+ holds for this child, shown in front of their name.
 *
 * Asked for by the director on 2026-09-06: "UDISE OK" when the portal has
 * issued both ids, "PEN ok · APAAR missing" when it has issued one, and for
 * the children it holds nothing for, "No PEN · No APAAR" followed by whether
 * the school has their Aadhaar — because an Aadhaar on file is exactly what
 * decides whether that child can be registered on the portal today or has to
 * be chased for a document first.
 *
 * The Aadhaar chip is shown only for those children. On a child the portal
 * has already registered it answers a question nobody is asking, and a badge
 * on all 237 rows says nothing.
 *
 * Every state here is also a filter option in the register's Completeness
 * list, and every option there is a state here: `matchesCompleteness` and
 * this component read the same predicates, so a filtered list and the badges
 * inside it can never disagree.
 *
 * Derived on every render, never stored, so an import that fills a PEN moves
 * the badge as Apply writes it.
 */
export function UdiseStatusBadge({
  student,
  className = "",
}: {
  student: SisStudent;
  className?: string;
}) {
  const status = udisePenApaarStatus(student);
  const chip =
    "ml-2 inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide";
  // Design tokens, not literals: --success / --warning / --danger each carry a
  // light and a dark value, so these chips follow the theme without a `.dark`
  // rescue rule having to know they exist.
  const green =
    "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]";
  const amber =
    "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]";
  const red =
    "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]";

  const tone =
    status.code === "ok" ? green : status.code === "none" ? red : amber;

  const title =
    status.code === "ok"
      ? `PEN ${student.pen} · APAAR ${student.apaarId}`
      : status.code === "pen_only"
        ? `PEN ${student.pen} — APAAR still to be generated on UDISE+`
        : status.code === "apaar_only"
          ? `APAAR ${student.apaarId} — PEN still to be captured from UDISE+`
          : "Not on UDISE+ — no PEN and no APAAR on the record";

  const aadhaar = hasAadhaarOnFile(student);

  return (
    <>
      <span className={`${chip} ${tone} ${className}`} title={title}>
        {status.label}
      </span>
      {status.code === "none" ? (
        <span
          className={`${chip} ${aadhaar ? green : red}`}
          title={
            aadhaar
              ? "Aadhaar on file — this child can be registered on UDISE+ now"
              : "No Aadhaar on file — collect it before the child can be registered"
          }
        >
          {aadhaar ? "Aadhaar available" : "Aadhaar missing"}
        </span>
      ) : null}
    </>
  );
}
