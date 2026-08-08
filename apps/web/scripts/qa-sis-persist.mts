/**
 * SIS remote merge helpers — no network required.
 */
import { mergeSisRemoteIntoState } from "../src/lib/sisPersistence";
import type { SisRemoteBundle } from "../src/lib/sisPersistence";
import { normalizeHousehold, normalizeStudent, type SisState } from "../src/lib/sis";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

const local: SisState = {
  version: 1,
  households: [
    normalizeHousehold({
      id: "hh_local",
      code: "L1",
      guardianName: "Local Guardian",
      mobile: "9000000001",
    }),
  ],
  students: [
    normalizeStudent({
      id: "stu_local",
      fullName: "Local Only",
      householdId: "hh_local",
      classId: "cls_x",
      curriculum: {
        academicYearCode: "2025-26",
        seniorStreamId: null,
        chosenSubjectIds: ["subA"],
        confirmedAt: "2026-07-01T00:00:00.000Z",
        confirmedBy: "office",
      },
    }),
    normalizeStudent({
      id: "stu_both",
      fullName: "Local Name",
      householdId: "hh_local",
      classId: "cls_x",
      curriculum: {
        academicYearCode: "2025-26",
        seniorStreamId: null,
        chosenSubjectIds: ["subLocal"],
        confirmedAt: "",
        confirmedBy: "system",
      },
    }),
  ],
  curriculumRequests: [],
};

const remote: SisRemoteBundle = {
  households: [
    normalizeHousehold({
      id: "hh_remote",
      code: "R1",
      guardianName: "Remote Guardian",
      mobile: "9000000002",
    }),
    normalizeHousehold({
      id: "hh_local",
      code: "L1",
      guardianName: "Remote Wins HH",
      mobile: "9000000001",
    }),
  ],
  students: [
    normalizeStudent({
      id: "stu_both",
      fullName: "Remote Name",
      householdId: "hh_remote",
      classId: "cls_y",
      curriculum: null,
    }),
    normalizeStudent({
      id: "stu_remote",
      fullName: "Remote Only",
      householdId: "hh_remote",
      classId: "cls_y",
    }),
  ],
  householdUpdatedAt: {},
  studentUpdatedAt: {},
};

// ── 1. Replace mode (preferDb: true) ──
const mergedReplace = mergeSisRemoteIntoState(local, remote, { preferDb: true });

assert(
  mergedReplace.households.some((h) => h.id === "hh_remote"),
  "replace mode: remote-only household kept",
);
assert(
  mergedReplace.households.find((h) => h.id === "hh_local")?.guardianName ===
    "Remote Wins HH",
  "replace mode: remote household overwrites same id",
);
assert(
  !mergedReplace.students.some((s) => s.id === "stu_local"),
  "replace mode: local-only deleted student purged",
);
assert(
  mergedReplace.students.some((s) => s.id === "stu_remote"),
  "replace mode: remote-only student kept",
);
assert(
  mergedReplace.students.find((s) => s.id === "stu_both")?.fullName === "Remote Name",
  "replace mode: remote student profile wins on collision",
);
assert(
  mergedReplace.students
    .find((s) => s.id === "stu_both")
    ?.curriculum?.chosenSubjectIds.join(",") === "subLocal",
  "replace mode: local curriculum preserved across roster merge",
);

// ── 2. Additive mode (preferDb: false) ──
const mergedAdditive = mergeSisRemoteIntoState(local, remote, { preferDb: false });
assert(
  mergedAdditive.students.some((s) => s.id === "stu_local"),
  "additive mode: local-only student kept",
);
assert(
  mergedAdditive.students.find((s) => s.id === "stu_both")?.fullName === "Local Name",
  "additive mode: local student wins on collision",
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll SIS remote merge checks passed.");
