/**
 * Run: npx tsx src/lib/studentCurriculum.selftest.ts
 *
 * Pins enrolment to CBSE's 2026-27 Schemes of Studies: three languages in
 * VI–VIII and from Class IX (X from 2027-28), two of them Indian; Maths,
 * Science, Social Science and (Class IX) vocational education compulsory;
 * XI–XII = Hindi or English + four more, a sixth optional, with the
 * not-together pairs. Also that a language is recognised by code and name,
 * not only by the NCF tag — the school's English and Hindi carried tag D.
 */
import assert from "node:assert/strict";
import { normalizeSubject, type ClassSubjectLink, type Subject } from "./foundationMasters";
import { defaultMasters, type MastersState } from "./masters";
import {
  cartProgress,
  languageKindOf,
  languagesRequired,
  validateCurriculum,
  type StudentCurriculum,
} from "./studentCurriculum";

console.log("studentCurriculum.selftest.ts");

const base = defaultMasters();
const classId = (name: string) => base.classes.find((c) => c.name === name)!.id;

const sub = (code: string, nameEn: string, extra: Partial<Subject> = {}): Subject =>
  normalizeSubject({ id: `s-${code}`, code, nameEn, ...extra });

// Tagged as the live school data was on 30 Sep 2026: English and Hindi tag D.
const subjects = [
  sub("ENG", "English", { ncfTagId: "D" }),
  sub("HIN", "Hindi", { ncfTagId: "D" }),
  sub("SKT", "Sanskrit", { ncfTagId: "A" }),
  sub("URDU", "Urdu", { ncfTagId: "A" }),
  sub("FRE", "French", { ncfTagId: "A", languageSubtype: "foreign" }),
  sub("MAT", "Mathematics"),
  sub("APP-MAT", "Applied Mathematics"),
  sub("SCI", "Science"),
  sub("SST", "Social Science"),
  sub("VOC", "Vocational Education", { ncfTagId: "B" }),
  sub("ICT", "Computational Thinking & AI"),
  sub("PHY", "Physics"),
  sub("CHE", "Chemistry"),
  sub("BIO", "Biology"),
  sub("CT", "Computer Science"),
  sub("IT", "Information Technology", { ncfTagId: "B" }),
  sub("ECO", "Economics"),
  sub("WE", "Work Experience", { category: "co_scholastic" }),
];
const byCode = (c: string) => subjects.find((s) => s.code === c)!.id;

function mastersWith(links: [string, string, boolean?][]): MastersState {
  const classSubjects: ClassSubjectLink[] = links.map(([cls, code, optional], i) => ({
    id: `l${i}`,
    classId: classId(cls),
    subjectId: byCode(code),
    periodsPerWeek: 5,
    isActive: true,
    isOptional: !!optional,
  }));
  return { ...base, subjects, classSubjects } as MastersState;
}

const student = (cls: string, ay = "2026-27") => ({ classId: classId(cls), academicYearCode: ay });
const cur = (codes: string[], ay = "2026-27"): StudentCurriculum => ({
  academicYearCode: ay,
  seniorStreamId: null,
  chosenSubjectIds: codes.map(byCode),
  confirmedAt: "",
  confirmedBy: "office",
});
const errorsOf = (m: MastersState, cls: string, codes: string[], ay = "2026-27") =>
  validateCurriculum(student(cls, ay), cur(codes, ay), m).errors;

/* ── Recognising languages ───────────────────────────────────────────── */

assert.equal(languageKindOf(subjects[0]!), "foreign", "English tagged D is still a language");
assert.equal(languageKindOf(subjects[1]!), "indian", "Hindi tagged D is still an Indian language");
assert.equal(languageKindOf(subjects[2]!), "indian");
assert.equal(languageKindOf(subjects[4]!), "foreign");
assert.equal(languageKindOf(subjects[5]!), null, "Mathematics is not a language");

/* ── The phase-in (Scheme of Studies IX–X, Table 1) ──────────────────── */

assert.equal(languagesRequired("VI", "2026-27"), 3);
assert.equal(languagesRequired("VIII", "2026-27"), 3);
assert.equal(languagesRequired("IX", "2026-27"), 3, "IX from 2026-27");
assert.equal(languagesRequired("IX", "2025-26"), 2);
assert.equal(languagesRequired("X", "2026-27"), 2, "Class X of 2026-27 stays on the old scheme");
assert.equal(languagesRequired("X", "2027-28"), 3);
assert.equal(languagesRequired("XI", "2026-27"), 1, "XI–XII: Hindi or English");
assert.equal(languagesRequired("V", "2026-27"), null);

/* ── VI–VIII: cores from the class map, R3 chosen ────────────────────── */

const middle = mastersWith([
  ["VI", "HIN"], ["VI", "ENG"], ["VI", "MAT"], ["VI", "SCI"], ["VI", "SST"],
  ["VI", "VOC"], ["VI", "ICT"], ["VI", "SKT", true], ["VI", "URDU", true],
]);
assert.match(errorsOf(middle, "VI", []).join(" "), /three languages are compulsory/, "no R3 chosen → refused");
assert.deepEqual(errorsOf(middle, "VI", ["SKT"]), [], "Hindi + English + Sanskrit is fine");
assert.deepEqual(errorsOf(middle, "VI", ["URDU"]), [], "…or Urdu as R3");
// English + Hindi + French is three languages but only ONE Indian — CBSE
// wants two of the three native to India.
const middleFrench = mastersWith([["VI", "ENG"], ["VI", "HIN"], ["VI", "MAT"], ["VI", "FRE", true], ["VI", "SKT", true]]);
assert.match(errorsOf(middleFrench, "VI", ["FRE"]).join(" "), /at least 2 of the languages must be Indian/);
assert.deepEqual(errorsOf(middleFrench, "VI", ["FRE", "SKT"]), [], "adding Sanskrit fixes it (French as a 4th language)");

// Live shape (30 Sep 2026): VI links English and Hindi only through their
// components. They still count as English and Hindi.
const withComponents = [
  ...subjects,
  sub("ENG-ORAL", "English — Oral", { parentId: "s-ENG" }),
  sub("HIN-WRIT", "Hindi — Written", { parentId: "s-HIN" }),
];
const componentsOnly = {
  ...base,
  subjects: withComponents,
  classSubjects: [
    { id: "c1", classId: classId("VI"), subjectId: "s-ENG-ORAL", periodsPerWeek: 2, isActive: true },
    { id: "c2", classId: classId("VI"), subjectId: "s-HIN-WRIT", periodsPerWeek: 3, isActive: true },
    { id: "c3", classId: classId("VI"), subjectId: byCode("MAT"), periodsPerWeek: 7, isActive: true },
    { id: "c4", classId: classId("VI"), subjectId: byCode("SKT"), periodsPerWeek: 3, isActive: true, isOptional: true },
  ],
} as MastersState;
assert.deepEqual(errorsOf(componentsOnly, "VI", ["SKT"]), [], "components count as their language");
assert.match(errorsOf(componentsOnly, "VI", []).join(" "), /three languages/, "…and two is still two");

/* ── IX–X ────────────────────────────────────────────────────────────── */

const secondary = mastersWith([]);
const ixGood = ["HIN", "ENG", "SKT", "MAT", "SCI", "SST", "VOC"];
assert.deepEqual(errorsOf(secondary, "IX", ixGood), [], "the CBSE 2026-27 Class IX set passes — no 'exactly 7' rule");
assert.deepEqual(errorsOf(secondary, "IX", [...ixGood, "ICT", "IT"]), [], "more than 7 is fine now");
assert.match(errorsOf(secondary, "IX", ["HIN", "ENG", "MAT", "SCI", "SST", "VOC"]).join(" "), /three languages/, "IX needs R3");
assert.match(errorsOf(secondary, "IX", ["HIN", "ENG", "SKT", "SCI", "SST", "VOC"]).join(" "), /Mathematics is compulsory/);
assert.match(errorsOf(secondary, "IX", ["HIN", "ENG", "SKT", "MAT", "SCI", "SST"]).join(" "), /Vocational Education is compulsory/);
assert.deepEqual(
  errorsOf(secondary, "X", ["HIN", "ENG", "MAT", "SCI", "SST"]),
  [],
  "Class X of 2026-27: two languages, skill only a warning",
);
assert.match(errorsOf(secondary, "X", ["HIN", "ENG", "MAT", "SCI", "SST", "VOC"], "2027-28").join(" "), /three languages/, "X from 2027-28 needs three");

/* ── XI–XII ──────────────────────────────────────────────────────────── */

const senior = mastersWith([]);
assert.deepEqual(errorsOf(senior, "XI", ["ENG", "PHY", "CHE", "MAT", "BIO"]), [], "English + four electives — one language is enough");
assert.deepEqual(errorsOf(senior, "XI", ["ENG", "PHY", "CHE", "MAT", "BIO", "ECO"]), [], "a sixth is optional");
assert.match(errorsOf(senior, "XI", ["ENG", "PHY", "CHE", "MAT"]).join(" "), /at least 5 main subjects/);
assert.match(errorsOf(senior, "XI", ["ENG", "PHY", "CHE", "MAT", "BIO", "ECO", "HIN"]).join(" "), /at most 6/);
assert.match(errorsOf(senior, "XI", ["SKT", "PHY", "CHE", "MAT", "BIO"]).join(" "), /Hindi or English is compulsory/);
assert.match(errorsOf(senior, "XI", ["ENG", "PHY", "CHE", "MAT", "APP-MAT"]).join(" "), /Mathematics and Applied Mathematics cannot be taken together/);
assert.match(errorsOf(senior, "XI", ["ENG", "PHY", "CHE", "CT", "IT"]).join(" "), /cannot be taken together/);
assert.deepEqual(
  errorsOf(senior, "XI", ["ENG", "PHY", "CHE", "MAT", "BIO", "WE"]),
  [],
  "Work Experience is internal, not one of the five/six main subjects",
);

/* ── Progress for the editor ─────────────────────────────────────────── */

const p = cartProgress("senior_cart", ["ENG", "PHY", "CHE", "MAT", "BIO", "WE"].map((c) => subjects.find((s) => s.code === c)!), { className: "XI", academicYearCode: "2026-27" });
assert.equal(p.count, 5, "main subjects only");
assert.equal(p.min, 5);
assert.equal(p.target, 6);
assert.equal(p.languagesRequired, 1);
const q = cartProgress("secondary_cart", ixGood.map((c) => subjects.find((s) => s.code === c)!), { className: "IX", academicYearCode: "2026-27" });
assert.equal(q.languages, 3);
assert.equal(q.languagesRequired, 3);
assert.equal(q.indianRequired, 2);
assert.equal(q.nativeLanguages, 2, "Hindi + Sanskrit");

console.log("OK — studentCurriculum.selftest.ts");
