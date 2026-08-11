/**
 * Run: npx tsx src/lib/waContactState.selftest.ts
 *
 * Exercises only the pure logic — isStopKeyword() and within24HourWindow().
 * recordInboundMessage()/isOptedOut()/isWithin24HourWindow() need a live
 * Supabase service-role client, so they're excluded here and verified live
 * against the real webhook instead.
 */
import assert from "node:assert/strict";

import { isStopKeyword, within24HourWindow } from "./waContactState.server";

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

console.log("OK — waContactState.selftest.ts");
