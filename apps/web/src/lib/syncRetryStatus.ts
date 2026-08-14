/**
 * Generic background-push retry + status tracking. Framework-agnostic —
 * used by domainBlobPersistence.ts (shared by ~30 modules) and
 * attendanceNormalizedClient.ts's parallel desk push.
 *
 * Deliberately does not touch domainBlobPersistence.ts's existing
 * `writeMetaUpdatedAt` timing: that optimistic stamp is load-bearing for
 * ensureHydrated()'s local-vs-remote conflict resolution, not just a status
 * marker. Status tracked here is a separate, additive concern.
 */

export type SyncStatus = "idle" | "pending" | "retrying" | "failed";

export type SyncStatusState = {
  status: SyncStatus;
  error?: string;
  attempts: number;
};

type PushRunner = () => Promise<{ ok: boolean; error?: string }>;

type RetryEntry = {
  run: PushRunner;
  attempts: number;
  error?: string;
  exhausted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const RETRY_DELAYS_MS = [5000, 20000, 60000];

/** Pure — no timers, no state. Returns null once retries are exhausted. */
export function nextRetryDelayMs(attempt: number): number | null {
  if (attempt < 0 || attempt >= RETRY_DELAYS_MS.length) return null;
  return RETRY_DELAYS_MS[attempt];
}

const entries = new Map<string, RetryEntry>();
const idleState: SyncStatusState = { status: "idle", attempts: 0 };

function statusKey(key: string): string {
  return `bhb_sync_status_v1:${key}`;
}

function persistStatus(key: string, state: SyncStatusState) {
  if (typeof window === "undefined") return;
  try {
    if (state.status === "idle") {
      localStorage.removeItem(statusKey(key));
    } else {
      localStorage.setItem(statusKey(key), JSON.stringify(state));
    }
  } catch {
    // localStorage full/unavailable — status tracking degrades to in-memory only
  }
}

function emitStatus(key: string, state: SyncStatusState) {
  persistStatus(key, state);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ key: string; state: SyncStatusState }>("bhb:sync-status", {
      detail: { key, state },
    }),
  );
}

function clearTimer(entry: RetryEntry) {
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function attempt(key: string, entry: RetryEntry) {
  clearTimer(entry);
  entry.exhausted = false;
  emitStatus(key, {
    status: entry.attempts === 0 ? "pending" : "retrying",
    attempts: entry.attempts,
  });
  void entry.run().then((result) => {
    // A newer call for this key may have replaced this entry mid-flight.
    if (entries.get(key) !== entry) return;
    if (result.ok) {
      entries.delete(key);
      emitStatus(key, { status: "idle", attempts: 0 });
      return;
    }
    entry.error = result.error;
    const delay = nextRetryDelayMs(entry.attempts);
    entry.attempts += 1;
    if (delay === null) {
      entry.exhausted = true;
      emitStatus(key, {
        status: "failed",
        error: result.error,
        attempts: entry.attempts,
      });
      return;
    }
    emitStatus(key, {
      status: "retrying",
      error: result.error,
      attempts: entry.attempts,
    });
    entry.timer = setTimeout(() => attempt(key, entry), delay);
  });
}

/** Runs `run` immediately; retries on failure per the backoff ladder. */
export function scheduleRetryingPush(key: string, run: PushRunner): void {
  const existing = entries.get(key);
  if (existing) clearTimer(existing);
  const entry: RetryEntry = { run, attempts: 0, exhausted: false, timer: null };
  entries.set(key, entry);
  attempt(key, entry);
}

/** Cancels any pending backoff wait and retries immediately. No-op if idle. */
export function retryNow(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  attempt(key, entry);
}

export function getSyncStatus(key: string): SyncStatusState {
  const entry = entries.get(key);
  if (entry) {
    return {
      status: entry.exhausted
        ? "failed"
        : entry.attempts === 0
          ? "pending"
          : "retrying",
      error: entry.error,
      attempts: entry.attempts,
    };
  }
  if (typeof window === "undefined") return idleState;
  try {
    const raw = localStorage.getItem(statusKey(key));
    if (!raw) return idleState;
    return JSON.parse(raw) as SyncStatusState;
  } catch {
    return idleState;
  }
}

export function subscribeSyncStatus(
  key: string,
  cb: (state: SyncStatusState) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ key: string; state: SyncStatusState }>).detail;
    if (detail?.key === key) cb(detail.state);
  };
  window.addEventListener("bhb:sync-status", handler);
  return () => window.removeEventListener("bhb:sync-status", handler);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const [key, entry] of entries) {
      if (entry.attempts > 0) attempt(key, entry);
    }
  });
}
