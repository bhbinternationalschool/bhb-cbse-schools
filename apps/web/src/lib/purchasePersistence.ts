import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadPurchase,
  purchaseStateIsEmpty,
  writePurchaseLocalRaw,
  type PurchaseState,
} from "@/lib/purchase";

const blob = createDomainBlobPersistence<PurchaseState>({
  table: "purchase_state",
  metaKey: "bhb_purchase_v1_remote_meta",
  label: "purchase",
  isEmpty: purchaseStateIsEmpty,
  loadLocal: loadPurchase,
  writeLocalRaw: writePurchaseLocalRaw,
});

export const purchaseRemoteEnabled = blob.remoteEnabled;
export const schedulePurchaseSync = blob.scheduleSync;
export const ensurePurchaseHydrated = blob.ensureHydrated;
export const resetPurchasePersistenceCache = blob.resetCache;
