import assert from "node:assert/strict";
import {
  addMinutes,
  defaultStaffGeoSettings,
  distanceM,
  evaluateStaffGeo,
  inTrackingWindow,
  isInsideFence,
  istParts,
  normalizeStaffGeoSettings,
  staffGeoAlertText,
  type StaffGeoEvalInput,
} from "./staffGeo";

console.log("staffGeo.selftest.ts");
const school = { lat: 25.4354328, lng: 82.9439863 };
const S = { ...defaultStaffGeoSettings(school), enabled: true, updatedAt: "x" };

// Distance sanity: same point 0; ~111m per 0.001° latitude.
assert.equal(distanceM(school.lat, school.lng, school.lat, school.lng), 0);
const d = distanceM(school.lat, school.lng, school.lat + 0.001, school.lng);
assert.ok(d > 100 && d < 122, String(d));

// Fence: 150m radius + 60m tolerance + accuracy slack.
assert.equal(isInsideFence(S, { lat: school.lat, lng: school.lng, accuracyM: 10 }).inside, true);
assert.equal(isInsideFence(S, { lat: school.lat + 0.001, lng: school.lng, accuracyM: 10 }).inside, true, "111m is inside");
assert.equal(isInsideFence(S, { lat: school.lat + 0.004, lng: school.lng, accuracyM: 10 }).inside, false, "~444m is outside");

// Window: 08:00–14:30 IST Mon–Sat. 2026-08-19 is a Wednesday.
const at = (istHHMM: string) => new Date(new Date(`2026-08-19T${istHHMM}:00+05:30`).toISOString());
assert.equal(inTrackingWindow(S, at("09:00")), true);
assert.equal(inTrackingWindow(S, at("07:00")), false);
assert.equal(inTrackingWindow(S, at("15:00")), false);
assert.equal(inTrackingWindow({ ...S, enabled: false }, at("09:00")), false);
assert.equal(inTrackingWindow(S, new Date("2026-08-23T04:00:00Z")), false, "Sunday excluded");
assert.equal(istParts(at("09:00")).date, "2026-08-19");
assert.equal(addMinutes("08:00", 20), "08:20");
assert.equal(addMinutes("23:50", 20), "00:10");

const base: StaffGeoEvalInput = { staffId: "s1", empCode: "STF-001", fullName: "VISHNU OM TRIPATHI", ping: null, openIncident: null, consented: true, attendance: "P" };
const now = at("09:00");
const ping = (over: Partial<{ lat: number; lng: number; accuracyM: number; at: string; outsideSince: string }>) =>
  ({ staffId: "s1", at: at("08:56").toISOString(), lat: school.lat, lng: school.lng, accuracyM: 10, ...over }) as never;

// Inside + fresh → no incident.
assert.equal(evaluateStaffGeo(S, { ...base, ping: ping({}) }, now).incident, null);
// Outside beyond fence, outsideSince past grace → left_premises once.
const out = evaluateStaffGeo(S, { ...base, ping: ping({ lat: school.lat + 0.01, outsideSince: at("08:45").toISOString() }) }, now);
assert.equal(out.presence, "outside");
assert.equal(out.incident?.kind, "left_premises");
assert.match(out.incident!.detail, /\d+ m from campus/);
// Same state with open incident → no repeat alert.
assert.equal(evaluateStaffGeo(S, { ...base, ping: ping({ lat: school.lat + 0.01, outsideSince: at("08:45").toISOString() }), openIncident: "left_premises" }, now).incident, null);
// Outside but within grace → no incident yet.
assert.equal(evaluateStaffGeo(S, { ...base, ping: ping({ lat: school.lat + 0.01, outsideSince: at("08:55").toISOString() }) }, now).incident, null);
// Stale ping → location_off once.
const stale = evaluateStaffGeo(S, { ...base, ping: ping({ at: at("08:30").toISOString() }) }, now);
assert.equal(stale.presence, "stale");
assert.equal(stale.incident?.kind, "location_off");
assert.equal(evaluateStaffGeo(S, { ...base, ping: ping({ at: at("08:30").toISOString() }), openIncident: "location_off" }, now).incident, null);
// No ping today: alert only after start + staleAfter (08:20).
assert.equal(evaluateStaffGeo(S, base, at("08:10")).incident, null);
assert.equal(evaluateStaffGeo(S, base, at("08:25")).incident?.kind, "location_off");
// Recovery incidents.
assert.equal(evaluateStaffGeo(S, { ...base, ping: ping({}), openIncident: "left_premises" }, now).incident?.kind, "returned");
assert.equal(evaluateStaffGeo(S, { ...base, ping: ping({}), openIncident: "location_off" }, now).incident?.kind, "back_online");
// Not tracked: exempt, no consent, absent.
assert.equal(evaluateStaffGeo({ ...S, exemptStaffIds: ["s1"] }, { ...base, ping: ping({}) }, now).presence, "not_tracked");
assert.equal(evaluateStaffGeo(S, { ...base, consented: false }, now).presence, "not_tracked");
assert.equal(evaluateStaffGeo(S, { ...base, attendance: "A" }, now).presence, "not_tracked");
assert.equal(evaluateStaffGeo({ ...S, skipAbsent: false }, { ...base, attendance: "A", ping: ping({}) }, now).presence, "inside", "skipAbsent off → tracked");

// Alert text carries name, emp code and distance; settings normalise garbage.
assert.match(staffGeoAlertText("BHB", out.incident!).replace(/\n/g, " "), /VISHNU OM TRIPATHI \(STF-001\).*outside school premises/);
const n = normalizeStaffGeoSettings({ radiusM: 5, staleAfterMin: 1, workingDays: [9, 1, 1], recipients: [{ name: "Owner", mobile: "+91 99999-00001" }, { mobile: "12" }] }, school);
assert.equal(n.radiusM, 30);
assert.equal(n.staleAfterMin, 5);
assert.deepEqual(n.workingDays, [1]);
assert.deepEqual(n.recipients, [{ name: "Owner", mobile: "9999900001" }]);
assert.equal(n.lat, school.lat);
console.log("OK — staffGeo.selftest.ts");
