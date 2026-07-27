/**
 * Payments remote sync — jsonb blob on payments_state.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadPayments,
  paymentsStateIsEmpty,
  writePaymentsLocalRaw,
  type PaymentsState,
} from "@/lib/payments";

const blob = createDomainBlobPersistence<PaymentsState>({
  table: "payments_state",
  metaKey: "bhb_payments_v1_remote_meta",
  label: "payments",
  isEmpty: paymentsStateIsEmpty,
  loadLocal: loadPayments,
  writeLocalRaw: writePaymentsLocalRaw,
});

export const paymentsRemoteEnabled = blob.remoteEnabled;
export const schedulePaymentsSync = blob.scheduleSync;
export const ensurePaymentsHydrated = blob.ensureHydrated;
export const resetPaymentsPersistenceCache = blob.resetCache;
