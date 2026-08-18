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
