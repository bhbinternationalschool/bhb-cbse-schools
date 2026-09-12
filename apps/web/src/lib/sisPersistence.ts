/**
 * Full SIS remote sync — households + students.
 * localStorage remains the working copy; Supabase overlays when configured.
 * Curriculum continues via curriculumPersistence (not stored on sis_students).
 */

import {
  normalizeStudent,
  type ClassUpgradeRecord,
  type Household,
  type SisState,
  type SisStudent,
  type StudentTag,
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
import { dedupeHydration, isDeskHydrated, markDeskHydrated, resetDeskHydrated } from "@/lib/deskHydrateGuard";

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
    const merged = mergeTagsAndUpgrades(local, remote);
    return {
      ...local,
      version: 1,
      households,
      students: remapTagIds(students, local.tags ?? [], merged.tags),
      ...merged,
    };
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

  const merged = mergeTagsAndUpgrades(local, remote);
  return {
    ...local,
    version: 1,
    households: [...hhMap.values()],
    students: remapTagIds([...stuMap.values()], local.tags ?? [], merged.tags),
    ...merged,
  };
}

/**
 * Re-point a child's tags at the stored tag row with the same CODE.
 *
 * Until 2026-09-12 the tag list was seeded per browser with random ids, so two
 * machines held different ids for the same six default tags. Now that the
 * stored list wins, a child tagged on the machine that lost would be left
 * holding an id nothing can name — and `assignStudentTags` drops ids it cannot
 * name, so the next edit of that child would delete the tag silently. The code
 * is the natural key, so remap by it rather than discarding.
 *
 * An id already present in the stored list is left alone, which is why this is
 * safe to run over students that came from the database: their ids are the
 * stored ones.
 */
function remapTagIds(
  students: SisStudent[],
  localTags: StudentTag[],
  nextTags: StudentTag[],
): SisStudent[] {
  const codeByOldId = new Map(localTags.map((tag) => [tag.id, tag.code]));
  const idByCode = new Map(nextTags.map((tag) => [tag.code, tag.id]));
  const kept = new Set(nextTags.map((tag) => tag.id));

  const rename = new Map<string, string>();
  for (const [oldId, code] of codeByOldId) {
    if (kept.has(oldId)) continue;
    const replacement = idByCode.get(code);
    if (replacement) rename.set(oldId, replacement);
  }
  if (rename.size === 0) return students;

  return students.map((s) => {
    const ids = s.tagIds ?? [];
    if (!ids.some((id) => rename.has(id))) return s;
    return {
      ...s,
      tagIds: [...new Set(ids.map((id) => rename.get(id) ?? id))],
    };
  });
}

/**
 * Tag definitions and the move history, merged.
 *
 * Both got their own tables on 2026-09-12, having lived until then in the
 * localStorage of one machine. The first hydrate after that happens against
 * EMPTY tables, so a plain "the database is the truth" replace would erase the
 * only copy of the office's tags before they were ever pushed — the shape of
 * the 2026-08-21 transport wipe. Hence:
 *
 *  - tags: the stored list wins when there is one, otherwise keep what this
 *    browser holds (and the next save uploads it). A tag is retired with
 *    `isActive: false`, never deleted, so the stored list is always complete
 *    and replacing is safe once it exists.
 *  - classUpgrades: union by id, stored copy winning on collision. History is
 *    append-only and must never shrink: two browsers can each hold a move the
 *    other has not seen, and both are true.
 */
function mergeTagsAndUpgrades(
  local: SisState,
  remote: SisRemoteBundle,
): Pick<SisState, "tags" | "classUpgrades"> {
  const tags =
    (remote.tags ?? []).length > 0 ? remote.tags : (local.tags ?? []);

  const byId = new Map<string, ClassUpgradeRecord>();
  for (const u of local.classUpgrades ?? []) byId.set(u.id, u);
  for (const u of remote.classUpgrades ?? []) byId.set(u.id, u);
  const classUpgrades = [...byId.values()].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || ""),
  );

  return { tags, classUpgrades };
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
  // The roster is the biggest single payload the app pulls (~2.5 MB), so a
  // duplicate fetch of it costs more than any other desk's.
  return dedupeHydration(MODULE, hydrateSisOnce);
}

async function hydrateSisOnce(): Promise<boolean> {

  const { hydrateSisDeskFromDb, sisSyncRecentlyPushed } = await import(
    "@/lib/sisNormalizedClient"
  );

  const { loadSis, writeSisLocalRaw, emptySisState } =
    await import("@/lib/sis");
  let next = loadSis();
  let changed = false;

  // "We just pushed, so we hold the latest" is only true while we still HOLD
  // it. After a refresh the browser has no memory copy, and when the origin
  // is over its localStorage quota there is no cache copy either — so this
  // skip left the office looking at a register of 0 students until the
  // 30 s window passed and someone navigated again (2026-09-06). Skip only
  // when there is actually a roster in hand.
  if (
    typeof window !== "undefined" &&
    sisSyncRecentlyPushed() &&
    next.students.length > 0
  ) {
    markDeskHydrated(MODULE);
    return false;
  }

  const readFromDb = sisReadFromDbEnabled();
  const { bundle, changed: remoteChanged, ok } = await hydrateSisDeskFromDb(
    readFromDb,
  );

  if (!ok) {
    // Unauthenticated or fetch failed — do not lock hydration flag
    if (typeof window !== "undefined") {
      const { reportLoadFailure } = await import("@/components/shell/Toast");
      reportLoadFailure("student records");
    }
    return false;
  }

  const remoteEmpty =
    bundle.households.length === 0 && bundle.students.length === 0;

  if (readFromDb && remoteEmpty && (next.students.length > 0 || next.households.length > 0)) {
    // A school with a roster in hand does not learn from one answer that it
    // has no students. An empty bundle against a populated browser is a
    // failed or partial read wearing a 200 — the same shape the transport
    // desk wipe took on 2026-08-21 — so it is reported and the copy in hand
    // is kept. A genuinely emptied roster is an explicit, audited action
    // (wipeRemoteSisRoster), never inferred here. The hydration flag is left
    // unset so the next navigation asks again.
    if (typeof window !== "undefined") {
      const { reportLoadFailure } = await import("@/components/shell/Toast");
      reportLoadFailure("student records (server answered with none)");
    }
    return false;
  }

  markDeskHydrated(MODULE);
  if (readFromDb && remoteEmpty) {
    // Nothing locally and nothing remotely: leave the empty state as is.
  } else if (
    (remoteChanged || bundle.students.length > 0) &&
    (bundle.households.length > 0 || bundle.students.length > 0)
  ) {
    next = mergeSisRemoteIntoState(next, bundle, {
      preferDb: readFromDb,
    });
    changed = true;
  }

  // Hydration is pull-only. This used to call saveSis(next), which schedules
  // a full-roster push (and, via syncSisIntoMasters → saveMasters, a masters
  // and staff push) on every hydrate — 226 of 228 roster POSTs in one day were
  // within 90 s of a roster GET from the same browser, median 23.6 s each,
  // and sis_students changed for 3 rows in six days (audit 2026-08-18). That
  // echo is what was timing out every ordinary read. Local edits reach the
  // DB only through an explicit saveSis() from the UI.
  if (next.students.length > 0 && !readFromDb) {
    void pushSisState(next);
  }

  if (changed) {
    writeSisLocalRaw(next);
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
