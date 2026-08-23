/**
 * Client → server sync for normalized attendance desk (registers + ancillary).
 */

import type { AttendanceState } from "@/lib/attendance";
import type { AttendanceDeskAncillary } from "@/lib/attendanceDeskAncillary.server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import { scheduleRetryingPush } from "@/lib/syncRetryStatus";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

const META_KEY = "bhb_attendance_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: AttendanceState | null = null;

type DeskMeta = {
  updatedAt: string;
  registerCount: number;
  ancillaryUpdatedAt?: string;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { updatedAt: "", registerCount: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", registerCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      registerCount: Number(p.registerCount) || 0,
      ancillaryUpdatedAt: p.ancillaryUpdatedAt,
    };
  } catch {
    return { updatedAt: "", registerCount: 0 };
  }
}

function writeMeta(patch: Partial<DeskMeta> & { updatedAt: string; registerCount: number }) {
  if (typeof window === "undefined") return;
  const prev = readMeta();
  localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...patch }));
}

export function attendanceNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function attendanceReadFromDbClientEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_ATTENDANCE_READ_FROM_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function scheduleAttendanceDeskSync(state: AttendanceState) {
  if (!attendanceNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    scheduleRetryingPush("attendanceDesk", () => pushAttendanceDeskApi(batch));
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushAttendanceDeskApi(
  state: AttendanceState,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/school-data/attendance-registers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registers: state.registers ?? [],
        policy: state.policy,
        absentNudges: state.absentNudges ?? [],
        exceptions: state.exceptions ?? [],
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      count?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        registerCount: body.count ?? state.registers.length,
        ancillaryUpdatedAt: body.updatedAt,
      });
      return { ok: true };
    }
    const error = body?.error || `HTTP ${res.status}`;
    console.warn("[attendance-db] desk push failed", error);
    return { ok: false, error };
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("attendance");
    else recordDeskSyncFailure("attendance", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("attendance", { status: 0, error: e instanceof Error ? e.message : String(e) });
    console.warn("[attendance-db] desk push error", e);
    return { ok: false, error: String(e) };
  }
}

export async function fetchAttendanceDeskFromApi(): Promise<{
  registers: AttendanceState["registers"];
  ancillary: AttendanceDeskAncillary;
  updatedAt: string;
  count: number;
} | null> {
  if (!attendanceNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/attendance-registers", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      registers?: AttendanceState["registers"];
      ancillary?: AttendanceDeskAncillary;
      updatedAt?: string;
      count?: number;
    };
    if (!Array.isArray(body.registers)) return null;
    return {
      registers: body.registers,
      ancillary: body.ancillary ?? {
        policy: {
          teacherCutoffTime: "10:30",
          lockTeachersAfterCutoff: true,
          absentNudgeEnabled: true,
          absentNudgeMaxOpen: 12,
        },
        absentNudges: [],
        exceptions: [],
      },
      updatedAt: body.updatedAt || "",
      count: body.count ?? body.registers.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateAttendanceDeskFromDb(
  preferDb?: boolean,
): Promise<{
  registers: AttendanceState["registers"];
  ancillary: AttendanceDeskAncillary;
  changed: boolean;
  ok: boolean;
}> {
  const remote = await fetchAttendanceDeskFromApi();
  if (!remote) {
    return {
      registers: [],
      ancillary: {
        policy: {
          teacherCutoffTime: "10:30",
          lockTeachersAfterCutoff: true,
          absentNudgeEnabled: true,
          absentNudgeMaxOpen: 12,
        },
        absentNudges: [],
        exceptions: [],
      },
      changed: false,
      ok: false,
    };
  }

  const meta = readMeta();
  const hasAncillary =
    remote.ancillary.absentNudges.length > 0 ||
    remote.ancillary.exceptions.length > 0;
  const shouldTake =
    preferDb ||
    attendanceReadFromDbClientEnabled() ||
    meta.registerCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.count > meta.registerCount ||
    hasAncillary;

  if (!shouldTake) {
    return { registers: [], ancillary: remote.ancillary, changed: false, ok: true };
  }

  writeMeta({
    updatedAt: remote.updatedAt,
    registerCount: remote.count,
    ancillaryUpdatedAt: remote.updatedAt,
  });
  return {
    registers: remote.registers,
    ancillary: remote.ancillary,
    changed: true,
    ok: true,
  };
}
