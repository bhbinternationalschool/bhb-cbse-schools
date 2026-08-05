/**
 * Payments remote sync — jsonb blob on payments_state + normalized payment_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadPayments,
  paymentsStateIsEmpty,
  writePaymentsLocalRaw,
  type PaymentsState,
} from "@/lib/payments";
import {
  hydratePaymentsDeskFromDb,
  schedulePaymentsDeskSync,
} from "@/lib/paymentsNormalizedClient";
import { mergeDbDeskIntoPaymentsState } from "@/lib/paymentsNormalizedMerge";
import { paymentsReadFromDbEnabled } from "@/lib/paymentsDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "payments";

const blob = createDomainBlobPersistence<PaymentsState>({
  table: "payments_state",
  metaKey: "bhb_payments_v1_remote_meta",
  label: "payments",
  isEmpty: paymentsStateIsEmpty,
  loadLocal: loadPayments,
  writeLocalRaw: writePaymentsLocalRaw,
});

export const paymentsRemoteEnabled = blob.remoteEnabled;
export function resetPaymentsPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function schedulePaymentsSync(state: PaymentsState) {
  if (typeof window === "undefined") {
    void pushPaymentsRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("payments")) {
    blob.scheduleSync(state);
  }
  schedulePaymentsDeskSync(state);
}

export async function pushPaymentsRemoteServer(
  state: PaymentsState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushPaymentDeskToDb } = await import("@/lib/paymentsNormalized.server");
  const desk = await pushPaymentDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("payments")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<PaymentsState>("payments_state");
  const remoteLinks = remote.state?.links?.length ?? 0;
  const nextLinks = state.links?.length ?? 0;
  if (nextLinks < remoteLinks && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("payments_state", state);
}

/**
 * Pull payments blob + normalized desk links.
 * DB wins when NEXT_PUBLIC_PAYMENTS_READ_FROM_DB=true or local is empty.
 */
export async function ensurePaymentsHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const readFromDb = paymentsReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("payments")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { links, changed } = await hydratePaymentsDeskFromDb(readFromDb);
  if (changed && (links.length > 0 || readFromDb)) {
    const merged = mergeDbDeskIntoPaymentsState(
      loadPayments(),
      { links },
      { preferDb: readFromDb },
    );
    writePaymentsLocalRaw(merged);
    normChanged = true;
  }

  if (normChanged) {
    schedulePaymentsSync(loadPayments());
  }

  return blobChanged || normChanged;
}

/** Server-side hydrate from blob + normalized DB into school mirror payments slice. */
export async function ensurePaymentsHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchPaymentDeskFromDb } = await import(
    "@/lib/paymentsNormalized.server"
  );
  const { paymentsReadFromDbEnabled } = await import("@/lib/paymentsDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  const { setMirrorSlice } = await import("@/lib/schoolDataMirror");

  let state = loadPayments();
  let changed = false;

  if (!deskSkipBlobPush("payments")) {
    const remoteBlob = await fetchServerBlob<PaymentsState>("payments_state");
    if (
      remoteBlob.state &&
      !paymentsReadFromDbEnabled() &&
      !paymentsStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchPaymentDeskFromDb();
  if (dbDesk.links.length > 0 || paymentsReadFromDbEnabled()) {
    state = mergeDbDeskIntoPaymentsState(state, dbDesk, {
      preferDb:
        paymentsReadFromDbEnabled() || (state.links?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) {
    writePaymentsLocalRaw(state);
    setMirrorSlice("payments", state);
  }

  return changed;
}
