import assert from "node:assert/strict";
import { normalizeSubject, type ClassSubjectLink, type Subject } from "./foundationMasters";
import type { SchoolClass } from "./masters";
import { NEP_STAGE_PACKS, applyNepSuggestions } from "./nepSubjectSuggestions";
import {
  applySubjectDraft,
  classLinkIdsToRemove,
  classSubjectRows,
  draftFromSubject,
  emptySubjectDraft,
  ncfSuggestionRows,
  schoolSubjectRows,
  singleSuggestionPack,
  subjectDeleteBlockers,
  subjectDraftError,
  subjectFromDraft,
  type SubjectsSlice,
} from "./subjectMasters";

console.log("subjectMasters.selftest.ts");

const sub = (id: string, code: string, parentId: string | null = null, sortOrder = 1): Subject =>
  normalizeSubject({ id, code, nameEn: code, parentId, sortOrder });
const cls = (id: string, name: string, sortOrder: number): SchoolClass =>
  ({ id, name, sortOrder, isActive: true }) as SchoolClass;
const link = (id: string, classId: string, subjectId: string): ClassSubjectLink => ({
  id,
  classId,
  subjectId,
  periodsPerWeek: 5,
  isActive: true,
});

// The live state on 30 Sep 2026: NUM (Early Numeracy) linked nowhere, a
// school-made MATH, and MATH-ORAL twice under NUM because the first one
// never appeared.
const classes = [cls("c-nur", "Nursery", 1), cls("c-1", "I", 4), cls("c-6", "VI", 9)];
const slice: SubjectsSlice = {
  classes,
  subjects: [
    sub("s-eng", "ENG", null, 1),
    sub("s-eng-o", "ENG-ORAL", "s-eng", 1),
    sub("s-num", "NUM", null, 2),
    sub("s-mo1", "MATH-ORAL", "s-num", 1),
    sub("s-math", "MATH", null, 3),
    sub("s-sci", "SCI", null, 4),
  ],
  classSubjects: [link("l1", "c-1", "s-eng"), link("l2", "c-6", "s-sci"), link("l3", "c-1", "s-eng-o")],
  staff: [],
};

/* ── Nothing the school adds is ever hidden ──────────────────────────── */

const all = schoolSubjectRows(slice);
assert.deepEqual(
  all.map((r) => r.subject.code),
  ["ENG", "ENG-ORAL", "NUM", "MATH-ORAL", "MATH", "SCI"],
  "every subject, each component right under its subject",
);
assert.equal(all.find((r) => r.subject.code === "MATH-ORAL")!.depth, 1);
assert.equal(all.find((r) => r.subject.code === "MATH-ORAL")!.parent!.code, "NUM");
assert.equal(all.find((r) => r.subject.code === "NUM")!.componentCount, 1);
assert.deepEqual(all.find((r) => r.subject.code === "ENG")!.classNames, ["I"]);

// A stage filter narrows, but a subject linked nowhere stays — that is the
// case the old screen lost.
const primary = schoolSubjectRows(slice, { groupClassIds: new Set(["c-1"]) });
const primaryCodes = primary.map((r) => r.subject.code);
assert.ok(primaryCodes.includes("ENG") && primaryCodes.includes("ENG-ORAL"));
assert.ok(primaryCodes.includes("MATH"), "unlinked school subject is not hidden by the stage filter");
assert.ok(primaryCodes.includes("NUM") && primaryCodes.includes("MATH-ORAL"), "unlinked component is not hidden");
assert.ok(!primaryCodes.includes("SCI"), "a subject linked only to another stage is filtered out");

// Search keeps the family together.
const q = schoolSubjectRows(slice, { query: "oral" }).map((r) => r.subject.code);
assert.deepEqual(q, ["ENG", "ENG-ORAL", "NUM", "MATH-ORAL"]);

// An orphan component (parent deleted elsewhere) is shown, not lost.
const orphan = schoolSubjectRows({ ...slice, subjects: [sub("x", "X-ORAL", "gone")] });
assert.equal(orphan.length, 1);
assert.equal(orphan[0].depth, 0);

/* ── Codes are unique, components one level deep ─────────────────────── */

const d = (patch: Partial<ReturnType<typeof emptySubjectDraft>>) => ({ ...emptySubjectDraft(), ...patch });
assert.equal(subjectDraftError(slice.subjects, d({ code: "", nameEn: "x" })), "Enter a code");
assert.equal(subjectDraftError(slice.subjects, d({ code: "GK", nameEn: " " })), "Enter a name");
assert.match(
  subjectDraftError(slice.subjects, d({ code: "math-oral", nameEn: "Math Oral", parentId: "s-num" }))!,
  /already used/,
  "the second MATH-ORAL is refused, case-insensitively",
);
assert.match(subjectDraftError(slice.subjects, d({ code: "a b!", nameEn: "x" }))!, /letters, numbers/);
assert.equal(subjectDraftError(slice.subjects, d({ code: "gk", nameEn: "General Knowledge" })), null);
assert.equal(
  subjectDraftError(slice.subjects, d({ code: "NUM-WRIT", nameEn: "Numeracy — Written", parentId: "s-num" })),
  null,
);
assert.match(
  subjectDraftError(slice.subjects, d({ code: "DEEP", nameEn: "x", parentId: "s-mo1" }))!,
  /not under another component/,
);
// Editing keeps its own code without calling it a clash.
assert.equal(subjectDraftError(slice.subjects, draftFromSubject(slice.subjects[4]), "s-math"), null);
// A subject with components cannot itself become a component.
assert.match(
  subjectDraftError(slice.subjects, { ...draftFromSubject(slice.subjects[2]), parentId: "s-eng" }, "s-num")!,
  /has components/,
);
assert.match(
  subjectDraftError(slice.subjects, { ...draftFromSubject(slice.subjects[4]), parentId: "s-math" }, "s-math")!,
  /own component/,
);

/* ── Building rows ───────────────────────────────────────────────────── */

const comp = subjectFromDraft(slice.subjects, d({ code: " num writ ", nameEn: " Written ", parentId: "s-num" }));
assert.equal(comp.code, "NUM-WRIT", "code upper-cased, spaces become hyphens");
assert.equal(comp.nameEn, "Written");
assert.equal(comp.parentId, "s-num");
assert.equal(comp.sortOrder, 2, "after the existing component");
assert.equal(comp.isActive, true);

const edited = applySubjectDraft(slice.subjects, slice.subjects[4], {
  ...draftFromSubject(slice.subjects[4]),
  nameEn: "Mathematics (school)",
  parentId: "s-num",
});
assert.equal(edited.id, "s-math", "an edit keeps the id every link points at");
assert.equal(edited.parentId, "s-num");
assert.equal(edited.nameEn, "Mathematics (school)");

/* ── Delete only what nothing points at ──────────────────────────────── */

assert.deepEqual(subjectDeleteBlockers(slice, "s-math"), [], "unlinked MATH may be deleted");
assert.deepEqual(subjectDeleteBlockers(slice, "s-mo1"), [], "the duplicate MATH-ORAL may be deleted");
assert.match(subjectDeleteBlockers(slice, "s-num")[0], /1 component \(MATH-ORAL\)/);
assert.match(subjectDeleteBlockers(slice, "s-sci")[0], /linked to 1 class \(VI\)/);
const withTeacher: SubjectsSlice = {
  ...slice,
  staff: [
    {
      fullName: "A. Teacher",
      subjectTeachingLinks: [
        { id: "t", classId: "c-6", sectionId: null, subjectId: "s-math", academicYearCode: "2026-27", periodsPerWeek: 5 },
      ],
    } as unknown as NonNullable<SubjectsSlice["staff"]>[number],
  ],
};
assert.match(subjectDeleteBlockers(withTeacher, "s-math")[0], /assigned to 1 teacher \(A\. Teacher\)/);

/* ── NCF suggestions ─────────────────────────────────────────────────── */

const pack = NEP_STAGE_PACKS.find((p) => p.id === "foundational")!;
const rows = ncfSuggestionRows(pack, slice.subjects, () => 5);
assert.equal(rows.length, pack.subjects.length, "one row per suggestion");
const numRow = rows.find((r) => r.code === "NUM");
if (numRow) assert.equal(numRow.present?.id, "s-num", "a suggestion the school has points at its row");

// Adding ONE suggestion adds just it (and its parent only when missing).
const withComponent = pack.subjects.find((s) => s.underCode);
if (withComponent) {
  const one = singleSuggestionPack(pack, withComponent.code);
  assert.equal(one.subjects.at(-1)!.code, withComponent.code);
  const { added } = applyNepSuggestions([], one);
  assert.equal(added, 2, "component + its missing parent");
}
const lone = pack.subjects.find((s) => !s.underCode)!;
assert.equal(applyNepSuggestions(slice.subjects, singleSuggestionPack(pack, lone.code)).added <= 1, true);
assert.equal(singleSuggestionPack(pack, "NOPE").subjects.length, 0);

/* ── One class's subjects ────────────────────────────────────────────── */

// Class I studies ENG and ENG-ORAL; it does not study NUM, MATH or SCI.
const classI = classSubjectRows(slice, "c-1");
assert.deepEqual(classI.map((r) => r.subject.code), ["ENG", "ENG-ORAL"]);
assert.ok(classI.every((r) => r.link), "both linked");
assert.equal(classI[1].depth, 1);
assert.equal(classI[1].parent!.code, "ENG");

// A component the class does not study still shows under its subject,
// unlinked, so the gap is visible and one click from being filled.
const withWritten: SubjectsSlice = {
  ...slice,
  subjects: [...slice.subjects, sub("s-eng-w", "ENG-WRIT", "s-eng", 2)],
};
const classI2 = classSubjectRows(withWritten, "c-1");
assert.deepEqual(classI2.map((r) => [r.subject.code, !!r.link]), [
  ["ENG", true],
  ["ENG-ORAL", true],
  ["ENG-WRIT", false],
]);
// ...unless it is inactive, which is not a gap.
const inactiveWritten: SubjectsSlice = {
  ...withWritten,
  subjects: withWritten.subjects.map((x) => (x.id === "s-eng-w" ? { ...x, isActive: false } : x)),
};
assert.equal(classSubjectRows(inactiveWritten, "c-1").length, 2);

// A class linked only to a component still shows the subject above it.
const onlyComponent: SubjectsSlice = { ...slice, classSubjects: [link("lx", "c-nur", "s-mo1")] };
assert.deepEqual(
  classSubjectRows(onlyComponent, "c-nur").map((r) => [r.subject.code, !!r.link]),
  [["NUM", false], ["MATH-ORAL", true]],
);
assert.deepEqual(classSubjectRows(slice, "c-nur"), [], "a class with nothing linked is empty");

// Removing a subject from a class takes its components' links too — and
// only that class's.
const twoClasses: SubjectsSlice = {
  ...slice,
  classSubjects: [...slice.classSubjects, link("l4", "c-6", "s-eng"), link("l5", "c-6", "s-eng-o")],
};
assert.deepEqual(classLinkIdsToRemove(twoClasses, "c-1", "s-eng").sort(), ["l1", "l3"]);
assert.deepEqual(classLinkIdsToRemove(twoClasses, "c-1", "s-eng-o"), ["l3"], "a component alone");
assert.deepEqual(classLinkIdsToRemove(twoClasses, "c-1", "s-sci"), []);

/* ── The NCF / CBSE suggestion packs themselves ────────────────────── */

for (const p of NEP_STAGE_PACKS) {
  const codes = p.subjects.map((x) => x.code.toUpperCase());
  assert.equal(new Set(codes).size, codes.length, `${p.id}: a code is suggested twice`);
  for (const x of p.subjects.filter((y) => y.underCode)) {
    assert.ok(codes.includes(x.underCode!.toUpperCase()), `${p.id}: ${x.code} sits under a missing ${x.underCode}`);
  }
}
// CBSE 2026-27 (Scheme of Studies IX–X): Mathematics Basic is discontinued,
// and the third language is part of the IX–X pack.
const ix = NEP_STAGE_PACKS.find((p) => p.id === "secondary_9_10")!;
assert.ok(!ix.subjects.some((x) => /basic/i.test(x.nameEn)), "no Mathematics Basic from 2026-27");
assert.ok(ix.subjects.some((x) => x.code === "SKT" && /R3/.test(x.nameEn)), "R3 offered in IX–X");
const xi = NEP_STAGE_PACKS.find((p) => p.id === "secondary_11_12")!;
assert.ok(["WE", "GS", "HPE"].every((c) => xi.subjects.some((x) => x.code === c)), "XI–XII internal subjects present");

console.log("OK — subjectMasters.selftest.ts");
