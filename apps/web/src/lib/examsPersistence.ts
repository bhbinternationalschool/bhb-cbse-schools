/**
 * Exams remote sync — jsonb blob on exams_state + normalized exam_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  examsStateIsEmpty,
  loadExams,
  writeExamsLocalRaw,
  type ExamsState,
} from "@/lib/exams";
import {
  hydrateExamsDeskFromDb,
  scheduleExamsDeskSync,
} from "@/lib/examsNormalizedClient";
import { mergeDbDeskIntoExamsState } from "@/lib/examsNormalizedMerge";
import { examsReadFromDbEnabled } from "@/lib/examsDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "exams";

const blob = createDomainBlobPersistence<ExamsState>({
  table: "exams_state",
  metaKey: "bhb_exams_v1_remote_meta",
  label: "exams",
  isEmpty: examsStateIsEmpty,
  loadLocal: loadExams,
  writeLocalRaw: writeExamsLocalRaw,
});

export const examsRemoteEnabled = blob.remoteEnabled;
export function resetExamsPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleExamsSync(state: ExamsState) {
  if (typeof window === "undefined") {
    void pushExamsRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("exams")) {
    blob.scheduleSync(state);
  }
  scheduleExamsDeskSync(state);
}

export async function pushExamsRemoteServer(
  state: ExamsState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushExamDeskToDb } = await import("@/lib/examsNormalized.server");
  const desk = await pushExamDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("exams")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<ExamsState>("exams_state");
  const remoteSheets = remote.state?.sheets?.length ?? 0;
  const nextSheets = state.sheets?.length ?? 0;
  if (nextSheets < remoteSheets && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("exams_state", state);
}

/**
 * Pull exams blob + normalized desk (terms, sheets, promotions, policy).
 * DB wins when NEXT_PUBLIC_EXAMS_READ_FROM_DB=true or local sheets empty.
 */
export async function ensureExamsHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = examsReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("exams")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed, ok } = await hydrateExamsDeskFromDb(readFromDb);
  if (!ok) return false;

  markDeskHydrated(MODULE);
  const hasDesk =
    bundle.sheets.length > 0 ||
    bundle.promotions.length > 0 ||
    bundle.dateSheet.length > 0 ||
    bundle.terms.length > 0;
  if (changed && (hasDesk || readFromDb)) {
    const merged = mergeDbDeskIntoExamsState(loadExams(), bundle, {
      preferDb: readFromDb,
    });
    writeExamsLocalRaw(merged);
    normChanged = true;
  }

  if (normChanged) {
    scheduleExamsSync(loadExams());
  }

  return blobChanged || normChanged;
}

/** Server-side hydrate from blob + normalized DB into exams cache. */
export async function ensureExamsHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchExamDeskFromDb } = await import("@/lib/examsNormalized.server");
  const { examsReadFromDbEnabled } = await import("@/lib/examsDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadExams();
  let changed = false;

  if (!deskSkipBlobPush("exams")) {
    const remoteBlob = await fetchServerBlob<ExamsState>("exams_state");
    if (
      remoteBlob.state &&
      !examsReadFromDbEnabled() &&
      !examsStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchExamDeskFromDb();
  const hasDesk =
    dbDesk.bundle.sheets.length > 0 ||
    dbDesk.bundle.promotions.length > 0 ||
    dbDesk.bundle.dateSheet.length > 0 ||
    dbDesk.bundle.terms.length > 0 ||
    dbDesk.bundle.subjects.length > 0;

  if (hasDesk || examsReadFromDbEnabled()) {
    state = mergeDbDeskIntoExamsState(state, dbDesk.bundle, {
      preferDb:
        examsReadFromDbEnabled() || (state.sheets?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) {
    writeExamsLocalRaw(state);
  }

  return changed;
}
