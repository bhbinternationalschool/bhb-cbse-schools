/**
 * Transport remote sync — jsonb blob on transport_state + normalized desk slices.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadTransport,
  transportStateIsEmpty,
  writeTransportLocalRaw,
  type TransportState,
} from "@/lib/transport";
import {
  hydrateTransportDeskFromDb,
  scheduleTransportDeskSync,
} from "@/lib/transportNormalizedClient";
import { mergeDbDeskIntoTransportState } from "@/lib/transportNormalizedMerge";
import { transportReadFromDbEnabled } from "@/lib/transportDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "transport";

const blob = createDomainBlobPersistence<TransportState>({
  table: "transport_state",
  metaKey: "bhb_transport_v2_remote_meta",
  label: "transport",
  isEmpty: transportStateIsEmpty,
  loadLocal: loadTransport,
  writeLocalRaw: writeTransportLocalRaw,
});

export const transportRemoteEnabled = blob.remoteEnabled;
export function resetTransportPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleTransportSync(state: TransportState) {
  if (typeof window === "undefined") {
    void pushTransportRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("transport")) blob.scheduleSync(state);
  scheduleTransportDeskSync(state);
}

export async function pushTransportRemoteServer(
  state: TransportState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushTransportDeskToDb } = await import(
    "@/lib/transportNormalized.server"
  );
  const desk = await pushTransportDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("transport")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<TransportState>("transport_state");
  const remoteRoutes = remote.state?.routes?.length ?? 0;
  const nextRoutes = state.routes?.length ?? 0;
  if (nextRoutes < remoteRoutes && remote.state) return { ok: true };

  return pushServerBlob("transport_state", state);
}

export async function ensureTransportHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const readFromDb = transportReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("transport")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydrateTransportDeskFromDb(readFromDb);
  if (
    changed &&
    (bundle.routes.length > 0 ||
      bundle.vehicles.length > 0 ||
      readFromDb)
  ) {
    writeTransportLocalRaw(
      mergeDbDeskIntoTransportState(loadTransport(), bundle, {
        preferDb: readFromDb,
      }),
    );
    normChanged = true;
  }

  if (normChanged) scheduleTransportSync(loadTransport());
  return blobChanged || normChanged;
}

export async function ensureTransportHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchTransportDeskFromDb } = await import(
    "@/lib/transportNormalized.server"
  );
  const { transportReadFromDbEnabled } = await import("@/lib/transportDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadTransport();
  let changed = false;

  if (!deskSkipBlobPush("transport")) {
    const remoteBlob = await fetchServerBlob<TransportState>("transport_state");
    if (
      remoteBlob.state &&
      !transportReadFromDbEnabled() &&
      !transportStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchTransportDeskFromDb();
  if (
    dbDesk.bundle.routes.length > 0 ||
    dbDesk.bundle.vehicles.length > 0 ||
    transportReadFromDbEnabled()
  ) {
    state = mergeDbDeskIntoTransportState(state, dbDesk.bundle, {
      preferDb:
        transportReadFromDbEnabled() || (state.routes?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeTransportLocalRaw(state);
  return changed;
}
