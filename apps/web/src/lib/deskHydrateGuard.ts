/**
 * Skip repeat blob/desk hydrate calls per module in the same browser tab.
 */

const hydrated = new Set<string>();

export function isDeskHydrated(module: string): boolean {
  return hydrated.has(module);
}

export function markDeskHydrated(module: string): void {
  hydrated.add(module);
}

export function resetDeskHydrated(module?: string): void {
  if (module) hydrated.delete(module);
  else hydrated.clear();
}
