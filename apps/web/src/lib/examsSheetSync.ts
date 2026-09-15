/**
 * Exam mark sheets reach the server ONE SHEET AT A TIME.
 *
 * Until 2026-09-15 a saved sheet travelled inside the whole-desk push: every
 * sheet this browser held, replacing every sheet on the server, with the
 * ones it did not hold deleted (and their marks cascade-deleted with them).
 * The desk hydrates once per mount, so a teacher's tab opened at 09:55 and
 * saved at 10:02 erased the sheet a colleague saved at 10:00. A push that
 * failed was logged to a console nobody had open, the screen had already
 * said "Marks saved", and the next hydrate replaced the unsent sheet with
 * the server's copy — the marks were simply gone.
 *
 * Now:
 *   - a sheet is pushed on its own, carrying the version it was edited from
 *     (`expectedUpdatedAt`), and the server refuses it if someone else saved
 *     in between (409) rather than overwriting them;
 *   - what has not reached the server yet is recorded here, so a hydrate
 *     keeps those sheets instead of discarding them, and they are retried;
 *   - a refusal is recorded on the exams desk's sync status, which the
 *     workspace shows as a banner, and a refused sheet is kept aside as a
 *     conflict copy so nothing typed is lost.
 *
 * Dependency-light on purpose: exams.ts imports this dynamically, so it must
 * not import anything that pulls the workspace in.
 */

import {
  loadExams,
  type ExamSubject,
  type MarkSheet,
  type SheetWriteIntent,
} from "@/lib/exams";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { scheduleRetryingPush } from "@/lib/syncRetryStatus";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const PENDING_KEY = "bhb_exams_pending_sheets_v1";
const CONFLICT_KEY = "bhb_exams_sheet_conflicts_v1";
export const EXAMS_SYNC_MODULE = "exams";

export type PendingSheetPush = {
  sheetId: string;
  /** `updatedAt` of the sheet as this browser last saw it from the server;
   * null when the sheet was created here. The FIRST value is kept across
   * re-saves: it is the version the server still holds until a push lands. */
  expectedUpdatedAt: string | null;
  /** Every intent since the last successful push, oldest first. */
  intents: SheetWriteIntent[];
  reason?: string;
  subjectsUsed?: ExamSubject[];
  queuedAt: string;
};

export type SheetConflict = {
  sheetId: string;
  /** The sheet exactly as this browser had it when the server refused it. */
  sheet: MarkSheet;
  error: string;
  status: number;
  at: string;
};

type PendingMap = Record<string, PendingSheetPush>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(key, JSON.stringify(value));
  } catch {
    /* bookkeeping only — never let it break the save */
  }
}

function readPending(): PendingMap {
  return readJson<PendingMap>(PENDING_KEY, {});
}

function writePending(map: PendingMap): void {
  writeJson(PENDING_KEY, map);
}

/** Ids of sheets this browser has saved that the server has not confirmed. */
export function pendingExamSheetIds(): Set<string> {
  return new Set(Object.keys(readPending()));
}

export function pendingExamSheetPushes(): PendingSheetPush[] {
  return Object.values(readPending()).sort((a, b) =>
    a.queuedAt.localeCompare(b.queuedAt),
  );
}

export function examSheetConflicts(): SheetConflict[] {
  return Object.values(readJson<Record<string, SheetConflict>>(CONFLICT_KEY, {}))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function clearExamSheetConflict(sheetId: string): void {
  const map = readJson<Record<string, SheetConflict>>(CONFLICT_KEY, {});
  delete map[sheetId];
  writeJson(CONFLICT_KEY, map);
}

function stashConflict(sheet: MarkSheet, status: number, error: string): void {
  const map = readJson<Record<string, SheetConflict>>(CONFLICT_KEY, {});
  map[sheet.id] = {
    sheetId: sheet.id,
    sheet,
    error,
    status,
    at: new Date().toISOString(),
  };
  writeJson(CONFLICT_KEY, map);
}

function retryKey(sheetId: string): string {
  return `exams-sheet:${sheetId}`;
}

/**
 * Record a sheet as needing to reach the server and start pushing it.
 *
 * Called from exams.ts right after the local write. Re-saving a sheet that
 * is still pending keeps the ORIGINAL expected version — the server has not
 * moved since — and appends the new intent, so "unlock, then correct two
 * marks" arrives as both and the server can apply them in order.
 */
export function scheduleExamSheetPush(
  sheetId: string,
  opts: {
    expectedUpdatedAt: string | null;
    intent: SheetWriteIntent;
    reason?: string;
    subjectsUsed?: ExamSubject[];
  },
): void {
  if (typeof window === "undefined") return;
  if (!isSupabaseConfigured()) return;
  const map = readPending();
  const prev = map[sheetId];
  const subjectsUsed = [
    ...(prev?.subjectsUsed ?? []),
    ...(opts.subjectsUsed ?? []),
  ];
  const seen = new Set<string>();
  map[sheetId] = {
    sheetId,
    expectedUpdatedAt: prev ? prev.expectedUpdatedAt : opts.expectedUpdatedAt,
    intents: [...(prev?.intents ?? []), opts.intent],
    reason: opts.reason ?? prev?.reason,
    subjectsUsed: subjectsUsed.filter((s) =>
      seen.has(s.id) ? false : (seen.add(s.id), true),
    ),
    queuedAt: prev?.queuedAt ?? new Date().toISOString(),
  };
  writePending(map);
  scheduleRetryingPush(retryKey(sheetId), () => pushOne(sheetId));
}

type PushOutcome = { ok: boolean; error?: string };

/**
 * Push what the desk holds NOW for this sheet (not a snapshot — a queue of
 * stale snapshots is worse than the current state, see deskSyncStatus.ts).
 *
 * Returns ok:false only for failures worth retrying (network, 5xx, expired
 * session). A refusal the server will repeat — someone else saved first
 * (409), the sheet is locked (423), this login may not write this section
 * (403), bad payload (400) — is recorded, the sheet is kept as a conflict
 * copy, and the entry is dropped so the retry ladder does not hammer it.
 */
async function pushOne(sheetId: string): Promise<PushOutcome> {
  const map = readPending();
  const pending = map[sheetId];
  if (!pending) return { ok: true };
  const sheet = loadExams().sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    // Deleted locally (its exam was removed) before it ever landed.
    delete map[sheetId];
    writePending(map);
    return { ok: true };
  }

  type ReplyBody = { ok?: boolean; error?: string; sheet?: { updatedAt?: string } };
  let status = 0;
  let body: ReplyBody | null;
  try {
    const res = await fetch("/api/school-data/exams-desk/sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheet,
        expectedUpdatedAt: pending.expectedUpdatedAt,
        intents: pending.intents,
        reason: pending.reason ?? "",
        subjectsUsed: pending.subjectsUsed ?? [],
      }),
    });
    status = res.status;
    body = (await res.json().catch(() => null)) as ReplyBody | null;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    recordDeskSyncFailure(EXAMS_SYNC_MODULE, { status: 0, error });
    return { ok: false, error };
  }

  if (status >= 200 && status < 300 && body?.ok) {
    const latest = readPending();
    // A save that arrived while this was in flight re-queued the sheet with
    // a newer intent; leave that entry for the next push.
    if (latest[sheetId] && latest[sheetId].queuedAt === pending.queuedAt) {
      delete latest[sheetId];
      writePending(latest);
    }
    recordDeskSyncSuccess(EXAMS_SYNC_MODULE);
    return { ok: true };
  }

  const error =
    body?.error || `The server rejected the save (HTTP ${status || 0})`;
  const final = status === 409 || status === 423 || status === 403 || status === 400;
  if (final) {
    stashConflict(sheet, status, error);
    const latest = readPending();
    delete latest[sheetId];
    writePending(latest);
    recordDeskSyncFailure(EXAMS_SYNC_MODULE, { status, error });
    return { ok: true };
  }
  recordDeskSyncFailure(EXAMS_SYNC_MODULE, { status, error });
  return { ok: false, error };
}

/**
 * Push every pending sheet now and say whether all of them landed. Used by
 * the desk's "Try saving again" and after each hydrate, so a sheet saved
 * offline goes up as soon as the server is back.
 */
export async function retryPendingExamSheets(): Promise<boolean> {
  const ids = [...pendingExamSheetIds()];
  if (ids.length === 0) return true;
  const results = await Promise.all(ids.map((id) => pushOne(id)));
  return results.every((r) => r.ok) && pendingExamSheetIds().size === 0;
}
