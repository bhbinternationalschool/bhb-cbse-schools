/**
 * Whether the desk actually reached the server.
 *
 * Every desk module pushes its state with the same shape:
 *
 *     const res = await fetch(...);
 *     if (res.ok && body?.ok) { writeMeta(...) }
 *     catch (e) { console.warn("desk push error", e) }
 *
 * which loses a failure twice over. The `catch` only fires when the request
 * throws — a network drop — and writes to a console nobody has open. An HTTP
 * response that simply is not ok (403 from a role that cannot write, 502 from
 * a refused upstream) falls straight past the `if` and returns having done
 * nothing at all: no write, no log, no error. The desk saved locally, the UI
 * said "saved", and the server never heard about it.
 *
 * That is how the school's real bank details were entered on 2026-08-24 and
 * were still absent from production afterwards, with nothing anywhere saying
 * so.
 *
 * This records the outcome of each push per module so the answer to "did that
 * save?" exists somewhere other than a discarded promise. Deliberately it does
 * NOT queue payloads: a desk push carries the module's whole state, so a queue
 * would hold megabytes of stale snapshots, and replaying an old one is worse
 * than re-pushing the current one. Retry means "push what the desk holds now".
 *
 * Dependency-light on purpose — the sync clients import it, so anything it
 * imported back would close a cycle.
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const STORAGE_KEY = "bhb_desk_sync_status_v1";

export type DeskSyncState = {
  module: string;
  lastAttemptAt: string;
  lastSuccessAt: string;
  /** Empty when the last attempt succeeded. */
  lastError: string;
  /** HTTP status of the last failure, 0 for a thrown request. */
  lastStatus: number;
  consecutiveFailures: number;
};

type StatusMap = Record<string, DeskSyncState>;

function readAll(): StatusMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as StatusMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: StatusMap): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* status is a diagnostic; never let it break the caller */
  }
}

function current(module: string): DeskSyncState {
  return (
    readAll()[module] ?? {
      module,
      lastAttemptAt: "",
      lastSuccessAt: "",
      lastError: "",
      lastStatus: 0,
      consecutiveFailures: 0,
    }
  );
}

export function recordDeskSyncSuccess(module: string): void {
  const now = new Date().toISOString();
  const map = readAll();
  map[module] = {
    ...current(module),
    module,
    lastAttemptAt: now,
    lastSuccessAt: now,
    lastError: "",
    lastStatus: 200,
    consecutiveFailures: 0,
  };
  writeAll(map);
}

/**
 * Record a push that did not land, and say so out loud.
 *
 * The event is what lets a workspace surface this without every module
 * growing its own plumbing.
 */
export function recordDeskSyncFailure(
  module: string,
  detail: { status?: number; error?: string },
): DeskSyncState {
  const now = new Date().toISOString();
  const prev = current(module);
  const next: DeskSyncState = {
    ...prev,
    module,
    lastAttemptAt: now,
    lastError: detail.error || `The server rejected the save (HTTP ${detail.status ?? 0})`,
    lastStatus: detail.status ?? 0,
    consecutiveFailures: prev.consecutiveFailures + 1,
  };
  const map = readAll();
  map[module] = next;
  writeAll(map);

  console.error(
    `[desk-sync] ${module}: the save did not reach the server — ${next.lastError}`,
  );
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("bhb-desk-sync-failed", { detail: next }));
  }
  return next;
}

/**
 * Wrap one desk push so its outcome cannot be lost.
 *
 * Returns whether it landed, so a caller that wants to know can ask. The
 * common case ignores the result and relies on the recorded status, which is
 * the point — the information survives even when nobody is looking.
 */
export async function trackDeskPush(
  module: string,
  push: () => Promise<{ ok: boolean; status: number; error?: string }>,
): Promise<boolean> {
  try {
    const res = await push();
    if (res.ok) {
      recordDeskSyncSuccess(module);
      return true;
    }
    recordDeskSyncFailure(module, { status: res.status, error: res.error });
    return false;
  } catch (e) {
    recordDeskSyncFailure(module, {
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export function deskSyncState(module: string): DeskSyncState {
  return current(module);
}

/** Modules whose most recent push did not land. */
export function failingDeskSyncs(): DeskSyncState[] {
  return Object.values(readAll())
    .filter((s) => s.consecutiveFailures > 0)
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
}

export function clearDeskSyncStatus(module: string): void {
  const map = readAll();
  delete map[module];
  writeAll(map);
}

/** Plain-language reading of why a push was refused. */
export function explainDeskSyncFailure(state: DeskSyncState): string {
  if (state.lastStatus === 401 || state.lastStatus === 403) {
    return "Your role is not allowed to save this on the server, even though the screen let you edit it. The change is held in this browser only.";
  }
  if (state.lastStatus === 0) {
    return "The server could not be reached. The change is held in this browser and will be sent when it is.";
  }
  if (state.lastStatus >= 500) {
    return "The server failed while saving. The change is held in this browser only.";
  }
  return "The server rejected the save. The change is held in this browser only.";
}
