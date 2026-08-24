/**
 * Client → server sync for SIS roster (sis_households / sis_students).
 */

import type { SisState } from "@/lib/sis";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import type { SisRemoteBundle } from "@/lib/sisNormalized.server";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

const META_KEY = "bhb_sis_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: Pick<SisState, "households" | "students"> | null = null;

type SisMeta = {
  updatedAt: string;
  studentCount: number;
  householdCount: number;
  lastPushedAt?: number;
};

function readMeta(): SisMeta {
  if (typeof window === "undefined") return { updatedAt: "", studentCount: 0, householdCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", studentCount: 0, householdCount: 0 };
    const p = JSON.parse(raw) as SisMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      studentCount: Number(p.studentCount) || 0,
      householdCount: Number(p.householdCount) || 0,
      lastPushedAt: p.lastPushedAt,
    };
  } catch {
    return { updatedAt: "", studentCount: 0, householdCount: 0 };
  }
}

function writeMeta(
  patch: Partial<SisMeta> & { updatedAt: string; studentCount: number; householdCount: number },
) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function sisNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function sisSyncRecentlyPushed(): boolean {
  const meta = readMeta();
  if (!meta.lastPushedAt) return false;
  return Date.now() - meta.lastPushedAt < 30_000;
}

export function sisReadFromDbClientEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_SIS_READ_FROM_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

/**
 * Ids the user explicitly removed, awaiting confirmation from the server.
 *
 * A removal used to exist only as an absence from the next roster push, and
 * since the push only upserts, the row was never deleted — the "removed"
 * student came back on the next hydrate. Deletions are now stated
 * explicitly, and they stay queued until the server confirms, so a failed
 * push cannot quietly drop them.
 */
const PENDING_DELETES_KEY = "bhb_sis_pending_deletes_v1";

export type SisMergeInstruction = { keepId: string; dropIds: string[] };

function loadPendingDeletes(): {
  studentIds: Set<string>;
  householdIds: Set<string>;
  merges: SisMergeInstruction[];
} {
  if (typeof window === "undefined") {
    return { studentIds: new Set(), householdIds: new Set(), merges: [] };
  }
  try {
    const raw = localStorage.getItem(PENDING_DELETES_KEY);
    if (!raw) return { studentIds: new Set(), householdIds: new Set(), merges: [] };
    const p = JSON.parse(raw) as {
      studentIds?: string[];
      householdIds?: string[];
      merges?: SisMergeInstruction[];
    };
    return {
      studentIds: new Set((p.studentIds ?? []).filter(Boolean)),
      householdIds: new Set((p.householdIds ?? []).filter(Boolean)),
      merges: (p.merges ?? []).filter((m) => m && m.keepId && Array.isArray(m.dropIds)),
    };
  } catch {
    return { studentIds: new Set(), householdIds: new Set(), merges: [] };
  }
}

// Persisted, not just in memory: a deletion whose push failed three times
// and was then followed by a reload / idle logout used to be forgotten, and
// the "removed" student came back on the next hydrate — the exact symptom
// this queue exists to prevent (audit 2026-08-18).
const pendingDeletes = loadPendingDeletes();

function persistPendingDeletes() {
  if (typeof window === "undefined") return;
  try {
    if (
      pendingDeletes.studentIds.size === 0 &&
      pendingDeletes.householdIds.size === 0 &&
      pendingDeletes.merges.length === 0
    ) {
      localStorage.removeItem(PENDING_DELETES_KEY);
    } else {
      localStorage.setItem(
        PENDING_DELETES_KEY,
        JSON.stringify({
          studentIds: [...pendingDeletes.studentIds],
          householdIds: [...pendingDeletes.householdIds],
          merges: pendingDeletes.merges,
        }),
      );
    }
  } catch {
    /* storage full — in-memory copy still carries them for this tab */
  }
}

export function recordSisDeletion(input: {
  studentIds?: string[];
  householdIds?: string[];
}): void {
  for (const id of input.studentIds ?? []) {
    if (id) pendingDeletes.studentIds.add(id);
  }
  for (const id of input.householdIds ?? []) {
    if (id) pendingDeletes.householdIds.add(id);
  }
  persistPendingDeletes();
}

/**
 * A duplicate merge: the server folds every record that points at a dropped
 * id (fee lines, attendance, exams, homework, PTM, leave, library, store,
 * payment links, concessions, curriculum, leads, chat, and the household if
 * it is left empty) into the kept student, then deletes the dropped rows —
 * one transaction (sis_merge_students). Queued and retried like deletions.
 */
export function recordSisMerge(input: SisMergeInstruction): void {
  const dropIds = [...new Set(input.dropIds.filter((id) => id && id !== input.keepId))];
  if (!input.keepId || dropIds.length === 0) return;
  pendingDeletes.merges.push({ keepId: input.keepId, dropIds });
  persistPendingDeletes();
}

/** Test seam — lets the selftest observe what would go on the wire. */
export function peekPendingSisDeletions(): {
  studentIds: string[];
  householdIds: string[];
  merges: SisMergeInstruction[];
} {
  return {
    studentIds: [...pendingDeletes.studentIds],
    householdIds: [...pendingDeletes.householdIds],
    merges: [...pendingDeletes.merges],
  };
}

// Monotonic push generation. A retry of an older payload must not land
// after a newer one and overwrite it; each attempt checks it is still the
// latest before sending.
let pushGeneration = 0;

export function scheduleSisDeskSync(state: Pick<SisState, "households" | "students">) {
  if (!sisNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pushGeneration += 1;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void flushSisDeskSync();
  }, DESK_PUSH_DEBOUNCE_MS);
}

export async function flushSisDeskSync(): Promise<void> {
  if (pushTimer) clearTimeout(pushTimer);
  const batch = pending;
  pending = null;
  pushTimer = null;
  if (!batch) return;
  await pushSisDeskApi(batch, 1, pushGeneration);
}

async function pushSisDeskApi(
  state: Pick<SisState, "households" | "students">,
  attempt = 1,
  generation = pushGeneration,
) {
  if (generation !== pushGeneration) return; // superseded by a newer save
  try {
    const res = await fetch("/api/school-data/sis-roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        households: state.households ?? [],
        students: state.students ?? [],
        // Stated deletions. Kept in the payload on retry and only cleared
        // once the server confirms — see below.
        deleteStudentIds: [...pendingDeletes.studentIds],
        deleteHouseholdIds: [...pendingDeletes.householdIds],
        merges: pendingDeletes.merges,
      }),
    });
    const sentMerges = pendingDeletes.merges.length;
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      studentCount?: number;
      householdCount?: number;
      conflicts?: { table: string; id: string }[];
      studentVersions?: Record<string, string>;
      householdVersions?: Record<string, string>;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      // The server accepted the batch, deletions included. Only now is it
      // safe to forget them; clearing before this point would lose the
      // deletion on any failed or retried push.
      pendingDeletes.studentIds.clear();
      pendingDeletes.householdIds.clear();
      pendingDeletes.merges.length = 0;
      persistPendingDeletes();

      // A merge moved fee lines / marks / etc. to the kept id on the server;
      // every module's browser copy still holds the dropped ids. Re-pull them
      // all now, so a save made in the meantime cannot push the old ids back.
      if (sentMerges > 0) {
        void Promise.all([
          import("@/lib/deskHydrateGuard"),
          import("@/lib/deskHydrationSchedule"),
        ]).then(([guard, sched]) => {
          guard.resetDeskHydrated();
          return sched.ensureAllDeskHydrated();
        });
      }

      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        studentCount: body.studentCount ?? state.students.length,
        householdCount: body.householdCount ?? state.households.length,
        lastPushedAt: Date.now(),
      });

      // Adopt the server's authoritative versions for what we just wrote.
      // Without this the next push of a record we just changed still
      // carries the pre-write token and conflicts with itself.
      const sv = body.studentVersions ?? {};
      const hv = body.householdVersions ?? {};
      if (Object.keys(sv).length > 0 || Object.keys(hv).length > 0) {
        const { loadSis, writeSisLocalRaw } = await import("@/lib/sis");
        const cur = loadSis();
        writeSisLocalRaw({
          ...cur,
          students: cur.students.map((s) =>
            sv[s.id] && sv[s.id] !== s.revisionAt
              ? { ...s, revisionAt: sv[s.id] }
              : s,
          ),
          households: cur.households.map((h) =>
            hv[h.id] && hv[h.id] !== h.revisionAt
              ? { ...h, revisionAt: hv[h.id] }
              : h,
          ),
        });
      }

      // Someone else saved these records after we read them. Their version
      // was kept rather than being overwritten by our stale copy — tell the
      // user plainly instead of letting the change vanish, and drop the
      // hydrate guard so the next read pulls the newer server state.
      const conflicts = body.conflicts ?? [];
      if (conflicts.length > 0 && typeof window !== "undefined") {
        const [{ pushToast }, { resetDeskHydrated }] = await Promise.all([
          import("@/components/shell/Toast"),
          import("@/lib/deskHydrateGuard"),
        ]);
        resetDeskHydrated("sis");
        pushToast({
          kind: "error",
          message:
            conflicts.length === 1
              ? "1 record was changed by someone else and was not overwritten. Reload to see their version before editing again."
              : `${conflicts.length} records were changed by someone else and were not overwritten. Reload to see the current versions before editing again.`,
          durationMs: 0,
        });
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("bhb-desk-synced", { detail: { module: "sis" } }),
        );
        recordDeskSyncSuccess("sis");
      }
    } else if (attempt < 3) {
      setTimeout(
        () => void pushSisDeskApi(state, attempt + 1, generation),
        1500 * attempt,
      );
    } else {
      const reason = body?.error || `HTTP ${res.status}`;
      console.warn("[sis-db] roster push failed after 3 attempts", reason);
      reportSisPushFailure(reason);
      recordDeskSyncFailure("sis", { status: res.status, error: reason });
    }
  } catch (e) {
    if (attempt < 3) {
      setTimeout(
        () => void pushSisDeskApi(state, attempt + 1, generation),
        1500 * attempt,
      );
    } else {
      console.warn("[sis-db] roster push error after 3 attempts", e);
      reportSisPushFailure(String(e));
      recordDeskSyncFailure("sis", {
        status: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/** A failed save must be visible, not a console line — see shell listener. */
function reportSisPushFailure(error: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("bhb-sync-error", {
      detail: { id: "sis", label: "student records", error },
    }),
  );
}

export async function fetchSisDeskFromApi(): Promise<{
  bundle: SisRemoteBundle;
  updatedAt: string;
  studentCount: number;
  householdCount: number;
} | null> {
  if (!sisNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/sis-roster", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      households?: SisState["households"];
      students?: SisState["students"];
      updatedAt?: string;
      studentCount?: number;
      householdCount?: number;
    };
    if (!Array.isArray(body.households) || !Array.isArray(body.students)) return null;
    return {
      bundle: {
        households: body.households,
        students: body.students,
        householdUpdatedAt: {},
        studentUpdatedAt: {},
      },
      updatedAt: body.updatedAt || "",
      studentCount: body.studentCount ?? body.students.length,
      householdCount: body.householdCount ?? body.households.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateSisDeskFromDb(preferDb?: boolean): Promise<{
  bundle: SisRemoteBundle;
  changed: boolean;
  ok: boolean;
}> {
  const remote = await fetchSisDeskFromApi();
  if (!remote) {
    return {
      bundle: {
        households: [],
        students: [],
        householdUpdatedAt: {},
        studentUpdatedAt: {},
      },
      changed: false,
      ok: false,
    };
  }

  const meta = readMeta();
  const hasRemoteStudents = remote.bundle.students.length > 0 || remote.bundle.households.length > 0;
  const shouldTake =
    preferDb ||
    sisReadFromDbClientEnabled() ||
    hasRemoteStudents ||
    meta.studentCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.studentCount > meta.studentCount;

  if (!shouldTake) {
    return { bundle: remote.bundle, changed: false, ok: true };
  }

  writeMeta({
    updatedAt: remote.updatedAt || new Date().toISOString(),
    studentCount: remote.studentCount,
    householdCount: remote.householdCount,
  });
  return { bundle: remote.bundle, changed: true, ok: true };
}
