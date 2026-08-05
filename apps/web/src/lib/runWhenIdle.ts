/** Yield to the browser so paint and input stay responsive during long work. */

export function yieldToMain(timeoutMs = 50): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  const sched = (
    window as Window & { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler;
  if (sched?.yield) return sched.yield();

  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function runWhenIdle(
  fn: () => void | Promise<void>,
  timeoutMs = 4_000,
): void {
  if (typeof window === "undefined") return;

  const run = () => {
    void fn();
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => run(), { timeout: timeoutMs });
  } else {
    setTimeout(run, 1);
  }
}
