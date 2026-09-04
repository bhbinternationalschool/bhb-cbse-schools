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
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";

const META_KEY = "bhb_staff_attendance_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: StaffAttendanceState | null = null;

type DeskMeta = {
  updatedAt: string;
  registerCount: number;
  outdoorDutyCount: number;
};

const EMPTY_META: DeskMeta = {
  updatedAt: "",
  registerCount: 0,
  outdoorDutyCount: 0,
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return { ...EMPTY_META };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { ...EMPTY_META };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      registerCount: Number(p.registerCount) || 0,
      outdoorDutyCount: Number(p.outdoorDutyCount) || 0,
    };
  } catch {
    return { ...EMPTY_META };
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
        outdoorDuty: state.outdoorDuty ?? [],
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      count?: number;
      outdoorDutyCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        registerCount: body.count ?? state.registers.length,
        outdoorDutyCount:
          body.outdoorDutyCount ?? (state.outdoorDuty ?? []).length,
      });
    } else if (!res.ok) {
      console.warn(
        "[staff-attendance-db] desk push failed",
        body?.error || res.status,
      );
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("staff_attendance");
    else recordDeskSyncFailure("staff_attendance", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("staff_attendance", { status: 0, error: e instanceof Error ? e.message : String(e) });
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
      ancillary: body.ancillary ?? {
        settings: defaultAttendanceSettings(),
        outdoorDuty: [],
      },
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
      ancillary: { settings: defaultAttendanceSettings(), outdoorDuty: [] },
      changed: false,
      ok: false,
    };
  }

  const meta = readMeta();
  const remoteOutdoor = remote.ancillary.outdoorDuty?.length ?? 0;
  const shouldTake =
    preferDb ||
    staffAttendanceReadFromDbClientEnabled() ||
    meta.registerCount === 0 ||
    (remote.updatedAt && remote.updatedAt >= meta.updatedAt) ||
    remote.count > meta.registerCount ||
    // A day with no new register can still have someone check out for
    // outdoor duty on another device; the register counts alone would miss it.
    remoteOutdoor > meta.outdoorDutyCount;

  if (!shouldTake) {
    return { registers: [], ancillary: remote.ancillary, changed: false, ok: true };
  }

  writeMeta({
    updatedAt: remote.updatedAt,
    registerCount: remote.count,
    outdoorDutyCount: remoteOutdoor,
  });
  return {
    registers: remote.registers,
    ancillary: remote.ancillary,
    changed: true,
    ok: true,
  };
}
