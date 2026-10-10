/**
 * Turn the text of a textbook contents page into chapter/topic
 * candidates for the syllabus plan.
 *
 * This is a *suggestion* engine, not an importer. Everything it returns
 * is shown to a teacher for review before anything is written, and the
 * lines it could not place are handed back too (`ignored`) so a page it
 * half-understood is visibly half-understood rather than quietly
 * truncated. Nothing here invents a chapter that was not on the page.
 *
 * Pure string handling on purpose: no network, no model call, fully
 * testable (see syllabusOcr.selftest.ts). An optional LLM pass can
 * refine the result later, but the deterministic parser is what the
 * feature is built on so it degrades to "usable" rather than "nothing"
 * when the model is unavailable.
 */

export type SyllabusOcrTopic = {
  /** "1.1" when the page numbered it, "" otherwise */
  code: string;
  title: string;
};

export type SyllabusOcrChapter = {
  /** "1", "I", "" — as printed, not invented */
  code: string;
  title: string;
  topics: SyllabusOcrTopic[];
  /**
   * `high` — an explicit chapter marker or number was printed.
   * `low`  — the line looked like a title but carried no number, so it
   *          is a guess the teacher should check.
   */
  confidence: "high" | "low";
};

export type SyllabusOcrResult = {
  chapters: SyllabusOcrChapter[];
  /** Lines that were read but not used — shown so nothing goes missing silently */
  ignored: string[];
};

/** Headings and front-matter that are never chapters. */
const NOISE = new Set([
  "contents",
  "content",
  "index",
  "table of contents",
  "syllabus",
  "foreword",
  "preface",
  "acknowledgement",
  "acknowledgements",
  "rationalised content",
  "rationalised contents",
  "answers",
  "appendix",
  "bibliography",
  "glossary",
  "notes",
  "page",
  "chapter",
  "unit",
  "topic",
  "topics",
  "s.no",
  "sr.no",
  "sl.no",
]);

/**
 * Words that legitimately precede a number, so the digit after them is
 * part of the title ("Algebra Part 2") or the chapter marker itself
 * ("Chapter 4"), never a page number.
 */
const COUNTER_WORDS = new Set([
  "chapter", "chap", "ch", "unit", "lesson", "module", "part", "volume",
  "vol", "book", "section", "paper", "term", "class", "grade", "std",
  "level", "no", "number", "phase", "stage", "set", "group", "activity",
  "exercise", "figure", "fig", "table",
]);

/**
 * Strip the trailing page number that contents pages print after each
 * title — "......... 21", or just "Rational Numbers   1".
 *
 * The hard case is telling that from a title that ends in a digit. Space
 * count alone is not enough: OCR flattens "Numbers        1" and
 * "Part 2" to the same single space. So the decision is made on the word
 * before the digit — after a counter word the number belongs to the
 * title, otherwise it is pagination.
 */
function stripPageNumber(line: string): string {
  const m = /^(.*?)[\s.·•…_-]+(\d{1,4})\s*$/u.exec(line);
  if (!m) return line.trim();
  const head = m[1]!.trim();
  if (!head) return line.trim();
  const lastWord = (head.split(/[\s.·•…_-]+/).pop() || "").toLowerCase();
  if (COUNTER_WORDS.has(lastWord)) return line.trim();
  return head;
}

function cleanLine(raw: string): string {
  return raw
    // OCR often emits non-breaking and zero-width characters
    .replace(/[ ​‎‏]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoise(line: string): boolean {
  // Digits are kept: "chapter" alone is a page heading, but "chapter 4"
  // is a real chapter and must not be filtered out with it.
  const lower = line.toLowerCase().replace(/[^a-z0-9. ]/g, "").trim();
  if (!lower) return true;
  if (NOISE.has(lower)) return true;
  // Front matter is usually paginated in roman numerals ("FOREWORD iii").
  // Only treat the trailing numeral as a page number when what remains is
  // itself front matter, so a real title like "World War II" survives.
  const deRomaned = lower.replace(/\s+[ivxlcdm]{1,6}$/, "").trim();
  if (deRomaned !== lower && NOISE.has(deRomaned)) return true;
  // Bare page numbers, roman numerals (front matter), or stray symbols.
  if (/^\d{1,4}$/.test(line)) return true;
  if (/^[ivxlcdm]{1,6}$/i.test(line)) return true;
  if (!/[a-zऀ-ॿ]/i.test(line)) return true;
  return false;
}

/** Title-case-ish cleanup without destroying acronyms the book uses. */
function tidyTitle(raw: string): string {
  const t = raw.replace(/^[\s:.\-–—]+/, "").replace(/[\s:.\-–—]+$/, "").trim();
  // ALL-CAPS headings are common on contents pages and read badly in the
  // plan; convert to sentence case but leave short acronyms alone.
  if (t.length > 3 && t === t.toUpperCase() && /[A-Z]{4,}/.test(t)) {
    return t
      .toLowerCase()
      .replace(/(^|\s|\()([a-z])/g, (_m, p, c) => `${p}${c.toUpperCase()}`);
  }
  return t;
}

const CHAPTER_WORD =
  /^(?:chapter|chap\.?|ch\.?|unit|lesson|module|part)\s*[-–—]?\s*(\d{1,2}|[ivxlcdm]{1,6})\b[\s:.\-–—]*(.*)$/i;
const NUMBERED = /^(\d{1,2})\s*[.):\-–—]\s*(.+)$/;
const TOPIC_NUMBERED = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?\s*[.):\-–—]?\s+(.+)$/;
const BULLET = /^[•·*\-–—▪]\s*(.+)$/;

/**
 * Parse OCR text into chapters and topics.
 *
 * Ordering rule: a `N.M` topic attaches to chapter `N` when that chapter
 * has been seen; otherwise it attaches to the most recent chapter, and
 * if there is none at all it is reported as ignored rather than promoted
 * to a chapter of its own.
 */
export function parseSyllabusFromText(text: string): SyllabusOcrResult {
  // Page numbers are stripped BEFORE whitespace is collapsed: the gap
  // between a title and its page number is the only thing distinguishing
  // "Rational Numbers        1" from a title that ends in a digit.
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((raw) => cleanLine(stripPageNumber(raw)))
    .filter(Boolean);

  const chapters: SyllabusOcrChapter[] = [];
  const ignored: string[] = [];
  const byCode = new Map<string, SyllabusOcrChapter>();

  const pushChapter = (
    code: string,
    title: string,
    confidence: "high" | "low",
  ) => {
    const chapter: SyllabusOcrChapter = {
      code,
      title: tidyTitle(title),
      topics: [],
      confidence,
    };
    chapters.push(chapter);
    if (code) byCode.set(code.replace(/^0+/, ""), chapter);
    return chapter;
  };

  for (const original of lines) {
    const line = original;
    if (!line || isNoise(line)) {
      // Keep genuinely unusable text out of `ignored` — a page number is
      // not something the teacher needs to reconcile.
      if (line && !/^\d{1,4}$/.test(line) && !isNoise(line)) {
        ignored.push(original);
      }
      continue;
    }

    // 1.1 Sub-topic
    const topic = TOPIC_NUMBERED.exec(line);
    if (topic) {
      const [, chapNo, subNo, subSub, rawTitle] = topic;
      const code = subSub
        ? `${chapNo}.${subNo}.${subSub}`
        : `${chapNo}.${subNo}`;
      const owner =
        byCode.get(String(chapNo).replace(/^0+/, "")) ??
        chapters[chapters.length - 1];
      if (!owner) {
        // A topic with no chapter above it cannot be placed. Promoting it
        // would fabricate a chapter that was never printed.
        ignored.push(original);
        continue;
      }
      owner.topics.push({ code, title: tidyTitle(rawTitle) });
      continue;
    }

    // Chapter 1 / Unit II / Lesson 3
    const worded = CHAPTER_WORD.exec(line);
    if (worded) {
      const [, code, rest] = worded;
      const title = tidyTitle(rest);
      if (title) {
        pushChapter(code, title, "high");
      } else {
        // "Chapter 4" on its own line — the title is usually the next
        // line, so hold the chapter open for it.
        pushChapter(code, "", "high");
      }
      continue;
    }

    // 1. Rational Numbers
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      const [, code, rest] = numbered;
      const title = tidyTitle(rest);
      if (title) {
        pushChapter(code, title, "high");
        continue;
      }
    }

    // • Bullet under the current chapter → a topic
    const bullet = BULLET.exec(line);
    if (bullet && chapters.length > 0) {
      chapters[chapters.length - 1]!.topics.push({
        code: "",
        title: tidyTitle(bullet[1]!),
      });
      continue;
    }

    // A bare line directly after "Chapter 4" completes that chapter.
    const last = chapters[chapters.length - 1];
    if (last && !last.title) {
      last.title = tidyTitle(line);
      continue;
    }

    // Otherwise: an unnumbered line. It may well be a chapter on a book
    // that does not number them, so keep it — but flag it low confidence
    // so the review screen shows it as a guess.
    if (line.length >= 3 && line.length <= 90) {
      pushChapter("", line, "low");
    } else {
      ignored.push(original);
    }
  }

  // Drop chapters that never got a title (e.g. a trailing "Chapter 9"
  // with nothing after it) — an untitled chapter is not a fact.
  const usable = chapters.filter((c) => c.title.length > 0);
  for (const c of chapters) {
    if (!c.title) ignored.push(c.code ? `Chapter ${c.code}` : "(untitled)");
  }

  return { chapters: usable, ignored };
}

/**
 * How much of the page we understood — drives whether the review screen
 * leads with "check these" or "we could not read this page".
 */
export function syllabusOcrQuality(result: SyllabusOcrResult): {
  chapters: number;
  topics: number;
  lowConfidence: number;
  ignored: number;
  verdict: "good" | "partial" | "poor";
} {
  const chapters = result.chapters.length;
  const topics = result.chapters.reduce((s, c) => s + c.topics.length, 0);
  const lowConfidence = result.chapters.filter(
    (c) => c.confidence === "low",
  ).length;
  let verdict: "good" | "partial" | "poor";
  if (chapters === 0) verdict = "poor";
  else if (lowConfidence > chapters / 2 || result.ignored.length > chapters)
    verdict = "partial";
  else verdict = "good";
  return {
    chapters,
    topics,
    lowConfidence,
    ignored: result.ignored.length,
    verdict,
  };
}
