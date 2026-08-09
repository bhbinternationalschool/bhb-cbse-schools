"use client";

import { useMemo } from "react";
import {
  buildPaymentChannelGroups,
  buildTenderChannelGroups,
  channelsForPaymentMode,
} from "@/lib/paymentChannels";
import type { AccountsState } from "@/lib/accountsTypes";
import type { PaymentMode } from "@/lib/accountsTypes";

const FIELD =
  "w-full rounded-xl border border-[rgba(32,48,80,0.18)] px-3 py-2 text-sm";

type PaymentChannelSelectProps = {
  value: string;
  onChange: (value: string) => void;
  accounts?: AccountsState;
  className?: string;
  placeholder?: string;
  includeCash?: boolean;
  disabled?: boolean;
  /** Restrict to one payment mode (expense voucher pay). */
  restrictMode?: PaymentMode;
  /** Fee collection grouped options. */
  variant?: "accounts" | "tender";
};

export function PaymentChannelSelect({
  value,
  onChange,
  accounts,
  className,
  placeholder = "Select payment mode & account…",
  includeCash = true,
  disabled,
  restrictMode,
  variant = "accounts",
}: PaymentChannelSelectProps) {
  const groups = useMemo(() => {
    if (restrictMode) {
      return channelsForPaymentMode(restrictMode, accounts);
    }
    if (variant === "tender") {
      return buildTenderChannelGroups(accounts);
    }
    return buildPaymentChannelGroups(accounts, { includeCash });
  }, [accounts, includeCash, restrictMode, variant]);

  const hasOptions = groups.some((g) => g.options.length > 0);

  return (
    <select
      className={className ?? FIELD}
      value={value}
      disabled={disabled || !hasOptions}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {!hasOptions ? "No account configured" : placeholder}
      </option>
      {groups.map((group) => (
        <optgroup key={group.modeLabel} label={group.modeLabel}>
          {group.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
