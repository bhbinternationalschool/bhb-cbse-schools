/**
 * Client → server sync for normalized accounts desk.
 */

import type { AccountsState } from "@/lib/accountsTypes";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_accounts_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: AccountsState | null = null;

type DeskMeta = { updatedAt: string; coaCount: number };

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", coaCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", coaCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      coaCount: Number(p.coaCount) || 0,
    };
  } catch {
    return { updatedAt: "", coaCount: 0 };
  }
}

function writeMeta(
  patch: Partial<DeskMeta> & { updatedAt: string; coaCount: number },
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

export function accountsNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function accountsReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ACCOUNTS_READ_FROM_DB === "true";
}

export function scheduleAccountsDeskSync(state: AccountsState) {
  if (!accountsNormalizedSyncEnabled() || typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (batch) void pushAccountsDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

function deskPayload(state: AccountsState) {
  return {
    cashPools: state.cashPools,
    cashLedger: state.cashLedger,
    bankAccounts: state.bankAccounts,
    bankLedger: state.bankLedger,
    modeBankMap: state.modeBankMap,
    reconSessions: state.reconSessions,
    expenseCategories: state.expenseCategories,
    expenseVouchers: state.expenseVouchers,
    recurringRules: state.recurringRules,
    vendors: state.vendors,
    vendorBills: state.vendorBills,
    payables: state.payables,
    trustees: state.trustees,
    ownerLoans: state.ownerLoans,
    ownerLoanSchedule: state.ownerLoanSchedule,
    ownerCashHandovers: state.ownerCashHandovers,
    coaAccounts: state.coaAccounts,
    journalEntries: state.journalEntries,
    fiscalYears: state.fiscalYears,
    settings: state.settings,
  };
}

async function pushAccountsDeskApi(state: AccountsState) {
  try {
    const res = await fetch("/api/school-data/accounts-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deskPayload(state)),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      coaCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        coaCount: body.coaCount ?? state.coaAccounts.length,
      });
    }
  } catch (e) {
    console.warn("[accounts-db] desk push error", e);
  }
}

export async function fetchAccountsDeskFromApi() {
  if (!accountsNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/accounts-desk", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as AccountsState & {
      ok?: boolean;
      updatedAt?: string;
      coaCount?: number;
    };
    if (!Array.isArray(body.coaAccounts)) return null;
    return {
      bundle: deskPayload(body as AccountsState),
      updatedAt: body.updatedAt || "",
      coaCount: body.coaCount ?? body.coaAccounts.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateAccountsDeskFromDb(preferDb?: boolean) {
  const remote = await fetchAccountsDeskFromApi();
  const emptyBundle = deskPayload({
    version: 1,
    cashPools: [],
    cashLedger: [],
    bankAccounts: [],
    bankLedger: [],
    modeBankMap: [],
    reconSessions: [],
    expenseCategories: [],
    expenseVouchers: [],
    recurringRules: [],
    vendors: [],
    vendorBills: [],
    payables: [],
    trustees: [],
    ownerLoans: [],
    ownerLoanSchedule: [],
    ownerCashHandovers: [],
    coaAccounts: [],
    journalEntries: [],
    fiscalYears: [],
    settings: { expenseApprovalPaise: 1_000_000, pettyThresholdPaise: 200_000 },
  });
  const empty = { bundle: emptyBundle, changed: false };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    accountsReadFromDbClientEnabled() ||
    meta.coaCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.coaCount > meta.coaCount;

  if (!shouldTake) return empty;

  writeMeta({ updatedAt: remote.updatedAt, coaCount: remote.coaCount });
  return { bundle: remote.bundle, changed: true };
}
