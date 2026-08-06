/**
 * Full SIS remote sync — households + students.
 * localStorage remains the working copy; Supabase overlays when configured.
 * Curriculum continues via curriculumPersistence (not stored on sis_students).
 */

import {
  normalizeStudent,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { sisReadFromDbEnabled } from "@/lib/sisDbConfig";
import {
  fetchSisFromDb,
  pushSisToDb,
  wipeSisRosterInDb,
  type SisRemoteBundle,
} from "@/lib/sisNormalized.server";
import {
  hydrateSisDeskFromDb,
  scheduleSisDeskSync,
  sisNormalizedSyncEnabled,
} from "@/lib/sisNormalizedClient";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "sis";

export type { SisRemoteBundle };

export function sisRemoteEnabled() {
  return sisNormalizedSyncEnabled();
}

export function resetSisPersistenceCache() {
  resetDeskHydrated(MODULE);
}

/**
 * Merge remote roster into local SIS.
 *
 * When `preferDb` is true the DB is the source of truth: local state is
 * **replaced** by DB records (not unioned).  Curriculum stored on local
 * students is preserved because curriculum syncs via its own persistence.
 *
 * When `preferDb` is false, local wins on id collision and remote-only
 * rows are added (additive merge — used only for first-time bootstrap).
 */
export function mergeSisRemoteIntoState(
  local: SisState,
  remote: SisRemoteBundle,
  opts?: { preferDb?: boolean },
): SisState {
  const prefer =
    opts?.preferDb ??
    sisReadFromDbEnabled() ??
    false;

  const curriculumById = new Map(
    local.students.map((s) => [s.id, s.curriculum] as const),
  );

  if (prefer) {
    // ── Replace mode: DB is source of truth ──
    // Use ONLY the remote records.  Local-only rows that are NOT in the DB
    // are intentionally dropped — they were deleted via merge/cleanup.
    const households = remote.households.length > 0
      ? remote.households
      : local.households;
    const students = (remote.students.length > 0
      ? remote.students
      : local.students
    ).map((s) =>
      normalizeStudent({
        ...s,
        curriculum: curriculumById.get(s.id) ?? s.curriculum ?? null,
      }),
    );
    return { ...local, version: 1, households, students };
  }

  // ── Additive merge: local wins, remote fills gaps ──
  const hhMap = new Map<string, Household>();
  for (const h of local.households) hhMap.set(h.id, h);
  for (const h of remote.households) {
    if (!hhMap.has(h.id)) hhMap.set(h.id, h);
  }

  const stuMap = new Map<string, SisStudent>();
  for (const s of local.students) stuMap.set(s.id, s);
  for (const s of remote.students) {
    if (!stuMap.has(s.id)) {
      stuMap.set(
        s.id,
        normalizeStudent({
          ...s,
          curriculum: curriculumById.get(s.id) ?? null,
        }),
      );
    }
  }

  return {
    ...local,
    version: 1,
    households: [...hhMap.values()],
    students: [...stuMap.values()],
  };
}

export async function fetchSisRemote(): Promise<SisRemoteBundle | null> {
  const remote = await hydrateSisDeskFromDb();
  if (!remote.changed && remote.bundle.students.length === 0) {
    return null;
  }
  return remote.bundle;
}

/** Service-role pull for WhatsApp / server mirror (no browser session). */
export async function fetchSisRemoteServer(): Promise<SisRemoteBundle | null> {
  const { bundle } = await fetchSisFromDb();
  if (!bundle.households.length && !bundle.students.length) return null;
  return bundle;
}

export async function pushSisState(
  state: SisState,
): Promise<{ ok: boolean; error?: string }> {
  if (!sisRemoteEnabled()) return { ok: true };
  if (typeof window === "undefined") {
    const result = await pushSisToDb(state);
    return { ok: result.ok, error: result.error };
  }
  scheduleSisDeskSync(state);
  return { ok: true };
}

export async function wipeRemoteSisRoster(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!sisRemoteEnabled()) return { ok: true };
  const result = await wipeSisRosterInDb();
  resetSisPersistenceCache();
  return result;
}

export function scheduleSisSync(state: SisState) {
  if (!sisRemoteEnabled()) return;
  if (typeof window === "undefined") {
    void pushSisToDb(state);
    return;
  }
  scheduleSisDeskSync(state);
}

export async function flushSisSync() {
  if (!sisRemoteEnabled() || typeof window === "undefined") return;
  const { flushSisDeskSync } = await import("@/lib/sisNormalizedClient");
  await flushSisDeskSync();
}

/**
 * Pull roster once, merge into localStorage, then hydrate curriculum.
 */
export async function ensureSisHydrated(): Promise<boolean> {
  if (!sisRemoteEnabled()) return false;
  if (isDeskHydrated(MODULE)) return false;

  const {
    hydrateSisDeskFromDb,
    scheduleSisDeskSync,
    sisNormalizedSyncEnabled,
    sisSyncRecentlyPushed,
  } = await import("@/lib/sisNormalizedClient");

  if (typeof window !== "undefined" && sisSyncRecentlyPushed()) {
    markDeskHydrated(MODULE);
    return false;
  }

  markDeskHydrated(MODULE);

  const { loadSis, saveSis, writeSisLocalRaw, isLikelyDemoRoster } =
    await import("@/lib/sis");
  let next = loadSis();
  let changed = false;

  const readFromDb = sisReadFromDbEnabled();
  const { bundle, changed: remoteChanged } = await hydrateSisDeskFromDb(
    readFromDb,
  );
  const remoteEmpty =
    bundle.households.length === 0 && bundle.students.length === 0;

  if (remoteEmpty && (next.students.length > 0 || next.households.length > 0)) {
    // If remote DB is empty but browser has local uploaded students, push local students to DB!
    void pushSisState(next);
  } else if (
    remoteChanged &&
    (bundle.households.length > 0 || bundle.students.length > 0)
  ) {
    const remoteAsSis = {
      version: 1 as const,
      households: bundle.households,
      students: bundle.students,
      curriculumRequests: [] as [],
      tags: next.tags ?? [],
      classUpgrades: next.classUpgrades ?? [],
    };
    if (next.students.length === 0 && isLikelyDemoRoster(remoteAsSis)) {
      await wipeRemoteSisRoster();
    } else {
      next = mergeSisRemoteIntoState(next, bundle, {
        preferDb: readFromDb,
      });
      changed = true;
    }
  }

  // If we just replaced local state from the DB, we don't need to push it back
  // Push is only needed if there are local-only rows or we didn't prefer the DB
  if (next.students.length > 0 && !readFromDb) {
    void pushSisState(next);
  }

  if (changed) {
    writeSisLocalRaw(next);
    saveSis(next);
  }

  const { ensureCurriculumHydrated } = await import(
    "@/lib/curriculumPersistence"
  );
  await ensureCurriculumHydrated();

  const { applyFeeDiscountSeedNow } = await import(
    "@/lib/feeDiscountImportHydrate"
  );
  applyFeeDiscountSeedNow();

  return changed;
}

/** Server-side hydrate from normalized DB into school mirror SIS slice. */
export async function ensureSisHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { loadSis, writeSisLocalRaw } = await import("@/lib/sis");
  const { bundle } = await fetchSisFromDb();
  if (!bundle.households.length && !bundle.students.length) return false;

  const state = loadSis();
  const merged = mergeSisRemoteIntoState(state, bundle, {
    preferDb: sisReadFromDbEnabled() || state.students.length === 0,
  });
  writeSisLocalRaw(merged);
  return true;
}
