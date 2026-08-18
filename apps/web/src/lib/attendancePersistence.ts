/**
 * Attendance remote sync — jsonb blob on attendance_state + normalized attendance_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  attendanceStateIsEmpty,
  loadAttendance,
  writeAttendanceLocalRaw,
  type AttendanceState,
} from "@/lib/attendance";
import {
  hydrateAttendanceDeskFromDb,
  scheduleAttendanceDeskSync,
} from "@/lib/attendanceNormalizedClient";
import { mergeDbDeskIntoAttendanceState } from "@/lib/attendanceNormalizedMerge";
import { attendanceReadFromDbEnabled } from "@/lib/attendanceDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "attendance";

const blob = createDomainBlobPersistence<AttendanceState>({
  table: "attendance_state",
  metaKey: "bhb_attendance_v1_remote_meta",
  label: "attendance",
  isEmpty: attendanceStateIsEmpty,
  loadLocal: loadAttendance,
  writeLocalRaw: writeAttendanceLocalRaw,
});

export const attendanceRemoteEnabled = blob.remoteEnabled;
export function resetAttendancePersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleAttendanceSync(state: AttendanceState) {
  if (typeof window === "undefined") {
    void pushAttendanceRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("attendance")) {
    blob.scheduleSync(state);
  }
  scheduleAttendanceDeskSync(state);
}

export async function pushAttendanceRemoteServer(
  state: AttendanceState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushAttendanceDeskToDb } = await import(
    "@/lib/attendanceNormalized.server"
  );
  const desk = await pushAttendanceDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("attendance")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<AttendanceState>("attendance_state");
  const remoteRegisters = remote.state?.registers?.length ?? 0;
  const nextRegisters = state.registers?.length ?? 0;
  if (nextRegisters < remoteRegisters && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("attendance_state", state);
}

/**
 * Pull attendance blob + normalized desk (registers + ancillary).
 * DB wins when NEXT_PUBLIC_ATTENDANCE_READ_FROM_DB=true or local is empty.
 */
export async function ensureAttendanceHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = attendanceReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("attendance")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { registers, ancillary, changed, ok } =
    await hydrateAttendanceDeskFromDb(readFromDb);
  if (!ok) return false;

  markDeskHydrated(MODULE);
  const hasAncillary =
    ancillary.absentNudges.length > 0 || ancillary.exceptions.length > 0;
  if (
    changed &&
    (registers.length > 0 || hasAncillary || readFromDb)
  ) {
    const merged = mergeDbDeskIntoAttendanceState(loadAttendance(), {
      registers,
      ancillary,
    }, { preferDb: readFromDb });
    writeAttendanceLocalRaw(merged);
    normChanged = true;
  }

  // Hydration is pull-only under desk-as-truth — see feesPersistence.ts for
  // the measured cost of pushing here (audit 2026-08-18). Legacy blob mode
  // still publishes the merge.
  if (normChanged && !readFromDb) {
    scheduleAttendanceSync(loadAttendance());
  }

  return blobChanged || normChanged;
}

/** Server-side hydrate from blob + normalized DB into attendance cache. */
export async function ensureAttendanceHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchAttendanceDeskFromDb } = await import(
    "@/lib/attendanceNormalized.server"
  );
  const { attendanceReadFromDbEnabled } = await import(
    "@/lib/attendanceDbConfig"
  );
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadAttendance();
  let changed = false;

  if (!deskSkipBlobPush("attendance")) {
    const remoteBlob = await fetchServerBlob<AttendanceState>("attendance_state");
    if (remoteBlob.state && !attendanceStateIsEmpty(remoteBlob.state)) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchAttendanceDeskFromDb();
  const hasAncillary =
    dbDesk.ancillary.absentNudges.length > 0 ||
    dbDesk.ancillary.exceptions.length > 0;
  if (
    dbDesk.registers.length > 0 ||
    hasAncillary ||
    attendanceReadFromDbEnabled()
  ) {
    state = mergeDbDeskIntoAttendanceState(
      state,
      { registers: dbDesk.registers, ancillary: dbDesk.ancillary },
      {
        preferDb:
          attendanceReadFromDbEnabled() || attendanceStateIsEmpty(state),
      },
    );
    changed = true;
  }

  if (changed) {
    writeAttendanceLocalRaw(state);
  }
  return changed;
}
