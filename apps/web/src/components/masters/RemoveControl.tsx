"use client";

import type { RemovalCheck } from "@/lib/masters";

/** Remove action: disabled when linked data exists; confirms with suggestion when allowed. */
export function RemoveControl({
  check,
  onRemove,
  label = "Remove",
  compact = false,
}: {
  check: RemovalCheck;
  onRemove: () => void;
  label?: string;
  compact?: boolean;
}) {
  const tip = check.canRemove
    ? `${check.confirmMessage} ${check.suggestion}`
    : check.suggestion;

  return (
    <div
      className={`flex flex-col items-end gap-0.5 ${compact ? "" : "max-w-[15rem]"}`}
    >
      <button
        type="button"
        disabled={!check.canRemove}
        title={tip}
        aria-disabled={!check.canRemove}
        className={`font-medium text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40 ${
          compact ? "text-[10px]" : "text-xs"
        }`}
        onClick={() => {
          if (!check.canRemove) return;
          const ok = window.confirm(
            `${check.confirmMessage}\n\n${check.suggestion}`,
          );
          if (!ok) return;
          onRemove();
        }}
      >
        {label}
      </button>
      {!check.canRemove ? (
        <span
          className={`text-right leading-snug text-[var(--muted)] ${
            compact ? "max-w-[9rem] text-[10px]" : "text-[11px]"
          }`}
        >
          {check.suggestion}
        </span>
      ) : null}
    </div>
  );
}
