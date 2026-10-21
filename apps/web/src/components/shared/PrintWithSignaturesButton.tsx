"use client";

/**
 * The Print / Save as PDF button of a sheet that carries staff signatures
 * (lib/printSignatures printGate):
 *   - while the signatures are loading it is disabled and says
 *     "Loading signatures…" (usually a moment);
 *   - once they have answered — with images, or with nobody's on file —
 *     it prints;
 *   - if they could not be read it asks "Signatures could not be loaded —
 *     print without them?" and the person chooses: print without them, or
 *     try again.
 * `requested` is a print asked for before the sheet was ready (Print on a
 * register row, print right after issue): it is carried out as soon as the
 * gate opens, or turns into the same question.
 */

import { useEffect, useState } from "react";
import { PRINT_SIGNATURES_FAILED, PRINT_SIGNATURES_LOADING, printGate } from "@/lib/printSignatures";
import type { PrintSignatureStatus } from "@/components/shared/usePrintSignatures";

export function PrintWithSignaturesButton({
  status,
  onPrint,
  onRetry,
  label = "Print",
  className = "btn-accent rounded-lg px-3 py-1.5 text-xs font-bold",
  requested = false,
  onRequestHandled,
  disabled = false,
}: {
  status: PrintSignatureStatus;
  onPrint: () => void;
  onRetry: () => void;
  label?: string;
  className?: string;
  requested?: boolean;
  onRequestHandled?: () => void;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!requested) return;
    const gate = printGate(status);
    if (gate === "wait") return;
    onRequestHandled?.();
    if (gate === "print") onPrint();
    else setAsking(true);
  }, [requested, status, onPrint, onRequestHandled]);

  const loading = status === "loading";
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className={`${className} disabled:cursor-wait disabled:opacity-60`}
        disabled={disabled || loading}
        aria-busy={loading}
        data-testid="print-with-signatures"
        onClick={() => {
          const gate = printGate(status);
          if (gate === "print") onPrint();
          else if (gate === "ask") setAsking(true);
        }}
      >
        {loading ? PRINT_SIGNATURES_LOADING : label}
      </button>
      {asking && status === "failed" ? (
        <span role="alertdialog" aria-label={PRINT_SIGNATURES_FAILED} className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-[var(--warning)]">
          <span>{PRINT_SIGNATURES_FAILED}</span>
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-0.5 font-semibold text-[var(--brand-deep)]"
            onClick={() => {
              setAsking(false);
              onPrint();
            }}
          >
            Print without signatures
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-0.5 font-semibold text-[var(--brand-deep)]"
            onClick={() => {
              setAsking(false);
              onRetry();
            }}
          >
            Try again
          </button>
        </span>
      ) : null}
    </span>
  );
}
