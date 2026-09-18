/**
 * Exam seating — the adjacency rule, and nobody lost.
 * Run: npx tsx src/lib/examSeating.selftest.ts
 */
import assert from "node:assert/strict";
import {
  adjacencyBreaches,
  groupBreaches,
  benchSlips,
  buildSeatingPlan,
  missingRollNumbers,
  roomCapacity,
  seatingExportRows,
  seatingOrder,
  type ExamRoom,
  type SeatingStudent,
} from "./examSeating";

console.log("examSeating.selftest.ts");

const room = (id: string, name: string, benches: number, seatsPerBench: number, sortOrder = 0): ExamRoom =>
  ({ id, name, benches, seatsPerBench, isActive: true, note: "", sortOrder });

function classOf(classId: string, className: string, n: number, opts: { noRollFrom?: number; groupLabel?: string } = {}) {
  const students: SeatingStudent[] = [];
  for (let i = 1; i <= n; i += 1) {
    const noRoll = opts.noRollFrom !== undefined && i >= opts.noRollFrom;
    students.push({
      id: `${classId}_${i}`,
      classId,
      name: `${className} CHILD ${String(i).padStart(2, "0")}`,
      rollNo: noRoll ? "" : String(i),
      admissionNo: `ADM-${classId}-${i}`,
    });
  }
  return { classId, className, groupLabel: opts.groupLabel ?? "Primary", students };
}

/* ── Order ────────────────────────────────────────────────────────── */
// Roll numbers sort as numbers, not as text: 2 before 10.
assert.ok(
  seatingOrder(
    { id: "a", classId: "c", name: "B", rollNo: "2", admissionNo: "" },
    { id: "b", classId: "c", name: "A", rollNo: "10", admissionNo: "" },
  ) < 0,
);
// A child with no roll number goes last rather than sorting under "".
assert.ok(
  seatingOrder(
    { id: "a", classId: "c", name: "Z", rollNo: "", admissionNo: "" },
    { id: "b", classId: "c", name: "A", rollNo: "9", admissionNo: "" },
  ) > 0,
);

assert.equal(roomCapacity(room("r", "R", 10, 3)), 30);
assert.equal(roomCapacity(room("r", "R", 0, 3)), 0);

/* ── The school's real shape ──────────────────────────────────────── */
// 13 classes, 229 children: 31, 29, 26, 23, 22, 18, 16, 16, 13, 12, 12, 9, 2.
// Three pre-primary, five primary, three middle — the bands this school runs,
// with two spare so the fixture keeps all thirteen real sizes.
const REAL = [31, 29, 26, 23, 22, 18, 16, 16, 13, 12, 12, 9, 2];
const GROUPS = [
  "Pre-Primary", "Pre-Primary", "Pre-Primary",
  "Primary", "Primary", "Primary", "Primary", "Primary",
  "Middle", "Middle", "Middle",
  "Middle", "Middle",
];
const studentsByClass = REAL.map((n, i) =>
  classOf(`cls_${i}`, `Class ${i + 1}`, n, { groupLabel: GROUPS[i] }),
);
const total = REAL.reduce((a, b) => a + b, 0);
assert.equal(total, 229);

// Rooms as the school describes them: some two-seater, some three.
const rooms = [
  room("r1", "Hall A", 20, 3, 1),
  room("r2", "Room 12", 20, 2, 2),
  room("r3", "Room 13", 20, 2, 3),
  room("r4", "Room 14", 15, 3, 4),
];
assert.equal(rooms.reduce((n, r) => n + roomCapacity(r), 0), 185, "60 + 40 + 40 + 45");

const tight = buildSeatingPlan({ rooms, studentsByClass });
// THE invariant: no child ever sits beside their own class.
assert.deepEqual(adjacencyBreaches(tight), [], "a bench must never seat one class twice in a row");
assert.deepEqual(groupBreaches(tight), [], "and never two class groups on one bench");
// Capacity is genuinely short here, and it says so by name, not by silence.
assert.ok(tight.unseated.length > 0);
assert.equal(tight.unseated.length, total - seatingExportRows(tight).length);
assert.ok(tight.notes.some((n) => /have no seat/.test(n)), tight.notes.join(" | "));
assert.equal(tight.toSeat, 229);
assert.equal(tight.capacity, 185);

// Enough room: everybody sits, and still nobody beside their own class.
const roomy = [...rooms, room("r5", "Hall B", 20, 3, 5)];
const full = buildSeatingPlan({ rooms: roomy, studentsByClass });
assert.deepEqual(adjacencyBreaches(full), []);
assert.deepEqual(groupBreaches(full), []);
// A room reads in bands: benches 1–13 one group, 14–20 the next.
for (const r of full.rooms) {
  assert.ok(r.bands.length > 0, `${r.roomName} has no bands`);
  let prev = 0;
  for (const band of r.bands) {
    assert.equal(band.fromBench, prev + 1, `${r.roomName}: bands must be contiguous`);
    assert.ok(band.toBench >= band.fromBench);
    prev = band.toBench;
  }
}
assert.equal(full.unseated.length, 0, "229 children, 245 seats — nobody is left standing");
assert.equal(seatingExportRows(full).length, 229);
// Every child appears exactly once.
assert.equal(new Set(seatingExportRows(full).map((r) => `${r.className}|${r.studentName}`)).size, 229);
// And the tallies add up to the same children.
assert.equal(full.tallies.reduce((n, t) => n + t.seated, 0), 229);
for (const t of full.tallies) assert.ok(t.rooms.length > 0, `${t.className} is seated nowhere`);

/* ── The sandwich a "one class per column" rule would have refused ── */
// Two classes, one three-seater room: class A takes seats 1 and 3, B takes 2.
const sandwich = buildSeatingPlan({
  rooms: [room("r", "Hall", 5, 3)],
  studentsByClass: [classOf("a", "Class A", 10), classOf("b", "Class B", 5)],
});
assert.deepEqual(adjacencyBreaches(sandwich), []);
assert.deepEqual(groupBreaches(sandwich), []);
assert.equal(seatingExportRows(sandwich).length, 15, "all 15 fit — the middle seat separates A from A");
assert.equal(sandwich.unseated.length, 0);

/* ── One class left, and a seat deliberately wasted ───────────────── */
const lonely = buildSeatingPlan({
  rooms: [room("r", "Hall", 4, 2)],
  studentsByClass: [classOf("a", "Class A", 8)],
});
assert.deepEqual(adjacencyBreaches(lonely), []);
assert.deepEqual(groupBreaches(lonely), []);
assert.equal(seatingExportRows(lonely).length, 4, "only one column is usable");
assert.equal(lonely.unseated.length, 4);
assert.ok(
  lonely.notes.some((n) => /left empty/.test(n)),
  "an empty column is a cost the office can see: " + lonely.notes.join(" | "),
);

/* ── No rooms at all ──────────────────────────────────────────────── */
const nowhere = buildSeatingPlan({ rooms: [], studentsByClass });
assert.equal(nowhere.rooms.length, 0);
assert.equal(nowhere.unseated.length, 229, "every child is named, not counted away");

/* ── What gets printed ────────────────────────────────────────────── */
const slips = benchSlips(full);
assert.ok(slips.length > 0);
const first = slips[0]!;
assert.equal(first.lines.length, first.seats);
assert.match(first.lines[0]!, /^1\. Class \d+ · \d+ · Class \d+ CHILD \d+$/);
// An empty seat still prints, so a slip shows the bench's real shape.
const partial = benchSlips(lonely);
assert.ok(partial.some((s) => s.lines.some((l) => /—$/.test(l))));

/* ── A missing roll number becomes an admission number, and is named ─ */
const withGaps = buildSeatingPlan({
  rooms: [room("r", "Hall", 10, 2)],
  studentsByClass: [classOf("a", "Class A", 10, { noRollFrom: 9 }), classOf("b", "Class B", 10)],
});
const gaps = missingRollNumbers(withGaps);
assert.equal(gaps.length, 2, "the two children with no roll number are listed for the office");
assert.ok(gaps.every((g) => g.label.startsWith("ADM-")), "their slip shows the admission number, never a blank");
// And they are seated LAST within their class.
const aRows = seatingExportRows(withGaps).filter((r) => r.className === "Class A");
assert.match(aRows[aRows.length - 1]!.rollOrAdmission, /^ADM-/);

console.log("ok");
