/**
 * Curriculum persistence merge helpers — no network required.
 */
import {
  mergeCurriculumRemoteIntoSis,
  mergeCurriculumTemplates,
  type CurriculumRemoteBundle,
} from "../src/lib/curriculumPersistence";
import type { CurriculumRequest } from "../src/lib/studentCurriculum";
import type { ClassCurriculumTemplate } from "../src/lib/officeCurriculumWorkflow";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

const remote: CurriculumRemoteBundle = {
  byStudentKey: {
    stu_a: {
      academicYearCode: "2025-26",
      seniorStreamId: null,
      chosenSubjectIds: ["sub1", "sub2"],
      confirmedAt: "2026-07-01T00:00:00.000Z",
      confirmedBy: "office",
    },
  },
  requests: [
    {
      id: "creq_1",
      studentId: "stu_a",
      academicYearCode: "2025-26",
      proposedStreamId: null,
      proposedChosenSubjectIds: ["sub1"],
      note: "",
      status: "approved",
      requestedAt: "2026-06-01T00:00:00.000Z",
      reviewedAt: "2026-06-02T00:00:00.000Z",
      reviewNote: "ok",
    } satisfies CurriculumRequest,
  ],
  templates: [],
};

const localState = {
  students: [
    {
      id: "stu_a",
      academicYearCode: "2025-26",
      curriculum: {
        academicYearCode: "2025-26",
        seniorStreamId: null,
        chosenSubjectIds: ["old"],
        confirmedAt: "",
        confirmedBy: "system" as const,
      },
    },
    {
      id: "stu_b",
      academicYearCode: "2025-26",
      curriculum: null,
    },
  ],
  curriculumRequests: [
    {
      id: "creq_1",
      studentId: "stu_a",
      academicYearCode: "2025-26",
      proposedStreamId: null,
      proposedChosenSubjectIds: ["sub1"],
      note: "",
      status: "pending" as const,
      requestedAt: "2026-06-01T00:00:00.000Z",
      reviewedAt: null,
      reviewNote: "",
    },
  ],
};

const merged = mergeCurriculumRemoteIntoSis(localState, remote);
assert(
  merged.students[0].curriculum?.chosenSubjectIds.join(",") === "sub1,sub2",
  "remote confirmed curriculum overwrites local draft",
);
assert(
  merged.curriculumRequests[0].status === "approved",
  "remote reviewed request wins over local pending",
);

const templates = mergeCurriculumTemplates(
  [
    {
      id: "tmpl_old",
      classId: "cls_x",
      academicYearCode: "2025-26",
      label: "old",
      chosenSubjectIds: ["a"],
      seniorStreamId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies ClassCurriculumTemplate,
  ],
  [
    {
      id: "tmpl_new",
      classId: "cls_x",
      academicYearCode: "2025-26",
      label: "new",
      chosenSubjectIds: ["b"],
      seniorStreamId: null,
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  ],
);
assert(templates[0].label === "new", "newer template updatedAt wins");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll curriculum persistence merge checks passed.");
