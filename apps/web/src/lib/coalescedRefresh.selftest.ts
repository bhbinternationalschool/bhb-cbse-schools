/**
 * Run: npx tsx src/lib/coalescedRefresh.selftest.ts
 *
 * data-layer 0.5e. The principal cockpit's snapshot refresh: one request in
 * flight at a time, at most one per 10 s, and a burst of desk events /
 * focus / visibility changes coalesces into one trailing run. Drives the
 * real lib/coalescedRefresh with a fake clock and fake timers.
 */
import assert from "node:assert/strict";
import { createCoalescedRefresh } from "./coalescedRefresh";

let clock = 1_000_000;
type T = { at: number; fn: () => void; id: number };
let timers: T[] = [];
let nextId = 1;
const setTimer = (fn: () => void, ms: number) => {
  const t = { at: clock + ms, fn, id: nextId++ };
  timers.push(t);
  return t.id;
};
const clearTimer = (h: unknown) => {
  timers = timers.filter((t) => t.id !== h);
};
const flush = () => new Promise((r) => setImmediate(r));
async function advance(ms: number) {
  const until = clock + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const due = timers[0];
    if (!due || due.at > until) break;
    timers.shift();
    clock = due.at;
    due.fn();
    await flush();
  }
  clock = until;
  await flush();
}

let runs = 0;
let concurrent = 0;
let maxConcurrent = 0;
const pending: Array<() => void> = [];
const run = () =>
  new Promise<void>((resolve) => {
    runs++;
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    pending.push(() => {
      concurrent--;
      resolve();
    });
  });
const finishOne = async () => {
  pending.shift()?.();
  await flush();
  await flush();
};

void (async () => {
  const r = createCoalescedRefresh({ run, minIntervalMs: 10_000, now: () => clock, setTimer, clearTimer });

  // Mount: one request runs at once.
  r.request();
  await flush();
  assert.equal(runs, 1, "the first request runs immediately");

  // The idle desk sweep: 24 bhb-desk-hydrated events + focus while it is in flight.
  for (let i = 0; i < 25; i++) r.request();
  await flush();
  assert.equal(runs, 1, "requests while one is in flight do not start another");
  assert.equal(maxConcurrent, 1);

  // It finishes 3 s later: the burst becomes ONE trailing run, at the 10 s mark.
  await advance(3_000);
  await finishOne();
  assert.equal(runs, 1, "the trailing run waits for the interval");
  await advance(6_999);
  assert.equal(runs, 1);
  await advance(1);
  assert.equal(runs, 2, "one trailing run at 10 s for the whole burst");
  await finishOne();

  // Quiet: a lone event inside the interval is deferred, not dropped; more coalesce.
  await advance(2_000);
  r.request();
  r.request();
  r.request();
  await flush();
  assert.equal(runs, 2, "inside the interval: deferred");
  await advance(8_000);
  assert.equal(runs, 3, "…and run once at the interval");
  await finishOne();

  // After a long quiet spell a request runs straight away.
  await advance(60_000);
  r.request();
  await flush();
  assert.equal(runs, 4);
  await finishOne();

  // Retry (force) skips the interval but never runs two at once.
  r.request({ force: true });
  await flush();
  assert.equal(runs, 5, "force skips the interval");
  r.request({ force: true });
  await flush();
  assert.equal(runs, 5, "…but not the one-in-flight rule");
  await finishOne();
  assert.equal(runs, 6, "the forced request queued behind it runs when it ends");
  await finishOne();
  assert.equal(maxConcurrent, 1, "never two snapshot requests in flight");

  // A failed run does not wedge it.
  const failing = createCoalescedRefresh({ run: () => Promise.reject(new Error("503")), minIntervalMs: 10_000, now: () => clock, setTimer, clearTimer });
  failing.request();
  await flush();
  await advance(10_000);
  failing.request();
  await flush();

  // Unmount: nothing runs after dispose.
  r.request();
  await flush();
  const at = runs;
  r.dispose();
  await advance(60_000);
  assert.equal(runs, at, "a disposed refresher schedules nothing");

  console.log("coalescedRefresh selftest: ok");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
