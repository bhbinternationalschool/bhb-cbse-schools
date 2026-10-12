/**
 * One refresh at a time, at most one per interval, however many events ask.
 *
 * data-layer 0.5e. The principal cockpit re-fetched /api/v1/principal/snapshot
 * (seven whole-desk hydrates on the server, ~5 s) on every
 * bhb-desk-hydrated / bhb-desk-synced / bhb-masters-updated event, on focus
 * and on visibilitychange — dozens per page load during the idle desk sweep,
 * several of them in flight at once.
 *
 * Pure (no React, injectable clock and timers) so the rule is testable.
 *  - A request while one is in flight runs ONE more after it ends (trailing),
 *    never a second in parallel.
 *  - A request inside the interval since the last start is deferred to the
 *    end of it; any number of requests in that window make one run.
 *  - `force` (a person pressing Retry) skips the interval, never the
 *    one-in-flight rule.
 */
export type CoalescedRefresh = {
  request(opts?: { force?: boolean }): void;
  dispose(): void;
};

type TimerHandle = unknown;

export function createCoalescedRefresh(opts: {
  run: () => Promise<unknown>;
  minIntervalMs: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (h: TimerHandle) => void;
}): CoalescedRefresh {
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let inFlight = false;
  let queued = false;
  let queuedForce = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let timer: TimerHandle | null = null;
  let disposed = false;

  function start() {
    if (disposed) return;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    inFlight = true;
    queued = false;
    queuedForce = false;
    lastStart = now();
    void Promise.resolve()
      .then(opts.run)
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (queued && !disposed) {
          const force = queuedForce;
          queued = false;
          queuedForce = false;
          request({ force });
        }
      });
  }

  function request(r?: { force?: boolean }) {
    if (disposed) return;
    const force = !!r?.force;
    if (inFlight) {
      queued = true;
      queuedForce = queuedForce || force;
      return;
    }
    const wait = force ? 0 : Math.max(0, lastStart + opts.minIntervalMs - now());
    if (wait === 0) {
      start();
      return;
    }
    if (timer === null) timer = setTimer(start, wait);
  }

  return {
    request,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
