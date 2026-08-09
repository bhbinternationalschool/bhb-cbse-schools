import { listBanksForPaymentMode } from "@/lib/accountsLookups";
import { loadAccounts } from "@/lib/accountsStore";
import {
  BANK_PAYMENT_MODES,
  BANK_PAYMENT_MODE_LABELS,
  type AccountsState,
  type PaymentMode,
} from "@/lib/accountsTypes";
import { TENDER_MODES, type TenderMode } from "@/lib/fees";

export type PaymentChannelGroup = {
  modeLabel: string;
  options: { value: string; label: string }[];
};

export function encodePaymentChannel(
  mode: PaymentMode,
  bankId = "",
): string {
  if (mode === "cash") return "cash";
  return `${mode}:${bankId}`;
}

export function decodePaymentChannel(value: string): {
  mode: PaymentMode;
  bankId: string;
} {
  if (!value || value === "cash") return { mode: "cash", bankId: "" };
  const i = value.indexOf(":");
  if (i < 0) return { mode: value as PaymentMode, bankId: "" };
  return {
    mode: value.slice(0, i) as PaymentMode,
    bankId: value.slice(i + 1),
  };
}

export function buildPaymentChannelGroups(
  state?: AccountsState,
  opts?: { includeCash?: boolean },
): PaymentChannelGroup[] {
  const s = state ?? loadAccounts();
  const groups: PaymentChannelGroup[] = [];

  if (opts?.includeCash !== false) {
    groups.push({
      modeLabel: "Cash",
      options: [{ value: "cash", label: "Cash in hand" }],
    });
  }

  for (const mode of BANK_PAYMENT_MODES) {
    const banks = listBanksForPaymentMode(mode, s);
    if (!banks.length) continue;
    groups.push({
      modeLabel: BANK_PAYMENT_MODE_LABELS[mode],
      options: banks.map((b) => ({
        value: encodePaymentChannel(mode, b.id),
        label: bankOptionLabel(b),
      })),
    });
  }

  return groups;
}

export function defaultPaymentChannel(state?: AccountsState): string {
  const groups = buildPaymentChannelGroups(state);
  for (const group of groups) {
    if (group.options[0]) return group.options[0].value;
  }
  return "cash";
}

export function channelsForPaymentMode(
  mode: PaymentMode,
  state?: AccountsState,
): PaymentChannelGroup[] {
  if (mode === "cash") {
    return [{ modeLabel: "Cash", options: [{ value: "cash", label: "Cash in hand" }] }];
  }
  const banks = listBanksForPaymentMode(mode, state);
  if (!banks.length) return [];
  return [
    {
      modeLabel: BANK_PAYMENT_MODE_LABELS[mode],
      options: banks.map((b) => ({
        value: encodePaymentChannel(mode, b.id),
        label: bankOptionLabel(b),
      })),
    },
  ];
}

function bankOptionLabel(b: {
  name: string;
  bankName: string;
  accountNo: string;
}): string {
  const bits = [b.name];
  if (b.bankName) bits.push(b.bankName);
  if (b.accountNo) bits.push(b.accountNo.slice(-4));
  return bits.join(" · ");
}

const TENDER_TO_PAYMENT: Partial<Record<TenderMode, PaymentMode>> = {
  cash: "cash",
  upi: "upi",
  rtgs: "rtgs",
  neft: "neft",
  cheque: "cheque",
  card: "card",
  imps: "neft",
};

export function encodeTenderChannel(mode: TenderMode, bankId = ""): string {
  if (mode === "cash") return "cash";
  if (!bankId) return mode;
  return `${mode}:${bankId}`;
}

export function decodeTenderChannel(value: string): {
  mode: TenderMode;
  bankId: string;
} {
  if (!value || value === "cash") return { mode: "cash", bankId: "" };
  const i = value.indexOf(":");
  if (i < 0) return { mode: value as TenderMode, bankId: "" };
  return {
    mode: value.slice(0, i) as TenderMode,
    bankId: value.slice(i + 1),
  };
}

/** Fee collection — modes grouped with configured bank account names. */
export function buildTenderChannelGroups(
  state?: AccountsState,
): PaymentChannelGroup[] {
  const s = state ?? loadAccounts();
  const groups: PaymentChannelGroup[] = [];

  groups.push({
    modeLabel: "Cash",
    options: [{ value: "cash", label: "Cash in hand" }],
  });

  for (const tm of TENDER_MODES) {
    if (tm.value === "cash") continue;

    if (tm.value === "bank") {
      const banks = s.bankAccounts.filter((b) => b.isActive !== false);
      if (!banks.length) continue;
      groups.push({
        modeLabel: tm.label,
        options: banks.map((b) => ({
          value: encodeTenderChannel("bank", b.id),
          label: bankOptionLabel(b),
        })),
      });
      continue;
    }

    const payMode = TENDER_TO_PAYMENT[tm.value];
    const banks = payMode ? listBanksForPaymentMode(payMode, s) : [];
    if (!banks.length) continue;

    groups.push({
      modeLabel: tm.label,
      options: banks.map((b) => ({
        value: encodeTenderChannel(tm.value, b.id),
        label: bankOptionLabel(b),
      })),
    });
  }

  return groups;
}

export function defaultTenderChannel(state?: AccountsState): string {
  const groups = buildTenderChannelGroups(state);
  for (const group of groups) {
    if (group.options[0]) return group.options[0].value;
  }
  return "cash";
}

export function tenderChannelLabel(
  value: string,
  state?: AccountsState,
): string {
  const { mode, bankId } = decodeTenderChannel(value);
  if (mode === "cash") return "Cash";
  const s = state ?? loadAccounts();
  const bank = bankId ? s.bankAccounts.find((b) => b.id === bankId) : undefined;
  const modeLabel =
    TENDER_MODES.find((m) => m.value === mode)?.label ?? mode;
  return bank ? `${modeLabel} · ${bank.name}` : modeLabel;
}

export function paymentChannelLabel(
  value: string,
  state?: AccountsState,
): string {
  const { mode, bankId } = decodePaymentChannel(value);
  if (mode === "cash") return "Cash";
  const s = state ?? loadAccounts();
  const bank = bankId ? s.bankAccounts.find((b) => b.id === bankId) : undefined;
  const modeLabel = BANK_PAYMENT_MODE_LABELS[mode] ?? mode;
  return bank ? `${modeLabel} · ${bank.name}` : modeLabel;
}
