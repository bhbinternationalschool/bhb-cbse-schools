import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  vaultStateIsEmpty,
  loadVault,
  writeVaultLocalRaw,
  type VaultState,
} from "@/lib/vault";

const blob = createDomainBlobPersistence<VaultState>({
  table: "vault_state",
  metaKey: "bhb_vault_v1_remote_meta",
  label: "vault",
  isEmpty: vaultStateIsEmpty,
  loadLocal: loadVault,
  writeLocalRaw: writeVaultLocalRaw,
});

export const scheduleVaultSync = blob.scheduleSync;
export const ensureVaultHydrated = blob.ensureHydrated;
export const resetVaultPersistenceCache = blob.resetCache;
