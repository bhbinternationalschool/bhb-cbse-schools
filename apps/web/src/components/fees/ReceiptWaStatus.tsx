"use client";

import { useEffect, useState } from "react";
import {
  WaDeliveryTicks,
  type WaTickStage,
} from "@/components/comms/WaDeliveryTicks";

type Row = {
  stage: WaTickStage;
  stageLabel: string;
  mobile: string;
  error: string;
  ladder: { deliveredAt: string | null; readAt: string | null } | null;
};

/**
 * Did the family get this receipt?
 *
 * Shown on the receipt itself, because that is where the question is asked.
 * The office used to have no answer at all: Meta reported delivered and read
 * to a webhook that filed it in a table nothing read.
 *
 * It polls briefly rather than once. `sent` turns into `delivered` and often
 * `read` within seconds of the send, and a status that never moved off "Sent"
 * because nobody refreshed would be read as a problem when there is none.
 * Polling stops as soon as the answer is final, and after a minute regardless
 * — this is a receipt on screen, not a dashboard.
 */
export function ReceiptWaStatus({ voucherId }: { voucherId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!voucherId) return;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      tries += 1;
      try {
        const res = await fetch(
          `/api/fees/receipt-wa?voucherId=${encodeURIComponent(voucherId)}`,
        );
        const json = (await res.json()) as { receipts?: Row[] };
        if (cancelled) return;
        const next = json.receipts?.[0] ?? null;
        setRow(next);
        setChecked(true);
        // Read and failed are final. Everything else may still move.
        const settled = next?.stage === "read" || next?.stage === "failed";
        if (!settled && tries < 6) timer = setTimeout(poll, 10_000);
      } catch {
        if (!cancelled) setChecked(true);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [voucherId]);

  if (!checked) {
    return (
      <span className="text-[11px] text-[var(--muted)]">
        Checking WhatsApp…
      </span>
    );
  }
  if (!row) {
    // No send record at all — distinct from a send that failed, and the
    // office should read it that way: nothing was attempted for this receipt.
    return (
      <span className="text-[11px] text-[var(--muted)]">
        Not sent on WhatsApp
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <WaDeliveryTicks
        stage={row.stage}
        at={row.ladder?.readAt || row.ladder?.deliveredAt}
      />
      {row.mobile ? (
        <span className="text-[11px] text-[var(--muted)]">{row.mobile}</span>
      ) : null}
      {row.stage === "failed" && row.error ? (
        <span className="text-[11px] text-[var(--danger)]">
          {row.error}
        </span>
      ) : null}
    </span>
  );
}
