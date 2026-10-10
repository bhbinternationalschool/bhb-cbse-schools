/**
 * Run: npx tsx src/lib/punchScreenGeofence.selftest.ts
 *
 * Director, 3 Oct 2026: the punch QR screen works only inside the school.
 */
import assert from "node:assert/strict";
import { validateScreenLocation } from "./staffGeofence.server";

const fence = { lat: 25.3, lng: 82.9, radiusM: 150 };
const at = (northM: number, accuracyM?: number) => ({ lat: fence.lat + northM / 111_320, lng: fence.lng, accuracyM });

assert.equal(validateScreenLocation(at(20, 15), fence).ok, true, "in the office");
assert.equal(validateScreenLocation(at(200, 80), fence).ok, true, "edge of campus, laptop Wi-Fi accuracy");
assert.equal(validateScreenLocation(at(400, 30), fence).ok, false, "a house 400 m away");
assert.match(validateScreenLocation(at(2000, 20), fence).reason || "", /from the school/);
// A vague reading proves nothing either way: refused, with what to do.
const vague = validateScreenLocation(at(10, 900), fence);
assert.equal(vague.ok, false);
assert.match(vague.reason || "", /precisely enough/);
// The allowance is capped: a 250 m reading cannot stretch the fence to 400 m.
assert.equal(validateScreenLocation(at(330, 250), fence).ok, false);
// No location at all — refused, never assumed inside.
for (const g of [null, {}, { lat: "x", lng: 1 }, { lat: 0, lng: 0 }]) {
  assert.equal(validateScreenLocation(g as never, fence).ok, false);
}
// Query-string values arrive as text.
assert.equal(validateScreenLocation({ lat: String(fence.lat), lng: String(fence.lng), accuracyM: "25" }, fence).ok, true);

console.log("OK — punchScreenGeofence.selftest.ts");
