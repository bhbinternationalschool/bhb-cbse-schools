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
/**
 * Small, load-bearing caches: everything else on the page resolves through
 * them (class names, sections, fee heads). When storage is full, evict the
 * bulky roster/CRM caches — which re-hydrate from the DB on the next
 * navigation anyway — before giving up on one of these.
 */
const PROTECTED_KEYS = new Set(["bhb_masters_v5"]);

/**
 * Caches that may be dropped to make room, because every one of them
 * re-downloads from the database on the next read.
 *
 * An ALLOWLIST, never "the biggest bhb_* keys". Plenty of keys on this origin
 * are not caches at all — `bhb_collections_wipe_seen_v1` is the marker whose
 * loss replayed a one-time wipe signal and deleted nine fee receipts on
 * 2026-08-26 — so a size-ranked sweep would eventually take one of those.
 */
const EVICTABLE_BULK_KEYS = [
  "bhb_admissions_v1",
  "bhb_sis_v1",
  "bhb_homework_v1",
  "bhb_school_comms_v1",
  // Added 2026-09-13: the transport desk re-hydrates from
  // transport_desk_slices like the rest, and at 169 assignments it is worth
  // real space to whichever desk needs it next.
  "bhb_transport_v2",
];

/** Bytes this key currently occupies, 0 when absent or unreadable. */
function cacheSize(key: string): number {
  try {
    return window.localStorage.getItem(key)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Drop re-hydratable caches until `write` succeeds, biggest first.
 *
 * Biggest first so the fewest caches are lost, and one at a time with a retry
 * between, so freeing 2 MB does not also throw away three small desks that
 * would have fitted. Returns true when the write got through.
 */
function evictUntilItFits(exceptKey: string, write: () => void): boolean {
  const candidates = EVICTABLE_BULK_KEYS.filter(
    (k) => k !== exceptKey && !PROTECTED_KEYS.has(k) && cacheSize(k) > 0,
  ).sort((a, b) => cacheSize(b) - cacheSize(a));

  for (const victim of candidates) {
    try {
      window.localStorage.removeItem(victim);
    } catch {
      continue;
    }
    try {
      write();
      console.warn(
        `[storage] evicted ${victim} to make room; it re-hydrates from the database.`,
      );
      return true;
    } catch {
      // Still short. Keep going — the next one is the next biggest.
    }
  }
  return false;
}

export function writeCacheOrInvalidate(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isStorageQuotaError(err)) throw err;

    // EVERY key gets to make room, not just masters.
    //
    // Until 2026-09-13 only `bhb_masters_v5` could evict; every other desk
    // simply dropped itself. So on a full origin the transport desk could
    // never cache: it hydrated 169 assignments from the database, failed to
    // store them, read back an empty cache, showed zero routes and zero
    // riders — and then pushed that emptiness, which the server guard refused
    // eight times over. The director's desk sat empty for a day because a
    // cache could not find 300 KB.
    if (evictUntilItFits(key, () => window.localStorage.setItem(key, value))) {
      return true;
    }

    if (PROTECTED_KEYS.has(key)) {
      // Nothing left to give — keep the previous masters rather than dropping
      // the one cache the whole page resolves through.
      console.warn(`[storage] ${key} could not be written (quota); previous copy kept.`);
      return false;
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing more to do; the caller still proceeds to the database.
    }
    console.warn(
      `[storage] ${key} (${Math.round(value.length / 1024)} KB) exceeds this ` +
        "browser's quota — cache dropped. The database write is unaffected.",
    );
    noteQuotaDropOnce(key);
    return false;
  }
}

/**
 * Say it on screen, once per page, when a bulk cache is dropped for quota.
 * A silent drop is how "student register shows 0" stayed a mystery for a
 * day (2026-09-06): the console said it, nobody was looking there.
 */
let quotaNoticeShown = false;
function noteQuotaDropOnce(key: string) {
  if (quotaNoticeShown || typeof window === "undefined") return;
  quotaNoticeShown = true;
  void import("@/components/shell/Toast")
    .then(({ pushToast }) =>
      pushToast({
        kind: "info",
        message:
          "This browser's storage is full, so some records are held in memory " +
          `only (${key.replace(/^bhb_|_v\d+$/g, "")}). They reload from the server on the next open; nothing is lost.`,
        durationMs: 9000,
      }),
    )
    .catch(() => {});
}
