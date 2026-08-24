/**
 * Client → server sync for normalized student leave desk.
 */

import type { StudentLeaveState } from "@/lib/studentLeave";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

const META_KEY = "bhb_student_leave_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: StudentLeaveState | null = null;

type DeskMeta = {
  updatedAt: string;
  requestCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", requestCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", requestCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      requestCount: Number(p.requestCount) || 0,
    };
  } catch {
    return { updatedAt: "", requestCount: 0 };
  }
}

function writeMeta(
  patch: Partial<DeskMeta> & { updatedAt: string; requestCount: number },
) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function studentLeaveNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function studentLeaveReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STUDENT_LEAVE_READ_FROM_DB === "true";
}

export function scheduleStudentLeaveDeskSync(state: StudentLeaveState) {
  if (!studentLeaveNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushStudentLeaveDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushStudentLeaveDeskApi(state: StudentLeaveState) {
  try {
    const res = await fetch("/api/school-data/student-leave-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: state.requests }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      requestCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        requestCount: body.requestCount ?? state.requests.length,
      });
    } else if (!res.ok) {
      console.warn("[student-leave-db] desk push failed", body?.error || res.status);
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("student_leave");
    else recordDeskSyncFailure("student_leave", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("student_leave", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[student-leave-db] desk push error", e);
  }
}

export async function fetchStudentLeaveDeskFromApi(): Promise<{
  bundle: Pick<StudentLeaveState, "requests">;
  updatedAt: string;
  requestCount: number;
} | null> {
  if (!studentLeaveNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/student-leave-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      requests?: StudentLeaveState["requests"];
      updatedAt?: string;
      requestCount?: number;
    };
    if (!Array.isArray(body.requests)) return null;
    return {
      bundle: { requests: body.requests },
      updatedAt: body.updatedAt || "",
      requestCount: body.requestCount ?? body.requests.length,
    };
  } catch {
    return null;
  }
}

type StudentLeaveDeskBundle = Pick<StudentLeaveState, "requests">;

export async function hydrateStudentLeaveDeskFromDb(
  preferDb?: boolean,
): Promise<{
  bundle: StudentLeaveDeskBundle;
  changed: boolean;
  /** false = fetch failed / not authenticated; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const remote = await fetchStudentLeaveDeskFromApi();
  const empty: StudentLeaveDeskBundle = { requests: [] };
  if (!remote) return { bundle: empty, changed: false, ok: false };

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    studentLeaveReadFromDbClientEnabled() ||
    meta.requestCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.requestCount > meta.requestCount;

  if (!shouldTake) return { bundle: empty, changed: false, ok: true };

  writeMeta({
    updatedAt: remote.updatedAt,
    requestCount: remote.requestCount,
  });

  return { bundle: remote.bundle, changed: true, ok: true };
}
