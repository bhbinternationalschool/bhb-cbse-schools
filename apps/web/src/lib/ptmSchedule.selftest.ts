/**
 * Run: npx tsx src/lib/ptmSchedule.selftest.ts
 *
 * Scheduling a PTM from the staff app (request mr_mv9yydt031or): one event
 * covering every class picked; a teacher only for classes they teach a
 * section of; the office / leadership for any class.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planPtmEvent, ptmScheduleClasses, type PtmScheduleScope } from "@/lib/ptmSchedule";

console.log("ptmSchedule.selftest.ts");

const classes = [
  { id: "c5", name: "V", sortOrder: 5, isActive: true },
  { id: "c3", name: "III", sortOrder: 3, isActive: true },
  { id: "c4", name: "IV", sortOrder: 4, isActive: true },
  { id: "old", name: "Closed", sortOrder: 9, isActive: false },
];
const teacher: PtmScheduleScope = {
  unrestricted: false,
  teaching: [
    { classId: "c5", className: "V", sectionId: "s5a", sectionName: "A" },
    { classId: "c3", className: "III", sectionId: "s3b", sectionName: "B" },
    { classId: "c5", className: "V", sectionId: "s5b", sectionName: "B" },
  ],
};
const office: PtmScheduleScope = { unrestricted: true, teaching: [] };

// The picker.
assert.deepEqual(
  ptmScheduleClasses(teacher, classes),
  [
    { id: "c3", name: "III", sections: "B" },
    { id: "c5", name: "V", sections: "A, B" },
  ],
  "a teacher: own classes only, class order, own sections named",
);
assert.deepEqual(
  ptmScheduleClasses(office, classes).map((c) => c.id),
  ["c3", "c4", "c5"],
  "the office: every active class",
);

const base = { classes, academicYearCode: "2026-27", today: "2026-10-20", id: "ptme_x", now: "2026-10-20T10:00:00Z" };

// Multi-class create: ONE event covering both classes.
const multi = planPtmEvent({
  ...base,
  scope: teacher,
  body: { name: " Term 1 PTM ", date: "2026-10-25", classIds: ["c5", "c3", "c5"], mode: "video" },
});
assert.ok(multi.ok);
if (multi.ok) {
  assert.deepEqual(multi.event.classIds, ["c3", "c5"], "both classes, once each, class order");
  assert.equal(multi.event.name, "Term 1 PTM");
  assert.equal(multi.event.endDate, "2026-10-25", "one-day PTM ends the day it starts");
  assert.equal(multi.event.mode, "video");
  assert.equal(multi.event.isActive, true);
  assert.equal(multi.event.academicYearCode, "2026-27");
}

// Scope: a class the teacher does not teach is refused with 403.
const other = planPtmEvent({ ...base, scope: teacher, body: { name: "PTM", date: "2026-10-25", classIds: ["c3", "c4"] } });
assert.equal(other.ok, false);
if (!other.ok) {
  assert.equal(other.status, 403);
  assert.match(other.error, /You do not teach IV/);
}
// The office may schedule that same PTM.
const byOffice = planPtmEvent({ ...base, scope: office, body: { name: "PTM", date: "2026-10-25", classIds: ["c3", "c4"] } });
assert.ok(byOffice.ok);

// No "every class" PTM from a teacher (empty list), and none for the office either here.
for (const scope of [teacher, office]) {
  const none = planPtmEvent({ ...base, scope, body: { name: "PTM", date: "2026-10-25", classIds: [] } });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.status, 400);
}
// A closed class is not offered and not accepted.
const closed = planPtmEvent({ ...base, scope: office, body: { name: "PTM", date: "2026-10-25", classIds: ["old"] } });
assert.equal(closed.ok, false);
// Unknown class id → 400, not a silent drop.
const unknown = planPtmEvent({ ...base, scope: office, body: { name: "PTM", date: "2026-10-25", classIds: ["nope"] } });
assert.equal(unknown.ok, false);
if (!unknown.ok) assert.equal(unknown.status, 400);

// Dates.
const past = planPtmEvent({ ...base, scope: office, body: { name: "PTM", date: "2026-10-19", classIds: ["c3"] } });
assert.equal(past.ok, false, "a past date is refused");
const backwards = planPtmEvent({
  ...base,
  scope: office,
  body: { name: "PTM", date: "2026-10-25", endDate: "2026-10-24", classIds: ["c3"] },
});
assert.equal(backwards.ok, false);
const noName = planPtmEvent({ ...base, scope: office, body: { name: "  ", date: "2026-10-25", classIds: ["c3"] } });
assert.equal(noName.ok, false);

// The route: app feature + ptm·edit, and only the new event row is written.
const route = readFileSync(join(__dirname, "../app/api/v1/staff/ptm/events/route.ts"), "utf8");
assert.ok(/assertMobileFeature\(ctx, "ptm_meet"\)/.test(route));
assert.ok(/assertPermission\(ctx, "ptm", "edit"\)/.test(route));
assert.ok(/staffSectionScope\(ctx\)/.test(route));
assert.ok(/\{ only: \{ events: \[event\.id\] \} \}/.test(route));

console.log("ptmSchedule.selftest: all assertions passed");
