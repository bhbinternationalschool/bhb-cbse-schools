/**
 * Client → server sync for normalized staff attendance desk.
 */

import {
  defaultAttendanceSettings,
  type StaffAttendanceState,
} from "@/lib/staffAttendance";
import type { StaffAttendanceDeskAncillary } from "@/lib/staffAttendanceDeskAncillary.server";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_staff_attendance_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: StaffAttendanceState | null = null;

type DeskMeta = {
  updatedAt: string;
  registerCount: number;
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

export function staffAttendanceNormalizedSyncEnabled(): boolean {
  return isSupabaseConfigured();
}

export function staffAttendanceReadFromDbClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STAFF_ATTENDANCE_READ_FROM_DB === "true";
}

export function scheduleStaffAttendanceDeskSync(state: StaffAttendanceState) {
  if (!staffAttendanceNormalizedSyncEnabled()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushStaffAttendanceDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushStaffAttendanceDeskApi(state: StaffAttendanceState) {
  try {
    const res = await fetch("/api/school-data/staff-attendance-registers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registers: state.registers ?? [],
        settings: state.settings,
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
      });
    } else if (!res.ok) {
      console.warn(
        "[staff-attendance-db] desk push failed",
        body?.error || res.status,
      );
    }
  } catch (e) {
    console.warn("[staff-attendance-db] desk push error", e);
  }
}

export async function fetchStaffAttendanceDeskFromApi(): Promise<{
  registers: StaffAttendanceState["registers"];
  ancillary: StaffAttendanceDeskAncillary;
  updatedAt: string;
  count: number;
} | null> {
  if (!staffAttendanceNormalizedSyncEnabled()) return null;
  try {
    const res = await fetch("/api/school-data/staff-attendance-registers", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      registers?: StaffAttendanceState["registers"];
      ancillary?: StaffAttendanceDeskAncillary;
      updatedAt?: string;
      count?: number;
    };
    if (!Array.isArray(body.registers)) return null;
    return {
      registers: body.registers,
      ancillary: body.ancillary ?? { settings: defaultAttendanceSettings() },
      updatedAt: body.updatedAt || "",
      count: body.count ?? body.registers.length,
    };
  } catch {
    return null;
  }
}

export async function hydrateStaffAttendanceDeskFromDb(
  preferDb?: boolean,
): Promise<{
  registers: StaffAttendanceState["registers"];
  ancillary: StaffAttendanceDeskAncillary;
  changed: boolean;
  /** false = fetch failed/unauthenticated; caller must not treat result as confirmed-empty. */
  ok: boolean;
}> {
  const remote = await fetchStaffAttendanceDeskFromApi();
  if (!remote) {
    return {
      registers: [],
      ancillary: { settings: defaultAttendanceSettings() },
      changed: false,
      ok: false,
    };
  }

  const meta = readMeta();
  const shouldTake =
    preferDb ||
    staffAttendanceReadFromDbClientEnabled() ||
    meta.registerCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.count > meta.registerCount;

  if (!shouldTake) {
    return { registers: [], ancillary: remote.ancillary, changed: false, ok: true };
  }

  writeMeta({
    updatedAt: remote.updatedAt,
    registerCount: remote.count,
  });
  return {
    registers: remote.registers,
    ancillary: remote.ancillary,
    changed: true,
    ok: true,
  };
}
