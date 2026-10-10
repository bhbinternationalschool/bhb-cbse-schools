/**
 * Self-test: the school's books, shaped into syllabus units.
 * Run: npx tsx apps/web/src/lib/syllabusFromBooks.selftest.ts
 */
import assert from "node:assert/strict";
import { toImportChapters } from "@/lib/syllabusFromBooks";

console.log("syllabusFromBooks.selftest.ts");

// The book's own order, whatever order the rows arrive in.
{
  const out = toImportChapters([
    { position: 3, name: "Our Clothes", topics: ["Why we wear clothes", "Clothes for each season"] },
    { position: 1, name: "My Family", topics: ["People at home"] },
    { position: 2, name: "  Our Food  ", topics: [] },
  ]);
  assert.deepEqual(out.map((c) => c.title), ["My Family", "Our Food", "Our Clothes"]);
  assert.deepEqual(out.map((c) => c.code), ["1", "2", "3"], "the chapter's own number is its code");
  assert.deepEqual(out[0]!.topics, [{ title: "People at home" }]);
  assert.equal(out[1]!.topics, undefined, "no topics is no key, not an empty list");
  assert.equal(out[2]!.topics!.length, 2);
}

// How long a chapter takes is the teacher's judgement, never the book's.
{
  const out = toImportChapters([{ position: 1, name: "My Family", topics: ["People at home"] }]);
  assert.equal(out[0]!.plannedPeriods, undefined, "a planned period count must not be invented");
  assert.equal(out[0]!.topics![0]!.plannedPeriods, undefined);
}

// Nothing usable is dropped quietly rather than shown as a blank row.
{
  const out = toImportChapters([
    { position: 1, name: "   ", topics: ["x"] },
    { position: 2, name: "Numbers", topics: ["  ", "Counting", "counting", "Counting "] },
    { position: 3, name: "numbers", topics: [] },
    { position: 0, name: "Preface", topics: [] },
  ]);
  assert.deepEqual(out.map((c) => c.title), ["Preface", "Numbers"], "a blank title is not a chapter");
  assert.equal(out[0]!.code, undefined, "position 0 carries no chapter number");
  const numbers = out.find((c) => c.title === "Numbers")!;
  assert.deepEqual(numbers.topics, [{ title: "Counting" }], "the same topic twice is one topic");
  assert.equal(out.filter((c) => c.title.toLowerCase() === "numbers").length, 1, "and the same chapter twice is one chapter");
}

// Hindi reads through unchanged — the name is the book's, not ours.
{
  const out = toImportChapters([
    { position: 5, name: "ईमानदार बालक", topics: ["कहानी का सार", "शब्दार्थ"] },
  ]);
  assert.equal(out[0]!.title, "ईमानदार बालक");
  assert.deepEqual(out[0]!.topics, [{ title: "कहानी का सार" }, { title: "शब्दार्थ" }]);
}

console.log("  ok — the book's order, the book's names, and no invented periods");
