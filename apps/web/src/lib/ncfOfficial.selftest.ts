/**
 * Run: npx tsx src/lib/ncfOfficial.selftest.ts
 *
 * Pins how DIKSHA's class-wise subject lists become school subjects:
 * parsing and cleaning the framework, the first-sync baseline, change
 * detection, class-name mapping, and the bulk apply to a class — matched by
 * the school's own saved match first, so a renamed subject stays matched.
 */
import assert from "node:assert/strict";
import { normalizeSubject, type ClassSubjectLink, type Subject } from "./foundationMasters";
import {
  canonicalOfficialSubject,
  codeForNewSubject,
  dikshaGradeForClass,
  diffOfficial,
  parseFramework,
  planApplyToClass,
  resolveSchoolSubject,
  type StoredOfficial,
} from "./ncfOfficial";

console.log("ncfOfficial.selftest.ts");

/* ── Parsing, shaped like DIKSHA's framework read (30 Sep 2026) ──────── */

const assoc = (names: string[]) => names.map((name) => ({ category: "subject", name }));
const framework = {
  result: {
    framework: {
      name: "NCERT",
      categories: [
        { code: "board", terms: [{ name: "NCERT" }] },
        {
          code: "gradeLevel",
          terms: [
            { name: "Class 1", associations: assoc(["EVS", "Education", "English", "Hindi", "ICT", "Mathematics", "Urdu"]) },
            {
              name: "Class 6",
              associations: [
                ...assoc(["Arts", "English", "English Workbook", "Health And Physical Education", "Physical Education And Well Being", "Science", "Sanskrit", "CBSE Training"]),
                { category: "medium", name: "Hindi" },
              ],
            },
            { name: "CPD", associations: assoc(["Education"]) },
            { name: "Preschool 1", associations: assoc(["English", "Hindi", "Mathematics"]) },
          ],
        },
      ],
    },
  },
};
const parsed = parseFramework(framework)!;
assert.ok(parsed, "a recognised framework parses");
assert.deepEqual([...parsed.keys()], ["Class 1", "Class 6", "Preschool 1"], "only grades the ERP has classes for");
assert.deepEqual(
  parsed.get("Class 1"),
  ["English", "Environmental Studies", "Hindi", "ICT", "Mathematics", "Urdu"],
  "EVS spelled out; 'Education' is a tag, not a subject",
);
assert.deepEqual(
  parsed.get("Class 6"),
  ["Arts", "English", "Health And Physical Education", "Physical Education And Well Being", "Sanskrit", "Science"],
  "workbooks and 'CBSE Training' dropped; a medium is not a subject; old and NCF-2023 PE names both kept",
);
assert.equal(parseFramework({ result: {} }), null, "an unrecognised shape is null, never 'no subjects'");
assert.equal(parseFramework("<html>503</html>"), null);
assert.equal(canonicalOfficialSubject("Political Science/Civics"), "Political Science");
assert.equal(canonicalOfficialSubject("Accounts"), "Accountancy");
assert.equal(canonicalOfficialSubject("  "), null);

/* ── Classes ─────────────────────────────────────────────────────────── */

assert.equal(dikshaGradeForClass("Nursery"), "Preschool 1");
assert.equal(dikshaGradeForClass("LKG"), "Preschool 2");
assert.equal(dikshaGradeForClass("UKG"), "Preschool 3");
assert.equal(dikshaGradeForClass("I"), "Class 1");
assert.equal(dikshaGradeForClass("VIII"), "Class 8");
assert.equal(dikshaGradeForClass("Class XII"), "Class 12");
assert.equal(dikshaGradeForClass("10"), "Class 10");
assert.equal(dikshaGradeForClass("Staff room"), null);

/* ── Change detection ────────────────────────────────────────────────── */

const first = diffOfficial("NCERT", [], parsed);
assert.equal(first.baseline, true, "the first sync is a baseline");
assert.equal(first.changes.length, 0, "…and reports nothing");

const stored: StoredOfficial[] = [
  ...parsed.get("Class 6")!.filter((s) => s !== "Arts").map((subject) => ({ board: "NCERT" as const, grade: "Class 6", subject, removedAt: null })),
  { board: "NCERT", grade: "Class 6", subject: "Vocational Education", removedAt: null },
  { board: "NCERT", grade: "Class 1", subject: "English", removedAt: null },
  { board: "NCERT", grade: "Class 7", subject: "Science", removedAt: null },
  { board: "NCERT", grade: "Class 6", subject: "Urdu", removedAt: "2026-09-01T00:00:00Z" },
  { board: "CBSE", grade: "Class 6", subject: "Arts", removedAt: null },
];
const next = diffOfficial("NCERT", stored, parsed);
assert.equal(next.baseline, false);
const has = (grade: string, subject: string, kind: string) =>
  next.changes.some((c) => c.grade === grade && c.subject === subject && c.kind === kind);
assert.ok(has("Class 6", "Arts", "added"), "a subject new to a class is 'added'");
assert.ok(has("Class 6", "Vocational Education", "removed"), "one DIKSHA stopped listing is 'removed'");
assert.ok(!next.changes.some((c) => c.grade === "Class 7"), "a whole grade missing from DIKSHA is left alone");
assert.ok(!next.changes.some((c) => c.subject === "Urdu" && c.kind === "removed"), "already removed is not removed again");
assert.ok(!has("Class 6", "Arts", "removed"), "CBSE's rows do not count for NCERT");

/* ── Matching and creating school subjects ───────────────────────────── */

const sub = (id: string, code: string, nameEn: string, parentId: string | null = null): Subject =>
  normalizeSubject({ id, code, nameEn, parentId });
const school = [
  sub("s-eng", "ENG", "English"),
  sub("s-mat", "MAT", "Maths (school name)"),
  sub("s-pe", "PEW", "Health & Physical Education"),
  sub("s-evs", "EVS", "Our Surroundings"),
  sub("s-art", "DRAW", "Drawing"),
];
assert.equal(resolveSchoolSubject("Mathematics", school, [])?.id, "s-mat", "matched by the usual code");
assert.equal(resolveSchoolSubject("english", school, [])?.id, "s-eng");
assert.equal(resolveSchoolSubject("Physical Education And Well Being", school, [])?.id, "s-pe", "NCF-2023 PE name → the school's PE");
assert.equal(resolveSchoolSubject("Arts", school, []), null, "no ART code, no 'Arts' name → to be created");
assert.equal(
  resolveSchoolSubject("Arts", school, [{ subjectKey: "arts", schoolSubjectId: "s-art" }])?.id,
  "s-art",
  "the school's saved match wins — Arts is its Drawing",
);
assert.equal(
  resolveSchoolSubject("Mathematics", school, [{ subjectKey: "mathematics", schoolSubjectId: "gone" }])?.id,
  "s-mat",
  "a match to a deleted subject falls back to the usual rules",
);
assert.equal(codeForNewSubject("Arts", school), "ART");
assert.equal(codeForNewSubject("Knowledge Traditions and Practices of India", school), "KTPI");
assert.equal(codeForNewSubject("English", school), "ENG2", "never a clash with an existing code");
assert.equal(codeForNewSubject("Statistics", school), "STAT");

/* ── Applying a class's list in bulk ─────────────────────────────────── */

const links: ClassSubjectLink[] = [
  { id: "l1", classId: "c6", subjectId: "s-eng", periodsPerWeek: 6, isActive: true },
];
const plan = planApplyToClass({
  officialSubjects: ["English", "Arts", "Mathematics", "Health And Physical Education", "Physical Education And Well Being"],
  classId: "c6",
  subjects: school,
  classSubjects: links,
  mappings: [],
  periodsFor: () => 5,
});
assert.deepEqual(
  plan.rows.map((r) => [r.official, r.subject.code, r.created, r.alreadyLinked]),
  [
    ["English", "ENG", false, true],
    ["Arts", "ART", true, false],
    ["Mathematics", "MAT", false, false],
    ["Health And Physical Education", "PEW", false, false],
    ["Physical Education And Well Being", "PEW", false, true],
  ],
);
assert.equal(plan.newSubjects.length, 1, "only Arts is new");
assert.equal(plan.newSubjects[0]!.nameEn, "Arts");
assert.deepEqual(
  plan.newLinks.map((l) => l.subjectId).sort(),
  ["s-mat", "s-pe", plan.newSubjects[0]!.id].sort(),
  "English already linked; PE linked once for both names",
);
assert.ok(plan.newLinks.every((l) => l.classId === "c6" && l.periodsPerWeek === 5 && l.isActive));
assert.equal(plan.newMappings.length, 5, "every match is remembered, so a rename keeps it");

// After the school renames its new ART subject, the saved match still finds it.
const renamed = [...school, { ...plan.newSubjects[0]!, code: "ARTC", nameEn: "Art & Craft" }];
assert.equal(
  resolveSchoolSubject("Arts", renamed, plan.newMappings)?.nameEn,
  "Art & Craft",
  "renamed subject stays matched",
);

// Applying again changes nothing.
const again = planApplyToClass({
  officialSubjects: ["English", "Arts"],
  classId: "c6",
  subjects: renamed,
  classSubjects: [...links, ...plan.newLinks],
  mappings: plan.newMappings,
  periodsFor: () => 5,
});
assert.equal(again.newSubjects.length, 0);
assert.equal(again.newLinks.length, 0);
assert.equal(again.newMappings.length, 0);

console.log("OK — ncfOfficial.selftest.ts");
