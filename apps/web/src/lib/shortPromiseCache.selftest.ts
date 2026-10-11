import assert from "node:assert/strict";
import { clearShortCache, shortCached } from "./shortPromiseCache";

console.log("shortPromiseCache.selftest.ts");

/** Redraws share one answer; unreadable answers are never cached. */
async function main() {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { n: calls };
  };
  const [a, b] = await Promise.all([shortCached("k", 15_000, load), shortCached("k", 15_000, load)]);
  assert.equal(calls, 1, "concurrent callers share one load");
  assert.equal(a, b);
  await shortCached("k", 15_000, load);
  assert.equal(calls, 1, "a caller inside the window reuses the answer");
  await shortCached("k2", 15_000, load);
  assert.equal(calls, 2, "a different key loads on its own");

  clearShortCache();
  let nulls = 0;
  const unreadable = async () => {
    nulls += 1;
    return null;
  };
  await shortCached("u", 15_000, unreadable);
  await new Promise((r) => setTimeout(r, 0));
  await shortCached("u", 15_000, unreadable);
  assert.equal(nulls, 2, "a null (could not read) answer is not cached");

  let fails = 0;
  const failing = async () => {
    fails += 1;
    throw new Error("down");
  };
  await shortCached("f", 15_000, failing).catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
  await shortCached("f", 15_000, failing).catch(() => {});
  assert.equal(fails, 2, "a failed load is not cached");

  clearShortCache();
  let t = 0;
  const realNow = Date.now;
  Date.now = () => 1_000_000 + t;
  try {
    let n = 0;
    const l = async () => ++n;
    await shortCached("t", 15_000, l);
    t = 15_001;
    await shortCached("t", 15_000, l);
    assert.equal(n, 2, "after the window the next caller loads fresh");
  } finally {
    Date.now = realNow;
  }
  console.log("shortPromiseCache: ok");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
