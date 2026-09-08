/**
 * Self-test: a receipt's date is the school's decision, within limits that
 * are nobody's decision.
 * Run: npx tsx apps/web/src/lib/feeBackdate.selftest.ts
 *
 * Before this rule existed the two surfaces disagreed: the web counter took
 * ANY date including future ones, and the mobile app took only today. The
 * setting resolves that — but the interesting cases are the ones the setting
 * must NOT be able to unlock, because they are not preferences. A receipt
 * dated tomorrow records money that has not been handed over; a receipt dated
 * into last session lands in a book that has already been closed and reported.
 */

import assert from "node:assert/strict";

import {
  DEFAULT_FEE_BACKDATE_POLICY,
  backdatePolicyApplies,
  earliestCollectionDate,
  feeBackdateVerdict,
  normalizeFeeBackdatePolicy,
} from "./feeBackdate";

console.log("feeBackdate.selftest.ts");

const TODAY = "2026-09-08";
const SESSION_START = "2026-04-01";
const OFF = { allowForAllStaff: false };
const ON = { allowForAllStaff: true };

function verdict(p: {
  date: string;
  policy?: { allowForAllStaff: boolean };
  mayOverride?: boolean;
  dayClosed?: boolean;
}) {
  return feeBackdateVerdict({
    collectionDate: p.date,
    today: TODAY,
    sessionStartOn: SESSION_START,
    policy: p.policy ?? OFF,
    mayOverride: p.mayOverride ?? false,
    dayClosed: p.dayClosed,
  });
}

// 1. The default is the tight one. A school that has not chosen gets
//    same-day only, because that is the behaviour nobody has to audit.
assert.equal(DEFAULT_FEE_BACKDATE_POLICY.allowForAllStaff, false);
assert.equal(normalizeFeeBackdatePolicy(undefined).allowForAllStaff, false);
assert.equal(normalizeFeeBackdatePolicy({}).allowForAllStaff, false);
// Only a real `true` turns it on — a stray string from an old blob does not.
assert.equal(
  normalizeFeeBackdatePolicy({ allowForAllStaff: "yes" as unknown as boolean })
    .allowForAllStaff,
  false,
);

// 2. Today always works, for everybody, whatever the setting says. Turning
//    back-dating off must never stop the counter taking money now.
assert.deepEqual(verdict({ date: TODAY }), { ok: true });
assert.deepEqual(verdict({ date: TODAY, policy: ON }), { ok: true });

// 3. THE ONES THE SETTING CANNOT UNLOCK.
//    A future date is not a preference — it records money not yet handed
//    over. Refused for the owner, with the setting on, on every path.
for (const args of [
  { date: "2026-09-09" },
  { date: "2026-09-09", policy: ON },
  { date: "2026-09-09", policy: ON, mayOverride: true },
  { date: "2027-01-01", mayOverride: true },
]) {
  const r = verdict(args);
  assert.equal(r.ok, false, `future date allowed: ${JSON.stringify(args)}`);
  assert.match(r.ok === false ? r.reason : "", /future/i);
}

//    Before the session began: the book for that year is closed and
//    reported. This is what stops last year's ₹35.8L and this year's being
//    stirred together further.
for (const args of [
  { date: "2026-03-31", policy: ON, mayOverride: true },
  { date: "2025-12-25", policy: ON, mayOverride: true },
]) {
  const r = verdict(args);
  assert.equal(r.ok, false, `pre-session date allowed: ${JSON.stringify(args)}`);
  assert.match(r.ok === false ? r.reason : "", /running session/i);
}
//    The session's own first day is inside it, not outside.
assert.deepEqual(verdict({ date: SESSION_START, mayOverride: true }), { ok: true });

//    A closed day stays closed for everybody — that is the day-close's
//    authority, not this setting's.
const closed = verdict({ date: "2026-09-05", policy: ON, mayOverride: true, dayClosed: true });
assert.equal(closed.ok, false);
assert.match(closed.ok === false ? closed.reason : "", /closed/i);

// 4. The setting, doing its actual job: an ordinary clerk on a past date.
const clerkOff = verdict({ date: "2026-09-05" });
assert.equal(clerkOff.ok, false);
assert.match(clerkOff.ok === false ? clerkOff.reason : "", /switched off/i);
assert.deepEqual(verdict({ date: "2026-09-05", policy: ON }), { ok: true });

// 5. Owner / admin / principal get through with the setting OFF — that is
//    the whole point of the override, so a real mistake can be corrected
//    without voiding and re-issuing.
assert.deepEqual(verdict({ date: "2026-09-05", mayOverride: true }), { ok: true });

// 6. Malformed input refuses rather than guessing. An unusable "today" is
//    the dangerous one: without it there is no way to tell a back-date from
//    a same-day receipt, so it must not fall through to "allowed".
assert.equal(verdict({ date: "" }).ok, false);
assert.equal(verdict({ date: "08-09-2026" }).ok, false);
assert.equal(
  feeBackdateVerdict({
    collectionDate: "2026-09-05",
    today: "",
    sessionStartOn: SESSION_START,
    policy: ON,
    mayOverride: true,
  }).ok,
  false,
);

// 7. Machine-recorded money is not governed by a data-entry policy. A
//    payment-link receipt carries the date the GATEWAY says the parent paid,
//    which is legitimately days old when a webhook is replayed or a
//    settlement reconciled late. Refusing those would reject real money.
assert.equal(backdatePolicyApplies("counter"), true);
assert.equal(backdatePolicyApplies("manual_book"), true);
assert.equal(backdatePolicyApplies(undefined), true);
assert.equal(backdatePolicyApplies("payment_link"), false);

// 8. The picker's floor matches the rule, so the counter is told the limit
//    before typing instead of after.
assert.equal(
  earliestCollectionDate({ today: TODAY, sessionStartOn: SESSION_START, policy: OFF, mayOverride: false }),
  TODAY,
  "with no authority the field is pinned to today",
);
assert.equal(
  earliestCollectionDate({ today: TODAY, sessionStartOn: SESSION_START, policy: OFF, mayOverride: true }),
  SESSION_START,
);
assert.equal(
  earliestCollectionDate({ today: TODAY, sessionStartOn: SESSION_START, policy: ON, mayOverride: false }),
  SESSION_START,
);

console.log("  ok — the setting decides who; the session and today decide what");
