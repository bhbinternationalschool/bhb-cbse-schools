/**
 * Self-test: bus ETAs and the parent messages built from them.
 * Run: npx tsx apps/web/src/lib/transportParentMessages.selftest.ts
 *
 * Two rules, both learned from this fleet:
 *
 *   - An unmeasured route yields NO ETA. A parent standing at a stop on the
 *     strength of an invented time is the failure being avoided, and it is
 *     the same judgement the afternoon planner already makes.
 *   - A message with a missing variable is not sent. "expected at at about"
 *     is worse than silence: the parent acts on it.
 */

import assert from "node:assert/strict";

import {
  buildStopEtas,
  buildTransportMessage,
  TRANSPORT_TEMPLATES,
} from "./transportParentMessages";
import type { TransportRoute } from "./transport";

console.log("transportParentMessages.selftest.ts");

function route(opts: {
  roundTripMinutes?: number;
  stops: { id: string; name: string; km: number }[];
}): TransportRoute {
  return {
    id: "r1",
    code: "MAGIC-1",
    name: "Magic 1",
    busNo: "MAGIC 1",
    isActive: true,
    ...(opts.roundTripMinutes ? { roundTripMinutes: opts.roundTripMinutes } : {}),
    stops: opts.stops.map((s, i) => ({
      id: s.id,
      name: s.name,
      sequence: i + 1,
      distanceKm: s.km,
      monthlyFeePaise: 50000,
      distanceSource: "google",
    })),
  } as unknown as TransportRoute;
}

const measured = route({
  roundTripMinutes: 60,
  stops: [
    { id: "far", name: "Katari Bazar", km: 10 },
    { id: "mid", name: "Ayar Mod", km: 5 },
    { id: "near", name: "Jagdishpur", km: 2 },
  ],
});

/* ── the furthest stop is reached first ─────────────────────── */

const etas = buildStopEtas(measured, "06:30");
const byId = new Map(etas.map((e) => [e.stopId, e]));

assert.equal(byId.get("far")!.expectedAt, "07:00", "30 min out to the furthest stop");
assert.ok(
  byId.get("mid")!.minutesFromStart! > byId.get("far")!.minutesFromStart!,
  "nearer stops are collected on the way back in",
);
assert.ok(
  byId.get("near")!.minutesFromStart! > byId.get("mid")!.minutesFromStart!,
  "and the nearest is last",
);
// The whole outbound-and-back leg fits inside the measured round trip.
for (const e of etas) {
  assert.ok(e.minutesFromStart! <= 60, `${e.stopName} must fit in the round trip`);
}

/* ── times are real clock times ─────────────────────────────── */

for (const e of etas) {
  assert.ok(/^\d{2}:\d{2}$/.test(e.expectedAt!), `bad time: ${e.expectedAt}`);
}
// And they wrap properly rather than producing "25:10".
const lateRun = buildStopEtas(measured, "23:50");
assert.ok(/^\d{2}:\d{2}$/.test(lateRun[0].expectedAt!));
assert.ok(Number(lateRun[0].expectedAt!.slice(0, 2)) < 24);

/* ── THE protection: unmeasured yields nothing ──────────────── */

const unmeasured = buildStopEtas(
  route({ stops: [{ id: "a", name: "Ayar Mod", km: 4 }] }),
  "06:30",
);
assert.equal(unmeasured[0].expectedAt, null, "no round trip -> no ETA");
assert.ok(/never been measured/.test(unmeasured[0].reason));

const noDistance = buildStopEtas(
  route({ roundTripMinutes: 60, stops: [{ id: "a", name: "Ayar Mod", km: 0 }] }),
  "06:30",
);
assert.equal(noDistance[0].expectedAt, null, "no distances -> no ETA");

const noDeparture = buildStopEtas(measured, "");
assert.equal(noDeparture[0].expectedAt, null, "no departure time -> no ETA");
assert.ok(/departure time/.test(noDeparture[0].reason));

// A single unmeasured stop on an otherwise good route is blanked alone —
// the rest of the run still gets its times.
const mixed = buildStopEtas(
  route({
    roundTripMinutes: 60,
    stops: [
      { id: "ok", name: "Katari Bazar", km: 10 },
      { id: "bad", name: "New Stop", km: 0 },
    ],
  }),
  "06:30",
);
assert.ok(mixed.find((e) => e.stopId === "ok")!.expectedAt);
assert.equal(mixed.find((e) => e.stopId === "bad")!.expectedAt, null);

/* ── messages are templates, never free text ────────────────── */

const eta = buildTransportMessage("eta", {
  "child name": "AARAV",
  "stop name": "Ayar Mod",
  "expected time": "07:10",
  bus: "MAGIC 1",
});
assert.equal(eta.ok, true);
if (!eta.ok) throw new Error("unreachable");
assert.equal(eta.message.templateName, "bhb_transport_eta");
assert.equal(eta.message.variables.length, 4, "ordered body variables");
assert.deepEqual(eta.message.variables, ["AARAV", "Ayar Mod", "07:10", "MAGIC 1"]);
assert.ok(/AARAV/.test(eta.message.preview));
assert.ok(
  /not a live position/.test(eta.message.preview),
  "the parent is told this is a schedule, not a live fix",
);
assert.ok(!/\{\{/.test(eta.message.preview), "no placeholder survives into the preview");

/* ── a hole in the sentence means nothing is sent ───────────── */

const missing = buildTransportMessage("eta", {
  "child name": "AARAV",
  "stop name": "Ayar Mod",
  "expected time": "",
  bus: "MAGIC 1",
});
assert.equal(missing.ok, false);
if (missing.ok) throw new Error("unreachable");
assert.ok(/expected time/.test(missing.error), "names the variable that is missing");

// Whitespace is not a value either.
assert.equal(
  buildTransportMessage("eta", {
    "child name": "  ",
    "stop name": "Ayar Mod",
    "expected time": "07:10",
    bus: "MAGIC 1",
  }).ok,
  false,
);

/* ── every kind is complete and self-consistent ─────────────── */

for (const [kind, def] of Object.entries(TRANSPORT_TEMPLATES)) {
  assert.ok(def.name.startsWith("bhb_transport_"), `${kind} needs a namespaced name`);
  const placeholders = [...def.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const highest = Math.max(...placeholders);
  assert.equal(
    highest,
    def.variables.length,
    `${kind}: body uses {{${highest}}} but declares ${def.variables.length} variables`,
  );
  // Every slot from 1..n is actually used, or Meta rejects the template.
  for (let i = 1; i <= def.variables.length; i += 1) {
    assert.ok(placeholders.includes(i), `${kind}: {{${i}}} is declared but never used`);
  }
}

console.log("  ok");
