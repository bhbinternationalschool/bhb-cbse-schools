import assert from "node:assert/strict";
import {
  broadcastsBy,
  emptyStaffBroadcastLog,
  normalizeStaffBroadcastLog,
  STAFF_BROADCAST_LOG_CAP,
  withBroadcastEntry,
  type StaffBroadcastEntry,
} from "./staffBroadcastLog";

console.log("staffBroadcastLog.selftest.ts");

const entry = (id: string, staffId: string, at: string): StaffBroadcastEntry => ({
  id,
  at,
  staffId,
  staffName: staffId,
  audience: "class_parents",
  sectionIds: ["s1"],
  sectionLabels: ["Class 5 A"],
  body: "hello",
  templateName: "",
  families: 3,
  recipientCount: 3,
  skippedOptOut: 0,
  sent: 3,
  failed: 0,
  pushSent: 1,
});

// Garbage normalizes to empty; rows without id or staff are dropped.
assert.deepEqual(normalizeStaffBroadcastLog(null), emptyStaffBroadcastLog());
assert.equal(
  normalizeStaffBroadcastLog({ entries: [{ id: "x" }, { staffId: "y" }, entry("a", "t1", "2026-10-13T01:00:00Z")] })
    .entries.length,
  1,
);

// Newest first, one person's own only.
let log = emptyStaffBroadcastLog();
log = withBroadcastEntry(log, entry("a", "t1", "2026-10-13T01:00:00Z"));
log = withBroadcastEntry(log, entry("b", "t2", "2026-10-13T02:00:00Z"));
log = withBroadcastEntry(log, entry("c", "t1", "2026-10-13T03:00:00Z"));
assert.deepEqual(broadcastsBy(log, "t1").map((e) => e.id), ["c", "a"]);
assert.deepEqual(broadcastsBy(log, ""), []);

// Capped.
let big = emptyStaffBroadcastLog();
for (let i = 0; i < STAFF_BROADCAST_LOG_CAP + 5; i++) {
  big = withBroadcastEntry(big, entry(`e${i}`, "t1", new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()));
}
assert.equal(big.entries.length, STAFF_BROADCAST_LOG_CAP);
assert.equal(big.entries[0]!.id, `e${STAFF_BROADCAST_LOG_CAP + 4}`);

console.log("ok");
