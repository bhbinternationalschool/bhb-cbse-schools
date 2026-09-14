/**
 * Self-test: judging a family's WhatsApp pin against their stop and home.
 * Run: npx tsx src/lib/pinReview.selftest.ts
 */

import assert from "node:assert/strict";

import { kmBetween, mapsLink, reviewPin } from "./pinReview";

console.log("pinReview.selftest.ts");

const school = { lat: 25.4354328, lng: 82.9 };
const east = (km: number) => ({ lat: school.lat, lng: school.lng + km / 100.6 }); // ~1 km per 0.00994° here

assert.ok(Math.abs(kmBetween(school, east(1)) - 1) < 0.05);
assert.equal(mapsLink({ lat: 25.1, lng: 82.2 }), "https://www.google.com/maps?q=25.100000,82.200000");

// Standing at their stop.
const near = reviewPin({ pin: east(2), assignedStop: { name: "Ayar Bazar", at: east(2.2) }, routeStops: [{ name: "Ayar Bazar", at: east(2.2) }], home: null });
assert.equal(near.verdict, "ok");
assert.ok(near.findings.includes("near_assigned_stop"));

// Far from their stop, and another stop on the same route is right there.
const other = reviewPin({
  pin: east(5),
  assignedStop: { name: "Ayar Bazar", at: east(2) },
  routeStops: [{ name: "Ayar Bazar", at: east(2) }, { name: "Kakalpur", at: east(5.1) }],
  home: null,
});
assert.equal(other.verdict, "check");
assert.ok(other.findings.includes("far_from_assigned_stop"));
assert.ok(other.findings.includes("closer_to_another_stop"));
assert.match(other.summary, /Kakalpur/);

// Sent from far away from the recorded village.
const away = reviewPin({ pin: east(8), assignedStop: { name: "X", at: east(8) }, routeStops: [], home: { label: "Mahadevpur", at: east(2), precision: "village" } });
assert.ok(away.findings.includes("far_from_recorded_home"));
assert.match(away.summary, /somewhere else/);
// Far from the village centroid but right beside a stop on their route: the village is the suspect.
const wrongVillage = reviewPin({ pin: east(8), assignedStop: null, stopLinkBroken: true, routeStops: [{ name: "Mahadepur", at: east(8.3) }], home: { label: "Mahadevpur", at: east(2), precision: "village" } });
assert.match(wrongVillage.summary, /recorded village is more likely wrong/);
// A village centroid a kilometre out is not a finding.
const centroid = reviewPin({ pin: east(3), assignedStop: { name: "X", at: east(3) }, routeStops: [], home: { label: "V", at: east(2), precision: "village" } });
assert.ok(!centroid.findings.includes("far_from_recorded_home"));
// But a kilometre and a half from a geocoded home address is.
const addr = reviewPin({ pin: east(3.8), assignedStop: { name: "X", at: east(3.8) }, routeStops: [], home: { label: "home", at: east(2), precision: "household" } });
assert.ok(addr.findings.includes("far_from_recorded_home"));

// The stop link is broken: said as that, with the nearest stop as evidence.
const broken = reviewPin({
  pin: east(3),
  assignedStop: null,
  stopLinkBroken: true,
  routeStops: [{ name: "Shivrampur", at: east(3.2) }, { name: "Far", at: east(9) }],
  home: null,
});
assert.equal(broken.verdict, "check");
assert.ok(broken.findings.includes("stop_link_broken"));
assert.ok(!broken.findings.includes("no_stop_assigned"));
assert.match(broken.summary, /broken/);
assert.match(broken.summary, /Shivrampur/);

// A stop with no map position cannot be compared, and says so.
const unmapped = reviewPin({ pin: east(3), assignedStop: { name: "Old stop", at: null }, routeStops: [], home: null });
assert.ok(unmapped.findings.includes("assigned_stop_not_mapped"));
assert.match(unmapped.summary, /no map position/);

console.log("  ok");
