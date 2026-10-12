"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * "This is what changes" — shown before any permission save, copy or
 * template is written (Masters → Roles). Nothing is saved until Confirm.
 */
export function RbacChangePreview({
  title,
  gained,
  lost,
  notes,
  confirmLabel = "Save",
  onConfirm,
  onCancel,
}: {
  title: string;
  gained: string[];
  lost: string[];
  notes?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const nothing = gained.length === 0 && lost.length === 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-[var(--card)] shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <p className="text-base font-bold text-[var(--brand-deep)]">{title}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {gained.length} permission{gained.length === 1 ? "" : "s"} added · {lost.length} removed
            </p>
          </div>
          <button type="button" onClick={onCancel} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-sunken)]" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {notes ? <div className="space-y-1 text-[13px]">{notes}</div> : null}
          {nothing ? (
            <p className="text-[var(--muted)]">What the person or role can do does not change.</p>
          ) : null}
          {gained.length ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--success)]">Will be able to</p>
              <ul className="space-y-0.5 text-[13px]">
                {gained.map((g) => (
                  <li key={g}>+ {g}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {lost.length ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--danger)]">Will no longer be able to</p>
              <ul className="space-y-0.5 text-[13px]">
                {lost.map((g) => (
                  <li key={g}>− {g}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
