/**
 * Share one in-flight or recent answer between callers that ask for the same
 * thing within a few seconds.
 *
 * A dashboard redraws each time a desk lands, and each redraw used to fetch
 * its server figures again — Fee Take asked for the dues summary and store
 * dues 7–9 times while loading (11 Oct 2026). Callers within `ttlMs` of the
 * first get the same promise. A promise that rejects, or resolves to null
 * (this codebase's "could not read"), is dropped at once so the next caller
 * tries again: an unreadable figure is never served from the cache.
 */
const entries = new Map<string, { at: number; value: Promise<unknown> }>();

export function shortCached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  entries.set(key, { at: now, value });
  const drop = () => {
    if (entries.get(key)?.value === value) entries.delete(key);
  };
  value.then((v) => {
    if (v == null) drop();
  }, drop);
  return value;
}

/** Selftests only. */
export function clearShortCache(): void {
  entries.clear();
}
