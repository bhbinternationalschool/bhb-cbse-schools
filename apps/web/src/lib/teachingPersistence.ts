/**
 * Teaching remote sync — jsonb blob on teaching_state.
 *
 * Blob-only for now (no normalized desk slice yet). The one deviation
 * from the other blob modules: hydration MERGES the remote copy into the
 * local one instead of replacing it, because every teacher writes to
 * this module concurrently from their own device. See
 * `mergeTeachingStates` for the rule.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadTeaching,
  mergeTeachingStates,
  teachingStateIsEmpty,
  writeTeachingLocalRaw,
  type TeachingState,
} from "@/lib/teaching";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "teaching";

const blob = createDomainBlobPersistence<TeachingState>({
  table: "teaching_state",
  metaKey: "bhb_teaching_v1_remote_meta",
  label: "teaching",
  isEmpty: teachingStateIsEmpty,
  loadLocal: loadTeaching,
  // Union, never replace — a straight overwrite here drops the logs of
  // whichever teacher happened to push first.
  writeLocalRaw: (incoming: TeachingState) => {
    writeTeachingLocalRaw(mergeTeachingStates(loadTeaching(), incoming));
  },
});

export const teachingRemoteEnabled = blob.remoteEnabled;

export function resetTeachingPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleTeachingSync(state: TeachingState) {
  if (typeof window === "undefined") {
    void pushTeachingRemoteServer(state);
    return;
  }
  blob.scheduleSync(state);
}

/**
 * Server-side push. Merges against whatever is already in the cloud so a
 * stale server-side copy cannot truncate the shared log set.
 */
export async function pushTeachingRemoteServer(
  state: TeachingState,
): Promise<{ ok: boolean; error?: string }> {
  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<TeachingState>("teaching_state");
  const next = remote.state
    ? mergeTeachingStates(remote.state, state)
    : state;
  return pushServerBlob("teaching_state", next);
}

/** Pull the teaching blob and merge it into the local working copy. */
export async function ensureTeachingHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  const changed = await blob.ensureHydrated();
  markDeskHydrated(MODULE);
  return changed;
}

/** Server-side hydrate from the blob into the teaching cache. */
export async function ensureTeachingHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;
  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<TeachingState>("teaching_state");
  if (!remote.state) return false;
  writeTeachingLocalRaw(mergeTeachingStates(loadTeaching(), remote.state));
  return true;
}
