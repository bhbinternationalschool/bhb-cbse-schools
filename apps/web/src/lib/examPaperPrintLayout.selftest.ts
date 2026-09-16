import assert from "node:assert/strict";
import {
  fontScaleForClass,
  imposeBooklet,
  imposeTwoUp,
  languageForSubject,
  normalizePrintSettings,
  paginateBlocks,
  printLabels,
  resolveFontScale,
  resolveLanguage,
  sheetGeometry,
  subjectNameIn,
} from "./examPaperPrint";

// ── settings ──
{
  const d = normalizePrintSettings(undefined);
  assert.equal(d.pageSize, "A4");
  assert.equal(d.layout, "single");
  assert.equal(d.duplexFlip, "short");
  assert.equal(d.fontScale, "auto");
  assert.equal(d.language, "auto");
  assert.deepEqual(d.header, { schoolName: "", address: "", examName: "", title: "" });
  const g = normalizePrintSettings({ pageSize: "B5", layout: "booklet", duplexFlip: "long", fontScale: "huge", language: "sa", header: { schoolName: " बीएचबी " } });
  assert.equal(g.pageSize, "A4", "unknown size falls back to A4");
  assert.equal(g.layout, "booklet");
  assert.equal(g.duplexFlip, "long");
  assert.equal(g.fontScale, "auto", "unknown scale falls back to auto");
  assert.equal(g.language, "sa");
  assert.equal(g.header.schoolName, "बीएचबी", "header lines are trimmed");
  assert.equal(g.header.title, "");
}

// ── geometry ──
{
  const single = sheetGeometry(normalizePrintSettings({ pageSize: "A4", layout: "single" }));
  assert.equal(single.orientation, "portrait");
  assert.equal(single.pagesPerSide, 1);
  assert.equal(single.pageWidthMm, 210);
  assert.equal(single.contentWidthMm, 210 - 24);
  const booklet = sheetGeometry(normalizePrintSettings({ pageSize: "A4", layout: "booklet" }));
  assert.equal(booklet.orientation, "landscape", "a folded A4 is printed landscape");
  assert.equal(booklet.sheetWidthMm, 297);
  assert.equal(booklet.sheetHeightMm, 210);
  assert.equal(booklet.pagesPerSide, 2);
  assert.equal(booklet.pageWidthMm, 148.5, "each page is A5");
  assert.equal(booklet.marginMm.left, 9, "half-size pages get a tighter margin");
  assert.ok(booklet.contentHeightMm > 170 && booklet.contentHeightMm < 190);
}

// ── imposition ──
{
  assert.deepEqual(imposeBooklet(4), [{ front: [4, 1], back: [2, 3] }], "4-page booklet: [4|1] outside, [2|3] inside");
  assert.deepEqual(imposeBooklet(8), [
    { front: [8, 1], back: [2, 7] },
    { front: [6, 3], back: [4, 5] },
  ]);
  assert.deepEqual(imposeBooklet(5), [
    { front: [0, 1], back: [2, 0] },
    { front: [0, 3], back: [4, 5] },
  ], "5 pages pad to 8; pages 6–8 print blank");
  assert.deepEqual(imposeBooklet(1), [{ front: [0, 1], back: [2 > 1 ? 0 : 2, 0] }]);
  assert.deepEqual(imposeBooklet(4, "long"), [{ front: [4, 1], back: [3, 2] }], "long-edge flip mirrors the back");
  assert.deepEqual(imposeTwoUp(3), [{ front: [1, 2], back: [3, 0] }], "two-up is plain reading order");
  assert.deepEqual(imposeTwoUp(6), [
    { front: [1, 2], back: [3, 4] },
    { front: [5, 6], back: [0, 0] },
  ]);
  // Every page appears exactly once.
  for (const n of [4, 7, 12]) {
    const seen = imposeBooklet(n).flatMap((s) => [...s.front, ...s.back]).filter(Boolean).sort((a, b) => a - b);
    assert.deepEqual(seen, Array.from({ length: n }, (_, i) => i + 1), `booklet(${n}) places each page once`);
  }
}

// ── pagination ──
{
  assert.deepEqual(paginateBlocks([100, 100, 100], [false, false, false], 250, 10), [[0, 1], [2]], "greedy fill with gaps: 100+10+100 fits, +110 does not");
  assert.deepEqual(paginateBlocks([200, 20, 100], [false, true, false], 250, 10), [[0], [1, 2]], "a heading travels with its next block");
  assert.deepEqual(paginateBlocks([400, 50], [false, false], 250, 10), [[0], [1]], "an over-tall block takes a page of its own");
  assert.deepEqual(paginateBlocks([], [], 250, 10), [[]], "an empty paper is still one (blank) page");
  assert.deepEqual(paginateBlocks([30, 30, 30], [true, true, false], 100, 10), [[0, 1, 2]], "two headings in a row stay together");
}

// ── typography ──
{
  assert.equal(fontScaleForClass("Nursery"), "large");
  assert.equal(fontScaleForClass("LKG"), "large");
  assert.equal(fontScaleForClass("I"), "large");
  assert.equal(fontScaleForClass("II"), "large");
  assert.equal(fontScaleForClass("III"), "normal");
  assert.equal(fontScaleForClass("V"), "normal");
  assert.equal(fontScaleForClass("VI"), "small");
  assert.equal(fontScaleForClass("X"), "small");
  assert.equal(fontScaleForClass("XII"), "small");
  assert.equal(fontScaleForClass("IX"), "small", "IX is not I");
  assert.equal(fontScaleForClass("IV"), "normal", "IV is not I");
  assert.equal(resolveFontScale(normalizePrintSettings({ fontScale: "large" }), "X"), "large", "an explicit choice wins");
  assert.equal(resolveFontScale(normalizePrintSettings({}), "UKG"), "large");
}

// ── language ──
{
  assert.equal(languageForSubject("Hindi"), "hi");
  assert.equal(languageForSubject("Sanskrit"), "sa");
  assert.equal(languageForSubject("Mathematics"), "en");
  assert.equal(resolveLanguage(normalizePrintSettings({ language: "hi" }), "Mathematics"), "hi", "a Hindi-medium maths paper is a choice");
  assert.equal(resolveLanguage(normalizePrintSettings({}), "Sanskrit"), "sa");
  const hi = printLabels("hi");
  assert.equal(hi.class, "कक्षा");
  assert.equal(hi.maxMarks, "पूर्णांक");
  assert.equal(hi.attemptAny(5, 7), "निम्नलिखित 7 में से किन्हीं 5 के उत्तर दीजिए।");
  assert.equal(printLabels("sa").subject, "विषयः");
  assert.equal(printLabels("en").attemptAny(2, 3), "Attempt any 2 of the following 3.");
  assert.equal(subjectNameIn("hi", "Mathematics"), "गणित");
  assert.equal(subjectNameIn("hi", "Social Science"), "सामाजिक विज्ञान");
  assert.equal(subjectNameIn("hi", "Science"), "विज्ञान");
  assert.equal(subjectNameIn("sa", "Sanskrit"), "संस्कृतम्");
  assert.equal(subjectNameIn("hi", "Robotics"), "Robotics", "an unmapped subject keeps its English name");
  assert.equal(subjectNameIn("en", "Hindi"), "Hindi");
}

console.log("OK — examPaperPrintLayout.selftest.ts");
