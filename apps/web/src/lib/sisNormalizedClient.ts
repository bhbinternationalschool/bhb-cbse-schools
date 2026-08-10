/**
 * Client → server sync for SIS roster (sis_households / sis_students).
 */

import type { SisState } from "@/lib/sis";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import type { SisRemoteBundle } from "@/lib/sisNormalized.server";

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
const pendingDeletes = {
  studentIds: new Set<string>(),
  householdIds: new Set<string>(),
};

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
}

/** Test seam — lets the selftest observe what would go on the wire. */
export function peekPendingSisDeletions(): {
  studentIds: string[];
  householdIds: string[];
} {
  return {
    studentIds: [...pendingDeletes.studentIds],
    householdIds: [...pendingDeletes.householdIds],
  };
}

export function scheduleSisDeskSync(state: Pick<SisState, "households" | "students">) {
  if (!sisNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
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
  await pushSisDeskApi(batch);
}

async function pushSisDeskApi(
  state: Pick<SisState, "households" | "students">,
  attempt = 1,
) {
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
      }),
    });
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
      }
    } else if (attempt < 3) {
      setTimeout(
        () => void pushSisDeskApi(state, attempt + 1),
        1500 * attempt,
      );
    } else {
      console.warn("[sis-db] roster push failed after 3 attempts", body?.error || res.status);
    }
  } catch (e) {
    if (attempt < 3) {
      setTimeout(
        () => void pushSisDeskApi(state, attempt + 1),
        1500 * attempt,
      );
    } else {
      console.warn("[sis-db] roster push error after 3 attempts", e);
    }
  }
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
