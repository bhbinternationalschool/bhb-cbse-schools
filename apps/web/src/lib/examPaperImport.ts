/**
 * Turning a publisher's folder of question papers into papers this desk owns.
 *
 * The school downloads a term's papers as a tree —
 * `Class6/Division A/Math/Editable/MOY/Summative Assessment 1 - Set 1/….docx` —
 * and wants them to land in the Question Papers tab filed by class, subject
 * and exam, without anyone re-typing 2,000 questions.
 *
 * Three rules shape everything here:
 *
 * 1. **The paper says what it is; the folder only hints.** In the school's own
 *    download, two Half-Yearly papers sit under `Assessment 2/` and one class's
 *    Half-Yearly sits under `MOY/`. So the exam is read from the paper's title
 *    first and the folder is consulted only when the title is silent. The class
 *    and subject printed inside the document must agree with the folder, or the
 *    file is held back for a human — never quietly filed under the folder's word.
 *
 * 2. **Nothing is guessed.** A subject or exam name this school has not mapped
 *    yet produces a `needs_mapping` row naming the exact word that was not
 *    understood. It is not matched by resemblance, and it is not dropped.
 *
 * 3. **Sets are not papers.** `Set 1 / Set 2 / Set 3` of one class + subject +
 *    exam are sets A / B / C of a single paper, so the desk can print one set
 *    and keep the others in reserve. The publisher's own label is kept beside
 *    each set, because the school's copy of Set 3 exists where Set 2 does not.
 *
 * Pure: no storage, no network, no `window`. The route in
 * `app/api/exams/papers/import` supplies the bytes; this decides what they mean.
 */

import type {
  ExamPaperQuestion,
  ExamPaperQuestionType,
  ExamPaperSection,
} from "@/lib/examPapers";

/* -------------------------------------------------------------------------- */
/* Mapping tables                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Folder word → the class name in masters. Publishers write `Class6`; this
 * school's masters say `VI`. Extra spellings are cheap and stop a whole
 * download stalling on a capital letter.
 */
export const DEFAULT_CLASS_FOLDER_MAP: Record<string, string> = {
  nursery: "Nursery",
  nur: "Nursery",
  lkg: "LKG",
  ukg: "UKG",
  prep: "UKG",
  class1: "I",
  class2: "II",
  class3: "III",
  class4: "IV",
  class5: "V",
  class6: "VI",
  class7: "VII",
  class8: "VIII",
  class9: "IX",
  class10: "X",
  class11: "XI",
  class12: "XII",
  grade1: "I",
  grade2: "II",
  grade3: "III",
  grade4: "IV",
  grade5: "V",
  grade6: "VI",
  grade7: "VII",
  grade8: "VIII",
};

/**
 * Folder word → subject **code** in masters (not the name: the school's names
 * are long — "Environmental Studies / World Around Us" — and change; the code
 * does not).
 */
export const DEFAULT_SUBJECT_FOLDER_MAP: Record<string, string> = {
  english: "ENG",
  "english literacy": "ENG",
  "english language": "ENG",
  hindi: "HIN",
  "hindi literacy": "HIN",
  math: "MAT",
  maths: "MAT",
  mathematics: "MAT",
  numeracy: "NUM",
  "early numeracy": "NUM",
  science: "SCI",
  "social science": "SST",
  "social studies": "SST",
  evs: "EVS",
  "environmental studies": "EVS",
  "understanding our world": "WAU",
  "world around us": "WAU",
  sanskrit: "SKT",
  computer: "ICT",
};

/**
 * Title words → exam **code** in the exams desk. Longest match wins, so
 * "Summative Assessment 2" is never read as "Summative Assessment".
 */
export const DEFAULT_EXAM_TITLE_MAP: Record<string, string> = {
  "formative assessment 1": "UT1",
  "formative assessment 2": "UT2",
  "formative assessment 3": "UT2",
  "summative assessment 1": "HY",
  "summative assessment 2": "ANNUAL",
  "unit test 1": "UT1",
  "unit test 2": "UT2",
  "periodic test 1": "UT1",
  "periodic test 2": "UT2",
  "half yearly": "HY",
  "half-yearly": "HY",
  "mid year": "HY",
  "mid-year": "HY",
  moy: "HY",
  annual: "ANNUAL",
  final: "ANNUAL",
  "end of year": "ANNUAL",
  eoy: "ANNUAL",
};

export type ImportMappings = {
  /** lower-cased folder word → masters class name */
  classes: Record<string, string>;
  /** lower-cased folder word → masters subject code */
  subjects: Record<string, string>;
  /** lower-cased title phrase → exam term code */
  exams: Record<string, string>;
};

export function defaultImportMappings(): ImportMappings {
  return {
    classes: { ...DEFAULT_CLASS_FOLDER_MAP },
    subjects: { ...DEFAULT_SUBJECT_FOLDER_MAP },
    exams: { ...DEFAULT_EXAM_TITLE_MAP },
  };
}

/** Merge a school's learned mappings over the built-in ones. */
export function mergeImportMappings(
  learned: Partial<ImportMappings> | null | undefined,
): ImportMappings {
  const base = defaultImportMappings();
  if (!learned) return base;
  return {
    classes: { ...base.classes, ...normalizeMapRecord(learned.classes) },
    subjects: { ...base.subjects, ...normalizeMapRecord(learned.subjects) },
    exams: { ...base.exams, ...normalizeMapRecord(learned.exams) },
  };
}

function normalizeMapRecord(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const key = normalizeWord(k);
    const val = String(v ?? "").trim();
    if (key && val) out[key] = val;
  }
  return out;
}

/** "Social  Science" / "social-science" / "Class 6" → "social science" / "class6". */
export function normalizeWord(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[_\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^class\s+(\d+)$/, "class$1")
    .replace(/^grade\s+(\d+)$/, "grade$1");
}

/* -------------------------------------------------------------------------- */
/* Path + header reading                                                      */
/* -------------------------------------------------------------------------- */

export type ImportPath = {
  classFolder: string;
  subjectFolder: string;
  /** `Assessment 1` / `MOY` / `Assessment 2` — a hint only; see rule 1. */
  bucketFolder: string;
  /** The folder the file sits in, which carries the publisher's paper name. */
  paperFolder: string;
  fileName: string;
};

/** Folders that sit between the ones that mean something. */
function isWrapperFolder(name: string): boolean {
  const n = normalizeWord(name);
  return (
    /^division\b/.test(n) ||
    /^section\b/.test(n) ||
    n === "editable" ||
    n === "printable" ||
    n === "pdf"
  );
}

/**
 * Read the tree positions out of a relative path.
 *
 * The shape is `<class>/<division>/<subject>/<editable|printable>/<bucket>/<paper>/<file>`,
 * but two things move it around. Publishers drop levels — no division, no
 * `Editable`. And a browser reports a picked folder's own name at the front
 * of every path, so the same tree arrives as `Lead Assessments 2/Class6/…`
 * when the school picks the download and as `Class6/…` when it picks a class.
 *
 * So the class is not "the first segment": it is the first segment the school
 * has a class mapping for, which is true in both cases. When `knowsClass` is
 * not supplied, or recognises nothing in the path, the first segment is used
 * and will be reported as an unmapped class word — visible, and mappable,
 * rather than silently filed under a folder name.
 */
export function parseImportPath(
  relPath: string,
  knowsClass?: (folderWord: string) => boolean,
): ImportPath | null {
  const parts = String(relPath ?? "")
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..");
  if (parts.length < 2) return null;

  const fileName = parts[parts.length - 1]!;
  if (!/\.docx$/i.test(fileName)) return null;

  const dirs = parts.slice(0, -1);
  let classAt = 0;
  if (knowsClass) {
    const found = dirs.findIndex((d) => !isWrapperFolder(d) && knowsClass(d));
    if (found >= 0) classAt = found;
  }
  const classFolder = dirs[classAt] ?? "";

  const rest = dirs.slice(classAt + 1).filter((d) => !isWrapperFolder(d));

  const subjectFolder = rest[0] ?? "";
  const paperFolder = rest.length > 1 ? rest[rest.length - 1]! : "";
  const bucketFolder = rest.length > 2 ? rest[rest.length - 2]! : "";

  return { classFolder, subjectFolder, bucketFolder, paperFolder, fileName };
}

export type PaperHeader = {
  /** Line 1 of the paper, e.g. "Class6" */
  docClass: string;
  /** Line 2, the publisher's own title for this paper */
  docTitle: string;
  /** Line 3, the subject as printed */
  docSubject: string;
  /** 0 when the paper does not state one — every pre-primary paper here. */
  maxMarks: number;
  durationMinutes: number;
};

const HEADER_NOISE = /^[-–—_=\s.]*$/;

/**
 * Read the block the publisher prints above the instructions. It is three
 * lines — class, paper title, subject — followed by the name/date rules and
 * `Max. Marks:` / `Time:`.
 */
export function readPaperHeader(lines: string[]): PaperHeader {
  const head: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || HEADER_NOISE.test(line)) continue;
    if (/^instructions?\s*:?$/i.test(line)) break;
    if (/^section\s+[A-Z]$/i.test(line)) break;
    head.push(line);
    if (head.length >= 12) break;
  }

  const joined = head.join("\n");
  const marks = /max\.?\s*marks?\s*:?\s*([0-9]+(?:\.[0-9]+)?)/i.exec(joined);
  const time = /time\s*:?\s*([0-9]+(?:\.[0-9]+)?)\s*(hours?|hrs?|h\b|min)/i.exec(joined);

  let durationMinutes = 0;
  if (time) {
    const n = Number(time[1]) || 0;
    durationMinutes = /^h/i.test(time[2]!) ? Math.round(n * 60) : Math.round(n);
  }

  const meta = (l: string) =>
    /^(name|date|roll|max\.?\s*marks|time|school|session)\b/i.test(l);
  const content = head.filter((l) => !meta(l));

  return {
    docClass: content[0] ?? "",
    docTitle: content[1] ?? "",
    docSubject: content[2] ?? "",
    maxMarks: marks ? Math.round(Number(marks[1])) : 0,
    durationMinutes,
  };
}

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

export type ExamGuess = {
  /** Exam term code, e.g. "UT1"; "" when nothing matched. */
  code: string;
  /** The phrase that decided it — shown to the school when it asks to map one. */
  matched: string;
  /** Where the decision came from. */
  from: "title" | "folder" | "bucket" | "";
};

/**
 * Which exam is this? Title, then the paper's folder, then the bucket folder —
 * in that order, because the bucket is the part that has been wrong in
 * practice. Longest phrase wins so "summative assessment 2" beats "summative
 * assessment 1"'s shorter prefixes.
 */
export function classifyExam(
  input: { docTitle: string; paperFolder: string; bucketFolder: string },
  mappings: ImportMappings,
): ExamGuess {
  const phrases = Object.keys(mappings.exams).sort((a, b) => b.length - a.length);
  const sources: { text: string; from: ExamGuess["from"] }[] = [
    { text: input.docTitle, from: "title" },
    { text: input.paperFolder, from: "folder" },
    { text: input.bucketFolder, from: "bucket" },
  ];
  for (const source of sources) {
    const hay = normalizeWord(source.text);
    if (!hay) continue;
    for (const phrase of phrases) {
      if (hay.includes(phrase)) {
        return { code: mappings.exams[phrase]!, matched: phrase, from: source.from };
      }
    }
  }
  return { code: "", matched: "", from: "" };
}

/** "Summative Assessment 1 - Set 3" → 3. No set stated → 1. */
export function readSetNumber(text: string): number {
  const m = /\bset\s*([0-9]+|[ivx]+|[a-d])\b/i.exec(String(text ?? ""));
  if (!m) return 1;
  const raw = m[1]!.toLowerCase();
  if (/^[0-9]+$/.test(raw)) return Math.max(1, Math.min(26, Number(raw)));
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
  if (roman[raw]) return roman[raw]!;
  const letter = raw.charCodeAt(0) - 96;
  return letter >= 1 && letter <= 26 ? letter : 1;
}

export function setCodeForNumber(n: number): string {
  const i = Math.max(1, Math.min(26, Math.floor(n))) - 1;
  return String.fromCharCode(65 + i);
}

/* -------------------------------------------------------------------------- */
/* Body parsing                                                               */
/* -------------------------------------------------------------------------- */

const RE_SECTION = /^section\s+([A-Za-z0-9]+)\s*$/i;
const RE_QUESTION_NO = /^(\d{1,3})[).]\s*(.*)$/;
const RE_SUBPART_NO = /^([a-eA-E])[).]\s*(.*)$/;
const RE_OPTION_NO = /^\(\s*([ivx]{1,4}|[a-dA-D])\s*\)\s*(.*)$/i;

/**
 * The Hindi papers print their marks in Hindi — `(3 अंक)`, `(1×3=3 अंक)` —
 * and an importer that only knew the word "marks" read every Hindi paper as
 * worth nothing at all. Both words count, and so does the bare `(2)` some
 * pre-primary sheets use.
 */
const MARK_WORD = "marks?|m|अंक|अङ्क|अंकों";
const RE_MARKS = new RegExp(`^\\(\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:${MARK_WORD})\\s*\\)\\s*$`, "i");
const RE_SECTION_MARKS = new RegExp(
  `^\\(\\s*[0-9]+\\s*[×x*]\\s*[0-9]+\\s*=\\s*([0-9]+)\\s*(?:${MARK_WORD})\\s*\\)\\s*$`,
  "i",
);
/** `(i) चाँद की भूमि    (ii) उगते सूर्य की भूमि` — two options, one line. */
const RE_INLINE_OPTIONS = /\(\s*(?:i{1,3}|iv|v|[a-d])\s*\)/gi;

export type ParsedPaperBody = {
  sections: ExamPaperSection[];
  questionCount: number;
  /** Sum of the marks printed against the questions. */
  parsedMarks: number;
  /**
   * Marks the paper allots to something with no printed question — every
   * `Oral Questions … (10 marks)` section at the foot of a primary paper.
   * Kept apart so the totals reconcile without inventing an item.
   */
  unassignedMarks: number;
  /** Titles of the sections those marks came from. */
  unassignedSections: string[];
  /** Image tokens seen anywhere in the body, in order. */
  imageRids: string[];
};

type Draft = {
  title: string;
  instructions: string;
  /** From the section's own `(10×1=10 marks)` line, when it prints one. */
  statedMarks: number;
  questions: ExamPaperQuestion[];
};

/**
 * Split `(i) सही (ii) ग़लत` into its options. Only a line that *begins* with
 * a marker and carries at least two of them is treated this way — plenty of
 * question text mentions "(i)" in passing, and splitting on that would tear a
 * sentence in half.
 */
export function splitInlineOptions(line: string): string[] {
  RE_INLINE_OPTIONS.lastIndex = 0;
  const starts: number[] = [];
  for (const m of line.matchAll(RE_INLINE_OPTIONS)) starts.push(m.index ?? -1);
  if (starts.length < 2 || starts[0] !== 0) return [];
  const out: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!;
    const to = i + 1 < starts.length ? starts[i + 1]! : line.length;
    out.push(line.slice(from, to).replace(RE_INLINE_OPTIONS, " ").replace(/\s+/g, " ").trim());
  }
  return out.filter(Boolean).length >= 2 ? out : [];
}

/**
 * Walk the paragraph stream and rebuild sections and questions.
 *
 * The publisher's layout is regular: a section heading, its instruction, its
 * marks line, then questions as `12)` on a line of their own, options as
 * `(i)` … `(iv)`, and the question's worth as `(2 marks)` on the line that
 * closes it. Sub-parts `a)` `b)` `c)` of a case study stay inside their
 * parent question — their marks are already counted in the parent's, and
 * adding them again would make every case-study paper over-total.
 */
export function parsePaperBody(
  lines: string[],
  opts: { questionId: (n: number) => string; sectionId: (n: number) => string },
): ParsedPaperBody {
  const drafts: Draft[] = [];
  const imageRids: string[] = [];
  /** Marks printed where no question was open — see `unassignedMarks`. */
  const orphans: { title: string; marks: number }[] = [];

  let current: Draft | null = null;
  let question: ExamPaperQuestion | null = null;
  let pendingOption: string | null = null;
  /** `a)` in its own table cell, waiting for the line that follows it. */
  let pendingSubpart: string | null = null;
  let started = false;
  let seq = 0;

  const pushQuestion = () => {
    if (question && current) current.questions.push(question);
    question = null;
    pendingOption = null;
    pendingSubpart = null;
  };
  const newSection = (title: string): Draft => {
    pushQuestion();
    const draft: Draft = { title, instructions: "", statedMarks: 0, questions: [] };
    drafts.push(draft);
    return draft;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || HEADER_NOISE.test(line)) continue;

    for (const m of line.matchAll(/\[\[img:([A-Za-z0-9_.-]+)\]\]/g)) {
      imageRids.push(m[1]!);
    }

    const section = RE_SECTION.exec(line);
    if (section) {
      started = true;
      current = newSection(`Section ${section[1]!.toUpperCase()}`);
      continue;
    }

    const qNo = RE_QUESTION_NO.exec(line);
    if (qNo && (started || drafts.length)) {
      // A bare number closes the previous question and opens the next.
      if (!current) current = newSection("Section A");
      pushQuestion();
      seq += 1;
      question = blankQuestion(opts.questionId(seq));
      const trailing = (qNo[2] ?? "").trim();
      if (trailing) question.text = trailing;
      continue;
    }

    const marks = RE_MARKS.exec(line);
    if (marks) {
      const value = Number(marks[1]) || 0;
      if (question && question.marks === 0) {
        question.marks = value;
      } else if (!question && value > 0) {
        // "Oral Questions … (10 marks)" — a real part of the paper's total
        // with nothing printed to attach it to.
        orphans.push({ title: current?.title ?? "", marks: value });
      }
      // Sub-part marks arrive after the parent's; they are already included.
      continue;
    }

    const sectionMarks = RE_SECTION_MARKS.exec(line);
    if (sectionMarks) {
      if (current) {
        current.statedMarks = Number(sectionMarks[1]) || 0;
        if (!current.instructions) current.instructions = line;
      }
      continue;
    }

    const inline = question ? splitInlineOptions(line) : [];
    if (inline.length) {
      question!.options.push(...inline);
      pendingOption = null;
      for (const rid of imageTokens(line)) addPlaceholder(question!, rid);
      continue;
    }

    const option = RE_OPTION_NO.exec(line);
    if (option && question) {
      const text = (option[2] ?? "").trim();
      if (text) {
        question.options.push(text);
        pendingOption = null;
      } else {
        // The marker sits in its own table cell; the text is the next line.
        pendingOption = option[1]!;
        question.options.push("");
      }
      continue;
    }

    if (pendingOption && question) {
      question.options[question.options.length - 1] = stripTokens(line);
      pendingOption = null;
      for (const rid of imageTokens(line)) addPlaceholder(question, rid);
      continue;
    }

    if (question) {
      for (const rid of imageTokens(line)) addPlaceholder(question, rid);
      const sub = RE_SUBPART_NO.exec(line);
      let text = line;
      if (sub) {
        const trailing = (sub[2] ?? "").trim();
        if (!trailing) {
          // The letter sits alone in its cell; its part is the next line.
          pendingSubpart = sub[1]!.toLowerCase();
          continue;
        }
        text = `${sub[1]!.toLowerCase()}) ${trailing}`;
      } else if (pendingSubpart) {
        text = `${pendingSubpart}) ${line}`;
        pendingSubpart = null;
      }
      question.text = question.text ? `${question.text}\n${text}` : text;
      continue;
    }

    if (current && !current.instructions && !started) continue;
    if (current && !current.instructions) current.instructions = line;
  }
  pushQuestion();

  const sections: ExamPaperSection[] = [];
  let sIdx = 0;
  for (const d of drafts) {
    if (!d.questions.length) continue;
    sIdx += 1;
    const instructions = stripTokens(d.instructions);
    sections.push({
      id: opts.sectionId(sIdx),
      title: d.title,
      instructions,
      questions: d.questions.map((q) => finishQuestion(q, instructions)),
    });
  }

  // A section whose questions are not printed — an oral or practical
  // component — still carries marks the paper counts.
  for (const d of drafts) {
    if (d.questions.length || d.statedMarks <= 0) continue;
    orphans.push({ title: d.title, marks: d.statedMarks });
  }

  const questionCount = sections.reduce((n, s) => n + s.questions.length, 0);
  const parsedMarks = sections.reduce(
    (n, s) => n + s.questions.reduce((m, q) => m + (q.marks || 0), 0),
    0,
  );
  return {
    sections,
    questionCount,
    parsedMarks,
    unassignedMarks: orphans.reduce((n, o) => n + o.marks, 0),
    unassignedSections: [...new Set(orphans.map((o) => o.title).filter(Boolean))],
    imageRids,
  };
}

/**
 * A question with nothing filled in but its identity.
 *
 * Written out in full rather than spread from a default, so that when the
 * paper model grows a field the compiler stops here and someone decides
 * whether an imported paper can answer it. Everything a teacher would judge —
 * the Bloom level, the competency code, the chapter — stays empty: the file
 * does not say, and a guess would go straight into the item analysis as if it
 * were a fact.
 */
function blankQuestion(id: string): ExamPaperQuestion {
  return {
    id,
    type: "short",
    text: "",
    marks: 0,
    options: [],
    answerKey: "",
    formulas: [],
    images: [],
    icons: [],
    hardness: "medium",
    source: "bank",
    competencyCode: "",
    unitId: "",
    bloomLevel: "",
    markingScheme: [],
    pairs: [],
    subQuestions: [],
    attemptAny: 0,
    answerLines: 0,
    optionColumns: 0,
    imageColumns: 1,
  };
}

/**
 * Note the picture against the question, keyed by its relationship id. The
 * URL is not known here — `dataUrl` stays empty until the route has stored
 * the file and can put a real one in. A placeholder that never gets a URL is
 * dropped by `normalizePaper`, so a picture that failed to store leaves the
 * question without it rather than with a broken link.
 */
function addPlaceholder(q: ExamPaperQuestion, rid: string) {
  if (q.images.some((i) => i.id === rid)) return;
  q.images.push({ id: rid, dataUrl: "", caption: "", labels: [] });
}

function imageTokens(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\[\[img:([A-Za-z0-9_.-]+)\]\]/g)) out.push(m[1]!);
  return out;
}

function stripTokens(line: string): string {
  return line.replace(/\[\[img:[A-Za-z0-9_.-]+\]\]/g, " ").replace(/[ \t]+/g, " ").trim();
}

/**
 * What kind of question is this? The section's own instruction is the
 * strongest signal the paper gives — "Choose the correct option", "Match the
 * following", "Case-Based Questions" — and the shape of the item settles the
 * rest. Nothing here invents a Bloom level or a competency code: those are
 * the teacher's to add, and a wrong one would poison the item analysis.
 */
function finishQuestion(
  q: ExamPaperQuestion,
  sectionInstructions: string,
): ExamPaperQuestion {
  const text = stripTokens(q.text);
  const hay = `${sectionInstructions} ${text}`.toLowerCase();

  let type: ExamPaperQuestionType = "short";
  if (q.options.length >= 2) type = "mcq";
  else if (/\bmatch the following\b|\bmatch the column/.test(hay)) type = "match";
  else if (/\btrue\b.*\bfalse\b/.test(hay)) type = "true_false";
  else if (/\bfill in the blank/.test(hay)) type = "fill";
  else if (/\bcase[- ]based\b|\bcase study\b|\bsource[- ]based\b/.test(hay))
    type = "case_study";
  else if (/\bassertion\b/.test(hay) && /\breason\b/.test(hay))
    type = "assertion_reason";
  else if (/\bdraw\b|\blabel\b|\bdiagram\b/.test(hay)) type = "diagram";
  else if (q.marks >= 4) type = "long";

  return {
    ...q,
    type,
    text,
    options: q.options.map((o) => stripTokens(o)).filter((o, i, all) => o || all.length <= 1),
  };
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

/** What the school's masters and exams desk currently hold. */
export type ImportCatalog = {
  academicYearCode: string;
  classes: { id: string; name: string }[];
  subjects: { id: string; code: string; nameEn: string }[];
  terms: {
    id: string;
    code: string;
    label: string;
    academicYearCode: string;
    maxMarks: number;
  }[];
};

/** A paper already on the desk, reduced to what decides a re-import. */
export type ExistingPaperFacts = {
  paperId: string;
  academicYearCode: string;
  examTermId: string;
  classId: string;
  subjectId: string;
  sets: { setCode: string; fileHash: string }[];
};

/** One file, read far enough to be judged. */
export type ImportFileFacts = {
  relPath: string;
  /** sha-256 of the original file — the idempotency key. */
  fileHash: string;
  header: PaperHeader;
  questionCount: number;
  parsedMarks: number;
  /** Marks in a section with no printed questions — usually an oral component. */
  unassignedMarks?: number;
  unassignedSections?: string[];
  /** Set when the file could not be opened at all. */
  readError?: string;
};

export type ImportVerdict = "import" | "duplicate" | "needs_mapping" | "rejected";

export type ImportPlanRow = {
  relPath: string;
  fileName: string;
  fileHash: string;
  path: ImportPath | null;
  header: PaperHeader;
  classId: string;
  className: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  examTermId: string;
  examTermCode: string;
  examTermLabel: string;
  setCode: string;
  /** The publisher's own name for this set, kept verbatim. */
  publisherLabel: string;
  questionCount: number;
  parsedMarks: number;
  verdict: ImportVerdict;
  /** Why it cannot be imported as-is. */
  reasons: string[];
  /** Imported, but the school should look. */
  warnings: string[];
  /** Words the school must map before this row can move — `subject:Numeracy`. */
  unmapped: string[];
  /** ay|term|class|subject — every row of a group becomes one paper. */
  groupKey: string;
  /** The paper this set joins, when one already exists. */
  targetPaperId: string;
};

export type ImportPlanGroup = {
  groupKey: string;
  academicYearCode: string;
  examTermId: string;
  examTermLabel: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  targetPaperId: string;
  rows: ImportPlanRow[];
};

export type ImportPlan = {
  rows: ImportPlanRow[];
  groups: ImportPlanGroup[];
  counts: Record<ImportVerdict, number>;
  /** Every distinct word the school still has to map, deduplicated. */
  unmapped: string[];
};

function classNameKey(s: string): string {
  return normalizeWord(s).replace(/\s+/g, "");
}

/**
 * Both sides of the class check are folder words, so they go through the same
 * map: `Class6` from the path and `Class6` printed in the document both have
 * to land on `VI`. A document that says nothing about its class does not fail
 * the check — some pre-primary papers print only the subject.
 */
function sameClass(
  folderWord: string,
  docWord: string,
  mappings: ImportMappings,
): boolean {
  if (!docWord.trim()) return true;
  const a = mappings.classes[normalizeWord(folderWord)] ?? folderWord;
  const b = mappings.classes[normalizeWord(docWord)] ?? docWord;
  return classNameKey(a) === classNameKey(b);
}

function sameSubject(
  folderWord: string,
  docWord: string,
  mappings: ImportMappings,
): boolean {
  if (!docWord.trim()) return true;
  const a = mappings.subjects[normalizeWord(folderWord)] ?? normalizeWord(folderWord);
  const b = mappings.subjects[normalizeWord(docWord)] ?? normalizeWord(docWord);
  return a === b;
}

/**
 * Decide, for every file, what it is and whether it may be imported — without
 * importing anything. The school reads this table, fixes what it disagrees
 * with, and only then presses the button.
 */
export function planPaperImport(input: {
  files: ImportFileFacts[];
  catalog: ImportCatalog;
  mappings: ImportMappings;
  existing: ExistingPaperFacts[];
}): ImportPlan {
  const { catalog, mappings } = input;
  const ay = catalog.academicYearCode;

  const classByName = new Map(
    catalog.classes.map((c) => [classNameKey(c.name), c] as const),
  );
  const subjectByCode = new Map(
    catalog.subjects.map((s) => [s.code.toUpperCase(), s] as const),
  );
  const termByCode = new Map(
    catalog.terms
      .filter((t) => t.academicYearCode === ay)
      .map((t) => [t.code.toUpperCase(), t] as const),
  );

  const existingByGroup = new Map<string, ExistingPaperFacts>();
  const hashToPaper = new Map<string, ExistingPaperFacts>();
  for (const p of input.existing) {
    existingByGroup.set(
      `${p.academicYearCode}|${p.examTermId}|${p.classId}|${p.subjectId}`,
      p,
    );
    for (const s of p.sets) if (s.fileHash) hashToPaper.set(s.fileHash, p);
  }

  const rows: ImportPlanRow[] = [];
  const seenHashes = new Set<string>();
  /** groupKey → setCode → hash, so two files cannot claim the same set. */
  const takenSets = new Map<string, Map<string, string>>();

  const knowsClass = (word: string) => !!mappings.classes[normalizeWord(word)];

  for (const file of input.files) {
    const path = parseImportPath(file.relPath, knowsClass);
    const fileName = path?.fileName ?? file.relPath.split(/[\\/]/).pop() ?? file.relPath;
    const header = file.header;
    const reasons: string[] = [];
    const warnings: string[] = [];
    const unmapped: string[] = [];

    const row: ImportPlanRow = {
      relPath: file.relPath,
      fileName,
      fileHash: file.fileHash,
      path,
      header,
      classId: "",
      className: "",
      subjectId: "",
      subjectCode: "",
      subjectName: "",
      examTermId: "",
      examTermCode: "",
      examTermLabel: "",
      setCode: "",
      publisherLabel: "",
      questionCount: file.questionCount,
      parsedMarks: file.parsedMarks,
      verdict: "import",
      reasons,
      warnings,
      unmapped,
      groupKey: "",
      targetPaperId: "",
    };

    if (file.readError) {
      row.verdict = "rejected";
      reasons.push(file.readError);
      rows.push(row);
      continue;
    }
    if (!path) {
      row.verdict = "rejected";
      reasons.push("Not a .docx inside a class folder");
      rows.push(row);
      continue;
    }

    row.publisherLabel = path.paperFolder || header.docTitle || fileName;

    // Class
    const className = mappings.classes[normalizeWord(path.classFolder)] ?? "";
    if (!className) {
      unmapped.push(`class:${path.classFolder}`);
    } else {
      const cls = classByName.get(classNameKey(className));
      if (!cls) {
        reasons.push(`Masters has no class "${className}"`);
      } else {
        row.classId = cls.id;
        row.className = cls.name;
      }
    }

    // Subject
    const subjectCode = mappings.subjects[normalizeWord(path.subjectFolder)] ?? "";
    if (!subjectCode) {
      unmapped.push(`subject:${path.subjectFolder}`);
    } else {
      const sub = subjectByCode.get(subjectCode.toUpperCase());
      if (!sub) {
        reasons.push(`Masters has no subject with code ${subjectCode}`);
      } else {
        row.subjectId = sub.id;
        row.subjectCode = sub.code;
        row.subjectName = sub.nameEn;
      }
    }

    // Exam
    const exam = classifyExam(
      {
        docTitle: header.docTitle,
        paperFolder: path.paperFolder,
        bucketFolder: path.bucketFolder,
      },
      mappings,
    );
    if (!exam.code) {
      unmapped.push(`exam:${path.paperFolder || header.docTitle || path.bucketFolder}`);
    } else {
      const term = termByCode.get(exam.code.toUpperCase());
      if (!term) {
        reasons.push(`No ${exam.code} exam exists in ${ay}`);
      } else {
        row.examTermId = term.id;
        row.examTermCode = term.code;
        row.examTermLabel = term.label;
        if (exam.from === "bucket") {
          warnings.push(
            `Exam read from the folder "${path.bucketFolder}" — the paper itself does not say`,
          );
        }
      }
    }

    // The document must agree with the tree it was filed in.
    if (path.classFolder && !sameClass(path.classFolder, header.docClass, mappings)) {
      reasons.push(
        `Filed under ${path.classFolder} but the paper says "${header.docClass}"`,
      );
    }
    if (
      path.subjectFolder &&
      !sameSubject(path.subjectFolder, header.docSubject, mappings)
    ) {
      reasons.push(
        `Filed under ${path.subjectFolder} but the paper says "${header.docSubject}"`,
      );
    }

    if (file.questionCount === 0) {
      reasons.push("No questions could be read from this file");
    }

    // Marks: reported, never corrected.
    const oral = file.unassignedMarks ?? 0;
    const accounted = file.parsedMarks + oral;
    if (oral > 0) {
      const where = (file.unassignedSections ?? []).filter(Boolean).join(", ");
      warnings.push(
        `${oral} marks sit in a section with no printed questions${where ? ` (${where})` : ""} — enter them by hand if the exam uses them`,
      );
    }
    if (!header.maxMarks) {
      warnings.push("The paper does not state its maximum marks");
    } else if (accounted && accounted !== header.maxMarks) {
      warnings.push(
        `Questions add up to ${accounted}, the paper says ${header.maxMarks}`,
      );
    }
    if (row.examTermId) {
      const term = catalog.terms.find((t) => t.id === row.examTermId);
      if (term && header.maxMarks && term.maxMarks && term.maxMarks !== header.maxMarks) {
        warnings.push(
          `${term.label} is set to ${term.maxMarks} marks in the exams desk; this paper is ${header.maxMarks}`,
        );
      }
    }

    if (reasons.length) row.verdict = "rejected";
    else if (unmapped.length) row.verdict = "needs_mapping";

    if (row.verdict === "import") {
      row.groupKey = `${ay}|${row.examTermId}|${row.classId}|${row.subjectId}`;
      const target = existingByGroup.get(row.groupKey);
      row.targetPaperId = target?.paperId ?? "";

      const already = hashToPaper.get(file.fileHash);
      if (already || seenHashes.has(file.fileHash)) {
        row.verdict = "duplicate";
        reasons.push(
          already
            ? "Already imported — the file has not changed"
            : "The same file appears twice in this folder",
        );
      } else {
        seenHashes.add(file.fileHash);
        const wanted = setCodeForNumber(
          readSetNumber(path.paperFolder || header.docTitle),
        );
        let taken = takenSets.get(row.groupKey);
        if (!taken) {
          taken = new Map<string, string>();
          for (const s of target?.sets ?? []) taken.set(s.setCode, s.fileHash);
          takenSets.set(row.groupKey, taken);
        }
        let code = wanted;
        if (taken.has(code)) {
          let i = 0;
          while (i < 26 && taken.has(setCodeForNumber(i + 1))) i += 1;
          code = setCodeForNumber(i + 1);
          warnings.push(`Set ${wanted} is already taken here — filed as Set ${code}`);
        }
        taken.set(code, file.fileHash);
        row.setCode = code;
      }
    }

    rows.push(row);
  }

  const groups = new Map<string, ImportPlanGroup>();
  for (const row of rows) {
    if (row.verdict !== "import") continue;
    let g = groups.get(row.groupKey);
    if (!g) {
      g = {
        groupKey: row.groupKey,
        academicYearCode: ay,
        examTermId: row.examTermId,
        examTermLabel: row.examTermLabel,
        classId: row.classId,
        className: row.className,
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        targetPaperId: row.targetPaperId,
        rows: [],
      };
      groups.set(row.groupKey, g);
    }
    g.rows.push(row);
  }

  const counts: Record<ImportVerdict, number> = {
    import: 0,
    duplicate: 0,
    needs_mapping: 0,
    rejected: 0,
  };
  for (const r of rows) counts[r.verdict] += 1;

  return {
    rows,
    groups: [...groups.values()].sort((a, b) =>
      `${a.className}${a.subjectName}`.localeCompare(`${b.className}${b.subjectName}`),
    ),
    counts,
    unmapped: [...new Set(rows.flatMap((r) => r.unmapped))].sort(),
  };
}
