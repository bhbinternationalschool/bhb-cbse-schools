/**
 * moduleStateMerge — an office save never erases a teacher's entry, and a
 * delete stays deleted. Run: npx tsx src/lib/moduleStateMerge.selftest.ts
 */
import { mergeModuleState, withTombstone } from "./moduleStateMerge";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id);

// Office loaded [a,b] this morning; a teacher logged c since.
const server = { version: 1, incidents: [{ id: "c" }, { id: "a", notifiedParentAt: "t1" }, { id: "b" }] };
const office = { version: 1, incidents: [{ id: "a", status: "resolved" }, { id: "b" }] };
const m = mergeModuleState("discipline", server, office);
expect("teacher row kept", ids(m.incidents), ["c", "a", "b"]);
expect("office edit wins, notice kept", (m.incidents as unknown[])[1], { id: "a", status: "resolved", notifiedParentAt: "t1" });

// Office deletes b: tombstone travels with the save; b does not come back.
const del = { version: 1, incidents: [{ id: "a" }], deletedIds: withTombstone(undefined, "b") };
const m2 = mergeModuleState("discipline", server, del);
expect("delete sticks", ids(m2.incidents), ["c", "a"]);
expect("tombstone stored", m2.deletedIds, ["b"]);
// A later stale browser still holding b cannot resurrect it.
const m3 = mergeModuleState("discipline", m2, { version: 1, incidents: [{ id: "a" }, { id: "b" }] });
expect("stale copy cannot resurrect", ids(m3.incidents), ["c", "a"]);

// Health: all three lists.
const h = mergeModuleState(
  "health",
  { visits: [{ id: "v2" }, { id: "v1" }], medications: [{ id: "m1" }], vaccinations: [] },
  { visits: [{ id: "v1" }], medications: [], vaccinations: [{ id: "x1" }] },
);
expect("health visits", ids(h.visits), ["v2", "v1"]);
expect("health meds", ids(h.medications), ["m1"]);
expect("health vacc", ids(h.vaccinations), ["x1"]);

// Complaints: a teacher's resolution is not undone by a stale office copy.
const c = mergeModuleState(
  "complaints",
  { tickets: [{ id: "k", status: "resolved", resolutionNote: "Spoke to parent", resolvedAt: "r" }] },
  { tickets: [{ id: "k", status: "assigned", assignedToStaffId: "s1" }] },
);
expect("complaint moved on kept", (c.tickets as unknown[])[0], {
  id: "k", status: "resolved", assignedToStaffId: "s1", resolutionNote: "Spoke to parent", resolvedAt: "r",
});

// Nothing stored yet: the save goes through as sent.
expect("no current", mergeModuleState("discipline", null, office), office);
// Other modules untouched.
expect("other module", mergeModuleState("visitors", server, office), office);

if (failed) {
  console.error(`moduleStateMerge: ${failed} failure(s)`);
  process.exit(1);
}
console.log("moduleStateMerge: ok");
