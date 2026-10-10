/**
 * Self-test: module data never goes to browser storage (10 Oct 2026), and
 * the small things that do still survive a full browser.
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
import { clearMemoryCopies, isMemoryOnlyKey, isStorageQuotaError, readCache, writeCacheOrInvalidate } from "./browserStorage";

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

/* ── Module data is held in page memory, never written to disk ── */
// 10 Oct 2026: whole-module copies (students, fees, masters…) filled the
// ~5 MB browser limit at nearly every login, and an old copy outliving its
// page was pushed back over newer data. The server is the copy now.
{
  const store = install(10_000);
  for (const k of ["bhb_masters_v5", "bhb_sis_v1", "bhb_fees_v1", "bhb_transport_v2", "bhb_admissions_v1", "bhb_payroll_v1"]) {
    assert.equal(isMemoryOnlyKey(k), true, k);
    assert.equal(writeCacheOrInvalidate(k, big(500)), true, `${k} reported stored`);
    assert.equal(store.getItem(k), null, `${k} is not on disk`);
    assert.equal(readCache(k)?.length, 500, `${k} is readable for this page`);
  }
}

/* ── Even a completely full browser cannot stop a module loading ── */
{
  const store = install(100);
  store.setItem("bhb_x", big(90));
  assert.equal(writeCacheOrInvalidate("bhb_sis_v1", big(5_000_000)), true, "no quota involved at all");
  assert.equal(readCache("bhb_sis_v1")?.length, 5_000_000);
}

/* ── Markers, outboxes and named deletes are NOT module data — they stay on disk ── */
{
  for (const k of [
    "bhb_collections_wipe_seen_v1",
    "bhb_fee_discount_seed_applied_v1",
    "bhb_exams_pending_sheets_v1",
    "bhb_exams_sheet_conflicts_v1",
    "bhb_homework_diary_deletes_v1",
    "bhb_sis_pending_deletes_v1",
    "bhb_desk_named_deletes_v1:fees",
    "bhb_sis_filters_v1",
  ]) {
    assert.equal(isMemoryOnlyKey(k), false, k);
  }
  const store = install(10_000);
  writeCacheOrInvalidate("bhb_exams_pending_sheets_v1", "[1]");
  assert.equal(store.getItem("bhb_exams_pending_sheets_v1"), "[1]", "an outbox survives a reload");
}

/* ── A small key that cannot fit is held in memory for this page ── */
{
  const store = install(100);
  store.setItem("bhb_x", big(90));
  assert.equal(writeCacheOrInvalidate("bhb_sis_filters_v1", big(500)), false, "the caller is told it did not persist");
  assert.equal(store.getItem("bhb_sis_filters_v1"), null);
  assert.equal(readCache("bhb_sis_filters_v1")?.length, 500, "but this page still reads it");
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
    () => writeCacheOrInvalidate("bhb_sis_filters_v1", "x"),
    /SecurityError/,
    "only quota is handled here; anything else is a bug to surface",
  );
}

/* ── A fresh login forgets the previous session's module copies ── */
{
  (globalThis as Record<string, unknown>).window = {
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
  };
  writeCacheOrInvalidate("bhb_masters_v5", "{\"prev\":true}");
  assert.equal(readCache("bhb_masters_v5"), "{\"prev\":true}");
  clearMemoryCopies();
  assert.equal(readCache("bhb_masters_v5"), null, "the next user starts from the server, not the last user's copy");
}

console.log("  ✓ storage — module data in memory only; markers and outboxes kept on disk");
