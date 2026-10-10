/**
 * Self-test: Hinglish → Hindi / Sanskrit covers the whole question.
 * Run: npx tsx apps/web/src/lib/examPaperTransliterate.selftest.ts
 *
 * Reported 2026-09-16: "the Hindi and Sanskrit buttons do not work". The API
 * was fine — both of that morning's calls returned in 5 and 7 seconds and
 * were applied. What was broken was WHAT the button touched:
 *
 *  - a question that is only a heading for its parts has no own text, and
 *    the buttons were disabled on `!q.text.trim()` — dead on exactly the
 *    questions a Hindi paper is built from;
 *  - parts carry their own options, pairs and answer key (PR #226), and only
 *    the part's TEXT was sent. The heading came back in Hindi with every
 *    option under it still in Hinglish;
 *  - picture captions and the marking scheme were never sent either.
 *
 * The answers are paired to the fields BY POSITION, so the order the texts
 * go out in and the order they come back in must match exactly. That is what
 * these assertions hold down.
 */

import assert from "node:assert/strict";

import {
  applyTransliteratedQuestion,
  questionHasConvertibleText,
  questionTransliterationTexts,
} from "./examPapers";

console.log("examPaperTransliterate.selftest.ts");

type Q = Parameters<typeof questionTransliterationTexts>[0];

const heading: Q = {
  text: "",
  options: [],
  pairs: [],
  answerKey: "",
  formulas: [],
  markingScheme: [],
  images: [],
  subQuestions: [
    {
      text: "Bharat ki rajdhani kya hai?",
      marks: 1,
      type: "mcq",
      options: ["Dilli", "Mumbai", "Kolkata", "Chennai"],
      pairs: [],
      answerKey: "Dilli",
    },
    {
      text: "Sabse lambi nadi kaun si hai?",
      marks: 1,
      type: "short",
      options: [],
      pairs: [],
      answerKey: "Ganga",
    },
  ],
} as unknown as Q;

/* ── 1. A parts-only question is convertible ────────────────────────── */

assert.equal(
  heading.text.trim(),
  "",
  "this is the shape that had both buttons dead",
);
assert.ok(
  questionHasConvertibleText(heading),
  "a heading with parts must be convertible — the parts are the question",
);

/* ── 2. Every part's options and key go out ─────────────────────────── */

const texts = questionTransliterationTexts(heading);
assert.ok(texts.includes("Dilli"), "a part's options must be sent");
assert.ok(texts.includes("Ganga"), "a part's answer key must be sent");
assert.equal(
  texts.length,
  1 + (1 + 4 + 0 + 1) + (1 + 0 + 0 + 1) + 1,
  "own text + part 1 (text, 4 options, key) + part 2 (text, key) + own key",
);

/* ── 3. The answers come back onto the right fields ─────────────────── */

const converted = applyTransliteratedQuestion(
  heading,
  texts.map((t) =>
    t === ""
      ? ""
      : ({
          "Bharat ki rajdhani kya hai?": "भारत की राजधानी क्या है?",
          Dilli: "दिल्ली",
          Mumbai: "मुंबई",
          Kolkata: "कोलकाता",
          Chennai: "चेन्नई",
          "Sabse lambi nadi kaun si hai?": "सबसे लंबी नदी कौन सी है?",
          Ganga: "गंगा",
        }[t] ?? t),
  ),
);

assert.equal(converted.subQuestions[0]!.text, "भारत की राजधानी क्या है?");
assert.deepEqual(
  converted.subQuestions[0]!.options,
  ["दिल्ली", "मुंबई", "कोलकाता", "चेन्नई"],
  "the options under the part are converted, in their own order",
);
assert.equal(converted.subQuestions[0]!.answerKey, "दिल्ली");
assert.equal(converted.subQuestions[1]!.answerKey, "गंगा");
assert.equal(
  converted.subQuestions[0]!.marks,
  1,
  "marks, type and everything else on the part survive untouched",
);
assert.equal(converted.subQuestions[0]!.type, "mcq");

/* ── 4. Pictures, pairs and the marking scheme travel too ───────────── */

const rich: Q = {
  text: "Neeche diye gaye chitra ko dekhiye",
  options: [],
  pairs: [
    { left: "Ganga", right: "Uttar" },
    { left: "Kaveri", right: "Dakshin" },
  ],
  answerKey: "",
  formulas: [],
  markingScheme: ["Sahi jodi ke liye 1 ank"],
  images: [{ id: "i1", dataUrl: "data:,", caption: "Bharat ka naksha", labels: [] }],
  subQuestions: [],
} as unknown as Q;

const richTexts = questionTransliterationTexts(rich);
assert.ok(richTexts.includes("Bharat ka naksha"), "picture captions are sent");
assert.ok(richTexts.includes("Sahi jodi ke liye 1 ank"), "the marking scheme is sent");
assert.ok(richTexts.includes("Kaveri"), "both sides of every pair are sent");

const richOut = applyTransliteratedQuestion(
  rich,
  richTexts.map((t) => (t ? `«${t}»` : t)),
);
assert.equal(richOut.images[0]!.caption, "«Bharat ka naksha»");
assert.equal(richOut.images[0]!.dataUrl, "data:,", "the picture itself is untouched");
assert.deepEqual(richOut.pairs[1], { left: "«Kaveri»", right: "«Dakshin»" });
assert.deepEqual(richOut.markingScheme, ["«Sahi jodi ke liye 1 ank»"]);

/* ── 5. A short reply is refused, never pasted into the wrong fields ── */

assert.throws(
  () => applyTransliteratedQuestion(rich, richTexts.slice(0, 3)),
  /refusing to shuffle/,
  "fewer lines back than sent must throw, not silently misalign the paper",
);

/* ── 6. A truly empty question offers nothing to convert ────────────── */

assert.equal(
  questionHasConvertibleText({
    text: "  ",
    options: ["", ""],
    pairs: [],
    answerKey: "",
    formulas: [],
    markingScheme: [],
    images: [],
    subQuestions: [],
  } as unknown as Q),
  false,
);

console.log("  ok — the whole question converts, and the lines cannot cross");
