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
} from "@/lib/mastersNormalizedClient";
import { mergeDbDeskIntoMastersState } from "@/lib/mastersNormalizedMerge";
import { mastersReadFromDbEnabled } from "@/lib/mastersDbConfig";
import { deskSkipMirrorBlobSliceClient } from "@/lib/deskCutover";
import { dedupeHydration, isDeskHydrated, markDeskHydrated, resetDeskHydrated } from "@/lib/deskHydrateGuard";
import { readCache, writeCacheOrInvalidate } from "@/lib/browserStorage";
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
    const raw = readCache(STORAGE_KEY);
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
    // Merge into the copy as it is NOW, not localBefore: the staff hydrate
    // runs in parallel and writes the roster while this fetch is out. Writing
    // localBefore back put staff to [] on every load where the roster landed
    // first — the Staff page showed 0 however often it was refreshed
    // (12 Oct 2026), and the staff desk, already marked loaded, never re-read.
    writeMastersLocalRaw(
      mergeDbDeskIntoMastersState(loadMasters(), bundle, {
        preferDb: readFromDb,
      }),
    );
    normChanged = true;
  }
  // (data-layer 2.2c: a read no longer re-sends "local edits that never
  // reached the DB" — that pushed the tab's whole copy from a READ, and the
  // masters-desk re-read after every element write would have sent a refused
  // fee save's stale book again. A failed save says so and is redone by hand.)
  const changedAnything = mirrorChanged || normChanged;
  // Tell the screens already painted from the old copy. Until now only
  // saveMasters() and the staff hydrate raised this, so a workspace that
  // mounted before this hydrate kept showing what localStorage held then.
  if (changedAnything && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bhb-masters-updated"));
  }
  return changedAnything;
}

export function resetMastersPersistenceCache() {
  resetDeskHydrated(MODULE);
}
