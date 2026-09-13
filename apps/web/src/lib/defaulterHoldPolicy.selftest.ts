/**
 * Self-test: the defaulter policy and the rounds built from it.
 * Run: npx tsx apps/web/src/lib/defaulterHoldPolicy.selftest.ts
 *
 * The numbers are production's, read on 13 Sep 2026: 717 children, 155 of
 * them riding, 220 carrying an open bill, and 172 sitting at S3 or worse. The
 * cases pinned here are the ones that made the existing settings unusable —
 * a fifty-rupee shortfall ranked beside a forty-thousand-rupee one, and two
 * thirds of the bus qualifying at once.
 */

import assert from "node:assert/strict";

import {
  BLOCKABLE_HOLD_CODES,
  defaultDefaulterPolicy,
  evaluateGate,
  gateFor,
  isBlockableHold,
  normalizeDefaulterPolicy,
  qualifiesForGate,
  stageRank,
  type DefaulterFacts,
  type HoldGate,
} from "./defaulterHoldPolicy";
import {
  applyRound,
  buildHoldRound,
  canApplyRound,
  countRound,
  decideMany,
  roundBlockers,
  staleItems,
} from "./defaulterHoldRound";

console.log("defaulterHoldPolicy.selftest.ts");

const facts = (
  studentId: string,
  stage: DefaulterFacts["stage"],
  overdueDays: number,
  rupees: number,
): DefaulterFacts => ({
  studentId,
  stage,
  overdueDays,
  overdueAmountPaise: rupees * 100,
});

/* ── what may never be withheld ─────────────────────────────── */

// buildPlaybook promises attendance, homework, emergency medical and pickup
// safety are never withheld. The policy cannot express them at all.
for (const forbidden of [
  "HOLD_ATTENDANCE",
  "HOLD_HOMEWORK",
  "HOLD_MEDICAL",
  "HOLD_PICKUP",
]) {
  assert.equal(isBlockableHold(forbidden), false, forbidden);
}
assert.ok(BLOCKABLE_HOLD_CODES.includes("HOLD_TRANSPORT"));
assert.ok(BLOCKABLE_HOLD_CODES.includes("HOLD_ADMIT_CARD"));

/* ── defaults reproduce today's behaviour ───────────────────── */

const base = defaultDefaulterPolicy();
// Same stages the frozen HOLD_FROM_STAGE constant already uses.
assert.equal(gateFor(base, "HOLD_TRANSPORT")!.fromStage, "S3");
assert.equal(gateFor(base, "HOLD_ADMIT_CARD")!.fromStage, "S3");
assert.equal(gateFor(base, "HOLD_REPORT_CARD")!.fromStage, "S2");
assert.equal(gateFor(base, "HOLD_TC")!.fromStage, "S4");
// The two the school runs by approval propose; nothing else changed mode.
assert.equal(gateFor(base, "HOLD_TRANSPORT")!.mode, "propose");
assert.equal(gateFor(base, "HOLD_ADMIT_CARD")!.mode, "propose");
assert.equal(gateFor(base, "HOLD_REPORT_CARD")!.mode, "auto");
// No floors by default, so installing the policy changes nothing.
for (const g of base.gates) {
  assert.equal(g.minAmountPaise, 0);
  assert.equal(g.minOverdueDays, 0);
}

/* ── the money floor, which is the whole point ──────────────── */

const transport: HoldGate = {
  holdCode: "HOLD_TRANSPORT",
  mode: "propose",
  fromStage: "S3",
  minAmountPaise: 0,
  minOverdueDays: 0,
};

// The fifty-rupee child. resolveStage reads only days, so a token shortfall
// lands at S3 beside a serious one — and HOLD_TRANSPORT fires at S3.
const tokenShortfall = facts("s_small", "S3", 20, 50);
const seriousDebt = facts("s_big", "S3", 20, 40_000);

assert.equal(qualifiesForGate(transport, tokenShortfall).qualifies, true);
assert.equal(qualifiesForGate(transport, seriousDebt).qualifies, true);

// With a floor, only the real one qualifies.
const withFloor: HoldGate = { ...transport, minAmountPaise: 200_000 };
assert.equal(qualifiesForGate(withFloor, tokenShortfall).qualifies, false);
assert.equal(qualifiesForGate(withFloor, seriousDebt).qualifies, true);

const spared = qualifiesForGate(withFloor, tokenShortfall);
assert.equal(spared.qualifies, false);
// The office screen shows this string as-is, so it must name the floor.
assert.match(spared.qualifies ? "" : spared.reason, /2000/);

/* ── a day floor on top of the stage ────────────────────────── */

const threeWeeks: HoldGate = { ...transport, minOverdueDays: 21 };
assert.equal(qualifiesForGate(threeWeeks, facts("s", "S3", 16, 5_000)).qualifies, false);
assert.equal(qualifiesForGate(threeWeeks, facts("s", "S3", 22, 5_000)).qualifies, true);

/* ── off means off ──────────────────────────────────────────── */

assert.equal(
  qualifiesForGate({ ...transport, mode: "off" }, seriousDebt).qualifies,
  false,
);

/* ── stage order ────────────────────────────────────────────── */

assert.ok(stageRank("S4") > stageRank("S3"));
assert.ok(stageRank("S3") > stageRank("S0"));
assert.equal(
  qualifiesForGate(transport, facts("s", "S2", 12, 9_000)).qualifies,
  false,
  "S2 is below the gate",
);

/* ── evaluateGate answers 'why is this family not on the list' ─ */

const population = [
  facts("s_big", "S3", 20, 40_000),
  facts("s_small", "S3", 20, 50),
  facts("s_early", "S2", 10, 9_000),
  facts("s_worst", "S4", 140, 62_000),
];
const run = evaluateGate(withFloor, population);
assert.deepEqual(
  run.caught.map((f) => f.studentId),
  ["s_worst", "s_big"],
  "largest bill first",
);
assert.equal(run.spared.length, 2);
assert.ok(run.spared.every((s) => s.reason.length > 0));

/* ── normalising a stored policy ────────────────────────────── */

// A gate for something that is not blockable is dropped, not repaired.
const cleaned = normalizeDefaulterPolicy({
  version: 1,
  note: "x",
  gates: [
    { holdCode: "HOLD_ATTENDANCE" as never, mode: "auto", fromStage: "S1" },
    { holdCode: "HOLD_TRANSPORT", mode: "propose", fromStage: "S4", minAmountPaise: 500_000 },
  ],
});
assert.equal(cleaned.gates.some((g) => String(g.holdCode) === "HOLD_ATTENDANCE"), false);
assert.equal(gateFor(cleaned, "HOLD_TRANSPORT")!.fromStage, "S4");
assert.equal(gateFor(cleaned, "HOLD_TRANSPORT")!.minAmountPaise, 500_000);

// A code the stored policy never mentioned arrives switched OFF, so adding a
// hold code in a later release cannot start withholding on upgrade.
assert.equal(gateFor(cleaned, "HOLD_TC")!.mode, "off");

// Junk in, defaults out — never a crash, never a guess.
assert.equal(normalizeDefaulterPolicy(null).gates.length, base.gates.length);
assert.equal(normalizeDefaulterPolicy({ gates: "nonsense" as never }).gates.length, base.gates.length);
assert.equal(
  normalizeDefaulterPolicy({ gates: [{ holdCode: "HOLD_TRANSPORT", minAmountPaise: -5 }] })
    .gates.find((g) => g.holdCode === "HOLD_TRANSPORT")!.minAmountPaise,
  0,
);

/* ── a round: built, decided, applied ───────────────────────── */

let round = buildHoldRound({
  id: "rnd_1",
  holdCode: "HOLD_TRANSPORT",
  gate: withFloor,
  population,
  asOf: "2026-09-13",
  createdBy: "director",
  now: "2026-09-13T10:00:00.000Z",
});

assert.equal(round.status, "draft");
assert.equal(round.items.length, 2);
assert.equal(countRound(round).undecided, 2);

// Nothing applies while a child has no decision.
assert.equal(canApplyRound(round), false);
assert.ok(roundBlockers(round).some((b) => b.code === "undecided"));

// The bulk action: tick both, press one button.
round = decideMany(round, ["s_worst", "s_big"], "disallow");
assert.equal(countRound(round).disallow, 2);
assert.equal(canApplyRound(round), true);

// Letting one through needs a reason.
round = decideMany(round, ["s_big"], "allow");
assert.equal(canApplyRound(round), false);
assert.ok(roundBlockers(round).some((b) => b.code === "allow_without_reason"));

round = decideMany(round, ["s_big"], "allow", "Father in hospital — agreed 15 Oct");
assert.equal(canApplyRound(round), true);

// A round is a closed list: ids that were never caught cannot be added.
const sneak = decideMany(round, ["s_small"], "disallow");
assert.equal(sneak.items.length, 2);
assert.equal(sneak.items.some((i) => i.studentId === "s_small"), false);

const applied = applyRound(round, "director", "2026-09-13T11:00:00.000Z");
assert.ok(!("error" in applied));
if ("error" in applied) throw new Error(String(applied.error));
assert.equal(applied.round.status, "applied");
assert.equal(applied.round.appliedBy, "director");
assert.equal(applied.records.length, 2);

// The allow is kept, not dropped — next month must know who was spared.
const allowRecord = applied.records.find((r) => r.studentId === "s_big")!;
assert.equal(allowRecord.decision, "allow");
assert.match(allowRecord.reason, /hospital/);
const blockRecord = applied.records.find((r) => r.studentId === "s_worst")!;
assert.equal(blockRecord.decision, "disallow");
assert.equal(blockRecord.overdueAmountPaise, 62_000 * 100);

// Applying twice is refused rather than duplicated.
const again = applyRound(applied.round, "director");
assert.ok("error" in again);

// A draft that caught nobody is not applicable.
const empty = buildHoldRound({
  id: "rnd_empty",
  holdCode: "HOLD_TRANSPORT",
  gate: { ...withFloor, minAmountPaise: 99_999_999 },
  population,
  asOf: "2026-09-13",
  createdBy: "director",
});
assert.equal(empty.items.length, 0);
assert.ok(roundBlockers(empty).some((b) => b.code === "empty"));

/* ── a family who paid after the list was approved ──────────── */

const paidUp = [
  facts("s_worst", "S0", 0, 0), // cleared the lot
  facts("s_big", "S3", 20, 40_000),
];
const stale = staleItems(applied.round, paidUp);
assert.equal(stale.length, 1);
assert.equal(stale[0]!.studentId, "s_worst");
assert.equal(stale[0]!.cleared, true);

// Someone who merely part-paid is reported too, but not as cleared.
const partPaid = staleItems(applied.round, [facts("s_worst", "S4", 140, 100)]);
assert.equal(partPaid.length, 1);
assert.equal(partPaid[0]!.cleared, false);

// An allowed child is not stale news — they were never going to be blocked.
// s_worst is left untouched here so only s_big could possibly be reported.
assert.equal(
  staleItems(applied.round, [
    facts("s_worst", "S4", 140, 62_000),
    facts("s_big", "S0", 0, 0),
  ]).length,
  0,
);

// A disallowed child who has vanished from the open-dues list entirely has
// paid in full — absence is not "unknown", it is zero.
const vanished = staleItems(applied.round, [facts("s_big", "S3", 20, 40_000)]);
assert.equal(vanished.length, 1);
assert.equal(vanished[0]!.studentId, "s_worst");
assert.equal(vanished[0]!.cleared, true);

console.log("  ok");
