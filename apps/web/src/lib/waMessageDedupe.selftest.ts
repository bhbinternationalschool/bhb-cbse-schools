/**
 * Webhook idempotency.
 *
 * The rule under test is that a retry of the same WhatsApp message never
 * costs a second reply, a second hub row or a second paid transcription —
 * and that the map cannot grow without bound while enforcing it.
 *
 * The subtle one is at the end: pruning must never evict the id just
 * recorded, or the very next retry of that message would look new, which is
 * the exact case this exists to catch.
 *
 * Run: npx tsx src/lib/waMessageDedupe.selftest.ts
 */
import assert from "node:assert/strict";

import {
  HANDLED_MAX,
  HANDLED_TTL_MS,
  isHandledMessage,
  rememberHandledMessage,
  type HandledMap,
} from "./waMessageDedupe";

console.log("waMessageDedupe.selftest.ts");

const NOW = 1_760_000_000_000;

// A message is new until it is recorded, then it is not.
{
  assert.equal(isHandledMessage({}, "wamid.A", NOW), false);
  const after = rememberHandledMessage({}, "wamid.A", NOW);
  assert.equal(isHandledMessage(after, "wamid.A", NOW), true, "a retry is recognised");
  assert.equal(isHandledMessage(after, "wamid.B", NOW), false, "a different message is not");
}

// No id means nothing to dedupe on — a message without one must still be
// handled, not silently swallowed as a duplicate.
{
  assert.equal(isHandledMessage({ "wamid.A": NOW }, undefined, NOW), false);
  assert.equal(isHandledMessage(undefined, "wamid.A", NOW), false, "an empty store is not a match");
  const unchanged = rememberHandledMessage({ "wamid.A": NOW }, undefined, NOW);
  assert.deepEqual(unchanged, { "wamid.A": NOW }, "recording nothing changes nothing");
}

// Old entries stop matching, so an id reused long after is not mistaken for
// a retry — and they are dropped from the map on the next write.
{
  const old: HandledMap = { "wamid.OLD": NOW - HANDLED_TTL_MS - 1 };
  assert.equal(isHandledMessage(old, "wamid.OLD", NOW), false, "past the window is not a retry");

  const pruned = rememberHandledMessage(old, "wamid.NEW", NOW);
  assert.equal("wamid.OLD" in pruned, false, "ordinary traffic tidies the map");
  assert.equal(pruned["wamid.NEW"], NOW);

  const justInside: HandledMap = { "wamid.EDGE": NOW - HANDLED_TTL_MS + 1000 };
  assert.equal(isHandledMessage(justInside, "wamid.EDGE", NOW), true, "inside the window still counts");
}

// A junk value in the stored blob is not a match and does not throw.
{
  const junk = { "wamid.X": "yesterday" } as unknown as HandledMap;
  assert.equal(isHandledMessage(junk, "wamid.X", NOW), false);
  const cleaned = rememberHandledMessage(junk, "wamid.Y", NOW);
  assert.equal("wamid.X" in cleaned, false, "the junk entry is dropped rather than carried");
}

// The map is capped, oldest evicted first.
{
  let map: HandledMap = {};
  for (let i = 0; i < HANDLED_MAX + 50; i += 1) {
    map = rememberHandledMessage(map, `wamid.${i}`, NOW + i);
  }
  const size = Object.keys(map).length;
  assert.ok(size <= HANDLED_MAX, `capped at ${HANDLED_MAX}, got ${size}`);
  assert.equal("wamid.0" in map, false, "the oldest went first");
  assert.equal(
    isHandledMessage(map, `wamid.${HANDLED_MAX + 49}`, NOW + HANDLED_MAX + 49),
    true,
    "the newest is still there",
  );
}

// Pruning never evicts the id being recorded — otherwise its own retry,
// arriving moments later, would be treated as a new message.
{
  const map: HandledMap = {};
  // Fill to the cap with entries all NEWER than the one recorded last, so a
  // naive oldest-first prune would choose exactly the id just written.
  for (let i = 0; i < HANDLED_MAX; i += 1) {
    map[`wamid.filler${i}`] = NOW + 10_000 + i;
  }
  const after = rememberHandledMessage(map, "wamid.OLDEST", NOW);
  assert.equal(
    isHandledMessage(after, "wamid.OLDEST", NOW),
    true,
    "the id just recorded survives its own prune",
  );
}

console.log("OK");
