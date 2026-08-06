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
