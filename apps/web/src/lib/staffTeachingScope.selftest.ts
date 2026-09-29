/**
 * staffTeachingScope — a teacher's own sections and subjects.
 * Run: npx tsx src/lib/staffTeachingScope.selftest.ts
 *
 * Shapes are the 2026-09-29 roster: a subject-only teacher (Shipra Singh),
 * a class teacher who also teaches elsewhere (Kiran Patel), and a subject
 * link saved with no section (Ravindra Yadav, Sports in Class IX).
 */
import { teachingSectionsFor, normalizeYear } from "./staffTeachingScope";
import type { StaffRecord } from "./foundationMasters";

let failed = 0;
function expect(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failed += 1;
    console.error(`FAIL ${label}: got ${g}, want ${w}`);
  }
}

const staff = (id: string, extra: Partial<StaffRecord>) =>
  ({ id, classTeacherLinks: [], subjectTeachingLinks: [], ...extra }) as StaffRecord;

const masters = {
  classes: [
    { id: "c2", name: "II", sortOrder: 5 },
    { id: "c6", name: "VI", sortOrder: 9 },
    { id: "c9", name: "IX", sortOrder: 12 },
  ],
  sections: [
    { id: "s2a", classId: "c2", name: "A" },
    { id: "s6a", classId: "c6", name: "A" },
    { id: "s9a", classId: "c9", name: "A" },
    { id: "s9b", classId: "c9", name: "B", isActive: false },
  ],
  subjects: [
    { id: "eng", code: "eng ", nameEn: "English" },
    { id: "hin", nameEn: "Hindi" },
    { id: "gk", nameEn: "G.K." },
    { id: "pe", nameEn: "Sports" },
  ],
  classSubjects: [
    { id: "x1", classId: "c2", subjectId: "eng", periodsPerWeek: 6, isActive: true },
    { id: "x2", classId: "c2", subjectId: "hin", periodsPerWeek: 6, isActive: true },
    { id: "x3", classId: "c2", subjectId: "gk", periodsPerWeek: 1, isActive: false },
  ],
  staff: [
    staff("shipra", {
      subjectTeachingLinks: [
        { id: "a", classId: "c6", sectionId: "s6a", subjectId: "hin", academicYearCode: "2026-27", periodsPerWeek: 5 },
        { id: "b", classId: "c9", sectionId: "s9a", subjectId: "eng", academicYearCode: "2026-2027", periodsPerWeek: 5 },
        { id: "old", classId: "c2", sectionId: "s2a", subjectId: "eng", academicYearCode: "2025-26", periodsPerWeek: 5 },
      ],
    }),
    staff("kiran", {
      classTeacherLinks: [
        { id: "ct", classId: "c2", sectionId: "s2a", academicYearCode: "2026-27", isPrimary: true },
      ],
      subjectTeachingLinks: [
        { id: "c", classId: "c6", sectionId: "s6a", subjectId: "eng", academicYearCode: "2026-27", periodsPerWeek: 6 },
      ],
    }),
    staff("ravindra", {
      subjectTeachingLinks: [
        { id: "d", classId: "c9", sectionId: null, subjectId: "pe", academicYearCode: "2026-27", periodsPerWeek: 3 },
      ],
    }),
    staff("ankita", {}),
  ],
};

const years = ["2026-27", "2026-27"];
const keys = (id: string, grids = []) =>
  teachingSectionsFor({ staffId: id, masters, grids, academicYearCodes: years }).map(
    (t) => `${t.className}${t.sectionName}${t.isClassTeacher ? "*" : ""}:${t.subjects.map((s) => s.id).join(",")}`,
  );

expect("normalizeYear long form", normalizeYear("2026-2027"), "2026-27");
expect("normalizeYear en dash", normalizeYear("2026–27"), "2026-27");

// Subject-only teacher: her two current sections, her subject only, last year's link ignored.
expect("subject teacher", keys("shipra"), ["VIA:hin", "IXA:eng"]);

// Class teacher first, with every ACTIVE subject of the class; other section by subject.
expect("class teacher", keys("kiran"), ["IIA*:eng,hin", "VIA:eng"]);

// Null section = every live section of the class (IX-B is inactive).
expect("null section link", keys("ravindra"), ["IXA:pe"]);

// Exam screens match on the subject CODE (their ids are their own), normalized.
expect(
  "subject code carried",
  teachingSectionsFor({ staffId: "shipra", masters, academicYearCodes: years })
    .find((t) => t.classId === "c9")?.subjects.map((x) => x.code),
  ["ENG"],
);

// Nobody assigned: nothing, never "everything".
expect("no links", keys("ankita"), []);
expect("blank staff id", keys(""), []);

// Timetable periods add the section and subject.
expect(
  "timetable slot",
  keys("ankita", [
    { academicYearCode: "2026-27", classId: "c2", sectionId: "s2a", slots: [{ teacherId: "ankita", subjectId: "gk" }] },
    { academicYearCode: "2025-26", classId: "c6", sectionId: "s6a", slots: [{ teacherId: "ankita", subjectId: "eng" }] },
  ] as never),
  ["IIA:gk"],
);

if (failed) {
  console.error(`staffTeachingScope: ${failed} failure(s)`);
  process.exit(1);
}
console.log("staffTeachingScope: ok");
