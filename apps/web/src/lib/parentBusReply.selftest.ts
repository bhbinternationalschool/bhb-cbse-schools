/**
 * What a parent is told about their child's bus.
 *
 * These are not formatting tests. Every string here is a claim a parent will
 * act on — a father who reads "your bus is here" drives to the stop — so the
 * rules under test are about honesty, not layout:
 *
 *  - a shared position always carries its age, because a fix without one
 *    reads as "now";
 *  - "no tracker fitted" is never phrased as a delay, because for 94 children
 *    it is permanent and "try again later" would be a lie they keep retrying;
 *  - no refusal ever guesses.
 *
 * Run: npx tsx src/lib/parentBusReply.selftest.ts
 */
import assert from "node:assert/strict";

import {
  composeBusCheckFailedReply,
  composeBusFoundReply,
  composeBusUnavailableReply,
  detectBusLocationIntent,
  joinBusReplies,
  wantsHindi,
} from "./parentBusReply";

console.log("parentBusReply.selftest.ts");

// The question, as parents actually ask it.
{
  const yes = [
    "BUS",
    "bus",
    "where is the bus",
    "bus kahan hai",
    "gaadi kahan hai",
    "bus kab aayegi",
    "बस कहाँ है",
    "गाड़ी कब आएगी",
    "bus kidhar hai bhaiya",
    "van location",
    "track the bus",
    "bus kaha ba",           // Bhojpuri
    "gadi kab aai",          // Bhojpuri
  ];
  for (const t of yes) {
    assert.equal(detectBusLocationIntent(t), true, `should detect: ${t}`);
  }
}

// Things that must NOT be read as a bus question.
{
  const no = [
    "",
    "business hours kya hai",
    "I am busy right now",
    "DUES",
    "fee kitna hai",
    "where is the fee receipt",
    "my child is absent",
  ];
  for (const t of no) {
    assert.equal(detectBusLocationIntent(t), false, `should not detect: ${t}`);
  }
}

// Reply language follows the language asked in.
{
  assert.equal(wantsHindi("बस कहाँ है"), true);
  assert.equal(wantsHindi("bus kahan hai"), false, "romanised Hindi still gets the English reply");
  assert.equal(wantsHindi(""), false);
}

const CTX = {
  busLabel: "Magic-1",
  childName: "Rahul",
  motionLabel: "Moving",
  speedKmh: 24,
  ageLabel: "just now",
  mapsUrl: "https://www.google.com/maps?q=25.435608,82.944422",
};

// A shared position always carries its age and the link.
{
  for (const hindi of [false, true]) {
    const r = composeBusFoundReply(CTX, hindi);
    assert.ok(r.includes("Magic-1"), "names the bus");
    assert.ok(r.includes("Rahul"), "names the child");
    assert.ok(r.includes(CTX.mapsUrl), "carries the map link");
    assert.ok(
      r.includes("just now"),
      "the age is in the message — a fix without one reads as 'now'",
    );
    assert.ok(r.includes("24 km/h"), "speed shown while moving");
  }
}

// A stationary bus does not get a "0 km/h" that reads like a fault.
{
  const parked = composeBusFoundReply(
    { ...CTX, motionLabel: "Parked", speedKmh: 0 },
    false,
  );
  assert.ok(!parked.includes("km/h"), "no speed line when it is not moving");
}

// One child in the household: no name to disambiguate, so none is shown.
{
  const solo = composeBusFoundReply({ ...CTX, childName: "" }, false);
  assert.ok(!solo.includes("()"), "no empty brackets where a name would be");
}

// The vehicle's position is not the child's stop time, and says so.
{
  const en = composeBusFoundReply(CTX, false);
  assert.ok(/not your child's stop time/i.test(en));
  const hi = composeBusFoundReply(CTX, true);
  assert.ok(hi.includes("स्टॉप"), "the same caveat in Hindi");
}

// Every refusal names the bus or the child, and offers a person.
{
  const reasons = ["no-vehicle", "no-feed", "off-trip", "too-old"] as const;
  for (const reason of reasons) {
    for (const hindi of [false, true]) {
      const r = composeBusUnavailableReply(reason, { busLabel: "Winger", childName: "Aarav" }, hindi);
      assert.ok(r.length > 20, `${reason} says something`);
      // Nothing may invent a position.
      assert.ok(
        !/google\.com\/maps/.test(r),
        `${reason} must not carry a map link`,
      );
      assert.ok(
        !/probably|shayad|लगभग|maybe/i.test(r),
        `${reason} must not hedge into a guess`,
      );
    }
  }
}

// "No tracker" is permanent, and must never be phrased as a delay. For 94
// children this is the answer forever, until a tracker is fitted.
{
  for (const hindi of [false, true]) {
    const r = composeBusUnavailableReply("no-feed", { busLabel: "City Bus", childName: "" }, hindi);
    assert.ok(r.includes("City Bus"), "names the vehicle");
    assert.ok(
      !/try again|later|thodi der|कुछ देर|बाद में/i.test(r),
      "never invites a parent to retry something that cannot work",
    );
    assert.ok(/HUMAN/.test(r), "offers a person instead");
  }
}

// Off-trip explains the rule rather than refusing flatly, so a parent knows
// when asking WILL work.
{
  const r = composeBusUnavailableReply("off-trip", { busLabel: "Magic-2", childName: "" }, false);
  assert.ok(/morning and afternoon/i.test(r), "says when live location is available");
}

// A household whose children ride different buses gets both, separated.
{
  const joined = joinBusReplies(["first bus", "second bus"]);
  assert.ok(joined.includes("first bus") && joined.includes("second bus"));
  assert.ok(joined.split("———").length === 2, "one separator between two replies");
  assert.equal(joinBusReplies(["only one"]), "only one", "no separator for a single bus");
  assert.equal(joinBusReplies(["a", "", "b"]).split("———").length, 2, "empties are dropped");
}

// A failed lookup must never be reported as "you have no bus".
{
  for (const hindi of [false, true]) {
    const r = composeBusCheckFailedReply(hindi);
    assert.ok(/HUMAN/.test(r), "offers a person");
    assert.ok(!/google\.com\/maps/.test(r), "invents no position");
    assert.ok(
      !/no school transport|गाड़ी दर्ज नहीं/.test(r),
      "a read failure says nothing about whether the child rides a bus",
    );
  }
}

console.log("OK");
