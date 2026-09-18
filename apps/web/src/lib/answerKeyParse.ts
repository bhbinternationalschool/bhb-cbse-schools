/**
 * Reading a publisher's answer-key PDF.
 *
 * The key is the same paper again, with three things added under each
 * question: `Answer:` — what the child should have written; `Solution:` — the
 * working, which is what a teacher marking a long answer actually needs; and
 * the marking guidance, "Give 1 mark for the correct answer", which decides
 * how a half-right answer scores.
 *
 * Both markers are printed in English even in the Hindi papers, so one reader
 * serves every subject. What differs is how much survives extraction: a
 * Class 6 Maths key is text, while a Nursery key's answers are pictures of
 * traced shapes and come out empty. An empty answer is left empty. A key that
 * cannot say what the answer is must not be made to say something.
 *
 * Pure: it takes the text somebody else extracted from the PDF.
 */

import type { PaperHeader } from "@/lib/examPaperImport";

export type AnswerKeyItem = {
  /** The number printed against the question, 1-based as the paper prints it. */
  number: number;
  /** Marks printed against it, 0 when the key does not say. */
  marks: number;
  /** The `Answer:` block; "" when the key shows a picture instead of text. */
  answer: string;
  /**
   * The `Solution:` working and the "Give N marks…" guidance, one step per
   * line — the shape `ExamPaperQuestion.markingScheme` already expects.
   */
  markingScheme: string[];
};

export type ParsedAnswerKey = {
  header: PaperHeader;
  items: AnswerKeyItem[];
  /** Numbers that appear more than once, or run backwards — see `isUsable`. */
  problems: string[];
};

/**
 * `Page 3 of 19` and the paper code stamped in every footer — which the PDF
 * prints on the SAME line, in the middle of whatever question the page break
 * fell in. They are removed from within a line, not by dropping whole lines.
 */
const RE_PAGE = /page\s+\d+\s+of\s+\d+/gi;
const RE_FOOTER_CODE = /\b[A-Z]{1,4}\d{2,4}-[A-Z0-9]+-[A-Z]{1,3}-\d+-\d+\b/g;
const RE_QUESTION = /^(\d{1,3})\)\s*(.*)$/;
const RE_ANSWER = /^answer\s*:?\s*(.*)$/i;
const RE_SOLUTION = /^solution\s*:?\s*(.*)$/i;
const RE_SECTION = /^section\s+[A-Za-z0-9]+\s*$/i;
/** "(2 marks)", "(7 अंक)" — the same words the question paper uses. */
const RE_MARKS = /\(\s*(\d+(?:\.\d+)?)\s*(?:marks?|m|अंक|अङ्क)\s*\)/i;
/** "Give 1 mark for the correct answer.", "सही उत्तर के लिए 1 अंक दें।" */
const RE_GUIDANCE = /^(?:give\b|maximum marks\b)|अंक\s*दें/i;

export function stripPdfFurniture(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/\u00a0/g, " ")
        .replace(RE_PAGE, " ")
        .replace(RE_FOOTER_CODE, " ")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

type Block = { number: number; marks: number; lines: string[] };

/**
 * Split the key into one block per question.
 *
 * A line like `12)` opens a question and closes the one before it. Section
 * headings and their instruction lines sit between blocks and belong to
 * neither, so they are dropped rather than swept into the previous answer.
 */
function blocksOf(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const line of lines) {
    const q = RE_QUESTION.exec(line);
    if (q) {
      current = {
        number: Number(q[1]),
        marks: Number(RE_MARKS.exec(line)?.[1] ?? 0),
        lines: [(q[2] ?? "").trim()].filter(Boolean),
      };
      blocks.push(current);
      continue;
    }
    if (RE_SECTION.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    if (!current.marks) {
      const m = RE_MARKS.exec(line);
      if (m) current.marks = Number(m[1]);
    }
    current.lines.push(line);
  }
  return blocks;
}

/**
 * Pull the answer and the marking scheme out of one question's block.
 *
 * Everything before `Answer:` is the question itself, which the desk already
 * holds from the question paper — repeating it here would double every paper.
 */
function readBlock(block: Block): AnswerKeyItem {
  const answer: string[] = [];
  const marking: string[] = [];
  let mode: "question" | "answer" | "solution" = "question";

  for (const line of block.lines) {
    const a = RE_ANSWER.exec(line);
    if (a) {
      mode = "answer";
      if (a[1]?.trim()) answer.push(a[1].trim());
      continue;
    }
    const s = RE_SOLUTION.exec(line);
    if (s) {
      mode = "solution";
      if (s[1]?.trim()) marking.push(s[1].trim());
      continue;
    }
    if (mode === "question") continue;
    // Marking guidance is printed after the solution, and sometimes with no
    // `Solution:` heading at all — it belongs with the scheme either way.
    if (RE_GUIDANCE.test(line)) {
      marking.push(line);
      mode = "solution";
      continue;
    }
    if (mode === "answer") answer.push(line);
    else marking.push(line);
  }

  return {
    number: block.number,
    marks: block.marks,
    answer: answer.join("\n").trim(),
    markingScheme: marking.filter(Boolean),
  };
}

/**
 * The key's first line is a printed row, not three paragraphs.
 *
 * In the .docx question paper the class, the title and the subject are
 * separate paragraphs; in the PDF they are three columns of one line, held
 * apart by runs of spaces. Collapsing that whitespace — which the body reader
 * must do — would weld them into a single meaningless string, so the header is
 * read from the raw text before anything is tidied.
 */
export function readKeyHeader(text: string): PaperHeader {
  const raw = text.split(/\r?\n/).map((l) => l.replace(/\u00a0/g, " ").trimEnd());
  const first = raw.find((l) => l.trim() && !/page\s+\d+\s+of\s+\d+/i.test(l));
  const columns = (first ?? "").trim().split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);

  const joined = raw.slice(0, 12).join("\n");
  const marks = /max\.?\s*marks?\s*:?\s*(\d+(?:\.\d+)?)/i.exec(joined)
    // Pre-primary keys print "Marks ....... /25" instead.
    ?? /marks?\s*\.*\s*\/\s*(\d+)/i.exec(joined);
  const time = /time\s*:?\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|min)/i.exec(joined);

  return {
    docClass: columns[0] ?? "",
    docTitle: columns[1] ?? "",
    docSubject: columns[2] ?? "",
    maxMarks: marks ? Math.round(Number(marks[1])) : 0,
    durationMinutes: time
      ? /^h/i.test(time[2]!)
        ? Math.round(Number(time[1]) * 60)
        : Math.round(Number(time[1]))
      : 0,
  };
}

export function parseAnswerKey(text: string): ParsedAnswerKey {
  const lines = stripPdfFurniture(text);
  const header = readKeyHeader(text);
  const items = blocksOf(lines).map(readBlock);

  const problems: string[] = [];
  const seen = new Set<number>();
  let previous = 0;
  for (const item of items) {
    if (seen.has(item.number)) problems.push(`question ${item.number} appears twice`);
    seen.add(item.number);
    if (item.number <= previous) {
      problems.push(`question ${item.number} comes after ${previous}`);
    }
    previous = item.number;
  }

  return { header, items, problems };
}

export type AnswerKeyMatch =
  | { ok: true; byNumber: Map<number, AnswerKeyItem>; withAnswers: number }
  | { ok: false; reason: string };

/**
 * Decide whether this key may be written onto that paper's questions.
 *
 * Getting this wrong is the worst outcome available here — an answer filed
 * against the wrong question is a mistake a teacher would carry into marking
 * a child's paper. So the bar is high and the failure is total: unless the
 * key and the paper agree on how many questions there are, on their numbering
 * and on what each is worth, nothing is written and the key stays an attached
 * document the teacher reads themselves.
 */
export function matchAnswerKeyToQuestions(
  key: ParsedAnswerKey,
  questions: { marks: number }[],
): AnswerKeyMatch {
  if (key.problems.length) {
    return { ok: false, reason: key.problems[0]! };
  }
  if (!key.items.length) {
    return { ok: false, reason: "no questions could be read from the key" };
  }
  if (key.items.length !== questions.length) {
    return {
      ok: false,
      reason: `the key has ${key.items.length} questions, the paper has ${questions.length}`,
    };
  }
  for (let i = 0; i < key.items.length; i++) {
    const item = key.items[i]!;
    if (item.number !== i + 1) {
      return { ok: false, reason: `question ${i + 1} is numbered ${item.number} in the key` };
    }
    const paperMarks = questions[i]!.marks;
    // A key that does not print marks is not evidence of disagreement.
    if (item.marks && paperMarks && item.marks !== paperMarks) {
      return {
        ok: false,
        reason: `question ${item.number} is ${item.marks} marks in the key and ${paperMarks} on the paper`,
      };
    }
  }
  return {
    ok: true,
    byNumber: new Map(key.items.map((i) => [i.number, i])),
    withAnswers: key.items.filter((i) => i.answer).length,
  };
}
