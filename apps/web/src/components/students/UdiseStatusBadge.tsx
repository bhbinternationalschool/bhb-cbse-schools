"use client";

import { udisePenApaarStatus } from "@/lib/udiseCompliance";
import type { SisStudent } from "@/lib/sis";

/**
 * What UDISE+ has issued for this child, shown in front of their name.
 *
 * Asked for by the director on 2026-09-06: "UDISE OK" for a child holding
 * both ids, "PEN ok · APAAR missing" for a child holding only the PEN, and
 * nothing at all for a child holding neither — an empty row is the honest
 * rendering of "the portal has not started with this child yet", and a badge
 * on all 237 students would say nothing.
 *
 * Derived on every render from the student record, never stored, so a
 * re-import that fills a PEN or an APAAR moves the badge the moment Apply
 * writes it — no refresh, no second pass.
 */
export function UdiseStatusBadge({
  student,
  className = "",
}: {
  student: SisStudent;
  className?: string;
}) {
  const status = udisePenApaarStatus(student);
  if (status.code === "none") return null;

  const tone =
    status.code === "ok"
      ? "border-[rgba(15,118,110,0.35)] bg-[rgba(15,118,110,0.12)] text-[#0f766e]"
      : "border-[rgba(138,90,16,0.35)] bg-[rgba(196,149,58,0.15)] text-[#8a5a10]";

  return (
    <span
      className={`ml-2 inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone} ${className}`}
      title={
        status.code === "ok"
          ? `PEN ${student.pen} · APAAR ${student.apaarId}`
          : status.code === "pen_only"
            ? `PEN ${student.pen} — APAAR still to be generated on UDISE+`
            : `APAAR ${student.apaarId} — PEN still to be captured from UDISE+`
      }
    >
      {status.label}
    </span>
  );
}
