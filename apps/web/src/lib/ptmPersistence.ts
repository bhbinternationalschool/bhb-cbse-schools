/**
 * PTM remote sync — jsonb blob on ptm_state + normalized ptm_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadPtm,
  ptmStateIsEmpty,
  writePtmLocalRaw,
  type PtmState,
} from "@/lib/ptm";
import {
  hydratePtmDeskFromDb,
  schedulePtmDeskSync,
} from "@/lib/ptmNormalizedClient";
import { mergeDbDeskIntoPtmState } from "@/lib/ptmNormalizedMerge";
import { ptmReadFromDbEnabled } from "@/lib/ptmDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";

const blob = createDomainBlobPersistence<PtmState>({
  table: "ptm_state",
  metaKey: "bhb_ptm_v1_remote_meta",
  label: "ptm",
  isEmpty: ptmStateIsEmpty,
  loadLocal: loadPtm,
  writeLocalRaw: writePtmLocalRaw,
});

export const ptmRemoteEnabled = blob.remoteEnabled;
export const resetPtmPersistenceCache = blob.resetCache;

export function schedulePtmSync(state: PtmState) {
  if (typeof window === "undefined") {
    void pushPtmRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("ptm")) {
    blob.scheduleSync(state);
  }
  schedulePtmDeskSync(state);
}

export async function pushPtmRemoteServer(
  state: PtmState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushPtmDeskToDb } = await import("@/lib/ptmNormalized.server");
  const desk = await pushPtmDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("ptm")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<PtmState>("ptm_state");
  const remoteEvents = remote.state?.events?.length ?? 0;
  const nextEvents = state.events?.length ?? 0;
  if (nextEvents < remoteEvents && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("ptm_state", state);
}

/**
 * Pull PTM blob + normalized desk.
 * DB wins when NEXT_PUBLIC_PTM_READ_FROM_DB=true or local is empty.
 */
export async function ensurePtmHydrated(): Promise<boolean> {
  const readFromDb = ptmReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("ptm")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydratePtmDeskFromDb(readFromDb);
  const hasDesk =
    bundle.events.length > 0 ||
    bundle.slots.length > 0 ||
    bundle.bookings.length > 0;
  if (changed && (hasDesk || readFromDb)) {
    const merged = mergeDbDeskIntoPtmState(loadPtm(), bundle, {
      preferDb: readFromDb,
    });
    writePtmLocalRaw(merged);
    normChanged = true;
  }

  if (normChanged) {
    schedulePtmSync(loadPtm());
  }

  return blobChanged || normChanged;
}

/** Server-side hydrate from blob + normalized DB into PTM cache. */
export async function ensurePtmHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchPtmDeskFromDb } = await import("@/lib/ptmNormalized.server");
  const { ptmReadFromDbEnabled } = await import("@/lib/ptmDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadPtm();
  let changed = false;

  if (!deskSkipBlobPush("ptm")) {
    const remoteBlob = await fetchServerBlob<PtmState>("ptm_state");
    if (
      remoteBlob.state &&
      !ptmReadFromDbEnabled() &&
      !ptmStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchPtmDeskFromDb();
  const hasDesk =
    dbDesk.bundle.events.length > 0 ||
    dbDesk.bundle.slots.length > 0 ||
    dbDesk.bundle.bookings.length > 0;

  if (hasDesk || ptmReadFromDbEnabled()) {
    state = mergeDbDeskIntoPtmState(state, dbDesk.bundle, {
      preferDb: ptmReadFromDbEnabled() || (state.events?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) {
    writePtmLocalRaw(state);
  }

  return changed;
}
