/**
 * Self-test: when the weekly "read Nucleus" nudge goes out, and what it says.
 * Run: npx tsx apps/web/src/lib/nucleusReminder.selftest.ts
 */
import assert from "node:assert/strict";
import {
  REMIND_AFTER_DAYS,
  ageInDays,
  reminderDecision,
  reminderMessage,
} from "@/lib/nucleusReminder";

// ── Age of a reading ────────────────────────────────────────────────────
{
  assert.equal(ageInDays("2026-09-11", "2026-09-18"), 7);
  assert.equal(ageInDays("2026-09-18", "2026-09-18"), 0);
  // A reading dated ahead of today (clock skew, a typed date) is negative,
  // not silently treated as ancient.
  assert.equal(ageInDays("2026-09-20", "2026-09-18"), -2);
  assert.equal(ageInDays("not-a-date", "2026-09-18"), null);
}

// ── Silence while the reading is fresh ──────────────────────────────────
{
  const d = reminderDecision("2026-09-18", "2026-09-18");
  assert.equal(d.due, false);
  assert.equal(reminderMessage(d), "", "a fresh reading sends nothing");

  // Exactly a week old is still fresh; the day after is not.
  assert.equal(reminderDecision("2026-09-11", "2026-09-18").due, false);
  assert.equal(reminderDecision("2026-09-10", "2026-09-18").due, true);
}

// ── Never read, or unreadable: nudge rather than stay quiet ─────────────
{
  const never = reminderDecision(null, "2026-09-18");
  assert.equal(never.due, true);
  assert.equal(never.due && never.reason, "never-read");
  assert.match(reminderMessage(never), /no reading from Nucleus yet/i);

  // A date we cannot parse must not buy silence.
  const broken = reminderDecision("18/09/2026", "2026-09-18");
  assert.equal(broken.due, true);
  assert.equal(broken.due && broken.reason, "never-read");
}

// ── A stale reading names its own age and date ──────────────────────────
{
  const stale = reminderDecision("2026-08-31", "2026-09-18");
  assert.equal(stale.due, true);
  assert.equal(stale.due && stale.reason, "stale");
  const msg = reminderMessage(stale);
  assert.match(msg, /18 days old/);
  assert.match(msg, /2026-08-31/);
  // Every nudge carries the two steps, so nobody has to remember them.
  assert.match(msg, /Teacher Timeliness/);
  assert.match(msg, /Teaching → Nucleus progress/);
}

// ── The threshold is the one the scheduler comment promises ─────────────
{
  assert.equal(REMIND_AFTER_DAYS, 7);
  assert.equal(reminderDecision("2026-09-08", "2026-09-18", 30).due, false, "threshold is honoured");
}

console.log("nucleusReminder.selftest: all assertions passed");
