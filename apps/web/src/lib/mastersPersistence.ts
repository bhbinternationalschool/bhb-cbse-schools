/**
 * Masters desk hydrate/sync — foundation + fee setup (school_mirror masters slice).
 */

import {
  loadMasters,
  mastersMirrorIsEmpty,
  type MastersState,
} from "@/lib/masters";
import { setMirrorSlice } from "@/lib/schoolDataMirror";
import {
  hydrateMastersDeskFromDb,
  mastersDeskPushPending,
  scheduleMastersDeskSync,
} from "@/lib/mastersNormalizedClient";
import { mergeDbDeskIntoMastersState } from "@/lib/mastersNormalizedMerge";
import { mastersReadFromDbEnabled } from "@/lib/mastersDbConfig";
import { deskSkipMirrorBlobSliceClient } from "@/lib/deskCutover";
import { dedupeHydration, isDeskHydrated, markDeskHydrated, resetDeskHydrated } from "@/lib/deskHydrateGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
import { guardMastersOverwrite } from "@/lib/mastersWriteGuard";

const MODULE = "masters";

const STORAGE_KEY = "bhb_masters_v5";

/**
 * The same rule the server applies to a masters push (guardMastersOverwrite),
 * applied to the browser's own copy: a write that would leave the desk with
 * no classes, or with a class-id generation sharing nothing with what is
 * stored, keeps the stored classes/sections/subjects instead. On 2026-08-18
 * a browser at its storage quota lost its masters key, loadMasters() seeded
 * the empty shell, and every subsequent local write (staff hydrate, fee seed)
 * carried zero classes — the server refused the push ("would have removed
 * every class") but the browser kept the empty copy and showed every student
 * as "Unassigned" until the next hydrate, then lost it again.
 */
function protectLocalClasses(next: MastersState): MastersState {
  if (typeof window === "undefined") return next;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return next;
    const stored = JSON.parse(raw) as Partial<MastersState>;
    const storedIds = (stored.classes ?? []).map((c) => c.id);
    if (storedIds.length === 0) return next;
    const incomingIds = (next.classes ?? []).map((c) => c.id);
    const verdict = guardMastersOverwrite(storedIds, incomingIds);
    if (verdict.allow) return next;
    console.warn(`[masters] local write kept stored classes — ${verdict.message}`);
    return {
      ...next,
      classes: stored.classes ?? [],
      sections: stored.sections ?? next.sections,
      classSubjects: stored.classSubjects ?? next.classSubjects,
      subjects: stored.subjects ?? next.subjects,
    };
  } catch {
    return next;
  }
}

export function writeMastersLocalRaw(state: MastersState): void {
  if (typeof window === "undefined") {
    setMirrorSlice("masters", state);
    return;
  }
  const safe = protectLocalClasses(state);
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify({ ...safe, version: 2 }));
  setMirrorSlice("masters", safe);
}

export function scheduleMastersSync(state: MastersState) {
  if (typeof window === "undefined") {
    void pushMastersRemoteServer(state);
    return;
  }
  scheduleMastersDeskSync(state);
}

export async function pushMastersRemoteServer(
  state: MastersState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushMastersDeskToDb } = await import("@/lib/mastersNormalized.server");
  const desk = await pushMastersDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipMirrorBlobSlice } = await import("@/lib/deskCutover");
  if (deskSkipMirrorBlobSlice("masters")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const { stripStaffFromMastersForBlob } = await import("@/lib/staffPersistence");
  const remote = await fetchServerBlob<{ masters?: MastersState }>(
    "school_mirror_state",
  );
  const remoteClasses = remote.state?.masters?.classes?.length ?? 0;
  const nextClasses = state.classes?.length ?? 0;
  if (nextClasses < remoteClasses && remote.state?.masters) return { ok: true };

  const mirror = remote.state ?? {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    sis: null,
    fees: null,
    payments: null,
    masters: null,
    admissions: null,
  };
  return pushServerBlob("school_mirror_state", {
    ...mirror,
    masters: stripStaffFromMastersForBlob(state),
    updatedAt: new Date().toISOString(),
  });
}

export async function ensureMastersHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  // Same collapse as fees and sis: concurrent callers share one fetch.
  return dedupeHydration(MODULE, hydrateMastersOnce);
}

async function hydrateMastersOnce(): Promise<boolean> {

  const readFromDb = mastersReadFromDbEnabled();
  let mirrorChanged = false;

  if (!deskSkipMirrorBlobSliceClient("masters")) {
    const { fetchSchoolMirror } = await import("@/lib/schoolDataMirror");
    const { hydrateMastersFromMirror } = await import("@/lib/masters");
    const { readLocalMastersEditAt } = await import(
      "@/lib/mastersNormalizedClient"
    );
    const remote = await fetchSchoolMirror();
    if (remote?.masters) {
      const localAt = readLocalMastersEditAt();
      const remoteAt = remote.updatedAt || "";
      const remoteIsNewer = !localAt || (!!remoteAt && remoteAt > localAt);
      mirrorChanged = hydrateMastersFromMirror(
        remote.masters,
        remoteAt,
        remoteIsNewer,
      );
    }
  }

  let normChanged = false;
  const localBefore = loadMasters();
  const { bundle, changed, ok } = await hydrateMastersDeskFromDb(readFromDb);
  if (!ok) return false;

  markDeskHydrated(MODULE);
  if (
    changed &&
    (readFromDb ||
      bundle.classes.length > 0 ||
      bundle.feeHeads.length > 0 ||
      mastersMirrorIsEmpty(localBefore))
  ) {
    writeMastersLocalRaw(
      mergeDbDeskIntoMastersState(localBefore, bundle, {
        preferDb: readFromDb,
      }),
    );
    normChanged = true;
    // DB-read mode: hydrate is pull-only — edits sync via saveMasters().
    if (!readFromDb) {
      scheduleMastersSync(loadMasters());
    }
  } else if (readFromDb && mastersDeskPushPending()) {
    // Local edits never reached DB (tab closed, failed push) — push now.
    scheduleMastersSync(loadMasters());
  }
  return mirrorChanged || normChanged;
}

export function resetMastersPersistenceCache() {
  resetDeskHydrated(MODULE);
}
