/**
 * A tenant wipe signal must expire.
 *
 * The 2026-08-05 signal was still firing on 2026-08-10. The "seen" marker
 * lives in localStorage, so a browser with empty storage has never seen
 * anything and applies the signal on first load — indefinitely. And since
 * clearing site data deletes that marker, clearing RE-TRIGGERED the wipe:
 * masters emptied, the push base stamped five days stale, and (before the
 * cold-client fix) the gap refilled with freshly invented class ids. That is
 * why "clear your browser" left devices worse than before.
 *
 * The rule this pins: a signal is an instruction to drop desks that predate a
 * re-seed, so a browser first loading a week later has nothing to drop.
 *
 * The age logic is mirrored here rather than imported because
 * tenantDataWipe.ts touches localStorage and dynamic imports at module scope.
 * Keep the two in step — the constant is named in both.
 *
 * Run: npx tsx src/lib/tenantDataWipe.selftest.ts
 */
import assert from "node:assert/strict";

const MAX_WIPE_SIGNAL_AGE_DAYS = 7;

/** Exactly the predicate in applyTenantDataWipeSignalIfNeeded. */
function signalIsExpired(wipedAt: string | null, now: number): boolean {
  if (!wipedAt) return true;
  const ms = Date.parse(wipedAt);
  const ageDays = Number.isFinite(ms)
    ? (now - ms) / 86_400_000
    : Number.POSITIVE_INFINITY;
  return ageDays > MAX_WIPE_SIGNAL_AGE_DAYS;
}

const now = Date.parse("2026-08-10T09:00:00.000Z");
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

// ── The signal that actually caused this ──────────────────────────────────
{
  assert.equal(
    signalIsExpired("2026-08-05T07:44:19.406Z", now),
    false,
    "5 days old is still inside the window — it was live, not expired",
  );
  // …and the point is that it would have expired two days later rather than
  // firing forever.
  assert.equal(
    signalIsExpired("2026-08-05T07:44:19.406Z", now + 3 * 86_400_000),
    true,
    "the same signal must expire once past the limit",
  );
}

// ── Boundaries ────────────────────────────────────────────────────────────
{
  assert.equal(signalIsExpired(daysAgo(0), now), false, "a fresh signal applies");
  assert.equal(signalIsExpired(daysAgo(6.9), now), false, "just inside applies");
  assert.equal(signalIsExpired(daysAgo(7.1), now), true, "just outside expires");
  assert.equal(signalIsExpired(daysAgo(365), now), true, "a year old expires");
}

// ── Absent and malformed are ignored, never treated as "now" ──────────────
// Guessing here means wiping a browser on the strength of a malformed file.
// The cost of ignoring it is one more reload with a stale desk.
{
  assert.equal(signalIsExpired(null, now), true, "no signal, nothing to do");
  assert.equal(signalIsExpired("", now), true, "empty signal is not a signal");
  assert.equal(
    signalIsExpired("not-a-timestamp", now),
    true,
    "an unparseable signal must not wipe a browser",
  );
}

// ── A future timestamp must not be treated as expired ─────────────────────
// Clock skew between the server writing the file and the browser reading it
// would otherwise silently disable a signal that was just armed.
{
  const inTheFuture = new Date(now + 3600_000).toISOString();
  assert.equal(
    signalIsExpired(inTheFuture, now),
    false,
    "a slightly-future signal is live, not expired",
  );
}

console.log("tenantDataWipe.selftest: all assertions passed");
