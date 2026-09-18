import assert from "node:assert/strict";
import {
  matchAnswerKeyToQuestions,
  parseAnswerKey,
  stripPdfFurniture,
} from "./answerKeyParse";

console.log("answerKeyParse.selftest.ts");

/** A Class 6 Maths key, as `pdftotext -layout` produces it. */
const MATHS = `Class6                       Formative Assessment 1 - Set 1                    Math

Name: ..........   Date: .......    Max. Marks: 20    Time: 60 min
Instructions:
Read the questions carefully and attempt all questions.
                                  Section A
Choose the correct option.                                        (2×1=2 marks)
1) Which of the following numbers is equal to ten million?             (1 mark)
   (i) 1,00,000       (ii) 1,00,00,000 (iii) 10,00,00,000   (iv) 10,00,000
     Answer:
            1,00,00,000
         Solution:
         We know that 1 million = 10 lakhs = 10,00,000.
         Give 1 mark for the correct answer.
                          Page 1 of 6                        A261-C6-PM-1-14624
2) Which of the following is the smallest number?                      (1 mark)
   (i) 66060          (ii) 60606
         Answer:
               60066
         Solution:
         Compare the digits in the thousands place.
         Give 1 mark for the correct answer.
                                  Section B
Answer the following.                                             (1×4=4 marks)
3) Three bells ring at 36, 45 and 60 minutes.                         (4 marks)
     Answer:
     At 11 am.
     Solution:
     The LCM of 36, 45 and 60 is 180 minutes.
     Give 2 marks for the LCM and 2 for the time.
`;

{
  const key = parseAnswerKey(MATHS);
  assert.deepEqual(key.problems, []);
  assert.equal(key.header.docClass, "Class6");
  assert.equal(key.header.maxMarks, 20);
  assert.equal(key.items.length, 3);

  const [q1, , q3] = key.items;
  assert.equal(q1!.number, 1);
  assert.equal(q1!.marks, 1);
  assert.equal(q1!.answer, "1,00,00,000", "the question text is not repeated into the answer");
  assert.deepEqual(q1!.markingScheme, [
    "We know that 1 million = 10 lakhs = 10,00,000.",
    "Give 1 mark for the correct answer.",
  ]);
  assert.equal(q3!.marks, 4);
  assert.equal(q3!.answer, "At 11 am.");
  assert.match(q3!.markingScheme.join(" "), /Give 2 marks for the LCM/);
}

{
  // Page furniture lands mid-question and must not become part of an answer.
  const lines = stripPdfFurniture(MATHS);
  assert.ok(!lines.some((l) => /^Page \d+ of \d+$/.test(l)));
  assert.ok(!lines.includes("A261-C6-PM-1-14624"));
  assert.ok(!parseAnswerKey(MATHS).items[0]!.markingScheme.join(" ").includes("A261"));
}

{
  // Hindi keys print the markers in English but the marks in Hindi.
  const hindi = `Class6            Summative Assessment 1 - Set 1        Hindi
Name: ....   Max. Marks: 100   Time: 180 min
                              Section A
दिया गया गद्यांश पढ़कर, प्रश्नों के उत्तर दीजिए —                    (1×7=7 अंक)
1) निम्नलिखित गद्यांश को ध्यानपूर्वक पढ़िए :                              (7 अंक)
Answer:
(क) (i) अंजॉ ज़िले की पहाड़ियाँ
(ख) (ii) कथन और कारण दोनों ही गलत हैं।
Solution:
(क) गद्यांश में स्पष्ट है कि सबसे पहले सूर्योदय का अनुभव मिलता है।
(क) सही उत्तर के लिए 1 अंक दें।
`;
  const key = parseAnswerKey(hindi);
  assert.equal(key.items.length, 1);
  assert.equal(key.items[0]!.marks, 7, "अंक counts as marks");
  assert.match(key.items[0]!.answer, /अंजॉ ज़िले की पहाड़ियाँ/);
  assert.equal(key.items[0]!.markingScheme.length, 2);
  assert.match(key.items[0]!.markingScheme[1]!, /1 अंक दें/);
}

{
  // A pre-primary key shows the answer as a picture: nothing extractable.
  // The guidance survives, and the answer must stay empty rather than take
  // the guidance's words as if they were the answer.
  const nursery = `Nursery        Formative Assessment 1 - Set 1        Numeracy
Name: ......   Marks ...... /25   Time: 40 min
                            Section A
Answer the following.                            (1x10=10 marks)
1) Match the pictures to the correct shape.         (10 marks)
                       Page 2 of 9                A261-NRY-PR-1-14624
Answer:
Give 2 marks for each correct answer.
Maximum Marks: 10
`;
  const key = parseAnswerKey(nursery);
  assert.equal(key.items.length, 1);
  assert.equal(key.items[0]!.answer, "", "a picture answer stays empty");
  assert.deepEqual(key.items[0]!.markingScheme, [
    "Give 2 marks for each correct answer.",
    "Maximum Marks: 10",
  ]);
}

/* -------------------------------------------------------------------------- */
/* The guard                                                                  */
/* -------------------------------------------------------------------------- */

{
  const key = parseAnswerKey(MATHS);
  const ok = matchAnswerKeyToQuestions(key, [{ marks: 1 }, { marks: 1 }, { marks: 4 }]);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.withAnswers, 3);
    assert.equal(ok.byNumber.get(3)!.answer, "At 11 am.");
  }
}

{
  // One question short on the paper: writing answers would shift every one
  // of them onto the wrong question.
  const r = matchAnswerKeyToQuestions(parseAnswerKey(MATHS), [{ marks: 1 }, { marks: 1 }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /the key has 3 questions, the paper has 2/);
}

{
  // Same count, different worth — the alignment is not what it appears.
  const r = matchAnswerKeyToQuestions(parseAnswerKey(MATHS), [
    { marks: 1 },
    { marks: 4 },
    { marks: 1 },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /question 2 is 1 marks in the key and 4 on the paper/);
}

{
  // A paper whose marks the parser never read is not evidence of a clash.
  const r = matchAnswerKeyToQuestions(parseAnswerKey(MATHS), [
    { marks: 0 },
    { marks: 0 },
    { marks: 0 },
  ]);
  assert.equal(r.ok, true);
}

{
  const r = matchAnswerKeyToQuestions(parseAnswerKey("nothing here at all"), [{ marks: 1 }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no questions could be read/);
}

{
  // Numbering that repeats means the reader lost its place.
  const doubled = MATHS.replace("2) Which of the following is the smallest", "1) Which of the following is the smallest");
  const r = matchAnswerKeyToQuestions(parseAnswerKey(doubled), [{ marks: 1 }, { marks: 1 }, { marks: 4 }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /appears twice|comes after/);
}

console.log("OK — answerKeyParse.selftest.ts");
