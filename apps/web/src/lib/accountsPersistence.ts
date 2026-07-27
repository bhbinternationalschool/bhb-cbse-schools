import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  accountsStateIsEmpty,
  loadAccounts,
  writeAccountsLocalRaw,
  type AccountsState,
} from "@/lib/accounts";

const blob = createDomainBlobPersistence<AccountsState>({
  table: "accounts_state",
  metaKey: "bhb_accounts_v1_remote_meta",
  label: "accounts",
  isEmpty: accountsStateIsEmpty,
  loadLocal: loadAccounts,
  writeLocalRaw: writeAccountsLocalRaw,
});

export const accountsRemoteEnabled = blob.remoteEnabled;
export const scheduleAccountsSync = blob.scheduleSync;
export const ensureAccountsHydrated = blob.ensureHydrated;
export const resetAccountsPersistenceCache = blob.resetCache;
