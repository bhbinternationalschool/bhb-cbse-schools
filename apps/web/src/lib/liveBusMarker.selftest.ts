/**
 * Self-test: how a bus is drawn on the live map, and when it may move.
 * Run: npx tsx apps/web/src/lib/liveBusMarker.selftest.ts
 *
 * The rules this exists to protect, all three about not implying motion the
 * feed cannot support:
 *   - a parked bus is never pointed by its last heading;
 *   - an implausible jump snaps rather than sliding a bus through fields;
 *   - a stale fix never animates, because a moving marker is the strongest
 *     "this is happening now" a screen has.
 */

import assert from "node:assert/strict";

import {
  ANIMATE_MS,
  MAX_ANIMATE_KMH,
  appliedRotation,
  busMotion,
  decideAnimation,
  easeInOut,
  interpolate,
  liveBusStyle,
  metresBetween,
  normalizeCourseDeg,
  shortestRotation,
} from "./liveBusMarker";

console.log("liveBusMarker.selftest.ts");

/* ── A bearing, or nothing ── */
{
  assert.equal(normalizeCourseDeg(0), 0, "0 is due north and occurs while moving");
  assert.equal(normalizeCourseDeg(180), 180);
  assert.equal(normalizeCourseDeg(359.5), 359.5);
  assert.equal(normalizeCourseDeg(360), 0, "360 and 0 are one heading, not a full turn apart");

  // Production carries exactly one ping reading 361. It is not a bearing.
  assert.equal(normalizeCourseDeg(361), null);
  assert.equal(normalizeCourseDeg(-1), null);
  assert.equal(normalizeCourseDeg(null), null);
  assert.equal(normalizeCourseDeg(undefined), null);
  assert.equal(normalizeCourseDeg(Number.NaN), null);
}

/* ── Moving, stopped, or honestly unknown ── */
{
  assert.equal(busMotion({ speedKmh: 34 }), "moving");
  assert.equal(busMotion({ speedKmh: 0 }), "stopped");
  assert.equal(busMotion({ speedKmh: 2 }), "stopped", "GPS drift at a standstill");
  assert.equal(busMotion({ speedKmh: null }), "unknown");
  assert.equal(
    busMotion({ speedKmh: null, ignitionOn: false }),
    "stopped",
    "ignition off is definitely not moving",
  );
  assert.equal(
    busMotion({ speedKmh: null, ignitionOn: true }),
    "unknown",
    "ignition on cannot tell driving from idling — it must not be promoted to moving",
  );
}

/* ── A parked bus must not be pointed ── */
{
  const driving = liveBusStyle({
    lat: 25.4, lng: 82.9, speedKmh: 40, courseDeg: 275, freshness: "live",
  });
  assert.equal(driving.directional, true);
  assert.equal(driving.rotation, 275);
  assert.equal(driving.motion, "moving");

  // The tracker keeps reporting the heading it last saw. Rotating by it makes
  // a bus parked at the school appear to be driving north.
  const parked = liveBusStyle({
    lat: 25.4, lng: 82.9, speedKmh: 0, courseDeg: 275, freshness: "live",
  });
  assert.equal(parked.directional, false);
  assert.equal(parked.rotation, null);
  assert.equal(parked.motion, "stopped");

  // Moving but no usable heading → still not pointed; we do not invent one.
  const headless = liveBusStyle({
    lat: 25.4, lng: 82.9, speedKmh: 40, courseDeg: 361, freshness: "live",
  });
  assert.equal(headless.directional, false);
  assert.equal(headless.rotation, null);
}

/* ── A non-directional icon is upright, not tilted at the last heading ── */
{
  // Caught in the browser, not by the first version of this file: the stopped
  // icon is a tall rounded rectangle, and carrying the previous heading
  // through drew a parked bus leaning over at 300 degrees.
  const parked = liveBusStyle({
    lat: 0, lng: 0, speedKmh: 0, courseDeg: 300, freshness: "live",
  });
  assert.equal(appliedRotation(parked, 300), 0, "a stopped bus is drawn upright");
  assert.equal(appliedRotation(parked, 0), 0);

  const driving = liveBusStyle({
    lat: 0, lng: 0, speedKmh: 30, courseDeg: 300, freshness: "live",
  });
  assert.equal(appliedRotation(driving, 300), 300, "already pointing the right way");
  // Turning 350 -> 10 goes forward through 370, not backwards through 10.
  const turning = liveBusStyle({
    lat: 0, lng: 0, speedKmh: 30, courseDeg: 10, freshness: "live",
  });
  assert.equal(appliedRotation(turning, 350), 370);

  // Moving but with an unusable bearing is still upright — we do not keep
  // pointing it at a heading the tracker has stopped vouching for.
  const headless = liveBusStyle({
    lat: 0, lng: 0, speedKmh: 30, courseDeg: 361, freshness: "live",
  });
  assert.equal(appliedRotation(headless, 275), 0);
}

/* ── Age is in the colour, and a stale fix is visibly not live ── */
{
  const live = liveBusStyle({ lat: 0, lng: 0, speedKmh: 30, courseDeg: 90, freshness: "live" });
  const recent = liveBusStyle({ lat: 0, lng: 0, speedKmh: 30, courseDeg: 90, freshness: "recent" });
  const stale = liveBusStyle({ lat: 0, lng: 0, speedKmh: 30, courseDeg: 90, freshness: "stale" });
  const cold = liveBusStyle({ lat: 0, lng: 0, speedKmh: 30, courseDeg: 90, freshness: "cold" });

  assert.notEqual(live.fill, recent.fill, "live and recent must be distinguishable");
  assert.equal(live.opacity, 1);
  assert.ok(stale.opacity < 1, "a stale fix is faded");
  assert.ok(cold.opacity < stale.opacity, "colder is fainter still");
}

/* ── Animation: only between two known, plausible, fresh fixes ── */
{
  const a = { lat: 25.4354, lng: 82.9440 };
  // ~120 m north — an ordinary 30 s of travel.
  const b = { lat: 25.4365, lng: 82.9440 };

  const ok = decideAnimation({ from: a, to: b, elapsedMs: 30_000, freshness: "live" });
  assert.equal(ok.animate, true);
  if (ok.animate) assert.equal(ok.durationMs, ANIMATE_MS);

  // The very first fix has nothing to travel from — it is placed, not moved.
  const first = decideAnimation({ from: null, to: b, elapsedMs: 0, freshness: "live" });
  assert.equal(first.animate, false);
  if (!first.animate) assert.equal(first.reason, "first-fix");

  // GPS jitter around a stationary vehicle must not make it twitch.
  const jitter = decideAnimation({
    from: a, to: { lat: a.lat + 0.00002, lng: a.lng }, elapsedMs: 30_000, freshness: "live",
  });
  assert.equal(jitter.animate, false);
  if (!jitter.animate) assert.equal(jitter.reason, "no-movement");

  // 6 km in 30 s is 720 km/h — a dropped fix, not a journey. Sliding the icon
  // would draw a bus taking a route through fields that it never took.
  const teleport = decideAnimation({
    from: a, to: { lat: a.lat + 0.054, lng: a.lng }, elapsedMs: 30_000, freshness: "live",
  });
  assert.equal(teleport.animate, false);
  if (!teleport.animate) assert.equal(teleport.reason, "implausible");

  // The same 6 km over an hour is just a bus that drove there. Still not
  // animated — see below — but it is not the implausible case.
  const overAnHour = decideAnimation({
    from: a, to: { lat: a.lat + 0.054, lng: a.lng }, elapsedMs: 3_600_000, freshness: "live",
  });
  assert.equal(overAnHour.animate, true, "60 min for 6 km is 6 km/h, entirely plausible");

  // A fix an hour old is a last known position, not a live one.
  for (const f of ["stale", "cold"] as const) {
    const old = decideAnimation({ from: a, to: b, elapsedMs: 30_000, freshness: f });
    assert.equal(old.animate, false);
    if (!old.animate) assert.equal(old.reason, "not-fresh");
  }
}

/* ── The speed ceiling is where it says it is ── */
{
  const a = { lat: 25.4, lng: 82.9 };
  // Pick a distance that lands just under the ceiling over one minute.
  const underKm = (MAX_ANIMATE_KMH / 60) * 0.9;
  const overKm = (MAX_ANIMATE_KMH / 60) * 1.1;
  const north = (km: number) => ({ lat: a.lat + km / 111.32, lng: a.lng });

  assert.equal(
    decideAnimation({ from: a, to: north(underKm), elapsedMs: 60_000, freshness: "live" }).animate,
    true,
  );
  assert.equal(
    decideAnimation({ from: a, to: north(overKm), elapsedMs: 60_000, freshness: "live" }).animate,
    false,
  );
}

/* ── Interpolation stays on the segment ── */
{
  const a = { lat: 0, lng: 0 };
  const b = { lat: 10, lng: 20 };
  assert.deepEqual(interpolate(a, b, 0), a);
  assert.deepEqual(interpolate(a, b, 1), b);
  assert.deepEqual(interpolate(a, b, 0.5), { lat: 5, lng: 10 });
  // Clamped: an overrunning frame must never place the bus past its last fix.
  assert.deepEqual(interpolate(a, b, 1.4), b, "never extrapolate beyond the known fix");
  assert.deepEqual(interpolate(a, b, -2), a);
}

/* ── Easing is bounded and monotonic at the ends ── */
{
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(Math.round(easeInOut(0.5) * 1000) / 1000, 0.5);
  assert.equal(easeInOut(-1), 0);
  assert.equal(easeInOut(5), 1);
}

/* ── A bus turning north does not spin the long way round ── */
{
  // 350° → 10° is a 20° turn to the right, not 340° to the left.
  assert.equal(shortestRotation(350, 10), 370);
  assert.equal(shortestRotation(10, 350), -10);
  assert.equal(shortestRotation(90, 180), 180);
  assert.equal(shortestRotation(0, 0), 0);
  // Exactly opposite is 180 either way; it must stay bounded.
  assert.ok(Math.abs(shortestRotation(0, 180) - 0) <= 180);
}

/* ── Distance sanity, since every animation rule leans on it ── */
{
  const school = { lat: 25.4354328, lng: 82.9439863 };
  assert.equal(Math.round(metresBetween(school, school)), 0);
  // 0.001° of latitude is about 111 m anywhere.
  const north = { lat: school.lat + 0.001, lng: school.lng };
  const m = metresBetween(school, north);
  assert.ok(m > 105 && m < 118, `expected ~111 m, got ${m}`);
}

console.log("  ✓ live bus marker — parked buses are not pointed, teleports do not animate");
