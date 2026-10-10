import assert from "node:assert/strict";
import type { SisStudent } from "./sis";

console.log("appPopupsOnRoll.selftest.ts");

/**
 * Who the Aadhaar pop-up asks about: children on roll, one row each. SIS
 * keeps a row per child per year and older rows stay "active"; a child who
 * left this year (inactive 2026-27 row, active 2025-26 row) is not on roll.
 * On production 10 Oct 2026: 30 children in 22 families were like that.
 */

const row = (id: string, adm: string, ay: string, status: "active" | "inactive", hh = "hh1") =>
  ({ id, admissionNo: adm, academicYearCode: ay, status, householdId: hh, fullName: adm }) as unknown as SisStudent;

void (async () => {
  const { childrenOnRoll } = await import("./appPopups");
  const ids = (xs: SisStudent[]) => xs.map((x) => x.id).sort();

  const students = [
    // Harshit: left this year — 2026-27 inactive, older rows active.
    row("h23", "1082", "2023-24", "active"),
    row("h25", "1082", "2025-26", "active"),
    row("h26", "1082", "2026-27", "inactive"),
    // Unnati: on roll — 2026-27 active, older rows too.
    row("u25", "1081", "2025-26", "active"),
    row("u26", "1081", "2026-27", "active"),
    // A child not yet given a 2026-27 row: the newest row decides.
    row("n25", "1090", "2025-26", "active"),
  ];
  assert.deepEqual(ids(childrenOnRoll(students, "2026-27")), ["n25", "u26"], "the leaver is out; one row per child");
  assert.deepEqual(ids(childrenOnRoll(students, "")), ["n25", "u26"], "no session year: the newest row decides");
  // Two families are kept apart even with the same admission number.
  assert.equal(childrenOnRoll([row("a", "1", "2026-27", "active", "hhA"), row("b", "1", "2026-27", "active", "hhB")], "2026-27").length, 2);

  console.log("appPopupsOnRoll.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
