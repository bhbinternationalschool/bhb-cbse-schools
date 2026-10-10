/**
 * Client → server sync for normalized accounts desk.
 */

import type { AccountsState } from "@/lib/accountsTypes";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import { trackDeskPush } from "@/lib/deskSyncStatus";
import {
  confirmDeskDeletes,
  pendingDeskDeletes,
  recordDeskDeletion,
} from "@/lib/deskNamedDeletes";
import {
  applyStampedSave,
  buildStampedSave,
  captureRowStamps,
  onStampConflicts,
  type RowConflicts,
  type RowStamps,
} from "@/lib/rowStampClient";
import { rowFingerprint } from "@/lib/sliceRevClient";
import { ACCOUNTS_STAMPED_SLICES } from "@/lib/accountsStampSlices";

/** Name the accounts desk uses in deskNamedDeletes. */
const ACCOUNTS_DESK = "accounts";

/**
 * The user deleted a master row (bank account, chart head, expense category,
 * vendor). A save no longer deletes what it leaves out, so the deletion has to
 * be said; it rides every push until the server confirms it.
 */
export function recordAccountsDeletion(
  table:
    | "accounts_desk_bank_accounts"
    | "accounts_desk_coa_accounts"
    | "accounts_desk_expense_categories"
    | "accounts_desk_vendors",
  id: string,
) {
  recordDeskDeletion(ACCOUNTS_DESK, table, [id]);
}

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

/**
 * Stamped saves (10 Oct 2026). The load hands over each row's stamp; a save
 * sends only the rows this browser changed, each with the stamp it changed
 * it from, and the server refuses any row that moved on in between. Settings
 * ride the same way with their own stamp. All of it is page memory.
 */
const STAMP_MODULE = "accounts";
let settingsBase: { stamp: string; hash: number } | null = null;

/** After a load the browser took: remember the server's stamps. */
export function captureAccountsStamps(
  bundle: Record<string, unknown>,
  stamps: RowStamps | undefined,
  settingsStamp: string | undefined,
) {
  captureRowStamps(STAMP_MODULE, stamps ?? {}, bundle, ACCOUNTS_STAMPED_SLICES);
  settingsBase = { stamp: settingsStamp ?? "", hash: rowFingerprint(bundle.settings ?? {}) };
}

/** What a save sends: the changed rows only, their stamps, and settings if changed. */
export function stampedPayload(state: AccountsState) {
  const stamps = buildStampedSave(
    STAMP_MODULE,
    state as unknown as Record<string, unknown>,
    ACCOUNTS_STAMPED_SLICES,
  );
  const whole = deskPayload(state) as Record<string, unknown>;
  const body: Record<string, unknown> = { ...whole };
  // Only the rows that changed travel; the rest are already on the server.
  for (const slice of ACCOUNTS_STAMPED_SLICES) {
    const changed = stamps[slice] ?? {};
    body[slice] = ((whole[slice] as { id?: string }[] | undefined) ?? []).filter(
      (r) => r && typeof r.id === "string" && r.id in changed,
    );
  }
  const settingsChanged = !settingsBase || rowFingerprint(state.settings ?? {}) !== settingsBase.hash;
  return {
    body: { ...body, stamps, settingsBase: settingsChanged ? (settingsBase?.stamp ?? "") : null },
    stamps,
    settingsChanged,
  };
}

/**
 * Push the accounts desk to the server, and record whether it landed.
 *
 * The previous version lost a failure two ways: the `catch` fired only when
 * the request threw, and a response that was merely not ok fell past the
 * success branch having done nothing — no write, no log, no error. A role
 * without server-side `accounts:edit` therefore produced a screen that said
 * "saved" and a server that never heard about it.
 *
 * The outcome now goes through trackDeskPush, which records it and raises
 * `bhb-desk-sync-failed` for the workspace to surface. The server's own error
 * message is passed through rather than replaced with a generic one: "Your
 * role cannot write accounts" is actionable and "save failed" is not.
 */
async function pushAccountsDeskApi(state: AccountsState) {
  await trackDeskPush("accounts", async () => {
    const sentDeletes = pendingDeskDeletes(ACCOUNTS_DESK);
    const sent = stampedPayload(state);
    const res = await fetch("/api/school-data/accounts-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Deletions are named, never inferred from what this browser lacks.
      body: JSON.stringify({ ...sent.body, deletes: sentDeletes }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      coaCount?: number;
      error?: string;
      stamps?: RowStamps;
      conflicts?: RowConflicts;
      settingsStamp?: string;
    } | null;

    if (res.ok && body?.ok) {
      confirmDeskDeletes(ACCOUNTS_DESK, sentDeletes);
      applyStampedSave(
        STAMP_MODULE,
        state as unknown as Record<string, unknown>,
        sent.stamps,
        body,
        ACCOUNTS_STAMPED_SLICES,
      );
      if (sent.settingsChanged && body.settingsStamp) {
        settingsBase = { stamp: body.settingsStamp, hash: rowFingerprint(state.settings ?? {}) };
      }
      // Rows another PC changed first were not written: reload, and say so.
      onStampConflicts(STAMP_MODULE, body.conflicts);
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        coaCount: body.coaCount ?? state.coaAccounts.length,
      });
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status, error: body?.error };
  });
}

/**
 * Push what the desk holds right now.
 *
 * Retry deliberately re-pushes current state rather than replaying a stored
 * payload: a desk push carries the whole module, and the freshest version is
 * both smaller to reason about and the one the operator actually wants saved.
 */
export async function retryAccountsDeskSync(state: AccountsState): Promise<boolean> {
  if (!accountsNormalizedSyncEnabled() || typeof window === "undefined") return false;
  await pushAccountsDeskApi(state);
  const { deskSyncState } = await import("@/lib/deskSyncStatus");
  return deskSyncState("accounts").consecutiveFailures === 0;
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
      stamps?: RowStamps;
      settingsStamp?: string;
    };
    if (!Array.isArray(body.coaAccounts)) return null;
    return {
      bundle: deskPayload(body as AccountsState),
      updatedAt: body.updatedAt || "",
      coaCount: body.coaCount ?? body.coaAccounts.length,
      stamps: body.stamps,
      settingsStamp: body.settingsStamp,
    };
  } catch {
    return null;
  }
}

/**
 * True when this browser's desk is missing something the server has — a
 * bank account, or the chart of accounts. Such a copy must take the server's,
 * whatever the timestamps say: on 8 Oct 2026 a browser whose saved desk had
 * lost both bank accounts (a full or cleared localStorage) kept its own copy
 * for good, because its last save stamped it newer than the server, and the
 * Masters screen showed no banks.
 */
export function localDeskIsMissingRemote(
  local: Pick<AccountsState, "bankAccounts" | "coaAccounts"> | null | undefined,
  remote: Pick<AccountsState, "bankAccounts" | "coaAccounts">,
): boolean {
  if (!local) return false;
  const have = new Set((local.bankAccounts ?? []).map((b) => b.id));
  if ((remote.bankAccounts ?? []).some((b) => !have.has(b.id))) return true;
  return (local.coaAccounts ?? []).length === 0 && (remote.coaAccounts ?? []).length > 0;
}

export async function hydrateAccountsDeskFromDb(preferDb?: boolean, local?: AccountsState) {
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
  const empty = { bundle: emptyBundle, changed: false, fetched: false };
  if (!remote) return empty;

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    accountsReadFromDbClientEnabled() ||
    meta.coaCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.coaCount > meta.coaCount ||
    localDeskIsMissingRemote(local, remote.bundle);

  if (!shouldTake) return { ...empty, fetched: true };

  writeMeta({ updatedAt: remote.updatedAt, coaCount: remote.coaCount });
  // The rows as the server holds them are the base of the next save.
  captureAccountsStamps(remote.bundle as Record<string, unknown>, remote.stamps, remote.settingsStamp);
  return { bundle: remote.bundle, changed: true, fetched: true };
}
