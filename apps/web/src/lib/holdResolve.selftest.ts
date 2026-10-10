/**
 * Self-test: what a gate actually decides.
 * Run: npx tsx apps/web/src/lib/holdResolve.selftest.ts
 *
 * This is the piece that turns a child away, so the cases below are the ones
 * that would hurt if they were wrong: a block that does not hold, an allow
 * that does not let through, and the two "we do not know yet" moments.
 */

import assert from "node:assert/strict";

import {
  factsFrom,
  indexStandingDecisions,
  resolveHold,
  standingKey,
  type StandingDecision,
} from "./holdResolve";
import type { HoldGate } from "./defaulterHoldPolicy";

console.log("holdResolve.selftest.ts");

const propose: HoldGate = {
  holdCode: "HOLD_TRANSPORT",
  mode: "propose",
  fromStage: "S3",
  minAmountPaise: 0,
  minOverdueDays: 0,
};
const auto: HoldGate = { ...propose, mode: "auto" };
const off: HoldGate = { ...propose, mode: "off" };

// A child deep in arrears — under the old engine, blocked outright.
const deep = factsFrom("s1", "S4", 140, 62_000 * 100);
const clear = factsFrom("s2", "S0", -3, 0);

const ask = (
  gate: HoldGate | null,
  facts = deep,
  standing: StandingDecision | null | undefined = null,
  extra: Partial<Parameters<typeof resolveHold>[0]> = {},
) =>
  resolveHold({
    holdCode: "HOLD_TRANSPORT",
    label: "Transport boarding",
    gate,
    facts,
    standing,
    decisionsKnown: true,
    ...extra,
  });

/* ── the whole point: propose blocks nobody by itself ───────── */

// This is the 102-of-155 case. Same child, same arrears, same stage — under
// "propose" they keep their seat until a person puts them on a list.
const awaiting = ask(propose, deep, null);
assert.equal(awaiting.allowed, true);
assert.equal(awaiting.basis, "awaiting_round");

// Under "auto" the old behaviour is intact.
const held = ask(auto, deep, null);
assert.equal(held.allowed, false);
assert.equal(held.basis, "auto_qualified");
assert.match(held.message, /held at/);

// A gate switched off never blocks, whatever the arrears.
assert.equal(ask(off, deep, null).allowed, true);
assert.equal(ask(null, deep, null).basis, "no_gate");

// Below the gate, nothing happens.
assert.equal(ask(auto, clear, null).basis, "auto_below_gate");

/* ── a standing decision beats the arithmetic, both ways ────── */

const disallow: StandingDecision = {
  studentId: "s1",
  holdCode: "HOLD_TRANSPORT",
  decision: "disallow",
  reason: "Third term unpaid, agreed at the 2 Sep meeting",
  decidedAt: "2026-09-13T10:00:00.000Z",
  decidedBy: "director",
};
const allow: StandingDecision = {
  ...disallow,
  decision: "allow",
  reason: "Father in hospital — agreed 15 Oct",
};

// A block holds even under "propose", which is what makes a round mean
// anything at all.
const blocked = ask(propose, deep, disallow);
assert.equal(blocked.allowed, false);
assert.equal(blocked.basis, "standing_disallow");
// The message must carry who and why — a parent at a counter will ask.
assert.match(blocked.message, /director/);
assert.match(blocked.message, /2 Sep meeting/);
assert.match(blocked.message, /2026-09-13/);

// An allow beats an automatic hold, so a family the office spared is not
// re-blocked by the rule the next morning.
const spared = ask(auto, deep, allow);
assert.equal(spared.allowed, true);
assert.equal(spared.basis, "standing_allow");
assert.match(spared.message, /hospital/);

/* ── the PIN override still works, and cannot undo a round ──── */

// It rescues an automatic hold.
const pinned = ask(auto, deep, null, { pinOverrideUntil: "2026-09-20" });
assert.equal(pinned.allowed, true);
assert.equal(pinned.basis, "pin_override");
assert.match(pinned.message, /2026-09-20/);

// It does NOT quietly undo a decision somebody made in a round. A week-old
// PIN must not outrank this morning's list.
const pinVsRound = ask(propose, deep, disallow, {
  pinOverrideUntil: "2026-09-20",
});
assert.equal(pinVsRound.allowed, false);
assert.equal(pinVsRound.basis, "standing_disallow");

/* ── what happens before the decisions have loaded ──────────── */

// Not loaded under "propose": allowed, and honest about not having checked.
const unknownPropose = resolveHold({
  holdCode: "HOLD_TRANSPORT",
  label: "Transport boarding",
  gate: propose,
  facts: deep,
  standing: undefined,
  decisionsKnown: false,
});
assert.equal(unknownPropose.allowed, true);
assert.equal(unknownPropose.decisionsKnown, false);
// The screen must be able to say "not checked" rather than implying it was.
assert.match(unknownPropose.message, /not loaded|not checked/i);

// Not loaded under "auto": the rule still applies, because it needs no
// server data. A slow fetch must not hand out report cards it would refuse.
const unknownAuto = resolveHold({
  holdCode: "HOLD_TRANSPORT",
  label: "Transport boarding",
  gate: auto,
  facts: deep,
  standing: undefined,
  decisionsKnown: false,
});
assert.equal(unknownAuto.allowed, false);
assert.equal(unknownAuto.basis, "auto_qualified");

/* ── floors are honoured by the automatic path too ──────────── */

const withFloor: HoldGate = { ...auto, minAmountPaise: 200_000 };
const token = factsFrom("s3", "S3", 20, 50 * 100);
assert.equal(ask(withFloor, token, null).allowed, true, "₹50 is below ₹2,000");
assert.equal(ask(withFloor, deep, null).allowed, false);

/* ── the index ──────────────────────────────────────────────── */

const idx = indexStandingDecisions([disallow]);
assert.equal(idx.get(standingKey("s1", "HOLD_TRANSPORT"))?.decision, "disallow");
assert.equal(idx.get(standingKey("s1", "HOLD_ADMIT_CARD")), undefined);
assert.equal(idx.get(standingKey("nobody", "HOLD_TRANSPORT")), undefined);

console.log("  ok");
