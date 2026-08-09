/**
 * Accounts state — jsonb blob on accounts_state + normalized accounts_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  accountsStateIsEmpty,
  loadAccounts,
  writeAccountsLocalRaw,
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
export const ensureAccountsHydrated = async () => {
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

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
  if (normChanged) scheduleAccountsSync(loadAccounts());
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
