/**
 * Staff attendance remote sync — jsonb blob + normalized staff_attendance_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadStaffAttendance,
  staffAttendanceStateIsEmpty,
  writeStaffAttendanceLocalRaw,
  type StaffAttendanceState,
} from "@/lib/staffAttendance";
import {
  hydrateStaffAttendanceDeskFromDb,
  scheduleStaffAttendanceDeskSync,
} from "@/lib/staffAttendanceNormalizedClient";
import { mergeDbDeskIntoStaffAttendanceState } from "@/lib/staffAttendanceNormalizedMerge";
import { staffAttendanceReadFromDbEnabled } from "@/lib/staffAttendanceDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "staff_attendance";

const blob = createDomainBlobPersistence<StaffAttendanceState>({
  table: "staff_attendance_state",
  metaKey: "bhb_staff_attendance_v1_remote_meta",
  label: "staffAttendance",
  isEmpty: staffAttendanceStateIsEmpty,
  loadLocal: loadStaffAttendance,
  writeLocalRaw: writeStaffAttendanceLocalRaw,
});

export const staffAttendanceRemoteEnabled = blob.remoteEnabled;
export function resetStaffAttendancePersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleStaffAttendanceSync(state: StaffAttendanceState) {
  if (typeof window === "undefined") {
    void pushStaffAttendanceRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("staff_attendance")) {
    blob.scheduleSync(state);
  }
  scheduleStaffAttendanceDeskSync(state);
}

export async function pushStaffAttendanceRemoteServer(
  state: StaffAttendanceState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushStaffAttendanceDeskToDb } = await import(
    "@/lib/staffAttendanceNormalized.server"
  );
  const desk = await pushStaffAttendanceDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("staff_attendance")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<StaffAttendanceState>(
    "staff_attendance_state",
  );
  const remoteRegisters = remote.state?.registers?.length ?? 0;
  const nextRegisters = state.registers?.length ?? 0;
  if (nextRegisters < remoteRegisters && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("staff_attendance_state", state);
}

export async function ensureStaffAttendanceHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = staffAttendanceReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("staff_attendance")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { registers, ancillary, changed, ok } =
    await hydrateStaffAttendanceDeskFromDb(readFromDb);
  if (!ok) {
    // Fetch failed — do not lock hydration flag; caller can retry later.
    return blobChanged;
  }
  markDeskHydrated(MODULE);
  if (changed && (registers.length > 0 || ancillary.settings || readFromDb)) {
    const merged = mergeDbDeskIntoStaffAttendanceState(
      loadStaffAttendance(),
      { registers, ancillary },
      { preferDb: readFromDb },
    );
    writeStaffAttendanceLocalRaw(merged);
    normChanged = true;
  }

  // Pull-only under desk-as-truth — hydrate must not re-push (audit 2026-08-18).

  if (normChanged && !readFromDb) {
    scheduleStaffAttendanceSync(loadStaffAttendance());
  }

  return blobChanged || normChanged;
}

/** Server-side hydrate from blob + normalized DB. */
export async function ensureStaffAttendanceHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchStaffAttendanceDeskFromDb } = await import(
    "@/lib/staffAttendanceNormalized.server"
  );
  const { staffAttendanceReadFromDbEnabled } = await import(
    "@/lib/staffAttendanceDbConfig"
  );
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadStaffAttendance();
  let changed = false;

  if (!deskSkipBlobPush("staff_attendance")) {
    const remoteBlob = await fetchServerBlob<StaffAttendanceState>(
      "staff_attendance_state",
    );
    if (remoteBlob.state && !staffAttendanceStateIsEmpty(remoteBlob.state)) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchStaffAttendanceDeskFromDb();
  if (
    dbDesk.ok &&
    (dbDesk.registers.length > 0 ||
      dbDesk.ancillary.settings ||
      staffAttendanceReadFromDbEnabled())
  ) {
    state = mergeDbDeskIntoStaffAttendanceState(
      state,
      { registers: dbDesk.registers, ancillary: dbDesk.ancillary },
      {
        preferDb:
          staffAttendanceReadFromDbEnabled() ||
          staffAttendanceStateIsEmpty(state),
      },
    );
    changed = true;
  }

  if (changed) {
    writeStaffAttendanceLocalRaw(state);
  }
  return changed;
}
