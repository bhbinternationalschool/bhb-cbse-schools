/**
 * Run: npx tsx src/lib/data/server/referenceCache.selftest.ts
 *
 * data-layer 1.3. Every branch of referenceCache (lib/data/server/referenceCache.ts),
 * driven with a fake versions source and a fake build — no database:
 *   cold = one build, shared by concurrent readers; same versions = no build,
 *   however long; another desk moving = no build; its own desk moving = exactly
 *   one build; a failed rebuild = the previous value, stale, retried next read;
 *   no previous = ok:false, never stored; a fallback = served stale, never
 *   stored; a throwing build = a failed one; versions unknown = one build per
 *   snapshot; invalidate = the next read rebuilds and an older build is not
 *   stored; a build started under an older key is not joined by a newer read.
 *
 * data-layer 1.4: `builtFrom` — the deskKeys' versions a value was built under
 * (what a reference view sends the browser) — on a rebuild and a cache hit,
 * the values read BEFORE the build; null for a previous copy, a fallback, and
 * a build made while the versions were unknown.
 */
import assert from "node:assert/strict";
import { installServerOnlyStub } from "../../fakePostgrest.testkit";
import type { VersionsSnapshot, ErpVersions } from "./versions";

installServerOnlyStub();

const quiet = { log: console.log, error: console.error };
const logs: string[] = [];
console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));

type Fake = {
  snap: VersionsSnapshot;
  set(v: ErpVersions): void;
  fail(): void;
  calls: number;
  source: () => Promise<VersionsSnapshot>;
};

function fakeVersions(initial: ErpVersions): Fake {
  let seq = 0;
  const f: Fake = {
    snap: { ok: true, versions: initial, at: "t0", seq: ++seq },
    set(v) {
      f.snap = { ok: true, versions: v, at: `t${seq}`, seq: ++seq };
    },
    fail() {
      f.snap = { ok: false, error: "rpc down", seq: ++seq };
    },
    calls: 0,
    source: async () => {
      f.calls++;
      return f.snap;
    },
  };
  return f;
}

const v = (updated_at: string, count: number | null = 1) => ({ updated_at, count });

void (async () => {
  try {
    const { referenceCache } = await import("./referenceCache");

    // ── Cold: one build; five concurrent readers share it.
    {
      const fv = fakeVersions({ masters: v("a"), sis_staff: v("s1", 35), fee: v("f1") });
      let builds = 0;
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      const c = referenceCache("t-cold", ["masters", "sis_staff"], async () => {
        builds++;
        await gate;
        return { ok: true, value: { n: builds } };
      }, { versions: fv.source, forgetVersions: () => {} });
      const many = Array.from({ length: 5 }, () => c.read());
      await new Promise((r) => setTimeout(r, 10));
      release();
      const got = await Promise.all(many);
      assert.equal(builds, 1, "five concurrent cold reads share one build");
      for (const g of got) assert.ok(g.ok && g.value.n === 1 && g.from === "rebuild" && !g.stale);

      // ── Same versions: served, no build — and no wall clock is involved.
      const realNow = Date.now;
      Date.now = () => realNow() + 10 * 60_000;
      const warm = await c.read();
      Date.now = realNow;
      assert.ok(warm.ok && warm.from === "cache" && !warm.stale, "unchanged versions = the cached value");
      assert.equal(builds, 1, "no rebuild without a change, even 10 minutes on");

      // ── Another desk moved: still no build.
      fv.set({ masters: v("a"), sis_staff: v("s1", 35), fee: v("f2") });
      const other = await c.read();
      assert.ok(other.ok && other.from === "cache");
      assert.equal(builds, 1, "a desk outside deskKeys moving does not rebuild");

      // ── Its own desk moved: exactly one build, then cached again.
      logs.length = 0;
      fv.set({ masters: v("b"), sis_staff: v("s1", 35), fee: v("f2") });
      const moved = await c.read();
      assert.ok(moved.ok && moved.from === "rebuild" && moved.value.n === 2);
      assert.ok(logs.some((l) => l.includes("t-cold rebuilt (moved: masters)")), `the rebuild says why: ${logs.join(" | ")}`);
      await c.read();
      await c.read();
      assert.equal(builds, 2, "one move = exactly one rebuild");

      // ── A count change alone (a deleted staff row: max(updated_at) unchanged) rebuilds.
      fv.set({ masters: v("b"), sis_staff: v("s1", 34), fee: v("f2") });
      const del = await c.read();
      assert.ok(del.ok && del.from === "rebuild", "a count change is a change");
      assert.equal(builds, 3);
      assert.equal(c.builds, 3, "the cache counts its builds");
    }

    // ── A failed rebuild keeps the previous value (stale) and retries next read.
    {
      const fv = fakeVersions({ masters: v("a") });
      let mode: "ok" | "fail" | "throw" = "ok";
      let builds = 0;
      const c = referenceCache("t-fail", ["masters"], async () => {
        builds++;
        if (mode === "throw") throw new Error("socket hang up");
        if (mode === "fail") return { ok: false, error: "timeout" };
        return { ok: true, value: `v${builds}` };
      }, { versions: fv.source, forgetVersions: () => {} });
      const first = await c.read();
      assert.ok(first.ok && first.value === "v1");

      fv.set({ masters: v("b") });
      mode = "fail";
      const kept = await c.read();
      assert.ok(kept.ok && kept.value === "v1" && kept.stale && kept.from === "previous", "failed rebuild = previous value, stale");
      const again = await c.read();
      assert.ok(again.ok && again.from === "previous");
      assert.equal(builds, 3, "the key was not moved on: every read retries the rebuild");

      mode = "throw";
      const thrown = await c.read();
      assert.ok(thrown.ok && thrown.value === "v1" && thrown.stale, "a throwing build is a failed build");

      mode = "ok";
      const back = await c.read();
      assert.ok(back.ok && back.value === "v5" && !back.stale && back.from === "rebuild", "recovery replaces the copy");
      const cached = await c.read();
      assert.ok(cached.ok && cached.from === "cache" && cached.value === "v5");
    }

    // ── No previous value: ok:false, and nothing is stored.
    {
      const fv = fakeVersions({ masters: v("a") });
      let fail = true;
      let builds = 0;
      const c = referenceCache<string[]>("t-nocopy", ["masters"], async () => {
        builds++;
        return fail ? { ok: false, error: "masters_desk_slices" } : { ok: true, value: ["cls_1"] };
      }, { versions: fv.source, forgetVersions: () => {} });
      const r1 = await c.read();
      assert.deepEqual(r1, { ok: false, error: "masters_desk_slices" }, "no copy + failed build = ok:false");
      const r2 = await c.read();
      assert.equal(r2.ok, false);
      assert.equal(builds, 2, "a failed read is never stored: the same versions build again");
      fail = false;
      const r3 = await c.read();
      assert.ok(r3.ok && r3.value[0] === "cls_1" && r3.from === "rebuild");
    }

    // ── A fallback: served stale when there is no copy, never stored; a copy beats it.
    {
      const fv = fakeVersions({ masters: v("a") });
      let mode: "fallback" | "ok" = "fallback";
      let builds = 0;
      const c = referenceCache("t-fallback", ["masters"], async () => {
        builds++;
        return mode === "fallback" ? { ok: false, error: "staff roster", fallback: "no-roster" } : { ok: true, value: "full" };
      }, { versions: fv.source, forgetVersions: () => {} });
      const f1 = await c.read();
      assert.ok(f1.ok && f1.value === "no-roster" && f1.stale && f1.from === "fallback");
      await c.read();
      assert.equal(builds, 2, "a fallback is not stored: the next read builds again");
      mode = "ok";
      assert.ok((await c.read()).ok);
      fv.set({ masters: v("b") });
      mode = "fallback";
      const f2 = await c.read();
      assert.ok(f2.ok && f2.value === "full" && f2.from === "previous", "with a copy, the copy wins over a fallback");
    }

    // ── Versions unknown: one build per snapshot; a failure keeps the copy; recovery rebuilds once.
    {
      const fv = fakeVersions({ masters: v("a") });
      let fail = false;
      let builds = 0;
      const c = referenceCache("t-unknown", ["masters"], async () => {
        builds++;
        return fail ? { ok: false, error: "db down" } : { ok: true, value: builds };
      }, { versions: fv.source, forgetVersions: () => {} });
      await c.read();
      assert.equal(builds, 1);
      fv.fail();
      const u1 = await c.read();
      assert.ok(u1.ok && u1.from === "rebuild", "versions unknown: the copy cannot be proven current — rebuild");
      await c.read();
      await c.read();
      assert.equal(builds, 2, "…once per versions snapshot, not once per read");
      fv.fail();
      fail = true;
      const u2 = await c.read();
      assert.ok(u2.ok && u2.stale && u2.from === "previous" && u2.value === 2, "unknown versions + failed rebuild = previous, stale");
      fail = false;
      fv.set({ masters: v("a") });
      const back = await c.read();
      assert.ok(back.ok && back.from === "rebuild", "versions back: one rebuild to record them");
      await c.read();
      assert.equal(builds, 4);
    }

    // ── Invalidate: the next read rebuilds; a build that started before it is not stored.
    {
      const fv = fakeVersions({ masters: v("a") });
      let forgets = 0;
      let builds = 0;
      let hold: Promise<void> | null = null;
      const c = referenceCache("t-invalidate", ["masters"], async () => {
        builds++;
        const mine = builds;
        if (hold) await hold;
        return { ok: true, value: `v${mine}` };
      }, { versions: fv.source, forgetVersions: () => void forgets++ });
      await c.read();
      c.invalidate();
      assert.equal(forgets, 1, "invalidate drops the shared versions snapshot too");
      const r = await c.read();
      assert.ok(r.ok && r.value === "v2" && r.from === "rebuild", "same versions, but invalidated = rebuild");

      let release: () => void = () => {};
      hold = new Promise<void>((res) => (release = res));
      fv.set({ masters: v("b") });
      const before = c.read(); // build v3 starts, held
      await new Promise((res) => setTimeout(res, 5));
      c.invalidate();
      hold = null;
      const after = await c.read(); // build v4, not joined to v3
      release();
      const b = await before;
      assert.ok(b.ok && b.value === "v3", "the older build still answers its own callers");
      assert.ok(after.ok && after.value === "v4", "a read after invalidate does not join the older build");
      const now = await c.read();
      assert.ok(now.ok && now.from === "cache" && now.value === "v4", "the older build was not stored over the newer one");
    }

    // ── A build under an older key is not joined by a reader that saw a newer key; the later build wins.
    {
      const fv = fakeVersions({ masters: v("a") });
      let builds = 0;
      const releases: (() => void)[] = [];
      const c = referenceCache("t-order", ["masters"], async () => {
        builds++;
        const mine = builds;
        await new Promise<void>((res) => releases.push(res));
        return { ok: true, value: `v${mine}` };
      }, { versions: fv.source, forgetVersions: () => {} });
      const p1 = c.read();
      await new Promise((res) => setTimeout(res, 5));
      fv.set({ masters: v("b") });
      const p2 = c.read();
      await new Promise((res) => setTimeout(res, 5));
      assert.equal(builds, 2, "a newer key starts its own build instead of joining the older one");
      releases[1]!(); // the newer build finishes first
      const r2 = await p2;
      releases[0]!();
      const r1 = await p1;
      assert.ok(r1.ok && r1.value === "v1" && r2.ok && r2.value === "v2");
      const r = await c.read();
      assert.ok(r.ok && r.from === "cache" && r.value === "v2", "the later-started build is the one kept");
    }

    // ── builtFrom (1.4): the versions a value was built under, or null when not proven.
    {
      const fv = fakeVersions({ masters: v("a", 15), sis_staff: v("s1", 35), fee: v("f1") });
      let fail = false;
      let release: () => void = () => {};
      let gate: Promise<void> = Promise.resolve();
      const c = referenceCache("t-built", ["masters", "sis_staff"], async () => {
        await gate;
        if (fail) return { ok: false, error: "down" };
        return { ok: true, value: "x" };
      }, { versions: fv.source, forgetVersions: () => {} });
      const cold = await c.read();
      assert.ok(cold.ok && cold.from === "rebuild");
      assert.deepEqual(cold.ok && cold.builtFrom, { masters: v("a", 15), sis_staff: v("s1", 35) }, "a rebuild: its own desks' versions, nothing else");
      const hit = await c.read();
      assert.ok(hit.ok && hit.from === "cache");
      assert.deepEqual(hit.ok && hit.builtFrom, { masters: v("a", 15), sis_staff: v("s1", 35) }, "a cache hit: the versions it was built under");

      // The versions are read before the build: a write landing during the
      // build leaves builtFrom at the OLDER value (the copy is at least that new).
      fv.set({ masters: v("b", 16), sis_staff: v("s1", 35) });
      gate = new Promise<void>((r) => (release = r));
      const during = c.read();
      await new Promise((r) => setTimeout(r, 5));
      fv.set({ masters: v("c", 17), sis_staff: v("s1", 35) });
      release();
      const built = await during;
      assert.deepEqual(built.ok && built.builtFrom, { masters: v("b", 16), sis_staff: v("s1", 35) }, "builtFrom = the versions read before the build");

      fail = true;
      const prev = await c.read();
      assert.ok(prev.ok && prev.from === "previous" && prev.stale && prev.builtFrom === null, "a previous copy: builtFrom null");
      fv.fail();
      const unknown = await c.read();
      assert.ok(unknown.ok && unknown.stale && unknown.builtFrom === null, "versions unknown + failed build: null");
      fail = false;
      fv.fail();
      const builtUnknown = await c.read();
      assert.ok(builtUnknown.ok && builtUnknown.from === "rebuild" && builtUnknown.builtFrom === null, "built while the versions were unknown: null");

      const fb = referenceCache("t-built-fb", ["masters"], async () => ({ ok: false, error: "roster", fallback: "fb" }), {
        versions: fakeVersions({ masters: v("a") }).source,
        forgetVersions: () => {},
      });
      const fr = await fb.read();
      assert.ok(fr.ok && fr.from === "fallback" && fr.builtFrom === null, "a fallback: builtFrom null");
    }

    console.log = quiet.log;
    console.error = quiet.error;
    console.log("referenceCache selftest: ok");
    process.exit(0);
  } catch (e) {
    console.log = quiet.log;
    console.error = quiet.error;
    console.error(e);
    console.error(logs.slice(-20).join("\n"));
    process.exit(1);
  }
})();
