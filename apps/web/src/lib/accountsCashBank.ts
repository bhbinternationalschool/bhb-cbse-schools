/**
 * Accounts — cash book and bank book.
 *
 * postCashMovement and postBankMovement are sub-ledger primitives: they move
 * a pool or a bank account and post no journal. Pairing them with the GL
 * entry is the caller's job, which is why the wrappers here (deposit,
 * handover, pool transfer) always do both. A raw movement on its own will
 * leave the balance sheet untied.
 */

import {
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
} from "@/lib/accountsTypes";
import type {
  AccountsRemovalCheck,
  AccountsState,
  BankAccount,
  BankDirection,
  BankLedgerEntry,
  CashDirection,
  CashLedgerEntry,
  CashPool,
  ModeBankMapEntry,
  OwnerCashHandover,
  PaymentMode,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
  todayIso,
} from "@/lib/accountsUtil";
import {
  normalizeBank,
  syncModeBankMapFromBanks,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
} from "@/lib/accountsStore";
import {
  getCoaByCode,
} from "@/lib/accountsLookups";
import {
  postJournal,
} from "@/lib/accountsJournal";

/* ─── Cash book ────────────────────────────────────────────── */

export function cashInHandPaise(state?: AccountsState): number {
  const s = state ?? loadAccounts();
  return s.cashPools.reduce((n, p) => n + p.balancePaise, 0);
}

export function postCashMovement(input: {
  poolId: string;
  date?: string;
  direction: CashDirection;
  amountPaise: number;
  sourceType: string;
  sourceId?: string;
  narration?: string;
  transactionRef?: string;
}):
  | { ok: true; entry: CashLedgerEntry; pool: CashPool }
  | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return fail("Amount must be greater than zero");
  const state = loadAccounts();
  const pool = state.cashPools.find((p) => p.id === input.poolId);
  if (!pool) return fail("Cash pool not found");
  const delta = input.direction === "in" ? amount : -amount;
  const nextBalance = pool.balancePaise + delta;
  if (nextBalance < 0) return fail("Insufficient cash in pool");

  const entry: CashLedgerEntry = {
    id: id("cle"),
    poolId: pool.id,
    date: input.date || todayIso(),
    direction: input.direction,
    amountPaise: amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? "",
    narration: input.narration ?? "",
    transactionRef: input.transactionRef?.trim() ?? "",
    runningBalancePaise: nextBalance,
    createdAt: new Date().toISOString(),
    voidedAt: null,
    cancelReason: "",
  };
  const updatedPool: CashPool = { ...pool, balancePaise: nextBalance };
  saveAccounts({
    ...state,
    cashPools: state.cashPools.map((p) => (p.id === pool.id ? updatedPool : p)),
    cashLedger: [entry, ...state.cashLedger],
  });
  return { ok: true, entry, pool: updatedPool };
}

/* ─── Bank book ────────────────────────────────────────────── */

export function upsertBankAccount(
  patch: Partial<BankAccount> & { name: string },
): { ok: true; bank: BankAccount } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Bank account name required");
  const state = loadAccounts();
  const existing = patch.id
    ? state.bankAccounts.find((b) => b.id === patch.id)
    : undefined;
  const bank = normalizeBank({
    ...existing,
    ...patch,
    name,
    id: existing?.id ?? patch.id ?? id("bnk"),
  });
  const bankAccounts = existing
    ? state.bankAccounts.map((b) => (b.id === bank.id ? bank : b))
    : [...state.bankAccounts, bank];
  saveAccounts({
    ...state,
    bankAccounts,
    modeBankMap: syncModeBankMapFromBanks(bankAccounts),
  });
  return { ok: true, bank };
}

export function checkBankAccountRemoval(
  bankId: string,
  state?: AccountsState,
): AccountsRemovalCheck {
  const s = state ?? loadAccounts();
  const bank = s.bankAccounts.find((b) => b.id === bankId);
  const label = bank?.name ?? "this bank account";
  const blockers: string[] = [];
  if (
    s.bankLedger.some((e) => e.bankId === bankId && !e.voidedAt)
  ) {
    blockers.push("bank ledger entries");
  }
  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion: `Cannot delete — linked to ${blockers.join(", ")}. Mark inactive instead.`,
      confirmMessage: `Delete “${label}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "This cannot be undone.",
    confirmMessage: `Delete “${label}”?`,
  };
}

export function deleteBankAccount(
  bankId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const bank = state.bankAccounts.find((b) => b.id === bankId);
  if (!bank) return fail("Bank account not found");

  const check = checkBankAccountRemoval(bankId, state);
  if (!check.canRemove) return fail(check.suggestion);

  const bankAccounts = state.bankAccounts.filter((b) => b.id !== bankId);
  saveAccounts({
    ...state,
    bankAccounts,
    modeBankMap: syncModeBankMapFromBanks(bankAccounts),
  });
  return { ok: true };
}

export function postBankMovement(input: {
  bankId: string;
  date?: string;
  direction: BankDirection;
  amountPaise: number;
  mode: PaymentMode;
  sourceType: string;
  sourceId?: string;
  narration?: string;
  transactionRef?: string;
}): { ok: true; entry: BankLedgerEntry } | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return fail("Amount must be greater than zero");
  const state = loadAccounts();
  const bank = state.bankAccounts.find((b) => b.id === input.bankId);
  if (!bank) return fail("Bank account not found");
  const entry: BankLedgerEntry = {
    id: id("ble"),
    bankId: bank.id,
    date: input.date || todayIso(),
    direction: input.direction,
    amountPaise: amount,
    mode: input.mode,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? "",
    narration: input.narration ?? "",
    transactionRef: input.transactionRef?.trim() ?? "",
    createdAt: new Date().toISOString(),
    voidedAt: null,
    cancelReason: "",
  };
  saveAccounts({ ...state, bankLedger: [entry, ...state.bankLedger] });
  return { ok: true, entry };
}

/** Current bank balance = opening balance + debits (money in) - credits (money out). */
export function bankBalancePaise(bankId: string, state?: AccountsState): number {
  const s = state ?? loadAccounts();
  const bank = s.bankAccounts.find((b) => b.id === bankId);
  if (!bank) return 0;
  const movement = s.bankLedger
    .filter((e) => e.bankId === bankId && !e.voidedAt)
    .reduce((n, e) => n + (e.direction === "dr" ? e.amountPaise : -e.amountPaise), 0);
  return bank.openingBalancePaise + movement;
}

export function totalBankBalancePaise(state?: AccountsState): number {
  const s = state ?? loadAccounts();
  return s.bankAccounts
    .filter((b) => b.isActive)
    .reduce((n, b) => n + bankBalancePaise(b.id, s), 0);
}

export function recordBankDeposit(
  fromPoolId: string,
  bankId: string,
  amountPaise: number,
  date?: string,
): { ok: true } | { ok: false; error: string } {
  const amount = Math.round(amountPaise);
  const d = date || todayIso();
  const sourceId = id("dep");

  const cashRes = postCashMovement({
    poolId: fromPoolId,
    date: d,
    direction: "out",
    amountPaise: amount,
    sourceType: "bank_deposit",
    sourceId,
    narration: "Cash deposited to bank",
  });
  if (!cashRes.ok) return cashRes;

  const bankRes = postBankMovement({
    bankId,
    date: d,
    direction: "dr",
    amountPaise: amount,
    mode: "cash",
    sourceType: "bank_deposit",
    sourceId,
    narration: "Cash deposit",
  });
  if (!bankRes.ok) return bankRes;

  const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
  const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS);
  if (cashCoa && bankCoa) {
    postJournal({
      date: d,
      narration: "Cash deposited to bank",
      sourceType: "bank_deposit",
      sourceId,
      lines: [
        { coaId: bankCoa.id, debitPaise: amount, creditPaise: 0, narration: "" },
        { coaId: cashCoa.id, debitPaise: 0, creditPaise: amount, narration: "" },
      ],
    });
  }
  return { ok: true };
}

export function recordOwnerCashHandover(input: {
  fromPoolId: string;
  amountPaise: number;
  handedBy: string;
  receivedBy: string;
  purpose?: string;
  date?: string;
  note?: string;
}): { ok: true; handover: OwnerCashHandover } | { ok: false; error: string } {
  const handoverId = id("och");
  const cashRes = postCashMovement({
    poolId: input.fromPoolId,
    date: input.date,
    direction: "out",
    amountPaise: input.amountPaise,
    sourceType: "owner_handover",
    sourceId: handoverId,
    narration: input.purpose || "Owner cash handover",
  });
  if (!cashRes.ok) return cashRes;

  const state = loadAccounts();
  const handover: OwnerCashHandover = {
    id: handoverId,
    date: input.date || todayIso(),
    amountPaise: Math.round(input.amountPaise),
    fromPoolId: input.fromPoolId,
    handedBy: input.handedBy,
    receivedBy: input.receivedBy,
    purpose: input.purpose ?? "",
    note: input.note ?? "",
  };
  saveAccounts({
    ...state,
    ownerCashHandovers: [handover, ...state.ownerCashHandovers],
  });
  return { ok: true, handover };
}

export function voidCashLedgerEntry(
  entryId: string,
  reason = "",
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const entry = state.cashLedger.find((e) => e.id === entryId);
  if (!entry) return fail("Cash entry not found");
  if (entry.voidedAt) return fail("Already cancelled");
  const pool = state.cashPools.find((p) => p.id === entry.poolId);
  if (!pool) return fail("Cash pool not found");
  const reverse = entry.direction === "in" ? -entry.amountPaise : entry.amountPaise;
  const nextBalance = pool.balancePaise + reverse;
  if (nextBalance < 0) return fail("Cannot cancel — pool balance would go negative");
  const now = new Date().toISOString();
  saveAccounts({
    ...state,
    cashPools: state.cashPools.map((p) =>
      p.id === pool.id ? { ...p, balancePaise: nextBalance } : p,
    ),
    cashLedger: state.cashLedger.map((e) =>
      e.id === entryId
        ? { ...e, voidedAt: now, cancelReason: reason.trim() || e.cancelReason }
        : e,
    ),
  });
  return { ok: true };
}

/** Cancel a bank ledger payment/receipt. */
export function voidBankLedgerEntry(
  entryId: string,
  reason = "",
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const entry = state.bankLedger.find((e) => e.id === entryId);
  if (!entry) return fail("Bank entry not found");
  if (entry.voidedAt) return fail("Already cancelled");
  const now = new Date().toISOString();
  saveAccounts({
    ...state,
    bankLedger: state.bankLedger.map((e) =>
      e.id === entryId
        ? { ...e, voidedAt: now, cancelReason: reason.trim() || e.cancelReason }
        : e,
    ),
  });
  return { ok: true };
}

/** Cancel a journal voucher (excluded from TB / P&L thereafter). */
export function transferCashBetweenPools(input: {
  fromPoolId: string;
  toPoolId: string;
  amountPaise: number;
  date?: string;
  sourceType?: string;
  sourceId?: string;
  narration?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return fail("Amount must be greater than zero");
  if (input.fromPoolId === input.toPoolId) return fail("Pick two different pools");
  const sourceId = input.sourceId ?? id("xfer");
  const date = input.date || todayIso();
  const out = postCashMovement({
    poolId: input.fromPoolId,
    date,
    direction: "out",
    amountPaise: amount,
    sourceType: input.sourceType ?? "pool_transfer",
    sourceId: `${sourceId}_out`,
    narration: input.narration ?? "Pool transfer",
  });
  if (!out.ok) return out;
  const inn = postCashMovement({
    poolId: input.toPoolId,
    date,
    direction: "in",
    amountPaise: amount,
    sourceType: input.sourceType ?? "pool_transfer",
    sourceId: `${sourceId}_in`,
    narration: input.narration ?? "Pool transfer",
  });
  if (!inn.ok) return inn;
  return { ok: true };
}

/**
 * On Fee Take day-close approve: move counted cash drawer → main.
 * Fee income / counter cash should already be posted via postFeeCollectionToAccounts.
 */
export function setModeBankMap(
  entries: ModeBankMapEntry[],
): AccountsState {
  const state = loadAccounts();
  const next = { ...state, modeBankMap: entries };
  saveAccounts(next);
  return next;
}

/**
 * Post fee collection to cash/bank books (idempotent by voucher id).
 * Cash → drawer; UPI/NEFT/card/cheque → mapped bank.
 * JV: Dr Cash/Bank · Cr Fee Income (fees) · Cr AR (store dues collected).
 * When storeAmountPaise is set, that portion settles store AR instead of fee income.
 */
