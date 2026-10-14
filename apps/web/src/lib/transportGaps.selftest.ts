/**
 * Transport gaps — the pure half.
 * Run: npx tsx src/lib/transportGaps.selftest.ts
 */
import assert from "node:assert/strict";
import {
  feeGapPaise,
  gapFromRow,
  liveTransportGaps,
  rupees,
  sortGaps,
  type TransportGap,
} from "./transportGaps";
import { groupStopsByOrigin, stopOrigin } from "./transportStopOrigin";

console.log("transportGaps.selftest.ts");

// A row with an unknown kind or status is dropped, not guessed into a bucket.
assert.equal(gapFromRow({ id: "g1", kind: "mystery", status: "open", title: "x" }), null);
assert.equal(gapFromRow({ id: "g1", kind: "driving", status: "maybe", title: "x" }), null);
assert.equal(gapFromRow({ id: "", kind: "driving", status: "open", title: "x" }), null);

const row = gapFromRow({
  id: "g2",
  kind: "fee_distance",
  status: "open",
  title: "Aarohi — billed for 11.2 km, measured 2.7 km",
  billed_km: "11.2",
  road_km: 2.7,
  straight_km: null,
  billed_fee_paise: 60000,
  policy_fee_paise: null,
  settled_at: null,
});
assert.ok(row);
assert.equal(row.billedKm, 11.2);
assert.equal(row.roadKm, 2.7);
assert.equal(row.straightKm, null, "a missing measurement stays missing, never 0");
assert.equal(row.policyFeePaise, null);
assert.equal(row.settledAt, null);

// Fee gap needs both sides; an unknown policy fee is not a ₹0 gap.
assert.equal(feeGapPaise({ billedFeePaise: 60000, policyFeePaise: null }), null);
assert.equal(feeGapPaise({ billedFeePaise: 100000, policyFeePaise: 130000 }), 30000);
assert.equal(feeGapPaise({ billedFeePaise: 130000, policyFeePaise: 100000 }), -30000);
assert.equal(rupees(null), "—");
assert.equal(rupees(-30000), "−₹300");
assert.equal(rupees(130000), "₹1,300");

// Live gaps: seat count 0 (not recorded), no driver, a used stop with no pin.
const live = liveTransportGaps({
  vehicles: [
    { id: "v1", name: "Magic-2", seatCapacity: 0, driverName: "", isActive: true },
    { id: "v2", name: "Winger", seatCapacity: 26, driverName: "Suraj", isActive: true },
    { id: "v3", name: "Old Van", seatCapacity: 0, driverName: "", isActive: false },
  ] as never,
  routes: [
    {
      id: "r1",
      name: "City Bus",
      vehicleId: "v2",
      isActive: true,
      stops: [
        { id: "s1", name: "Chandapur", sequence: 1, distanceKm: 5.7, distanceSource: "manual" },
        { id: "s2", name: "Ayar", sequence: 2, distanceKm: 1.5, distanceSource: "google", geoLat: 25.43, geoLng: 82.95 },
        { id: "s3", name: "Unused", sequence: 3, distanceKm: 2, distanceSource: "manual" },
      ],
    },
  ] as never,
  assignments: [
    { id: "a1", routeId: "r1", stopId: "s1", effectiveTo: null },
    { id: "a2", routeId: "r1", stopId: "s2", effectiveTo: null },
    { id: "a3", routeId: "r1", stopId: "s3", effectiveTo: "2026-09-01" },
  ] as never,
});
const ids = live.map((g) => g.id).sort();
assert.deepEqual(ids, ["live:driver:v1", "live:seats:v1", "live:stopgeo:s1"], "inactive vehicles and ended riders raise nothing");
// Fuel bills: last fill 20 days ago → gap; 3 days ago → none.
const now14 = Date.parse("2026-10-14T00:00:00Z");
const fuelOld = liveTransportGaps({ vehicles: [], routes: [], assignments: [], fuelRefillLogs: [{ vehicleId: "v", filledAt: "2026-09-24T12:00:00Z" }] }, now14);
assert.equal(fuelOld[0]?.id, "live:fuel-bills");
assert.match(fuelOld[0]!.title, /19 days/);
assert.equal(liveTransportGaps({ vehicles: [], routes: [], assignments: [], fuelRefillLogs: [{ vehicleId: "v", filledAt: "2026-10-11T12:00:00Z" }] }, now14).length, 0);
// An action on a stored row comes through with a label.
const withAction = gapFromRow({ id: "s1", kind: "suggestion", status: "open", title: "x", action: { type: "move_rider", assignmentId: "a" } });
assert.equal(withAction?.action?.type, "move_rider");
assert.equal(withAction?.action?.label, "Do it");
assert.ok(live.every((g) => g.live && g.status === "open"));

// Sorting: open before settled, fee gaps first.
const mk = (id: string, kind: TransportGap["kind"], status: TransportGap["status"]): TransportGap =>
  ({ ...live[0], id, kind, status, live: false, title: id, vehicle: "X" });
const sorted = sortGaps([mk("d", "driving", "open"), mk("f2", "fee_distance", "settled"), mk("f1", "fee_distance", "open")]);
assert.deepEqual(sorted.map((g) => g.id), ["f1", "d", "f2"]);

// Actual (GPS) vs manual stops: the note is the marker.
assert.equal(stopOrigin({ geoAddress: "From GPS: Magic-1 stops here on 20 of 25 school days" }), "gps");
assert.equal(stopOrigin({ geoAddress: "  From GPS: x" }), "gps");
assert.equal(stopOrigin({ geoAddress: "CXH2+RX5, Ayar, Uttar Pradesh" }), "manual");
assert.equal(stopOrigin({}), "manual");
assert.equal(stopOrigin(null), "manual");
const groups = groupStopsByOrigin([
  { id: "m2", sequence: 3, geoAddress: "Ayar" },
  { id: "g1", sequence: 2, geoAddress: "From GPS: a" },
  { id: "m1", sequence: 1 },
  { id: "g2", sequence: 4, geoAddress: "From GPS: b" },
]);
assert.deepEqual(groups.map((g) => [g.origin, g.stops.map((s) => s.id)]), [["gps", ["g1", "g2"]], ["manual", ["m1", "m2"]]]);
// A route with no GPS stops keeps one unlabelled list — Rajesh Van looks as before.
const plain = groupStopsByOrigin([{ id: "a", sequence: 2 }, { id: "b", sequence: 1 }]);
assert.equal(plain.length, 1);
assert.equal(plain[0].label, "");
assert.deepEqual(plain[0].stops.map((s) => s.id), ["b", "a"]);

console.log("ok");
