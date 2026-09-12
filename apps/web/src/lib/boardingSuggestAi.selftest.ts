/**
 * Self-test: the boarding-point suggestion's prompt and its no-invention guard.
 * Run: npx tsx apps/web/src/lib/boardingSuggestAi.selftest.ts
 *
 * The rule this exists to protect: the model may weigh the shortlist, and may
 * not add to it. A stop id it makes up must not come back out as a place to
 * send a child — and an unknown (seats, fee, school distance, halt history)
 * must reach the prompt as "not recorded", never as a zero that reads as a
 * fact.
 */

import assert from "node:assert/strict";

import {
  boardingSuggestionWorthAsking,
  buildBoardingSuggestSystemPrompt,
  buildBoardingSuggestUserPrompt,
  candidatesWithinNoise,
  parseBoardingSuggestionJson,
  type BoardingCandidateFact,
  type BoardingSuggestFacts,
} from "./boardingSuggestAi";

console.log("boardingSuggestAi.selftest.ts");

function cand(p: Partial<BoardingCandidateFact>): BoardingCandidateFact {
  return {
    stopId: "st1",
    stopName: "Ayar Mod",
    routeLabel: "Winger",
    walkKm: 0.4,
    walkMinutes: 6,
    walkSource: "google",
    schoolKm: 4.2,
    monthlyFeePaise: 60000,
    seatsLeft: 5,
    siblingOnRoute: "",
    haltDays: 4,
    isCurrent: false,
    ...p,
  };
}

function facts(p: Partial<BoardingSuggestFacts>): BoardingSuggestFacts {
  return {
    studentId: "s1",
    firstName: "Aarav",
    classLabel: "IV A",
    homeLabel: "Ayar",
    homePrecision: "household",
    noiseFloorKm: 0.3,
    candidates: [cand({}), cand({ stopId: "st2", stopName: "Paharia", walkKm: 1.1 })],
    ...p,
  };
}

/* ── The allow-list is the whole guarantee ── */
{
  const good = parseBoardingSuggestionJson(
    JSON.stringify({
      stopId: "st2",
      recommendation: "Move to Paharia on Winger.",
      reasons: ["1.1 km walk", "sibling already on Winger"],
      caution: "Check the family agrees.",
    }),
    ["st1", "st2"],
  );
  assert.ok(good);
  assert.equal(good.stopId, "st2");
  assert.deepEqual(good.reasons, ["1.1 km walk", "sibling already on Winger"]);

  // An id that was never offered is the model inventing a destination. It must
  // not be corrected to the nearest real one, and it must not pass through.
  const invented = parseBoardingSuggestionJson(
    JSON.stringify({
      stopId: "st_does_not_exist",
      recommendation: "Board at the new stop by the temple.",
      reasons: [],
    }),
    ["st1", "st2"],
  );
  assert.ok(invented);
  assert.equal(invented.stopId, "", "an unknown id becomes no choice at all");
  assert.equal(
    invented.recommendation,
    "Board at the new stop by the temple.",
    "the words are still shown — a clerk judges them, they are not silently dropped",
  );

  // A stop NAME in the id field is the same failure.
  const named = parseBoardingSuggestionJson(
    JSON.stringify({ stopId: "Paharia", recommendation: "Paharia." }),
    ["st1", "st2"],
  );
  assert.equal(named?.stopId, "");

  // Declining is legitimate and must survive.
  const declined = parseBoardingSuggestionJson(
    JSON.stringify({
      stopId: "",
      recommendation: "The village centroid cannot separate these two.",
      reasons: [],
      caution: "Pin the child's boarding point.",
    }),
    ["st1", "st2"],
  );
  assert.equal(declined?.stopId, "");
  assert.equal(declined?.caution, "Pin the child's boarding point.");
}

/* ── Malformed answers are rejected, not patched ── */
{
  assert.equal(parseBoardingSuggestionJson("not json", ["st1"]), null);
  assert.equal(parseBoardingSuggestionJson("[]", ["st1"]), null);
  assert.equal(
    parseBoardingSuggestionJson(JSON.stringify({ stopId: "st1" }), ["st1"]),
    null,
    "a choice with no explanation is not an answer",
  );
  assert.equal(
    parseBoardingSuggestionJson(JSON.stringify({ stopId: "st1", recommendation: "   " }), [
      "st1",
    ]),
    null,
  );
  const many = parseBoardingSuggestionJson(
    JSON.stringify({
      stopId: "st1",
      recommendation: "Here.",
      reasons: ["a", "b", "c", "d", "e", "f"],
    }),
    ["st1"],
  );
  assert.equal(many?.reasons.length, 4, "reasons are capped");
}

/* ── Unknowns reach the prompt as unknown, never as zero ── */
{
  const p = buildBoardingSuggestUserPrompt(
    facts({
      candidates: [
        cand({
          stopId: "st1",
          seatsLeft: null,
          monthlyFeePaise: null,
          schoolKm: null,
          haltDays: null,
        }),
      ],
    }),
  );
  assert.match(p, /seats not recorded for this bus/);
  assert.match(p, /not priced yet/);
  assert.match(p, /distance from school never measured/);
  assert.match(p, /not enough GPS history/);
  assert.doesNotMatch(p, /0 seats left/);
  assert.doesNotMatch(p, /₹0\/month/);
  assert.doesNotMatch(p, /0 km from school/);
}

/* ── Zero is said plainly when it IS zero ── */
{
  const p = buildBoardingSuggestUserPrompt(
    facts({ candidates: [cand({ seatsLeft: 0, haltDays: 0 })] }),
  );
  assert.match(p, /NO SEATS LEFT/);
  assert.match(p, /has NOT been seen halting here/);
}

/* ── A straight line must never be described as a walk ── */
{
  const p = buildBoardingSuggestUserPrompt(
    facts({
      candidates: [cand({ walkSource: "straight", walkMinutes: null, walkKm: 0.9 })],
    }),
  );
  assert.match(p, /0\.9 km in a straight line \(walking route not available\)/);
  assert.doesNotMatch(p, /0\.9 km walk/);

  const walked = buildBoardingSuggestUserPrompt(facts({}));
  assert.match(walked, /0\.4 km walk \(about 6 min on foot\)/);
}

/* ── The home's precision and its noise floor both reach the model ── */
{
  const village = buildBoardingSuggestUserPrompt(
    facts({ homePrecision: "village", noiseFloorKm: 1, homeLabel: "Bhopapur" }),
  );
  assert.match(village, /CENTROID of their village/);
  assert.match(village, /smaller than 1 km cannot be told apart/);

  const pinned = buildBoardingSuggestUserPrompt(
    facts({ homePrecision: "pin", noiseFloorKm: 0.15 }),
  );
  assert.match(pinned, /dropped for this child specifically/);
}

/* ── The system prompt carries the rules that stop invention ── */
{
  const sys = buildBoardingSuggestSystemPrompt({ schoolName: "BHB International" });
  assert.match(sys, /MUST be copied exactly from the shortlist/);
  assert.match(sys, /Say NOTHING about roads, crossings, traffic/);
  assert.match(sys, /"Seats not recorded" is NOT "no seats"/);
  assert.match(sys, /you MUST return "" for stopId/);
  assert.match(sys, /BHB International/);
}

/* ── Current stop and sibling are marked, because both change the answer ── */
{
  const p = buildBoardingSuggestUserPrompt(
    facts({
      candidates: [
        cand({ stopId: "st1", isCurrent: true }),
        cand({ stopId: "st2", siblingOnRoute: "Isha Patel" }),
      ],
    }),
  );
  assert.match(p, /THIS IS WHERE THE CHILD BOARDS NOW/);
  assert.match(p, /sibling Isha Patel already on this bus/);
}

/* ── One option is not a choice worth paying a model for ── */
{
  assert.equal(boardingSuggestionWorthAsking(facts({ candidates: [] })), false);
  assert.equal(boardingSuggestionWorthAsking(facts({ candidates: [cand({})] })), false);
  assert.equal(boardingSuggestionWorthAsking(facts({})), true);
}

/* ── What the location cannot separate ── */
{
  const f = facts({
    homePrecision: "village",
    noiseFloorKm: 1,
    candidates: [
      cand({ stopId: "a", walkKm: 0.8 }),
      cand({ stopId: "b", walkKm: 1.5 }),
      cand({ stopId: "c", walkKm: 2.4 }),
    ],
  });
  assert.deepEqual(
    candidatesWithinNoise(f).map((c) => c.stopId),
    ["a", "b"],
    "0.8 and 1.5 are within a kilometre of each other; 2.4 is not",
  );

  const sharp = facts({
    homePrecision: "pin",
    noiseFloorKm: 0.15,
    candidates: [cand({ stopId: "a", walkKm: 0.4 }), cand({ stopId: "b", walkKm: 1.1 })],
  });
  assert.deepEqual(
    candidatesWithinNoise(sharp).map((c) => c.stopId),
    ["a"],
    "a doorstep pin can tell 0.4 km from 1.1 km apart",
  );

  assert.deepEqual(candidatesWithinNoise(facts({ candidates: [] })), []);
}

console.log("  ✓ boarding suggestion — allow-listed stops, unknowns stay unknown");
