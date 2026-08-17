/**
 * Syllabus OCR parser regression test.
 *
 * The parser feeds a review screen, so the bar is: read the common
 * contents-page layouts correctly, and never fabricate a chapter that
 * was not printed on the page.
 *
 * Run: npx tsx src/lib/syllabusOcr.selftest.ts
 */
import assert from "node:assert/strict";

import {
  parseSyllabusFromText,
  syllabusOcrQuality,
} from "./syllabusOcr";

console.log("syllabusOcr.selftest.ts");

/* ------------------------------------------------------------------ */
/* 1. NCERT style: "Chapter N Title  page"                             */
/* ------------------------------------------------------------------ */

{
  const page = `
CONTENTS
FOREWORD iii
Chapter 1  Rational Numbers        1
Chapter 2  Linear Equations in One Variable   21
Chapter 3  Understanding Quadrilaterals   37
`;
  const out = parseSyllabusFromText(page);
  assert.equal(out.chapters.length, 3);
  assert.equal(out.chapters[0]!.code, "1");
  assert.equal(out.chapters[0]!.title, "Rational Numbers");
  assert.equal(out.chapters[0]!.confidence, "high");
  assert.equal(
    out.chapters[1]!.title,
    "Linear Equations in One Variable",
    "page number must be stripped, title kept whole",
  );
  assert.equal(out.chapters[2]!.title, "Understanding Quadrilaterals");
}

/* ------------------------------------------------------------------ */
/* 2. Numbered list with dot leaders                                    */
/* ------------------------------------------------------------------ */

{
  const page = `
Contents
1. Rational Numbers ....................... 1
2. Linear Equations in One Variable ....... 21
3. Data Handling .......................... 65
`;
  const out = parseSyllabusFromText(page);
  assert.equal(out.chapters.length, 3);
  assert.equal(out.chapters[0]!.title, "Rational Numbers");
  assert.equal(out.chapters[2]!.title, "Data Handling");
  for (const c of out.chapters) {
    assert.ok(
      !/\.{2,}|\d+$/.test(c.title),
      `leader dots / page numbers must not survive: "${c.title}"`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* 3. Chapters with numbered sub-topics                                 */
/* ------------------------------------------------------------------ */

{
  const page = `
1. Rational Numbers
1.1 Introduction
1.2 Properties of Rational Numbers
1.3 Representation on the Number Line
2. Linear Equations in One Variable
2.1 Introduction
2.2 Solving Equations
`;
  const out = parseSyllabusFromText(page);
  assert.equal(out.chapters.length, 2);
  assert.equal(out.chapters[0]!.topics.length, 3);
  assert.equal(out.chapters[0]!.topics[0]!.code, "1.1");
  assert.equal(out.chapters[0]!.topics[0]!.title, "Introduction");
  assert.equal(
    out.chapters[0]!.topics[2]!.title,
    "Representation on the Number Line",
  );
  assert.equal(out.chapters[1]!.topics.length, 2);
  assert.equal(out.chapters[1]!.topics[1]!.title, "Solving Equations");
}

/* ------------------------------------------------------------------ */
/* 4. Topics attach to their printed chapter, not just the last one     */
/* ------------------------------------------------------------------ */

{
  // Some books list all chapters, then all sub-topics.
  const page = `
1. Force and Pressure
2. Friction
1.1 What is a Force
2.1 Types of Friction
`;
  const out = parseSyllabusFromText(page);
  assert.equal(out.chapters.length, 2);
  assert.equal(
    out.chapters[0]!.topics.length,
    1,
    "1.1 belongs to chapter 1 even though chapter 2 came last",
  );
  assert.equal(out.chapters[0]!.topics[0]!.title, "What is a Force");
  assert.equal(out.chapters[1]!.topics[0]!.title, "Types of Friction");
}

/* ------------------------------------------------------------------ */
/* 5. Unit / Lesson wording and roman numerals                          */
/* ------------------------------------------------------------------ */

{
  const page = `
Unit I : Number System
Unit II : Algebra
Lesson 3 - Geometry
`;
  const out = parseSyllabusFromText(page);
  assert.equal(out.chapters.length, 3);
  assert.equal(out.chapters[0]!.code, "I");
  assert.equal(out.chapters[0]!.title, "Number System");
  assert.equal(out.chapters[1]!.title, "Algebra");
  assert.equal(out.chapters[2]!.code, "3");
  assert.equal(out.chapters[2]!.title, "Geometry");
}

/* ------------------------------------------------------------------ */
/* 6. "Chapter 4" with the title on the following line                  */
/* ------------------------------------------------------------------ */

{
  const page = `
Chapter 4
Practical Geometry
Chapter 5
Data Handling
`;
  const out = parseSyllabusFromText(page);
  assert.equal(out.chapters.length, 2);
  assert.equal(out.chapters[0]!.code, "4");
  assert.equal(out.chapters[0]!.title, "Practical Geometry");
  assert.equal(out.chapters[1]!.title, "Data Handling");
}

/* ------------------------------------------------------------------ */
/* 7. Bullets become topics of the chapter above                        */
/* ------------------------------------------------------------------ */

{
  const page = `
Chapter 1 Crop Production
• Agricultural Practices
• Basic Practices of Crop Production
`;
  const out = parseSyllabusFromText(page);
  assert.equal(out.chapters.length, 1);
  assert.equal(out.chapters[0]!.topics.length, 2);
  assert.equal(out.chapters[0]!.topics[0]!.title, "Agricultural Practices");
  assert.equal(out.chapters[0]!.topics[0]!.code, "");
}

/* ------------------------------------------------------------------ */
/* 8. Front matter and page furniture are discarded                     */
/* ------------------------------------------------------------------ */

{
  const page = `
CONTENTS
FOREWORD
PREFACE
iii
iv
12
Chapter 1 Rational Numbers 1
`;
  const out = parseSyllabusFromText(page);
  assert.equal(
    out.chapters.length,
    1,
    "front matter must not become chapters",
  );
  assert.equal(out.chapters[0]!.title, "Rational Numbers");
}

/* ------------------------------------------------------------------ */
/* 9. ALL-CAPS headings are made readable                               */
/* ------------------------------------------------------------------ */

{
  const out = parseSyllabusFromText("1. UNDERSTANDING QUADRILATERALS 37");
  assert.equal(out.chapters[0]!.title, "Understanding Quadrilaterals");
}

/* ------------------------------------------------------------------ */
/* 10. Nothing is invented from an unreadable page                      */
/* ------------------------------------------------------------------ */

{
  const junk = parseSyllabusFromText(`
###
!!!
12
iv
`);
  assert.equal(junk.chapters.length, 0, "junk must yield no chapters");
  assert.equal(syllabusOcrQuality(junk).verdict, "poor");

  const empty = parseSyllabusFromText("");
  assert.equal(empty.chapters.length, 0);
  assert.equal(empty.ignored.length, 0);
}

/* ------------------------------------------------------------------ */
/* 11. An orphan sub-topic is reported, not promoted to a chapter       */
/* ------------------------------------------------------------------ */

{
  const out = parseSyllabusFromText("1.1 Introduction\n1.2 Properties");
  assert.equal(
    out.chapters.length,
    0,
    "sub-topics with no chapter above them must not become chapters",
  );
  assert.equal(
    out.ignored.length,
    2,
    "and they must be reported rather than dropped silently",
  );
}

/* ------------------------------------------------------------------ */
/* 12. Unnumbered titles are kept but flagged low confidence            */
/* ------------------------------------------------------------------ */

{
  const out = parseSyllabusFromText(`
Rational Numbers
Linear Equations
`);
  assert.equal(out.chapters.length, 2);
  assert.equal(out.chapters[0]!.confidence, "low");
  assert.equal(out.chapters[0]!.code, "");
  const q = syllabusOcrQuality(out);
  assert.equal(
    q.verdict,
    "partial",
    "a page of guesses must not be reported as a good read",
  );
  assert.equal(q.lowConfidence, 2);
}

/* ------------------------------------------------------------------ */
/* 13. A title ending in a digit is not mistaken for a page number      */
/* ------------------------------------------------------------------ */

{
  const out = parseSyllabusFromText("Chapter 7 Algebra Part 2");
  assert.equal(
    out.chapters[0]!.title,
    "Algebra Part 2",
    "a single space before a digit is part of the title",
  );
}

/* ------------------------------------------------------------------ */
/* 14. Quality summary counts what the review screen shows              */
/* ------------------------------------------------------------------ */

{
  const out = parseSyllabusFromText(`
Chapter 1 Rational Numbers 1
1.1 Introduction
1.2 Properties
Chapter 2 Data Handling 21
2.1 Graphs
`);
  const q = syllabusOcrQuality(out);
  assert.equal(q.chapters, 2);
  assert.equal(q.topics, 3);
  assert.equal(q.lowConfidence, 0);
  assert.equal(q.verdict, "good");
}

/* ------------------------------------------------------------------ */
/* 15. Verbatim Google Vision output                                    */
/* ------------------------------------------------------------------ */

{
  // Captured from a real Cloud Vision TEXT_DETECTION response, not
  // hand-written: Vision pushed the first page number onto its own line
  // while keeping the others inline, which no idealised fixture showed.
  const visionText = `CONTENTS
Chapter 1 Rational Numbers
1
Chapter 2 Linear Equations in One Variable 21
Chapter 3 Understanding Quadrilaterals 37
2.1 Introduction
2.2 Solving Equations`;

  const out = parseSyllabusFromText(visionText);
  assert.equal(out.chapters.length, 3);
  assert.equal(out.chapters[0]!.title, "Rational Numbers");
  assert.equal(
    out.chapters[1]!.title,
    "Linear Equations in One Variable",
    "inline page numbers must be stripped",
  );
  assert.equal(out.chapters[2]!.title, "Understanding Quadrilaterals");
  assert.equal(
    out.chapters[1]!.topics.length,
    2,
    "2.x topics belong to chapter 2, not to the chapter printed last",
  );
  assert.equal(out.chapters[2]!.topics.length, 0);
  assert.equal(
    out.ignored.length,
    0,
    "a stray page-number line is page furniture, not a lost chapter",
  );
  assert.equal(syllabusOcrQuality(out).verdict, "good");
}

console.log("  ✓ all syllabus OCR assertions passed");
