/**
 * Run: npx tsx src/lib/waContactState.selftest.ts
 *
 * Exercises only the pure logic — isStopKeyword() and within24HourWindow().
 * recordInboundMessage()/isOptedOut()/isWithin24HourWindow() need a live
 * Supabase service-role client, so they're excluded here and verified live
 * against the real webhook instead.
 */
import assert from "node:assert/strict";

import { isStopKeyword, within24HourWindow, unreachableVerdictApplies, UNREACHABLE_VERDICT_DAYS } from "./waContactState.server";

console.log("waContactState.selftest.ts");

// --- isStopKeyword: recognizes common opt-out phrasing -------------------
{
  assert.equal(isStopKeyword("STOP"), true);
  assert.equal(isStopKeyword("stop"), true);
  assert.equal(isStopKeyword("  Stop  "), true);
  assert.equal(isStopKeyword("unsubscribe"), true);
  assert.equal(isStopKeyword("opt out"), true);
  assert.equal(isStopKeyword("STOP please"), true);
  assert.equal(isStopKeyword("stop."), true);
  assert.equal(isStopKeyword("band karo"), true);
}

// --- isStopKeyword: ordinary messages are not misread as opt-outs --------
{
  assert.equal(isStopKeyword("please stop calling at 9am, otherwise fine"), false, "must not match STOP mid-sentence");
  assert.equal(isStopKeyword("what is the fee for class VI?"), false);
  assert.equal(isStopKeyword(""), false);
  assert.equal(isStopKeyword("   "), false);
  assert.equal(isStopKeyword("stopwatch"), false, "must not match a prefix of an unrelated word");
}

// --- within24HourWindow: inside vs outside Meta's session window ---------
{
  const now = "2026-08-11T12:00:00.000Z";
  assert.equal(within24HourWindow("2026-08-11T00:00:01.000Z", now), true, "23h59m ago is inside the window");
  assert.equal(within24HourWindow("2026-08-10T11:59:59.000Z", now), false, "just over 24h ago is outside the window");
  assert.equal(within24HourWindow(now, now), true, "an inbound message this instant is inside the window");
}

// --- within24HourWindow: unknown/invalid input never claims "inside" -----
{
  const now = "2026-08-11T12:00:00.000Z";
  assert.equal(within24HourWindow(null, now), false, "no prior inbound must never be treated as inside the window");
  assert.equal(within24HourWindow(undefined, now), false);
  assert.equal(within24HourWindow("not-a-date", now), false, "an unparsable timestamp must not be read as inside the window");
}

// --- a number Meta has refused is not messaged again, for a while --------
{
  // 21 Sep 2026: 27 numbers held on_whatsapp = false — 229 "undeliverable",
  // not one delivery ever — and every sender kept messaging them, because
  // the only column any sender read was the opt-out.
  const now = "2026-09-21T09:00:00.000Z";
  const dead = { onWhatsApp: false, checkedAt: "2026-09-20T12:00:00.000Z", lastInboundAt: null };
  assert.equal(unreachableVerdictApplies(dead, now), true, "a fresh 'not on WhatsApp' verdict stops the send");

  // Never checked is not the same as bad — it must never block.
  assert.equal(unreachableVerdictApplies({ onWhatsApp: null, checkedAt: null, lastInboundAt: null }, now), false);
  assert.equal(unreachableVerdictApplies({ onWhatsApp: undefined, checkedAt: dead.checkedAt, lastInboundAt: null }, now), false);
  assert.equal(unreachableVerdictApplies({ ...dead, onWhatsApp: true }, now), false);

  // A number that has written to us SINCE is on WhatsApp, whatever it said.
  assert.equal(
    unreachableVerdictApplies({ ...dead, lastInboundAt: "2026-09-21T08:00:00.000Z" }, now),
    false,
    "a parent who just messaged the school is reachable",
  );
  // ...but an inbound from BEFORE the verdict proves nothing about today.
  assert.equal(unreachableVerdictApplies({ ...dead, lastInboundAt: "2026-08-13T18:00:00.000Z" }, now), true);

  // The verdict expires, so a phone that was off for a month is tried again.
  const old = new Date(Date.parse(now) - (UNREACHABLE_VERDICT_DAYS + 1) * 86_400_000).toISOString();
  assert.equal(unreachableVerdictApplies({ ...dead, checkedAt: old }, now), false, "a stale verdict lets one send test it");
  const recent = new Date(Date.parse(now) - (UNREACHABLE_VERDICT_DAYS - 1) * 86_400_000).toISOString();
  assert.equal(unreachableVerdictApplies({ ...dead, checkedAt: recent }, now), true);

  // A verdict with no readable date is not a fact about today.
  assert.equal(unreachableVerdictApplies({ ...dead, checkedAt: "not-a-date" }, now), false);
  assert.equal(unreachableVerdictApplies({ ...dead, checkedAt: null }, now), false);
}

console.log("OK — waContactState.selftest.ts");
