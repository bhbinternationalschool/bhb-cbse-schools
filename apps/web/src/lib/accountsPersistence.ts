/**
 * Accounts state — jsonb blob on accounts_state + normalized accounts_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  accountsStateIsEmpty,
  loadAccounts,
  writeAccountsLocalRaw,
  repairOrphanCashLedger,
} from "@/lib/accountsStore";
import type { AccountsState } from "@/lib/accountsTypes";
import {
  hydrateAccountsDeskFromDb,
  scheduleAccountsDeskSync,
} from "@/lib/accountsNormalizedClient";
import { mergeDbDeskIntoAccountsState } from "@/lib/accountsNormalizedMerge";
import { accountsReadFromDbEnabled } from "@/lib/accountsDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  dedupeHydration,
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "accounts";

const blob = createDomainBlobPersistence<AccountsState>({
  table: "accounts_state",
  metaKey: "bhb_accounts_v1_remote_meta",
  label: "accounts",
  isEmpty: accountsStateIsEmpty,
  loadLocal: loadAccounts,
  writeLocalRaw: writeAccountsLocalRaw,
});

export const accountsRemoteEnabled = blob.remoteEnabled;
export const scheduleAccountsSync = (state: AccountsState) => {
  if (typeof window === "undefined") {
    void pushAccountsRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("accounts")) blob.scheduleSync(state);
  scheduleAccountsDeskSync(state);
};
/**
 * Pull the accounts desk, and let every caller AWAIT the same pull.
 *
 * This used to mark the module hydrated on the way IN and hold no shared
 * promise, so a second caller returned `false` immediately while the first
 * caller's fetch was still in flight. On the fee counter that is the whole
 * bug: the app shell starts the accounts pull as the page mounts, the
 * counter's own `await ensureAccountsHydrated()` returns at once against an
 * empty store, and the Mode & account list is built with nothing in it —
 * cash, no banks. Reaching the counter from the Accounts page hid it, because
 * by then the desk was already in localStorage.
 *
 * Measured on a warm dev server: the banks landed 6.7s after a direct load of
 * /fees. Cloud Run with a cold start and fifteen desks queued behind four
 * hydration slots is slower, and the operator is already typing.
 *
 * `dedupeHydration` — what SIS, fees, masters and payments already use —
 * shares the in-flight promise, and the flag is set after the work rather
 * than before, so an await is an actual await.
 */
export const ensureAccountsHydrated = async (): Promise<boolean> => {
  if (isDeskHydrated(MODULE)) return false;
  return dedupeHydration(MODULE, hydrateAccountsOnce);
};

const hydrateAccountsOnce = async (): Promise<boolean> => {
  const readFromDb = accountsReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("accounts")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydrateAccountsDeskFromDb(readFromDb);
  if (changed && (bundle.coaAccounts.length > 0 || readFromDb)) {
    writeAccountsLocalRaw(
      mergeDbDeskIntoAccountsState(loadAccounts(), bundle, { preferDb: readFromDb }),
    );
    normChanged = true;
  }
  // Hydration is exactly when pool ids can go stale: the ledger arrives from
  // the server while the pools are whatever this browser happens to hold. Heal
  // before anyone reads a cash balance, or the money reads as zero.
  const healed = repairOrphanCashLedger(loadAccounts());
  if (healed !== loadAccounts()) {
    writeAccountsLocalRaw(healed);
    normChanged = true;
  }

  // Pull-only under desk-as-truth — hydrate must not re-push (audit 2026-08-18).
  if (normChanged && !readFromDb) scheduleAccountsSync(loadAccounts());
  // Marked only now. Setting it on the way in is what let a caller believe a
  // pull had finished when it had not.
  markDeskHydrated(MODULE);
  return blobChanged || normChanged;
};

export async function pushAccountsRemoteServer(
  state: AccountsState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushAccountsDeskToDb } = await import("@/lib/accountsNormalized.server");
  const desk = await pushAccountsDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("accounts")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<AccountsState>("accounts_state");
  const remoteCoa = remote.state?.coaAccounts?.length ?? 0;
  const nextCoa = state.coaAccounts?.length ?? 0;
  if (nextCoa < remoteCoa && remote.state) return { ok: true };

  return pushServerBlob("accounts_state", state);
}

export async function ensureAccountsHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchAccountsDeskFromDb } = await import("@/lib/accountsNormalized.server");
  const { accountsReadFromDbEnabled } = await import("@/lib/accountsDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadAccounts();
  let changed = false;

  if (!deskSkipBlobPush("accounts")) {
    const remoteBlob = await fetchServerBlob<AccountsState>("accounts_state");
    if (
      remoteBlob.state &&
      !accountsReadFromDbEnabled() &&
      !accountsStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchAccountsDeskFromDb();
  if (dbDesk.bundle.coaAccounts.length > 0 || accountsReadFromDbEnabled()) {
    state = mergeDbDeskIntoAccountsState(state, dbDesk.bundle, {
      preferDb:
        accountsReadFromDbEnabled() || (state.coaAccounts?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeAccountsLocalRaw(state);
  return changed;
}

export function resetAccountsPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}
