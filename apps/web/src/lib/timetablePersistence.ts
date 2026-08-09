/**
 * Timetable remote sync — jsonb blob on timetable_state + normalized desk slices.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadTimetable,
  timetableStateIsEmpty,
  writeTimetableLocalRaw,
  type TimetableState,
} from "@/lib/timetable";
import {
  hydrateTimetableDeskFromDb,
  scheduleTimetableDeskSync,
} from "@/lib/timetableNormalizedClient";
import { mergeDbDeskIntoTimetableState } from "@/lib/timetableNormalizedMerge";
import { timetableReadFromDbEnabled } from "@/lib/timetableDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "timetable";

const blob = createDomainBlobPersistence<TimetableState>({
  table: "timetable_state",
  metaKey: "bhb_timetable_v1_remote_meta",
  label: "timetable",
  isEmpty: timetableStateIsEmpty,
  loadLocal: loadTimetable,
  writeLocalRaw: writeTimetableLocalRaw,
});

export const timetableRemoteEnabled = blob.remoteEnabled;
export function resetTimetablePersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleTimetableSync(state: TimetableState) {
  if (typeof window === "undefined") {
    void pushTimetableRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("timetable")) blob.scheduleSync(state);
  scheduleTimetableDeskSync(state);
}

export async function pushTimetableRemoteServer(
  state: TimetableState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushTimetableDeskToDb } = await import(
    "@/lib/timetableNormalized.server"
  );
  const desk = await pushTimetableDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("timetable")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<TimetableState>("timetable_state");
  const remoteGrids = remote.state?.grids?.length ?? 0;
  const nextGrids = state.grids?.length ?? 0;
  if (nextGrids < remoteGrids && remote.state) return { ok: true };

  return pushServerBlob("timetable_state", state);
}

export async function ensureTimetableHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = timetableReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("timetable")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed, ok } = await hydrateTimetableDeskFromDb(readFromDb);
  if (!ok) {
    // Fetch failed — do not lock hydration flag; caller can retry later.
    return blobChanged;
  }
  markDeskHydrated(MODULE);
  if (
    changed &&
    (bundle.bellTemplate.length > 0 ||
      bundle.grids.length > 0 ||
      readFromDb)
  ) {
    writeTimetableLocalRaw(
      mergeDbDeskIntoTimetableState(loadTimetable(), bundle, {
        preferDb: readFromDb,
      }),
    );
    normChanged = true;
  }

  if (normChanged) scheduleTimetableSync(loadTimetable());
  return blobChanged || normChanged;
}

export async function ensureTimetableHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchTimetableDeskFromDb } = await import(
    "@/lib/timetableNormalized.server"
  );
  const { timetableReadFromDbEnabled } = await import("@/lib/timetableDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadTimetable();
  let changed = false;

  if (!deskSkipBlobPush("timetable")) {
    const remoteBlob = await fetchServerBlob<TimetableState>("timetable_state");
    if (
      remoteBlob.state &&
      !timetableReadFromDbEnabled() &&
      !timetableStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchTimetableDeskFromDb();
  if (
    dbDesk.bundle.bellTemplate.length > 0 ||
    dbDesk.bundle.grids.length > 0 ||
    timetableReadFromDbEnabled()
  ) {
    state = mergeDbDeskIntoTimetableState(state, dbDesk.bundle, {
      preferDb:
        timetableReadFromDbEnabled() || (state.grids?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeTimetableLocalRaw(state);
  return changed;
}
