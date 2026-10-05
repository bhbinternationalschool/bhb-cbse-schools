/**
 * Self-test: npx tsx src/lib/surveyDay.selftest.ts
 * The field survey day's rules: live fix, step order, hours, route link.
 */
import assert from "node:assert/strict";
import {
  applySurveyStep,
  checkSurveyFix,
  externalMemberKey,
  isExternalMemberKey,
  surveyMessage,
  surveyRouteLink,
  surveyWorkedMs,
  SURVEY_MAX_ACCURACY_M,
  type SurveyDay,
} from "./surveyDay";

const T0 = Date.parse("2026-10-06T03:30:00Z"); // 09:00 IST

// ── live fix ──
assert.equal(checkSurveyFix(null, T0).ok, false);
assert.equal(checkSurveyFix({ lat: 0, lng: 0, accuracyM: 10 }, T0).ok, false);
assert.equal(checkSurveyFix({ lat: 25.3, lng: 82.9, accuracyM: 10, mocked: true }, T0).ok, false);
assert.equal(checkSurveyFix({ lat: 25.3, lng: 82.9 }, T0).ok, false, "no accuracy = not a live fix");
assert.equal(checkSurveyFix({ lat: 25.3, lng: 82.9, accuracyM: SURVEY_MAX_ACCURACY_M + 1 }, T0).ok, false);
assert.equal(checkSurveyFix({ lat: 95, lng: 82.9, accuracyM: 10 }, T0).ok, false);
const good = checkSurveyFix({ lat: 25.3176543, lng: 82.9739123, accuracyM: 12.4 }, T0);
assert.ok(good.ok);
if (good.ok) {
  assert.equal(good.fix.lat, 25.317654);
  assert.equal(good.fix.accuracyM, 12);
  assert.equal(good.fix.at, new Date(T0).toISOString());
}

const fixAt = (ms: number) => ({ lat: 25.3, lng: 82.9, accuracyM: 10, at: new Date(ms).toISOString() });
const day0: SurveyDay = {
  id: "d1",
  memberKey: "stf_1",
  memberName: "Asha",
  staffId: "stf_1",
  day: "2026-10-06",
  startMode: "field",
  beatId: "b1",
  status: "active",
  startedAt: new Date(T0).toISOString(),
  startGeo: fixAt(T0),
  endedAt: null,
  endGeo: null,
  breaks: [],
};

// ── step order ──
assert.equal(applySurveyStep(null, "break", fixAt(T0)).ok, false, "no day → nothing but start");
assert.equal(applySurveyStep(day0, "resume", fixAt(T0)).ok, false, "resume without a break");
const onBreak = applySurveyStep(day0, "break", fixAt(T0 + 2 * 3600_000));
assert.ok(onBreak.ok);
if (!onBreak.ok) throw new Error();
assert.equal(onBreak.day.status, "on_break");
assert.equal(applySurveyStep(onBreak.day, "break", fixAt(T0)).ok, false, "double break");
assert.equal(applySurveyStep(onBreak.day, "capture", fixAt(T0)).ok, false, "no capture on a break");
const back = applySurveyStep(onBreak.day, "resume", fixAt(T0 + 2.5 * 3600_000));
assert.ok(back.ok);
if (!back.ok) throw new Error();
assert.equal(back.day.status, "active");
assert.equal(back.day.breaks[0].endAt, new Date(T0 + 2.5 * 3600_000).toISOString());
assert.ok(applySurveyStep(back.day, "capture", fixAt(T0)).ok);
const ended = applySurveyStep(back.day, "end", fixAt(T0 + 6 * 3600_000));
assert.ok(ended.ok);
if (!ended.ok) throw new Error();
assert.equal(ended.day.status, "ended");
assert.equal(applySurveyStep(ended.day, "capture", fixAt(T0)).ok, false, "nothing after end");
assert.equal(applySurveyStep(ended.day, "end", fixAt(T0)).ok, false);

// Ending while on a break closes the break.
const endOnBreak = applySurveyStep(onBreak.day, "end", fixAt(T0 + 3 * 3600_000));
assert.ok(endOnBreak.ok);
if (endOnBreak.ok) assert.equal(endOnBreak.day.breaks[0].endAt, new Date(T0 + 3 * 3600_000).toISOString());

// ── hours: 6 h day less a 30 min break ──
assert.equal(surveyWorkedMs(ended.day, T0 + 99 * 3600_000), 5.5 * 3600_000);
// An open day counts to "now", less the open break.
assert.equal(surveyWorkedMs(onBreak.day, T0 + 3 * 3600_000), 2 * 3600_000);

// ── keys and messages ──
assert.equal(externalMemberKey("sxa_9"), "ext:sxa_9");
assert.ok(isExternalMemberKey("ext:sxa_9"));
assert.ok(!isExternalMemberKey("stf_1"));
assert.equal(surveyMessage({ action: "start", extra: "123456", ts: 5 }), "survey|start|123456|5");

// ── route link keeps start and end ──
assert.equal(surveyRouteLink([]), "");
assert.equal(surveyRouteLink([{ lat: 1, lng: 2 }]), "https://www.google.com/maps?q=1,2");
const pts = Array.from({ length: 25 }, (_, i) => ({ lat: i, lng: i }));
const link = surveyRouteLink(pts, 10);
const stops = link.replace("https://www.google.com/maps/dir/", "").split("/");
assert.equal(stops.length, 10);
assert.equal(stops[0], "0,0");
assert.equal(stops[9], "24,24");

console.log("surveyDay selftest: ok");
