import assert from "node:assert/strict";
import {
  MAX_PLAUSIBLE_KM,
  billableSources,
  freeRoutingBillable,
  freeRoutingEngine,
  freeRoutingRequest,
  isBillableSource,
  kmFromMeters,
  parseFreeRoutingMeters,
  plausibleSchoolRunKm,
  validLatLng,
} from "./freeRouting";
import { normalizeStop } from "./transport";

console.log("freeRouting.selftest.ts");

/* ── Engine selection: off unless configured ─────────────────────────── */

assert.equal(freeRoutingEngine({}), null, "no engine by default");
assert.equal(freeRoutingEngine({ ORS_API_KEY: "  " }), null, "blank is not a key");
assert.deepEqual(freeRoutingEngine({ ORS_API_KEY: " k1 " }), { kind: "ors", apiKey: "k1" });
assert.deepEqual(
  freeRoutingEngine({ OSRM_BASE_URL: "https://osrm.internal/" }),
  { kind: "osrm", baseUrl: "https://osrm.internal" },
  "trailing slash trimmed",
);
// A half-set variable must DISABLE the tier, not build "undefined/route/v1/…".
assert.equal(freeRoutingEngine({ OSRM_BASE_URL: "undefined" }), null);
assert.equal(freeRoutingEngine({ OSRM_BASE_URL: "osrm.internal" }), null, "needs a scheme");
// ORS wins when both are set: a supported service with a quota beats
// whatever the school last deployed.
assert.deepEqual(
  freeRoutingEngine({ ORS_API_KEY: "k", OSRM_BASE_URL: "https://osrm.internal" }),
  { kind: "ors", apiKey: "k" },
);

/* ── Billing: opt-in, spelled exactly ────────────────────────────────── */

assert.equal(freeRoutingBillable({}), false, "free distances do not bill by default");
assert.equal(freeRoutingBillable({ ROUTING_FREE_BILLABLE: "1" }), false);
assert.equal(freeRoutingBillable({ ROUTING_FREE_BILLABLE: "TRUE" }), false, "case matters");
assert.equal(freeRoutingBillable({ ROUTING_FREE_BILLABLE: "true" }), true);

assert.deepEqual(billableSources(false), ["google"]);
assert.deepEqual(billableSources(true), ["google", "free"]);
assert.equal(isBillableSource("free", false), false, "the whole point of the flag");
assert.equal(isBillableSource("free", true), true);
assert.equal(isBillableSource("estimate", true), false, "a guess never bills, flag or not");
assert.equal(isBillableSource("google", false), true);

/* ── Coordinates ─────────────────────────────────────────────────────── */

assert.ok(validLatLng({ lat: 25.31, lng: 82.97 }), "Varanasi");
assert.equal(validLatLng({ lat: 0, lng: 0 }), false, "0,0 is an unparsed coordinate");
assert.equal(validLatLng({ lat: 95, lng: 10 }), false, "off the planet");
assert.equal(validLatLng({ lat: NaN, lng: 10 }), false);
assert.equal(validLatLng({ lat: "25.31", lng: "82.97" }), false, "strings are not numbers");
assert.equal(validLatLng(null), false);

/* ── Requests: lon,lat — the easiest thing here to get wrong ─────────── */

{
  const from = { lat: 25.31, lng: 82.97 };
  const to = { lat: 25.28, lng: 82.95 };
  const osrm = freeRoutingRequest({ kind: "osrm", baseUrl: "https://osrm.internal" }, from, to);
  assert.match(osrm.url, /\/route\/v1\/driving\/82\.97,25\.31;82\.95,25\.28/, "lon first");
  assert.match(osrm.url, /overview=false/, "we want a number, not a polyline");
  assert.equal(osrm.init.method, "GET");

  const ors = freeRoutingRequest({ kind: "ors", apiKey: "secret" }, from, to);
  assert.equal(ors.init.method, "POST");
  assert.equal(
    (ors.init.headers as Record<string, string>).Authorization,
    "secret",
    "ORS takes the key bare in Authorization",
  );
  assert.deepEqual(JSON.parse(String(ors.init.body)), {
    coordinates: [
      [82.97, 25.31],
      [82.95, 25.28],
    ],
  }, "lon,lat in the body too");
}

/* ── Responses: three shapes, and refusal ────────────────────────────── */

assert.equal(parseFreeRoutingMeters({ code: "Ok", routes: [{ distance: 4520.4 }] }), 4520.4, "OSRM");
assert.equal(
  parseFreeRoutingMeters({ routes: [{ summary: { distance: 4520.4, duration: 600 } }] }),
  4520.4,
  "ORS json",
);
assert.equal(
  parseFreeRoutingMeters({ features: [{ properties: { summary: { distance: 4520.4 } } }] }),
  4520.4,
  "ORS geojson",
);
// OSRM says so when it could not route — never read a distance past that.
assert.equal(parseFreeRoutingMeters({ code: "NoRoute", routes: [{ distance: 12 }] }), null);
assert.equal(parseFreeRoutingMeters({ routes: [] }), null);
assert.equal(parseFreeRoutingMeters({ routes: [{ distance: 0 }] }), null, "zero is not a route");
assert.equal(parseFreeRoutingMeters({ routes: [{ distance: -5 }] }), null);
assert.equal(parseFreeRoutingMeters({ error: "quota" }), null);
assert.equal(parseFreeRoutingMeters("<html>502</html>"), null);
assert.equal(parseFreeRoutingMeters(null), null);

assert.equal(kmFromMeters(4520.4), 4.5);
assert.equal(kmFromMeters(50), 0.1);

/* ── Plausibility: a wrong continent must not become an invoice ──────── */

assert.ok(plausibleSchoolRunKm(4.5));
assert.ok(plausibleSchoolRunKm(MAX_PLAUSIBLE_KM));
assert.equal(plausibleSchoolRunKm(MAX_PLAUSIBLE_KM + 0.1), false);
assert.equal(plausibleSchoolRunKm(0), false);
assert.equal(plausibleSchoolRunKm(NaN), false);

/* ── Provenance survives normalisation ───────────────────────────────── */

// A stop measured for free must keep saying so. Recording it as "google"
// would be a false audit trail on the number a fee is defended from.
assert.equal(normalizeStop({ distanceKm: 4.5, distanceSource: "free" }, 0).distanceSource, "free");
assert.equal(normalizeStop({ distanceKm: 4.5, distanceSource: "google" }, 0).distanceSource, "google");
assert.equal(normalizeStop({ distanceKm: 4.5, distanceSource: "manual" }, 0).distanceSource, "manual");
// Unchanged legacy behaviour: a distance with no provenance is "manual",
// and no distance at all stays unsourced.
assert.equal(normalizeStop({ distanceKm: 4.5 }, 0).distanceSource, "manual");
assert.equal(normalizeStop({}, 0).distanceSource, "");
assert.equal(
  normalizeStop({ distanceKm: 4.5, distanceSource: "osrm" as never }, 0).distanceSource,
  "manual",
  "a source nobody defined is not trusted through",
);

console.log("OK — freeRouting.selftest.ts");
