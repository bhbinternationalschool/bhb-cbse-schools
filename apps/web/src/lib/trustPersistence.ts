import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  trustStateIsEmpty,
  loadTrust,
  writeTrustLocalRaw,
  type TrustState,
} from "@/lib/trust";

const blob = createDomainBlobPersistence<TrustState>({
  table: "trust_state",
  metaKey: "bhb_trust_v1_remote_meta",
  label: "trust",
  isEmpty: trustStateIsEmpty,
  loadLocal: loadTrust,
  writeLocalRaw: writeTrustLocalRaw,
});

export const scheduleTrustSync = blob.scheduleSync;
export const ensureTrustHydrated = blob.ensureHydrated;
export const resetTrustPersistenceCache = blob.resetCache;
