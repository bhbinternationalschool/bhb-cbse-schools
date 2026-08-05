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
 * Remote wins on id collision; local-only rows kept.
 * Curriculum on local students is preserved (synced separately).
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

  const hhMap = new Map<string, Household>();
  if (!prefer) {
    for (const h of local.households) hhMap.set(h.id, h);
  }
  for (const h of remote.households) hhMap.set(h.id, h);

  const curriculumById = new Map(
    local.students.map((s) => [s.id, s.curriculum] as const),
  );
  const stuMap = new Map<string, SisStudent>();
  if (!prefer) {
    for (const s of local.students) stuMap.set(s.id, s);
  }
  for (const s of remote.students) {
    const prev = stuMap.get(s.id);
    stuMap.set(
      s.id,
      normalizeStudent({
        ...s,
        curriculum: prev?.curriculum ?? curriculumById.get(s.id) ?? null,
      }),
    );
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

/**
 * Pull roster once, merge into localStorage, then hydrate curriculum.
 */
export async function ensureSisHydrated(): Promise<boolean> {
  if (!sisRemoteEnabled()) return false;
  if (isDeskHydrated(MODULE)) return false;
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

  if (readFromDb && remoteEmpty) {
    if (next.students.length > 0 || next.households.length > 0) {
      const { emptySisState, writeSisLocalRaw } = await import("@/lib/sis");
      next = {
        ...emptySisState(),
        tags: next.tags ?? [],
        classUpgrades: next.classUpgrades ?? [],
      };
      writeSisLocalRaw(next);
      changed = true;
    }
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
        preferDb: readFromDb || next.students.length === 0,
      });
      changed = true;
    }
  }

  // DB-read mode: hydrate is pull-only — never push stale browser roster back.
  if (!readFromDb) {
    await pushSisState(next);
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
