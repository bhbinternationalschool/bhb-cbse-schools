import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  transportStateIsEmpty,
  loadTransport,
  writeTransportLocalRaw,
  type TransportState,
} from "@/lib/transport";

const blob = createDomainBlobPersistence<TransportState>({
  table: "transport_state",
  metaKey: "bhb_transport_v2_remote_meta",
  label: "transport",
  isEmpty: transportStateIsEmpty,
  loadLocal: loadTransport,
  writeLocalRaw: writeTransportLocalRaw,
});

export const scheduleTransportSync = blob.scheduleSync;
export const ensureTransportHydrated = blob.ensureHydrated;
export const resetTransportPersistenceCache = blob.resetCache;
