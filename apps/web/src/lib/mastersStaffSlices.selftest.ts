/**
 * The masters desk must not speak for the staff roster.
 *
 * pushMastersDeskToDb() strips departments / designations / staff before it
 * writes masters_desk_slices, so the masters-desk GET reports all three as []
 * however many staff the school has. On 2026-09-19 the read side took that []
 * as authoritative: the Exams invigilator picker had nobody to offer, and
 * Masters showed 6 seeded placeholder departments over the school's 10.
 *
 * Run: npx tsx src/lib/mastersStaffSlices.selftest.ts
 */
import { mergeDbDeskIntoMastersState } from "./mastersNormalizedMerge";
import { STAFF_OWNED_MASTERS_SLICES } from "./staffDbConfig";
import { emptyMastersShell, type MastersState } from "./masters";
import type { MastersDeskBundle } from "./mastersNormalized.server";
import { MASTERS_ARRAY_SLICES } from "./mastersNormalized.server";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  if (got !== want) {
    failed += 1;
    console.error(`FAIL ${label}: got ${String(got)}, want ${String(want)}`);
  }
}

function localWithRoster(): MastersState {
  const shell = emptyMastersShell();
  return {
    ...shell,
    classes: [{ id: "cls_1", name: "I", sortOrder: 1, isActive: true }],
    departments: Array.from({ length: 10 }, (_, i) => ({
      id: `dep_${i}`,
      code: `D${i}`,
      name: `Dept ${i}`,
      isActive: true,
    })) as MastersState["departments"],
    designations: Array.from({ length: 18 }, (_, i) => ({
      id: `des_${i}`,
      code: `S${i}`,
      name: `Desig ${i}`,
      departmentId: null,
      isActive: true,
    })) as MastersState["designations"],
    staff: Array.from({ length: 35 }, (_, i) => ({
      id: `stf_${i}`,
      empCode: `EMP${i}`,
      fullName: `Teacher ${i}`,
      stream: "teaching",
      status: "active",
    })) as unknown as MastersState["staff"],
  };
}

/** What /api/school-data/masters-desk actually returns: 26 slices, no roster. */
function deskBundleWithoutRoster(): MastersDeskBundle {
  const { version: _v, ...empty } = emptyMastersShell();
  return {
    ...empty,
    classes: [
      { id: "cls_1", name: "I", sortOrder: 1, isActive: true },
      { id: "cls_2", name: "II", sortOrder: 2, isActive: true },
    ],
  } as MastersDeskBundle;
}

// The live fault: preferDb hydrate over a desk that already has the roster.
const merged = mergeDbDeskIntoMastersState(
  localWithRoster(),
  deskBundleWithoutRoster(),
  { preferDb: true },
);
expect("staff survives a masters-desk hydrate", merged.staff.length, 35);
expect("departments survive", merged.departments.length, 10);
expect("designations survive", merged.designations.length, 18);
// ...while the slices the desk does own still come from the DB.
expect("classes still take the DB copy", merged.classes.length, 2);

// A desk that somehow carries a roster still must not be trusted over the
// module that owns it — the strip means such a payload is stale by definition.
const staleRosterBundle = {
  ...deskBundleWithoutRoster(),
  staff: [
    {
      id: "stf_old",
      empCode: "EMP-001",
      fullName: "Priya Sharma",
      stream: "non_teaching",
      status: "active",
    },
  ],
} as unknown as MastersDeskBundle;
const merged2 = mergeDbDeskIntoMastersState(localWithRoster(), staleRosterBundle, {
  preferDb: true,
});
expect("a stale desk roster does not win", merged2.staff.length, 35);

// The two sides share one list, so neither can drift from the other.
for (const key of STAFF_OWNED_MASTERS_SLICES) {
  expect(
    `${key} is a known masters array slice`,
    MASTERS_ARRAY_SLICES.includes(key),
    true,
  );
}
expect(
  "the staff module owns exactly three slices",
  STAFF_OWNED_MASTERS_SLICES.join(","),
  "departments,designations,staff",
);

if (failed) {
  console.error(`mastersStaffSlices selftest: ${failed} failure(s)`);
  process.exit(1);
}
console.log("mastersStaffSlices selftest: ok");
