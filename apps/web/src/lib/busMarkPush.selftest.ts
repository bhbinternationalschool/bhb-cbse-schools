import assert from "node:assert/strict";
import { busMarkPush, istClock, BUS_PUSH_FRESH_MS, type BusMarkPushInput } from "./busMarkPush";

const now = Date.parse("2026-10-14T02:15:00.000Z"); // 7:45 AM IST
const base: BusMarkPushInput = {
  applied: true,
  status: "boarded",
  previous: "unmarked",
  runDate: "2026-10-14",
  today: "2026-10-14",
  tappedAt: "2026-10-14T02:12:00.000Z",
  nowMs: now,
  trip: "AM",
  childName: "Asha Yadav",
  stopName: "Shivpur",
  lang: "en",
};

assert.equal(istClock("2026-10-14T02:12:00.000Z"), "7:42 AM");
assert.equal(istClock("2026-10-14T09:05:00.000Z"), "2:35 PM");
assert.equal(istClock("nope"), "");

const boarded = busMarkPush(base);
assert.ok(boarded);
assert.equal(boarded.title, "On the bus: Asha Yadav");
assert.equal(boarded.body, "Boarded at Shivpur · 7:42 AM");
assert.equal(boarded.url, "/transport");
assert.equal(boarded.data.kind, "bus_mark");

const hi = busMarkPush({ ...base, lang: "hi" });
assert.equal(hi?.title, "बस में: Asha Yadav");

const dropped = busMarkPush({ ...base, trip: "PM", status: "dropped", stopName: "" });
assert.equal(dropped?.body, "Got off the bus · 7:42 AM");

const missed = busMarkPush({ ...base, status: "not_boarded", previous: "boarded" });
assert.match(missed!.body, /Call the school if this is wrong/);

// Nothing to tell
assert.equal(busMarkPush({ ...base, applied: false }), null, "stale retry ignored by the server");
assert.equal(busMarkPush({ ...base, previous: "boarded" }), null, "same status again");
assert.equal(busMarkPush({ ...base, status: "unmarked", previous: "boarded" }), null, "an undone tap");
assert.equal(busMarkPush({ ...base, runDate: "2026-10-13" }), null, "a past day's correction");
assert.equal(
  busMarkPush({ ...base, tappedAt: new Date(now - BUS_PUSH_FRESH_MS - 1000).toISOString() }),
  null,
  "a tap sent late from an offline phone",
);
assert.equal(busMarkPush({ ...base, tappedAt: "" }), null, "unknown tap time");
assert.equal(busMarkPush({ ...base, childName: " " }), null, "no name, no message");

console.log("busMarkPush selftest OK");
