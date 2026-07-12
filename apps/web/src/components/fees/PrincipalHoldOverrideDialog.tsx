"use client";

import { useState } from "react";
import {
  DEFAULT_PRINCIPAL_PIN,
  HOLD_LABELS,
  grantHoldOverride,
  revokeHoldOverrideWithPin,
  type HoldCheck,
} from "@/lib/holds";
import type { HoldCode } from "@/lib/types";
import { formatInr } from "@/lib/fees";

export function PrincipalHoldOverrideDialog({
  studentId,
  studentName,
  holdCode,
  mode = "unhold",
  block,
  overriddenBy,
  onClose,
  onGranted,
}: {
  studentId: string;
  studentName: string;
  holdCode: HoldCode;
  /** unhold = unlock with PIN; rehold = revoke override with PIN */
  mode?: "unhold" | "rehold";
  block?: Extract<HoldCheck, { allowed: false }> | null;
  overriddenBy: string;
  onClose: () => void;
  onGranted: () => void;
}) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [daysValid, setDaysValid] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const label = block?.label ?? HOLD_LABELS[holdCode];
  const isRehold = mode === "rehold";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isRehold) {
      const result = revokeHoldOverrideWithPin({
        studentId,
        holdCode,
        pin,
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onGranted();
      return;
    }
    const result = grantHoldOverride({
      studentId,
      holdCode,
      reason,
      overriddenBy,
      pin,
      daysValid,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onGranted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-labelledby="hold-override-title"
      >
        <h2
          id="hold-override-title"
          className="text-lg font-semibold text-[var(--brand-deep)]"
        >
          {isRehold ? "Re-hold policy" : "Unhold policy"}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {studentName} · {label}
        </p>
        {block && !isRehold ? (
          <p className="mt-2 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-xs text-[#dc2626]">
            {block.message}
            {block.overdueAmountPaise > 0
              ? ` (${formatInr(block.overdueAmountPaise)})`
              : ""}
          </p>
        ) : null}
        {isRehold ? (
          <p className="mt-2 rounded-lg bg-[rgba(180,35,24,0.08)] px-3 py-2 text-xs text-[var(--brand-deep)]">
            This removes the Principal override and applies the hold again until
            dues are cleared or a new unhold is granted.
          </p>
        ) : null}

        <label className="mt-4 block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Principal PIN
          </span>
          <input
            className="field !py-1.5"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 8))
            }
            placeholder={`Demo PIN ${DEFAULT_PRINCIPAL_PIN}`}
            maxLength={8}
            required
          />
        </label>

        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Reason
          </span>
          <input
            className="field !py-1.5"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isRehold
                ? "e.g. Override expired / dues still open"
                : "e.g. Parent paid cash, receipt pending"
            }
            required={!isRehold}
          />
        </label>

        {!isRehold ? (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Unhold valid for
            </span>
            <select
              className="field !py-1.5"
              value={daysValid}
              onChange={(e) => setDaysValid(Number(e.target.value))}
            >
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} day{d === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm text-[#dc2626]">{error}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
          >
            {isRehold ? "Re-hold" : "Unhold"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Compact banner when a student is under an enforced hold. */
export function HoldStatusBanner({
  check,
  onOverride,
}: {
  check: HoldCheck | null;
  onOverride?: () => void;
}) {
  if (!check || check.allowed) {
    if (check?.allowed && check.override) {
      return (
        <p className="rounded-lg bg-[rgba(22,163,74,0.1)] px-3 py-2 text-xs text-[#15803d]">
          Hold overridden until {check.override.expiresOn} ·{" "}
          {check.override.reason}
        </p>
      );
    }
    return null;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-xs text-[#dc2626]">
      <span className="font-semibold">{check.message}</span>
      {onOverride ? (
        <button
          type="button"
          className="shrink-0 rounded-md bg-white px-2 py-1 text-[11px] font-bold text-[var(--brand-deep)]"
          onClick={onOverride}
        >
          Unhold (PIN)
        </button>
      ) : null}
    </div>
  );
}
