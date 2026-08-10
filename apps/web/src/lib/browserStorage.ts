/**
 * localStorage is a cache. It must never gate a database write.
 *
 * On 2026-08-10 the director's phone showed "Something failed and was not
 * reported properly: the quota has been exceeded. If you were saving, check
 * the change was kept." That message came from the unhandled-rejection catcher
 * in AppShell, and it was telling the exact truth: admissions edits were not
 * reaching the database.
 *
 * saveAdmissions() called writeAdmissionsLocalRaw() FIRST, and that did a bare
 * localStorage.setItem. Admissions is 2.37 MB of JSON at 919 leads; with SIS
 * (1.72 MB) and ~35 other module desks the origin sits past the ~5 MB mobile
 * cap — and several browsers count UTF-16, so 4.31 MB of text can charge
 * ~8.6 MB against quota. setItem threw, and because it ran first, the two
 * lines that follow it — the mirror sync and scheduleAdmissionsSync, the
 * actual DB write — never ran at all.
 *
 * So a full CACHE silently stopped the RECORD from being saved. That inverts
 * the rule this migration exists to establish: the database is the source of
 * truth and a write either reaches it or says so.
 */

/** True for the various ways browsers signal "storage is full". */
export function isStorageQuotaError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return (
      err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" || // Firefox
      err.code === 22 ||
      err.code === 1014
    );
  }
  // Safari private mode has historically thrown a plain Error here.
  return err instanceof Error && /quota/i.test(err.message);
}

/**
 * Update a cache entry, or drop it if it no longer fits.
 *
 * Returns false when the value could not be stored. Never throws for a full
 * disk — callers are caching, and a cache miss must not become a failed save.
 *
 * On quota failure the existing entry is REMOVED rather than left behind. A
 * stale copy that can no longer be updated is worse than no copy: hydration
 * compares local against remote, so a frozen-but-present cache can outrank
 * fresh server data indefinitely. That is precisely how the masters desk
 * froze earlier the same day. An absent cache simply re-reads from the
 * database, which is the intended behaviour anyway.
 */
export function writeCacheOrInvalidate(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isStorageQuotaError(err)) throw err;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing more to do; the caller still proceeds to the database.
    }
    console.warn(
      `[storage] ${key} (${Math.round(value.length / 1024)} KB) exceeds this ` +
        "browser's quota — cache dropped. The database write is unaffected.",
    );
    return false;
  }
}
