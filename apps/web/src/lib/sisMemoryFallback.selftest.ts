/**
 * A cache that cannot be written must not read as "no students".
 *
 * 2026-08-10, the director's phone, after the admissions quota fix: the SIS
 * screen showed 0 students. The database held 711 and the server was sending
 * them — `GET /api/school-data/sis-roster` returned 200 with 2,457,504 bytes,
 * repeatedly. Nothing was missing and no id was mismatched.
 *
 * SIS is 2.46 MB. With admissions and ~35 other module desks the origin sits
 * past the ~5 MB mobile cap. `saveSis` caught QuotaExceededError, but
 * `writeSisLocalRaw` — the function the HYDRATE path calls — did not. So the
 * cache write threw, hydration aborted, and `loadSis()` (which reads from
 * localStorage) found nothing and returned an empty roster.
 *
 * Fixing the throw alone would not have been enough: the module round-trips
 * its state through localStorage, so a dropped cache still renders an empty
 * screen. The record has to live in memory, with the cache as a best-effort
 * copy for the next page load.
 *
 * Note this got WORSE as things got better. Guarding admissions freed enough
 * quota for admissions to load, which left SIS to be the write that failed.
 * A storage budget shared by 37 modules moves its failure around rather than
 * removing it — which is why the cure is not caching megabytes in a browser
 * at all (Stage 6), not guarding one more setItem.
 *
 * Run: npx tsx src/lib/sisMemoryFallback.selftest.ts
 */
import assert from "node:assert/strict";

type State = { students: { id: string }[] };

/** A store whose quota is already spent. */
function fullStore() {
  const map = new Map<string, string>();
  return {
    map,
    setItem(_k: string, _v: string) {
      const e = new Error("the quota has been exceeded");
      e.name = "QuotaExceededError";
      throw e;
    },
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
  };
}

/** sis.ts as it is now: memory is the record, cache is best effort. */
function makeSis(store: ReturnType<typeof fullStore>) {
  let memory: State | null = null;
  return {
    write(state: State) {
      memory = state; // unconditional, and BEFORE the cache attempt
      try {
        store.setItem("bhb_sis_v1", JSON.stringify(state));
      } catch (err) {
        if (!(err instanceof Error) || !/quota/i.test(err.message)) throw err;
        store.removeItem("bhb_sis_v1");
      }
    },
    load(): State {
      const raw = store.getItem("bhb_sis_v1");
      if (!raw && memory) return memory;
      return raw ? (JSON.parse(raw) as State) : { students: [] };
    },
  };
}

// ── The production failure ────────────────────────────────────────────────
{
  const store = fullStore();
  const sis = makeSis(store);
  const fromServer: State = {
    students: Array.from({ length: 711 }, (_, i) => ({ id: `stu_${i}` })),
  };

  sis.write(fromServer); // hydrate: the cache write fails

  assert.equal(
    sis.load().students.length,
    711,
    "all 711 students must still be readable after a failed cache write — " +
      "this is the exact case that showed 0 on the phone",
  );
}

// ── Hydration must not throw ──────────────────────────────────────────────
// writeSisLocalRaw threw, which aborted the hydrate before anything was
// applied. Nothing downstream ran.
{
  const sis = makeSis(fullStore());
  assert.doesNotThrow(
    () => sis.write({ students: [{ id: "stu_1" }] }),
    "a full cache must never abort hydration",
  );
}

// ── An empty roster is still representable ────────────────────────────────
// A school genuinely between imports has no students, and that must not be
// papered over by a stale memory copy.
{
  const store = fullStore();
  const sis = makeSis(store);
  sis.write({ students: [] });
  assert.equal(sis.load().students.length, 0, "empty stays empty when asserted");
}

// ── A working cache is still preferred ────────────────────────────────────
// Memory is per-page-load; the cache is what survives a reload.
{
  const map = new Map<string, string>();
  const working = {
    map,
    setItem: (k: string, v: string) => void map.set(k, v),
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
  };
  const sis = makeSis(working as unknown as ReturnType<typeof fullStore>);
  sis.write({ students: [{ id: "stu_1" }, { id: "stu_2" }] });
  assert.ok(map.has("bhb_sis_v1"), "a cache that works is still written");
  assert.equal(sis.load().students.length, 2);
}

console.log("sisMemoryFallback.selftest: all assertions passed");
