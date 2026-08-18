/**
 * Homework remote sync — jsonb blob on homework_state + normalized homework_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  homeworkStateIsEmpty,
  loadHomework,
  writeHomeworkLocalRaw,
  type HomeworkState,
} from "@/lib/homework";
import {
  hydrateHomeworkDeskFromDb,
  scheduleHomeworkDeskSync,
} from "@/lib/homeworkNormalizedClient";
import { mergeDbDeskIntoHomeworkState } from "@/lib/homeworkNormalizedMerge";
import { homeworkReadFromDbEnabled } from "@/lib/homeworkDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "homework";

const blob = createDomainBlobPersistence<HomeworkState>({
  table: "homework_state",
  metaKey: "bhb_homework_v1_remote_meta",
  label: "homework",
  isEmpty: homeworkStateIsEmpty,
  loadLocal: loadHomework,
  writeLocalRaw: writeHomeworkLocalRaw,
});

export const homeworkRemoteEnabled = blob.remoteEnabled;
export function resetHomeworkPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleHomeworkSync(state: HomeworkState) {
  if (typeof window === "undefined") {
    void pushHomeworkRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("homework")) {
    blob.scheduleSync(state);
  }
  scheduleHomeworkDeskSync(state);
}

export async function pushHomeworkRemoteServer(
  state: HomeworkState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushHomeworkDeskToDb } = await import("@/lib/homeworkNormalized.server");
  const desk = await pushHomeworkDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("homework")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<HomeworkState>("homework_state");
  const remotePosts = remote.state?.posts?.length ?? 0;
  const nextPosts = state.posts?.length ?? 0;
  if (nextPosts < remotePosts && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("homework_state", state);
}

/**
 * Pull homework blob + normalized desk.
 * DB wins when NEXT_PUBLIC_HOMEWORK_READ_FROM_DB=true or local is empty.
 */
export async function ensureHomeworkHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = homeworkReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("homework")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed, ok } = await hydrateHomeworkDeskFromDb(readFromDb);
  if (!ok) return false;

  markDeskHydrated(MODULE);
  const hasDesk =
    bundle.posts.length > 0 ||
    bundle.diary.length > 0 ||
    bundle.submissions.length > 0;
  if (changed && (hasDesk || readFromDb)) {
    const merged = mergeDbDeskIntoHomeworkState(loadHomework(), bundle, {
      preferDb: readFromDb,
    });
    writeHomeworkLocalRaw(merged);
    normChanged = true;
  }

  // Pull-only under desk-as-truth — hydrate must not re-push (audit 2026-08-18).

  if (normChanged && !readFromDb) {
    scheduleHomeworkSync(loadHomework());
  }

  return blobChanged || normChanged;
}

/** Server-side hydrate from blob + normalized DB into homework cache. */
export async function ensureHomeworkHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchHomeworkDeskFromDb } = await import(
    "@/lib/homeworkNormalized.server"
  );
  const { homeworkReadFromDbEnabled } = await import("@/lib/homeworkDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadHomework();
  let changed = false;

  if (!deskSkipBlobPush("homework")) {
    const remoteBlob = await fetchServerBlob<HomeworkState>("homework_state");
    if (
      remoteBlob.state &&
      !homeworkReadFromDbEnabled() &&
      !homeworkStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchHomeworkDeskFromDb();
  const hasDesk =
    dbDesk.bundle.posts.length > 0 ||
    dbDesk.bundle.diary.length > 0 ||
    dbDesk.bundle.submissions.length > 0;

  if (hasDesk || homeworkReadFromDbEnabled()) {
    state = mergeDbDeskIntoHomeworkState(state, dbDesk.bundle, {
      preferDb:
        homeworkReadFromDbEnabled() || (state.posts?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) {
    writeHomeworkLocalRaw(state);
  }

  return changed;
}
