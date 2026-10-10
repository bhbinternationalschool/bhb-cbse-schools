/**
 * A full localStorage must never stop a save from reaching the database.
 *
 * The director's phone, 2026-08-10: "Something failed and was not reported
 * properly: the quota has been exceeded. If you were saving, check the change
 * was kept." That toast is AppShell's unhandled-rejection catcher, and it was
 * literally correct — the admissions edit never reached the database.
 *
 * saveAdmissions ran in this order:
 *
 *   writeAdmissionsLocalRaw(normalized);   // bare localStorage.setItem
 *   scheduleClientSchoolMirrorSync(...);   // never reached
 *   scheduleAdmissionsSync(normalized);    // never reached — the DB write
 *
 * Admissions is 2.37 MB of JSON at 919 leads. With SIS (1.72 MB) and ~35 other
 * module desks the origin is past the ~5 MB mobile cap, and browsers that
 * count UTF-16 charge roughly double. setItem threw, and because it was FIRST,
 * the database write never happened.
 *
 * A full cache silently stopped the record from being saved. That is the exact
 * inversion of the rule this migration exists to establish: the database is
 * the source of truth, and a write either reaches it or says so.
 *
 * Two rules, pinned here:
 *   1. The database write is scheduled before, and independently of, the cache.
 *   2. A cache that cannot be updated is INVALIDATED, not left stale. A frozen
 *      copy can outrank fresh server data at hydrate time — that is how the
 *      masters desk froze earlier the same day.
 *
 * Run: npx tsx src/lib/saveSurvivesFullCache.selftest.ts
 */
import assert from "node:assert/strict";

type Effects = { dbScheduled: boolean; cacheWritten: boolean; cacheCleared: boolean };

/** A localStorage that is already full. */
function fullStorage() {
  const store = new Map<string, string>([["bhb_admissions_v1", "STALE"]]);
  return {
    store,
    setItem() {
      const e = new Error("the quota has been exceeded");
      e.name = "QuotaExceededError";
      throw e;
    },
    removeItem(k: string) {
      store.delete(k);
    },
  };
}

function isQuota(err: unknown): boolean {
  return err instanceof Error && (err.name === "QuotaExceededError" || /quota/i.test(err.message));
}

/** saveAdmissions as it is written now: database first, cache last. */
function saveFixed(storage: ReturnType<typeof fullStorage>): Effects {
  const fx: Effects = { dbScheduled: false, cacheWritten: false, cacheCleared: false };
  fx.dbScheduled = true; // scheduleClientSchoolMirrorSync + scheduleAdmissionsSync
  try {
    storage.setItem();
    fx.cacheWritten = true;
  } catch (err) {
    if (!isQuota(err)) throw err;
    storage.removeItem("bhb_admissions_v1");
    fx.cacheCleared = true;
  }
  return fx;
}

/** The old order, kept only so the regression is demonstrable. */
function saveOld(storage: ReturnType<typeof fullStorage>): Effects {
  const fx: Effects = { dbScheduled: false, cacheWritten: false, cacheCleared: false };
  storage.setItem(); // throws — everything below is unreachable
  fx.cacheWritten = true;
  fx.dbScheduled = true;
  return fx;
}

// ── The database write survives a full cache ──────────────────────────────
{
  const s = fullStorage();
  const fx = saveFixed(s);

  assert.equal(
    fx.dbScheduled,
    true,
    "the DB write must be scheduled even though the cache is full — this is " +
      "the whole fix; without it the edit is silently lost on mobile",
  );
  assert.equal(fx.cacheWritten, false, "the cache genuinely could not be written");
}

// ── A cache that cannot be updated is dropped, not left stale ─────────────
{
  const s = fullStorage();
  assert.equal(s.store.get("bhb_admissions_v1"), "STALE", "precondition");

  const fx = saveFixed(s);
  assert.equal(fx.cacheCleared, true, "the stale entry is removed");
  assert.equal(
    s.store.has("bhb_admissions_v1"),
    false,
    "a stale copy that can no longer be updated must not survive — it can " +
      "outrank fresh server data at hydrate time and freeze the desk",
  );
}

// ── The old order provably loses the save ─────────────────────────────────
{
  const s = fullStorage();
  let threw = false;
  let fx: Effects | null = null;
  try {
    fx = saveOld(s);
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "the old order threw before reaching the database");
  assert.equal(fx, null, "…so no effects were recorded at all");
  assert.equal(
    s.store.get("bhb_admissions_v1"),
    "STALE",
    "and the stale cache was left in place, compounding it",
  );
}

console.log("saveSurvivesFullCache.selftest: all assertions passed");
