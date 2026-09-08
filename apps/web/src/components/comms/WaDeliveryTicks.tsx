"use client";

/**
 * WhatsApp's ticks, said in words as well as marks.
 *
 * Meta has been reporting sent / delivered / read for months and the ERP
 * showed none of it, so "did that parent get their receipt" had no answer
 * short of asking them.
 *
 * The label is not decoration. A pair of ticks means nothing to somebody who
 * has not been told what one tick versus two means, and the difference here
 * decides whether the office rings a family — so the word is always there and
 * the marks are the shorthand beside it.
 */

export type WaTickStage =
  | "failed"
  | "read"
  | "delivered"
  | "sent"
  | "unknown";

const LOOK: Record<
  WaTickStage,
  { marks: string; label: string; className: string; title: string }
> = {
  read: {
    marks: "✓✓",
    label: "Read",
    className: "text-[var(--info)]",
    title: "Delivered and opened by the family",
  },
  delivered: {
    marks: "✓✓",
    label: "Delivered",
    className: "text-[var(--muted)]",
    title:
      "On the family's phone. It stays here rather than reaching Read when they have read receipts switched off in WhatsApp — that is not a fault.",
  },
  sent: {
    marks: "✓",
    label: "Sent",
    className: "text-[var(--muted)]",
    title: "Accepted by WhatsApp, not yet confirmed on the phone",
  },
  failed: {
    marks: "!",
    label: "Failed",
    className: "font-semibold text-[var(--danger)]",
    title: "WhatsApp could not deliver this",
  },
  unknown: {
    marks: "·",
    label: "No update yet",
    className: "text-[var(--muted)]",
    // Deliberately not "not delivered" — we do not know, and the stronger
    // word would have the office chasing a family who is perfectly fine.
    title: "No delivery update from WhatsApp yet",
  },
};

export function WaDeliveryTicks({
  stage,
  at,
  showLabel = true,
  className = "",
}: {
  stage: WaTickStage | undefined;
  /** When it reached this rung, for the tooltip. */
  at?: string | null;
  showLabel?: boolean;
  className?: string;
}) {
  const look = LOOK[stage ?? "unknown"];
  const when = at ? ` · ${new Date(at).toLocaleString("en-IN")}` : "";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] ${look.className} ${className}`}
      title={`${look.title}${when}`}
    >
      <span aria-hidden>{look.marks}</span>
      {showLabel ? <span>{look.label}</span> : null}
    </span>
  );
}
