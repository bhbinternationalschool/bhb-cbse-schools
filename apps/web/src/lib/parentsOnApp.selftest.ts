import assert from "node:assert/strict";
import { buildParentsOnApp, lastSeenLabel, type RosterChild } from "./parentsOnApp";

console.log("parentsOnApp.selftest.ts");

const now = new Date("2026-10-09T14:30:00.000Z"); // 8:00 pm IST
const kid = (householdId: string, name: string, classId: string, classSort: number): RosterChild => ({
  householdId, key: name, name, classId, className: classId.toUpperCase(), classSort, section: "",
});

const r = buildParentsOnApp({
  now,
  families: [
    { householdId: "h1", guardianName: "ANIL", mobile: "1" },
    { householdId: "h2", guardianName: "BINA", mobile: "2" },
    { householdId: "h3", guardianName: "CHETAN", mobile: "3" },
    { householdId: "h4", guardianName: "NO KIDS", mobile: "4" },
  ],
  children: [kid("h1", "A1", "ii", 2), kid("h1", "A2", "v", 5), kid("h2", "B1", "ii", 2), kid("h3", "C1", "v", 5)],
  devices: [
    { householdId: "h1", appVersion: "1.0.19+20", createdAt: "2026-10-08T14:00:00Z", lastSeenAt: "2026-10-09T13:00:00Z" },
    { householdId: "h1", appVersion: "1.0.19+20", createdAt: "2026-10-08T15:00:00Z", lastSeenAt: "2026-10-08T15:00:00Z" },
    { householdId: "h3", appVersion: "1.0.19+20", createdAt: "2026-09-20T10:00:00Z", lastSeenAt: "2026-09-25T10:00:00Z" },
    { householdId: "hx", appVersion: "1.0.19+20", createdAt: "2026-10-08T15:00:00Z", lastSeenAt: "2026-10-09T10:00:00Z" },
  ],
});

// Families with no child on roll, and phones of unknown families, are not counted.
assert.deepEqual(r.summary, { families: 3, familiesOnApp: 2, phones: 3, openedToday: 1, openedThisWeek: 1, quiet: 1 });
// A family with children in two classes shows under both; classes in school order.
assert.deepEqual(r.classes.map((c) => [c.className, c.onApp.length, c.notOnApp.length]), [["II", 1, 1], ["V", 2, 0]]);
const anil = r.classes[0]!.onApp[0]!;
assert.equal(anil.phones, 2);
assert.equal(anil.joinedAt, "2026-10-08T14:00:00Z", "first phone's sign-in");
assert.equal(anil.lastSeenAt, "2026-10-09T13:00:00Z", "latest phone's last open");
assert.equal(r.classes[1]!.onApp[0]!.guardianName, "ANIL", "most recently active first");

assert.equal(lastSeenLabel("2026-10-09T14:29:30Z", now), "just now");
assert.equal(lastSeenLabel("2026-10-09T14:00:00Z", now), "30 min ago");
assert.equal(lastSeenLabel("2026-10-09T10:30:00Z", now), "4 h ago");
assert.equal(lastSeenLabel("2026-10-08T10:00:00Z", now), "yesterday");
assert.equal(lastSeenLabel("2026-10-05T10:00:00Z", now), "4 days ago");
assert.equal(lastSeenLabel("", now), "—");

console.log("parentsOnApp.selftest: all assertions passed");
