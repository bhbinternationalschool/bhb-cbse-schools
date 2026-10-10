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
import { trackServerWork } from "@/lib/serverWork";

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
    void trackServerWork(pushTeachingRemoteServer(state));
    return;
  }
  blob.scheduleSync(state);
}

/**
 * Server-side push. Merges against whatever is already in the cloud so a
 * stale server-side copy cannot truncate the shared log set.
 *
 * `dropLessonPlanIds`: the merge is a union with no tombstones, so a plan
 * removed from `state` would come straight back from the cloud copy. A
 * removal names its plan here and it is filtered out after the merge.
 */
export async function pushTeachingRemoteServer(
  state: TeachingState,
  opts?: { dropLessonPlanIds?: string[] },
): Promise<{ ok: boolean; error?: string }> {
  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<TeachingState>("teaching_state");
  let next = remote.state
    ? mergeTeachingStates(remote.state, state)
    : state;
  const drop = new Set(opts?.dropLessonPlanIds ?? []);
  if (drop.size > 0) {
    next = {
      ...next,
      lessonPlans: next.lessonPlans.filter((p) => !drop.has(p.id)),
      logs: next.logs.map((l) =>
        drop.has(l.lessonPlanId) ? { ...l, lessonPlanId: "" } : l,
      ),
    };
  }
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
