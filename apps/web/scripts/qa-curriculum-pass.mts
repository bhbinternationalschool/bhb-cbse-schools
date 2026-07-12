/**
 * Quick curriculum QA harness — exercises seed → bulk confirm → marks → report
 * against in-memory localStorage mocks (no browser required).
 */
import { defaultMasters, saveMasters, loadMasters } from "../src/lib/masters";
import { seedNcfCartOfferings, ncfCartOfferingsReady } from "../src/lib/ncfCartSeed";
import {
  applyCurriculumBulk,
  enrollmentStatusOf,
  summarizeClassCurriculum,
} from "../src/lib/officeCurriculumWorkflow";
import {
  confirmCurriculum,
  validateCurriculum,
  cartCatalog,
  ncfTagForSubject,
} from "../src/lib/studentCurriculum";
import {
  subjectsForStudent,
  subjectsForMarkEntry,
  studentTakesExamSubject,
  buildReportCard,
  saveMarkSheet,
  listExamTerms,
  syncExamSubjectsFromMasters,
  loadExams,
  saveExams,
} from "../src/lib/exams";
import { loadSis, saveSis, normalizeStudent, type SisStudent } from "../src/lib/sis";

const store: Record<string, string> = {};
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  },
};
(globalThis as any).localStorage = (globalThis as any).window.localStorage;

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function ensureStudent(
  className: string,
  fullName: string,
  codes: string[],
): SisStudent {
  const m = loadMasters();
  const cls = m.classes.find((c) => c.name === className)!;
  const sec = m.sections.find((s) => s.classId === cls.id && s.isActive)!;
  const ids = codes.map((c) => {
    const sub = m.subjects.find((s) => s.code === c && !s.parentId);
    if (!sub) throw new Error(`Missing subject ${c}`);
    return sub.id;
  });
  const curriculum = confirmCurriculum(
    {
      academicYearCode: "2025-26",
      seniorStreamId: null,
      chosenSubjectIds: ids,
      confirmedAt: "",
      confirmedBy: "system",
    },
    "office",
  );
  const student = normalizeStudent({
    id: `qa_${className}_${Math.random().toString(36).slice(2, 7)}`,
    admissionNo: `QA-${className}`,
    fullName,
    gender: "M",
    dob: "2010-01-01",
    classId: cls.id,
    sectionId: sec.id,
    rollNo: "1",
    studentType: "NEW",
    feeGroupId: null,
    householdId: "hh_qa",
    campusId: m.campuses[0]?.id ?? "",
    academicYearCode: "2025-26",
    status: "active",
    joinedOn: "2025-04-01",
    curriculum,
  });
  const sis = loadSis();
  saveSis({
    ...sis,
    households: sis.households.length
      ? sis.households
      : [
          {
            id: "hh_qa",
            guardianName: "QA Guardian",
            mobile: "9999999999",
            whatsappMobile: "9999999999",
            altMobile: "",
            email: "",
            address: "",
            locality: "",
            landmark: "",
            city: "Varanasi",
            state: "UP",
            pincode: "",
          },
        ],
    students: [...sis.students.filter((s) => s.id !== student.id), student],
  });
  return loadSis().students.find((s) => s.id === student.id)!;
}

// --- Seed ---
let masters = defaultMasters();
const seeded = seedNcfCartOfferings(masters);
masters = {
  ...masters,
  subjects: seeded.subjects,
  classSubjects: seeded.classSubjects,
};
saveMasters(masters);
masters = loadMasters();

check(
  "Seed IX–XII cart offerings ready",
  ncfCartOfferingsReady(masters),
  `+${seeded.subjectsAdded} subjects · +${seeded.linksAdded} links`,
);

const ix = masters.classes.find((c) => c.name === "IX")!;
const xi = masters.classes.find((c) => c.name === "XI")!;
const ixCat = cartCatalog(masters, ix.id);
const xiCat = cartCatalog(masters, xi.id);
const ixTags = new Set(ixCat.map((s) => ncfTagForSubject(s)));
const xiTags = new Set(xiCat.map((s) => ncfTagForSubject(s)));

check(
  "IX catalog has A/B/C/D",
  ["A", "B", "C", "D"].every((t) => ixTags.has(t as any)),
  [...ixTags].join(","),
);
check(
  "XI catalog has A/B/C",
  ["A", "B", "C"].every((t) => xiTags.has(t as any)),
  [...xiTags].join(","),
);

// --- Bulk apply IX ---
const ixCodes = ["ENG", "HIN", "SKT", "MAT", "SCI", "SST", "IT"]; // 7: 3 lang + skill + cores
const ixDraft = {
  academicYearCode: "2025-26",
  seniorStreamId: null as string | null,
  chosenSubjectIds: ixCodes.map(
    (c) => masters.subjects.find((s) => s.code === c && !s.parentId)!.id,
  ),
  confirmedAt: "",
  confirmedBy: "system" as const,
};
const ixStudents = (loadSis().students.length
  ? loadSis().students.filter((s) => s.classId === ix.id)
  : []
).slice(0, 3);

// Ensure at least 2 IX students in sis demo or create
let sis = loadSis();
if (sis.students.filter((s) => s.classId === ix.id).length < 2) {
  ensureStudent("IX", "QA IX One", ixCodes);
  ensureStudent("IX", "QA IX Two", ixCodes);
  sis = loadSis();
}

const ixRoster = sis.students.filter(
  (s) => s.classId === ix.id && s.status === "active",
);
const ixValidate = validateCurriculum(
  { classId: ix.id, academicYearCode: "2025-26" },
  ixDraft,
  masters,
);
check("IX cart validates (7 / ≥3 lang / ≥1 skill)", ixValidate.ok, ixValidate.errors.join("; "));

const bulkIx = applyCurriculumBulk({
  state: sis,
  studentIds: ixRoster.map((s) => s.id),
  curriculum: ixDraft,
  masters,
  policy: "overwrite",
  confirm: true,
  classId: ix.id,
});
check(
  "Bulk confirm IX class",
  bulkIx.ok && bulkIx.updated > 0,
  `updated ${bulkIx.updated} · skipped ${bulkIx.skipped}`,
);
sis = loadSis();
const ixSummary = summarizeClassCurriculum(
  sis.students.filter((s) => s.classId === ix.id && s.status === "active"),
);
check(
  "IX enrollment statuses after bulk",
  ixSummary.confirmed === ixSummary.total && ixSummary.total > 0,
  JSON.stringify(ixSummary),
);

// --- XI student ---
const xiCodes = ["ENG", "HIN", "PHY", "CHE", "MAT", "IT"]; // 6: 2 lang + native + mix
const xiStudent = ensureStudent("XI", "QA XI Science", xiCodes);
const xiDraft = {
  academicYearCode: "2025-26",
  seniorStreamId: null as string | null,
  chosenSubjectIds: xiCodes.map(
    (c) => masters.subjects.find((s) => s.code === c && !s.parentId)!.id,
  ),
  confirmedAt: "",
  confirmedBy: "system" as const,
};
const xiValidate = validateCurriculum(xiStudent, xiDraft, masters);
check("XI cart validates (6 / ≥2 lang / native)", xiValidate.ok, xiValidate.errors.join("; "));

const bulkXi = applyCurriculumBulk({
  state: loadSis(),
  studentIds: [xiStudent.id],
  curriculum: xiDraft,
  masters,
  policy: "overwrite",
  confirm: true,
  classId: xi.id,
});
check("Bulk confirm XI student", bulkXi.ok && bulkXi.updated === 1, `updated ${bulkXi.updated}`);

const xiFresh = loadSis().students.find((s) => s.id === xiStudent.id)!;
check(
  "XI status confirmed",
  enrollmentStatusOf(xiFresh) === "confirmed",
  enrollmentStatusOf(xiFresh),
);

// --- Exams sync + subjects ---
store["bhb_exams_v1"] = ""; // force fresh
delete store["bhb_exams_v1"];
syncExamSubjectsFromMasters(xiFresh.classId);
const examSubs = subjectsForStudent(xiFresh);
check(
  "XI exam subjects = confirmed cart codes",
  examSubs.map((s) => s.code).sort().join(",") ===
    [...xiCodes].sort().join(","),
  examSubs.map((s) => s.code).join(","),
);

const acc = { id: "x", code: "ACC", name: "Accountancy", classIds: [], maxMarks: 100, sortOrder: 1, isActive: true };
check(
  "XI does not take ACC (not enrolled)",
  !studentTakesExamSubject(xiFresh, acc),
  "ACC blocked",
);

const markCols = subjectsForMarkEntry(xiFresh.classId, [xiFresh]);
check(
  "Mark entry columns match cart",
  markCols.length === xiCodes.length,
  markCols.map((s) => s.code).join(","),
);

// --- Save marks + report ---
const terms = listExamTerms("2025-26");
const term = terms[0];
if (!term) {
  check("Exam term exists", false, "no terms");
} else {
  const marks = examSubs.map((sub) => {
    const max = Math.min(term.maxMarks, sub.maxMarks);
    return {
      studentId: xiFresh.id,
      subjectId: sub.id,
      marksObtained: Math.min(35, max),
      grade: "B1",
      remark: "",
    };
  });
  const saved = saveMarkSheet({
    academicYearCode: "2025-26",
    examTermId: term.id,
    classId: xiFresh.classId,
    sectionId: xiFresh.sectionId,
    marks,
    enteredBy: "QA",
  });
  check("Save mark sheet for XI", saved.ok, saved.ok ? `term ${term.code} max ${term.maxMarks}` : (saved as any).error);

  const card = buildReportCard({
    student: xiFresh,
    classLabel: "XI-A",
    examTermId: term.id,
    academicYearCode: "2025-26",
  });
  if ("error" in card) {
    check("Report card builds", false, card.error);
  } else {
    check(
      "Report card subject count = 6",
      card.lines.length === 6,
      card.lines.map((l) => l.subjectName).join(", "),
    );
    check(
      "Report curriculumSource confirmed_cart",
      card.curriculumSource === "confirmed_cart",
      card.curriculumSource,
    );
    check(
      "Report has no ACC line",
      !card.lines.some((l) => /account/i.test(l.subjectName)),
      "ok",
    );
  }
}

// Unconfirmed provisional note path
const unconfirmed = normalizeStudent({
  ...xiFresh,
  curriculum: {
    ...xiFresh.curriculum!,
    confirmedAt: "",
  },
});
const provisionalSubs = subjectsForStudent(unconfirmed);
check(
  "Unconfirmed XI falls back to class map (provisional)",
  provisionalSubs.length >= 6,
  `${provisionalSubs.length} subjects`,
);

const failed = checks.filter((c) => !c.ok);
console.log("\n———");
console.log(`Result: ${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) {
  console.log("Failures:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
