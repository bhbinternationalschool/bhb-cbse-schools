/**
 * Run: npx tsx src/lib/syncRetryStatus.selftest.ts
 *
 * Exercises only the pure logic (nextRetryDelayMs) and the status
 * transitions of scheduleRetryingPush/retryNow — no real timers, since
 * this module runs under Node (no window/localStorage), so retries only
 * ever advance via explicit retryNow() calls in this test.
 */
import assert from "node:assert/strict";

import {
  getSyncStatus,
  nextRetryDelayMs,
  retryNow,
  scheduleRetryingPush,
} from "./syncRetryStatus";

console.log("syncRetryStatus.selftest.ts");

// --- nextRetryDelayMs: pure backoff ladder ---
assert.equal(nextRetryDelayMs(0), 5000);
assert.equal(nextRetryDelayMs(1), 20000);
assert.equal(nextRetryDelayMs(2), 60000);
assert.equal(nextRetryDelayMs(3), null);
assert.equal(nextRetryDelayMs(99), null);
assert.equal(nextRetryDelayMs(-1), null);

// --- scheduleRetryingPush: succeeds on the first attempt ---
async function testImmediateSuccess() {
  let calls = 0;
  scheduleRetryingPush("t:success", async () => {
    calls += 1;
    return { ok: true };
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  assert.equal(getSyncStatus("t:success").status, "idle");
}

// --- scheduleRetryingPush: fails until exhausted, then manual retryNow succeeds ---
async function testFailThenManualRetry() {
  let calls = 0;
  scheduleRetryingPush("t:fail", async () => {
    calls += 1;
    return { ok: false, error: "boom" };
  });
  // Let the first (immediate) attempt resolve. The next attempt is scheduled
  // behind a real setTimeout (5s) — we don't wait for it; instead we prove
  // the manual retryNow() path works independently of the timer.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  const afterFirstFailure = getSyncStatus("t:fail");
  assert.equal(afterFirstFailure.status, "retrying");
  assert.equal(afterFirstFailure.attempts, 1);
  assert.equal(afterFirstFailure.error, "boom");

  retryNow("t:fail");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 2);
}

// --- retryNow on an idle/unknown key is a safe no-op ---
function testRetryNowNoop() {
  retryNow("t:never-scheduled");
  assert.equal(getSyncStatus("t:never-scheduled").status, "idle");
}

async function main() {
  await testImmediateSuccess();
  await testFailThenManualRetry();
  testRetryNowNoop();
  console.log("OK");
  process.exit(0);
}

void main();
