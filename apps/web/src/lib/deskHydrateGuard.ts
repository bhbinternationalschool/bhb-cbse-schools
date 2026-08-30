/**
 * Cache module desk hydration for 15s to keep navigation instant while
 * ensuring changes made by other users/devices are automatically refreshed.
 */

const hydrated = new Map<string, number>();
const DESK_HYDRATE_TTL_MS = 15_000;

export function isDeskHydrated(module: string): boolean {
  const last = hydrated.get(module);
  if (!last) return false;
  return Date.now() - last < DESK_HYDRATE_TTL_MS;
}

export function markDeskHydrated(module: string): void {
  hydrated.set(module, Date.now());
}

export function resetDeskHydrated(module?: string): void {
  if (module) hydrated.delete(module);
  else hydrated.clear();
  inFlight.clear();
}

/**
 * One hydration per module at a time, however many callers ask for it.
 *
 * `isDeskHydrated` is only true AFTER a hydration finishes, so every caller
 * arriving while one is still in flight passed the check and started its
 * own. On the fee counter — where the workspace, the app shell, the
 * notification bell and the comms strip all mount together — that meant the
 * same desk being fetched three and four times per page load.
 *
 * `withHydrationSlot` below caps how many run at once, but capping
 * duplicates only makes the queue longer: the extra copies still occupy
 * slots that the desks nobody has fetched yet are waiting for. Collapsing
 * them here is what actually shortens the queue.
 *
 * Callers share one promise, so they all see the same result at the same
 * time. The entry is cleared when it settles, so the 15s TTL still governs
 * when a genuinely fresh read happens.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function dedupeHydration<T>(
  module: string,
  fn: () => Promise<T>,
): Promise<T> {
  const running = inFlight.get(module) as Promise<T> | undefined;
  if (running) return running;
  const started = (async () => fn())().finally(() => {
    inFlight.delete(module);
  });
  inFlight.set(module, started);
  return started;
}

/**
 * Caps concurrent desk-hydration network calls across the whole tab.
 *
 * On mount, AppShell's route scheduler, NotificationBell, CommsRunningStrip,
 * and StaffInternalChatButton each independently kick off their own
 * ensure*Hydrated() the moment they render — up to ~15 modules' worth, all in
 * the same tick. Each one is a real read (and often a pending-write push)
 * against the same database, so a page load could fire that many concurrent
 * queries at once. Under load this produced genuine multi-second-to-30s+
 * stalls and occasional request failures, all in the same few-second window.
 *
 * Every ensure*Hydrated() entry point routes its actual network work through
 * this gate instead, so the fan-out is capped tab-wide regardless of which
 * component triggered it first.
 */
const MAX_CONCURRENT_HYDRATIONS = 4;
let activeHydrations = 0;
const hydrationQueue: Array<() => void> = [];

export async function withHydrationSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeHydrations >= MAX_CONCURRENT_HYDRATIONS) {
    await new Promise<void>((resolve) => hydrationQueue.push(resolve));
  }
  activeHydrations++;
  try {
    return await fn();
  } finally {
    activeHydrations--;
    const next = hydrationQueue.shift();
    if (next) next();
  }
}
