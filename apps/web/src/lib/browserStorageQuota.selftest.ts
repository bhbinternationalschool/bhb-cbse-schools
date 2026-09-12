/**
 * Self-test: what happens to a desk cache when the browser's storage is full.
 * Run: npx tsx apps/web/src/lib/browserStorageQuota.selftest.ts
 *
 * The failure this exists to stop, seen in production on 12 Sep 2026:
 * only `bhb_masters_v5` could evict anything, so on a full origin the
 * transport desk hydrated 169 assignments from the database, failed to cache
 * them, read back nothing, showed zero routes and zero riders — and then
 * pushed that emptiness. The director's transport desk was blank for a day
 * because a cache could not find 300 KB.
 */

import assert from "node:assert/strict";

// Static: writeCacheOrInvalidate reads `window` when CALLED, not when the
// module loads, so installing a fake storage per test is enough.
import { isStorageQuotaError, writeCacheOrInvalidate } from "./browserStorage";

/** A localStorage with a byte ceiling, which is what a real one is. */
class FakeStorage {
  private map = new Map<string, string>();
  constructor(private capacity: number) {}
  get length() {
    return this.map.size;
  }
  private used(exceptKey?: string): number {
    let n = 0;
    for (const [k, v] of this.map) if (k !== exceptKey) n += k.length + v.length;
    return n;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.used(k) + k.length + v.length > this.capacity) {
      const err = new Error("QuotaExceededError: quota exceeded");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

function install(capacity: number): FakeStorage {
  const store = new FakeStorage(capacity);
  (globalThis as Record<string, unknown>).window = { localStorage: store };
  (globalThis as Record<string, unknown>).localStorage = store;
  return store;
}

const big = (n: number) => "x".repeat(n);

console.log("browserStorageQuota.selftest.ts");

/* ── The quota error is recognised in the shapes browsers throw ── */
{
  const dom = new Error("The quota has been exceeded.");
  dom.name = "QuotaExceededError";
  assert.equal(isStorageQuotaError(dom), true);
  assert.equal(isStorageQuotaError(new Error("network down")), false);
  assert.equal(isStorageQuotaError(null), false);
}

/* ── A desk that fits is simply written ── */
{
  install(10_000);
  assert.equal(writeCacheOrInvalidate("bhb_transport_v2", big(500)), true);
}

/* ── THE BUG: transport must be able to evict, not only masters ── */
{
  const store = install(3_000);
  // A big re-hydratable cache already owns the space.
  store.setItem("bhb_sis_v1", big(2_500));

  const ok = writeCacheOrInvalidate("bhb_transport_v2", big(1_000));
  assert.equal(ok, true, "transport must make room rather than drop itself");
  assert.equal(
    store.getItem("bhb_transport_v2")?.length,
    1_000,
    "and the desk it just hydrated is actually cached",
  );
  assert.equal(store.getItem("bhb_sis_v1"), null, "the bulky cache was evicted");
}

/* ── The fewest caches are lost: biggest victim first ── */
{
  const store = install(3_000);
  store.setItem("bhb_sis_v1", big(1_800));
  store.setItem("bhb_homework_v1", big(600));
  store.setItem("bhb_school_comms_v1", big(400));

  assert.equal(writeCacheOrInvalidate("bhb_transport_v2", big(1_500)), true);
  assert.equal(store.getItem("bhb_sis_v1"), null, "the biggest one goes first");
  assert.equal(
    store.getItem("bhb_homework_v1")?.length,
    600,
    "and the small ones that still fit are kept",
  );
  assert.equal(store.getItem("bhb_school_comms_v1")?.length, 400);
}

/* ── Masters is never the victim ── */
{
  const store = install(3_000);
  store.setItem("bhb_masters_v5", big(2_000));
  store.setItem("bhb_sis_v1", big(800));

  writeCacheOrInvalidate("bhb_transport_v2", big(700));
  assert.equal(
    store.getItem("bhb_masters_v5")?.length,
    2_000,
    "the cache the whole page resolves through is protected",
  );
  assert.equal(store.getItem("bhb_sis_v1"), null);
}

/* ── A key that is NOT a re-hydratable cache is never evicted ── */
{
  const store = install(2_000);
  // The marker whose loss replayed a one-time wipe signal and deleted nine
  // fee receipts on 2026-08-26. It must survive a storage squeeze.
  store.setItem("bhb_collections_wipe_seen_v1", big(50));
  store.setItem("bhb_fee_discount_seed_applied_v1", big(50));
  store.setItem("bhb_sis_v1", big(1_800));

  writeCacheOrInvalidate("bhb_transport_v2", big(1_000));
  assert.equal(
    store.getItem("bhb_collections_wipe_seen_v1")?.length,
    50,
    "a wipe-seen marker is not a cache and must never be evicted for room",
  );
  assert.equal(store.getItem("bhb_fee_discount_seed_applied_v1")?.length, 50);
}

/* ── Nothing left to give: the key is dropped, not left stale ── */
{
  const store = install(1_000);
  store.setItem("bhb_transport_v2", big(400));
  // Nothing evictable exists, and the new value cannot fit.
  const ok = writeCacheOrInvalidate("bhb_transport_v2", big(5_000));
  assert.equal(ok, false, "the caller is told it did not persist");
  assert.equal(
    store.getItem("bhb_transport_v2"),
    null,
    "a stale copy that can never be updated outranks fresh server data — drop it",
  );
}

/* ── Masters keeps its previous copy rather than being dropped ── */
{
  const store = install(1_000);
  store.setItem("bhb_masters_v5", big(400));
  const ok = writeCacheOrInvalidate("bhb_masters_v5", big(5_000));
  assert.equal(ok, false);
  assert.equal(
    store.getItem("bhb_masters_v5")?.length,
    400,
    "better a stale masters than none — everything resolves through it",
  );
}

/* ── A non-quota error is a real error and must not be swallowed ── */
{
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      setItem() {
        throw new Error("SecurityError: storage disabled");
      },
      getItem: () => null,
      removeItem() {},
    },
  };
  assert.throws(
    () => writeCacheOrInvalidate("bhb_transport_v2", "x"),
    /SecurityError/,
    "only quota is handled here; anything else is a bug to surface",
  );
}

console.log("  ✓ storage quota — every desk can make room, markers are never evicted");
