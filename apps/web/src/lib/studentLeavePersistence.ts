/**
 * Student leave remote sync — jsonb blob on student_leave_state + normalized desk.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadStudentLeave,
  studentLeaveStateIsEmpty,
  writeStudentLeaveLocalRaw,
  type StudentLeaveState,
} from "@/lib/studentLeave";
import {
  hydrateStudentLeaveDeskFromDb,
  scheduleStudentLeaveDeskSync,
} from "@/lib/studentLeaveNormalizedClient";
import { mergeDbDeskIntoStudentLeaveState } from "@/lib/studentLeaveNormalizedMerge";
import { studentLeaveReadFromDbEnabled } from "@/lib/studentLeaveDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "student_leave";

const blob = createDomainBlobPersistence<StudentLeaveState>({
  table: "student_leave_state",
  metaKey: "bhb_student_leave_v1_remote_meta",
  label: "student_leave",
  isEmpty: studentLeaveStateIsEmpty,
  loadLocal: loadStudentLeave,
  writeLocalRaw: writeStudentLeaveLocalRaw,
});

export const studentLeaveRemoteEnabled = blob.remoteEnabled;
export function resetStudentLeavePersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleStudentLeaveSync(state: StudentLeaveState) {
  if (typeof window === "undefined") {
    void pushStudentLeaveRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("student_leave")) {
    blob.scheduleSync(state);
  }
  scheduleStudentLeaveDeskSync(state);
}

export async function pushStudentLeaveRemoteServer(
  state: StudentLeaveState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushStudentLeaveDeskToDb } = await import(
    "@/lib/studentLeaveNormalized.server"
  );
  const desk = await pushStudentLeaveDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("student_leave")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<StudentLeaveState>("student_leave_state");
  const remoteCount = remote.state?.requests?.length ?? 0;
  const nextCount = state.requests?.length ?? 0;
  if (nextCount < remoteCount && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("student_leave_state", state);
}

/**
 * Pull student leave blob + normalized desk.
 * DB wins when NEXT_PUBLIC_STUDENT_LEAVE_READ_FROM_DB=true or local is empty.
 */
export async function ensureStudentLeaveHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = studentLeaveReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("student_leave")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed, ok } = await hydrateStudentLeaveDeskFromDb(readFromDb);
  if (!ok) {
    // Fetch failed — do not lock hydration flag; caller can retry later.
    return blobChanged;
  }
  markDeskHydrated(MODULE);
  if (changed && (bundle.requests.length > 0 || readFromDb)) {
    const merged = mergeDbDeskIntoStudentLeaveState(loadStudentLeave(), bundle, {
      preferDb: readFromDb,
    });
    writeStudentLeaveLocalRaw(merged);
    normChanged = true;
  }

  // Pull-only under desk-as-truth — hydrate must not re-push (audit 2026-08-18).

  if (normChanged && !readFromDb) {
    scheduleStudentLeaveSync(loadStudentLeave());
  }

  return blobChanged || normChanged;
}

/** Server-side hydrate from blob + normalized DB into student leave cache. */
export async function ensureStudentLeaveHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchStudentLeaveDeskFromDb } = await import(
    "@/lib/studentLeaveNormalized.server"
  );
  const { studentLeaveReadFromDbEnabled } = await import(
    "@/lib/studentLeaveDbConfig"
  );
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadStudentLeave();
  let changed = false;

  if (!deskSkipBlobPush("student_leave")) {
    const remoteBlob = await fetchServerBlob<StudentLeaveState>(
      "student_leave_state",
    );
    if (
      remoteBlob.state &&
      !studentLeaveReadFromDbEnabled() &&
      !studentLeaveStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchStudentLeaveDeskFromDb();
  if (dbDesk.bundle.requests.length > 0 || studentLeaveReadFromDbEnabled()) {
    state = mergeDbDeskIntoStudentLeaveState(state, dbDesk.bundle, {
      preferDb:
        studentLeaveReadFromDbEnabled() || (state.requests?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) {
    writeStudentLeaveLocalRaw(state);
  }

  return changed;
}
