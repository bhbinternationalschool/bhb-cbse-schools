"use client";

import type { WaDeliveryStage } from "@/lib/waDeliveryStatusShape";

/**
 * WhatsApp's own ticks, with the word next to them.
 *
 * A tick alone is not an answer for an office: a single grey tick and a
 * double grey tick look nearly identical at 11px, and "no webhook back yet"
 * looks exactly like "delivered" if you only draw one of them. So every row
 * carries the glyph AND the label, which is also why the label never says
 * "not delivered" — we do not know that, and the office would go and ring a
 * parent who is perfectly fine.
 */

const GLYPH: Record<WaDeliveryStage, string> = {
  // Handed to Meta.
  sent: "✓",
  // On the phone.
  delivered: "✓✓",
  // Opened — blue, and only ever if the parent has read receipts on.
  read: "✓✓",
  failed: "✕",
  unknown: "·",
};

const TONE: Record<WaDeliveryStage, string> = {
  sent: "text-[var(--muted)]",
  delivered: "text-[var(--brand-deep)]",
  read: "text-sky-600",
  failed: "text-rose-700",
  unknown: "text-[var(--muted)] opacity-60",
};

const TITLE: Record<WaDeliveryStage, string> = {
  sent: "Handed to WhatsApp, not on the phone yet",
  delivered: "On the parent's phone",
  read: "Opened by the parent (only shown if their read receipts are on)",
  failed: "Not delivered — see the reason",
  unknown: "No delivery update from WhatsApp yet",
};

export function WaDeliveryTicks({
  stage,
  label,
  className = "",
}: {
  stage: WaDeliveryStage;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap ${className}`}
      title={TITLE[stage]}
    >
      <span aria-hidden="true" className={`font-semibold ${TONE[stage]}`}>
        {GLYPH[stage]}
      </span>
      <span className={TONE[stage]}>{label}</span>
    </span>
  );
}

/** The counts across the top of the tab. Zero rungs are still shown: a 0 next
 * to "Failed" is information, and hiding it makes a bad day look like a
 * missing column. */
export function WaDeliveryTally({
  tally,
  active,
  onPick,
}: {
  tally: {
    total: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    unknown: number;
  };
  active: WaDeliveryStage | "all";
  onPick: (stage: WaDeliveryStage | "all") => void;
}) {
  const cells: { id: WaDeliveryStage | "all"; label: string; n: number }[] = [
    { id: "all", label: "All", n: tally.total },
    { id: "read", label: "Read", n: tally.read },
    { id: "delivered", label: "Delivered", n: tally.delivered },
    { id: "sent", label: "Sent", n: tally.sent },
    { id: "failed", label: "Failed", n: tally.failed },
    { id: "unknown", label: "No update", n: tally.unknown },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {cells.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
            active === c.id
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
          }`}
        >
          {c.id === "all" ? null : (
            <span aria-hidden="true" className="mr-1">
              {GLYPH[c.id]}
            </span>
          )}
          {c.label} {c.n}
        </button>
      ))}
    </div>
  );
}
