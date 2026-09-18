/**
 * Short homework, made complete for parents.
 *
 * A teacher types "5A maths hw: ex 5.2 Q1-5, due kal". The parent used to
 * see "Work: ex 5.2 Q1-5", which means nothing to a mother who does not
 * have the book open. The school has mapped every class, subject, chapter
 * and topic (tables school_textbooks / school_textbook_chapters), so the
 * reference can be resolved into the child's own book and the message can
 * say what the work actually is.
 *
 * Two halves, deliberately separated:
 *
 *   1. RESOLVE — pure, deterministic, no model. The shorthand becomes a
 *      pointer into the mapped curriculum, or it becomes nothing. A pointer
 *      that cannot be resolved is reported as unresolved; it is never
 *      guessed, because a wrong chapter sends a whole section's parents to
 *      the wrong pages.
 *   2. WRITE — the model turns the resolved facts into the message, in both
 *      languages. It may name ONLY what the resolver handed it, and the
 *      teacher's own words stay in the message as the work. What comes back
 *      is checked against the facts before anyone sees it.
 *
 * The teacher confirms before it goes out. This file writes a draft, not a
 * broadcast.
 */

/* ── 1. what the teacher wrote ───────────────────────────────────── */

export type HomeworkReference = {
  /** Chapter number, 0 when the text does not state one. */
  chapterPosition: number;
  /** "5.2", "2" — as written. */
  exercise: string;
  /** "1-5", "3" — as written. */
  questions: string;
  /** "45-46" — as written. */
  pages: string;
  /** What is left after the numbers are taken out: may name a chapter or topic. */
  nameFragment: string;
  /** Each thing the parser recognised, for the teacher to check. */
  read: string[];
};

const EMPTY_REFERENCE: HomeworkReference = {
  chapterPosition: 0,
  exercise: "",
  questions: "",
  pages: "",
  nameFragment: "",
  read: [],
};

/** Devanagari digits, which teachers do use: "पाठ ३". */
function westernDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

const STOPWORDS = new Set([
  "hw", "homework", "classwork", "cw", "do", "complete", "finish", "write", "read", "learn", "solve",
  "and", "the", "for", "from", "of", "in", "on", "all", "please", "kal", "aaj", "tomorrow", "today",
  "due", "submit", "copy", "notebook", "book", "karo", "karna", "likho", "padho", "yaad", "गृहकार्य",
  "करें", "करना", "लिखें", "पढ़ें", "याद", "कल", "आज", "सभी", "और",
]);

/**
 * Read the reference out of the teacher's line.
 *
 * Numbering conventions, and the one place this refuses to be clever:
 * "ex 5.2" is chapter 5, exercise 2 — the convention of every Indian maths
 * book. A bare "exercise 4" is NOT chapter 4: in most books it is the
 * fourth exercise of whatever chapter the class is on, and this ERP does
 * not know which chapter that is. So a bare exercise number yields no
 * chapter, and the message goes out without naming one.
 */
export function parseHomeworkReference(text: string): HomeworkReference {
  const raw = westernDigits(String(text || "")).replace(/\s+/g, " ").trim();
  if (!raw) return { ...EMPTY_REFERENCE };
  const read: string[] = [];
  let rest = raw;

  const take = (re: RegExp, note: (m: RegExpMatchArray) => string): RegExpMatchArray | null => {
    const m = rest.match(re);
    if (!m) return null;
    read.push(note(m));
    rest = rest.replace(m[0], " ");
    return m;
  };

  // Chapter, stated outright.
  const chapter = take(
    /\b(?:ch|chap|chapter|lesson|unit|paath|path|adhyay)\.?\s*[-–:]?\s*(\d{1,2})\b|(?:पाठ|अध्याय|इकाई)\s*[-–:]?\s*(\d{1,2})/i,
    (m) => `chapter ${m[1] || m[2]}`,
  );
  let chapterPosition = chapter ? Number(chapter[1] || chapter[2]) : 0;

  // Exercise. "5.2" carries the chapter with it; "4" does not.
  const exercise = take(
    /\b(?:ex|exercise|abhyas)\.?\s*[-–:]?\s*(\d{1,2}(?:\.\d{1,2})?)\b|(?:अभ्यास)\s*[-–:]?\s*(\d{1,2}(?:\.\d{1,2})?)/i,
    (m) => `exercise ${m[1] || m[2]}`,
  );
  const exerciseNo = exercise ? String(exercise[1] || exercise[2]) : "";
  if (!chapterPosition && exerciseNo.includes(".")) {
    chapterPosition = Number(exerciseNo.split(".")[0]);
  }

  const questions = take(
    /\b(?:q|qn|que|question|questions|prashn)\.?\s*[-–:]?\s*(\d{1,3}(?:\s*(?:-|–|to|se)\s*\d{1,3})?)\b|(?:प्रश्न)\s*[-–:]?\s*(\d{1,3}(?:\s*(?:-|–|से)\s*\d{1,3})?)/i,
    (m) => `questions ${m[1] || m[2]}`,
  );

  const pages = take(
    /\b(?:pg|page|pages|pp)\.?\s*[-–:]?\s*(\d{1,3}(?:\s*(?:-|–|to)\s*\d{1,3})?)\b|(?:पृष्ठ|पेज)\s*[-–:]?\s*(\d{1,3}(?:\s*(?:-|–)\s*\d{1,3})?)/i,
    (m) => `page ${m[1] || m[2]}`,
  );

  const nameFragment = rest
    .split(/[^\p{L}\p{M}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();

  return {
    chapterPosition: Number.isFinite(chapterPosition) ? chapterPosition : 0,
    exercise: exerciseNo,
    questions: questions ? String(questions[1] || questions[2]).replace(/\s*(?:-|–|to|se|से)\s*/i, "–") : "",
    pages: pages ? String(pages[1] || pages[2]).replace(/\s*(?:-|–|to)\s*/i, "–") : "",
    nameFragment,
    read,
  };
}

/* ── 2. the mapped curriculum ────────────────────────────────────── */

export type ChapterFact = { position: number; name: string; topics: string[] };
export type BookFact = { name: string; chapters: ChapterFact[] };

export type HomeworkResolution =
  | { kind: "chapter"; bookName: string; chapter: ChapterFact; how: "position" | "name" | "topic" }
  | { kind: "ambiguous"; reason: string; candidates: string[] }
  | { kind: "none"; reason: "no_book" | "no_reference" | "no_match" };

function normalise(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The reference, against the class's own book.
 *
 * Order matters: a stated chapter number beats a name, because a teacher
 * who writes "ch 6" means chapter 6 even if the words after it happen to
 * echo another chapter's title. A number the book does not have resolves to
 * NOTHING — the teacher is told the book has 12 chapters, rather than
 * parents being sent to a chapter that does not exist.
 */
export function resolveHomeworkChapter(input: {
  books: BookFact[];
  reference: HomeworkReference;
}): HomeworkResolution {
  const books = input.books.filter((b) => b.chapters.length);
  const ref = input.reference;
  if (!books.length) return { kind: "none", reason: "no_book" };
  if (books.length > 1) {
    // Two editions (English and Hindi medium, or two series) for one
    // subject. Which one the class holds is not something to decide from a
    // chapter number, so the teacher is asked.
    return { kind: "ambiguous", reason: "more than one book is loaded for this class and subject", candidates: books.map((b) => b.name) };
  }
  const book = books[0]!;

  if (ref.chapterPosition > 0) {
    const hit = book.chapters.find((c) => c.position === ref.chapterPosition);
    if (hit) return { kind: "chapter", bookName: book.name, chapter: hit, how: "position" };
    return { kind: "none", reason: "no_match" };
  }

  const fragment = normalise(ref.nameFragment);
  if (!fragment) return { kind: "none", reason: "no_reference" };

  const words = fragment.split(" ").filter((w) => w.length >= 4);
  if (!words.length) return { kind: "none", reason: "no_reference" };

  const byName = book.chapters.filter((c) => {
    const n = normalise(c.name);
    return words.some((w) => n.includes(w));
  });
  if (byName.length === 1) return { kind: "chapter", bookName: book.name, chapter: byName[0]!, how: "name" };
  if (byName.length > 1) {
    return { kind: "ambiguous", reason: "the words match more than one chapter", candidates: byName.map((c) => `Ch ${c.position} — ${c.name}`) };
  }

  const byTopic = book.chapters.filter((c) => c.topics.some((t) => {
    const n = normalise(t);
    return words.some((w) => n.includes(w));
  }));
  if (byTopic.length === 1) return { kind: "chapter", bookName: book.name, chapter: byTopic[0]!, how: "topic" };
  if (byTopic.length > 1) {
    return { kind: "ambiguous", reason: "the words match topics in more than one chapter", candidates: byTopic.map((c) => `Ch ${c.position} — ${c.name}`) };
  }
  return { kind: "none", reason: "no_match" };
}

/* ── 3. the facts the message is written from ────────────────────── */

export type HomeworkExpandFacts = {
  classLabel: string;
  subjectLabel: string;
  /** Exactly what the teacher typed, after the class/subject prefix. */
  teacherText: string;
  /** "Fri 19 Sep", or "" when no due date was given. */
  dueLabel: string;
  /** "" when nothing was resolved — and then no chapter may be named. */
  bookName: string;
  chapterNumber: number;
  chapterName: string;
  topics: string[];
  exercise: string;
  questions: string;
  pages: string;
};

export const HOMEWORK_TOPICS_IN_MESSAGE = 3;

export function homeworkExpandFacts(input: {
  classLabel: string;
  subjectLabel: string;
  teacherText: string;
  dueLabel: string;
  reference: HomeworkReference;
  resolution: HomeworkResolution;
}): HomeworkExpandFacts {
  const r = input.resolution;
  return {
    classLabel: input.classLabel,
    subjectLabel: input.subjectLabel,
    teacherText: input.teacherText.trim(),
    dueLabel: input.dueLabel,
    bookName: r.kind === "chapter" ? r.bookName : "",
    chapterNumber: r.kind === "chapter" ? r.chapter.position : 0,
    chapterName: r.kind === "chapter" ? r.chapter.name : "",
    topics: r.kind === "chapter" ? r.chapter.topics.slice(0, HOMEWORK_TOPICS_IN_MESSAGE) : [],
    exercise: input.reference.exercise,
    questions: input.reference.questions,
    pages: input.reference.pages,
  };
}

/** "2026-09-19" → "Fri 19 Sep"; today and tomorrow are said in words. */
export function formatDueLabel(dueAt: string, todayIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt || "")) return "";
  const due = Date.parse(`${dueAt}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(due)) return "";
  const days = Number.isNaN(today) ? NaN : Math.round((due - today) / 86_400_000);
  const d = new Date(due);
  const pretty = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  if (days === 0) return `today (${pretty})`;
  if (days === 1) return `tomorrow (${pretty})`;
  return pretty;
}

/* ── 4. the message ──────────────────────────────────────────────── */

export const HOMEWORK_EXPAND_PROMPT_VERSION = "homework-expand/2026-09-18";

export const HOMEWORK_EXPAND_SYSTEM = [
  "You write one short homework message that a parent reads on their phone. Many parents read Hindi more comfortably than English, so you write both.",
  "You are given FACTS. Everything you name — the book, the chapter number, the chapter title, the topics — must come from FACTS. When FACTS carries no book or chapter, name none: do not say 'the chapter you did today', do not guess a chapter number, do not invent page numbers or how many questions there are.",
  "The teacher's own words are the work. Keep them: a parent must be able to see exactly what was set. You add the context around them, you never replace or reinterpret them.",
  "No time estimates, no encouragement to the parent to teach, no praise, no emoji beyond what the school's format already uses.",
  "bodyHi is the same message in simple Hindi, not a transliteration. Keep the chapter title and the book name in their printed form (English titles stay English).",
  "title: at most 6 words naming the work, e.g. 'Maths — Exercise 5.2'.",
  'Respond with JSON only: {"title":"","bodyEn":"","bodyHi":""}',
].join("\n");

export function buildHomeworkExpandPrompt(f: HomeworkExpandFacts): string {
  const lines = [
    "FACTS",
    `Class: ${f.classLabel}`,
    `Subject: ${f.subjectLabel}`,
    f.bookName ? `Book: ${f.bookName}` : "Book: not known — name no book",
    f.chapterNumber ? `Chapter: ${f.chapterNumber} — ${f.chapterName}` : "Chapter: not known — name no chapter",
    f.topics.length ? `Topics in that chapter: ${f.topics.join("; ")}` : "",
    f.exercise ? `Exercise: ${f.exercise}` : "",
    f.questions ? `Questions: ${f.questions}` : "",
    f.pages ? `Pages: ${f.pages}` : "",
    f.dueLabel ? `Due: ${f.dueLabel}` : "Due: not stated — do not invent one",
    "",
    "The teacher wrote, exactly:",
    f.teacherText,
  ];
  return lines.filter(Boolean).join("\n");
}

export type HomeworkExpansion = { title: string; bodyEn: string; bodyHi: string };

const CHAPTER_CLAIM = /(?:chapter|chap\.?|ch\.?|lesson|पाठ|अध्याय)\s*[-–:]?\s*(\d{1,2})/gi;

/**
 * Does the message name a chapter the facts did not give it?
 *
 * The one check that matters. Everything else a model gets wrong here is
 * cosmetic; a chapter number is a hundred families opening the wrong pages,
 * and it reads exactly as authoritative as a right one.
 */
export function expansionInventsChapter(body: string, f: HomeworkExpandFacts): boolean {
  const teacherSaid = westernDigits(f.teacherText);
  for (const m of westernDigits(body).matchAll(CHAPTER_CLAIM)) {
    const n = Number(m[1]);
    if (f.chapterNumber && n === f.chapterNumber) continue;
    // A number the teacher themselves wrote is theirs to be wrong about.
    if (teacherSaid.includes(String(n))) continue;
    return true;
  }
  return false;
}

export function parseHomeworkExpansion(text: string, f: HomeworkExpandFacts): HomeworkExpansion | null {
  let raw: unknown;
  try {
    raw = JSON.parse(String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");
  const title = clean(o.title, 80);
  const bodyEn = clean(o.bodyEn, 900);
  const bodyHi = clean(o.bodyHi, 900);
  if (!bodyEn || !bodyHi) return null;
  if (expansionInventsChapter(bodyEn, f) || expansionInventsChapter(bodyHi, f)) return null;
  return { title: title || f.subjectLabel, bodyEn, bodyHi };
}

/**
 * The message without the model — when the key is missing, the budget is
 * spent, the reply will not parse, or the reply named a chapter nobody gave
 * it. Plainer than the written version and in the same order, so a parent
 * who gets one today and the other tomorrow is not reading two formats.
 *
 * It is not a degraded mode to be embarrassed about: with a resolved
 * chapter this already says everything the parent needs.
 */
export function renderHomeworkExpansion(f: HomeworkExpandFacts): HomeworkExpansion {
  const work = [
    f.exercise ? `Exercise ${f.exercise}` : "",
    f.questions ? `questions ${f.questions}` : "",
    f.pages ? `pages ${f.pages}` : "",
  ].filter(Boolean).join(", ");

  const en = [
    `📘 ${f.classLabel} · ${f.subjectLabel}`,
    f.bookName ? `Book: ${f.bookName}` : "",
    f.chapterNumber ? `Chapter ${f.chapterNumber} — ${f.chapterName}` : "",
    f.topics.length ? `This chapter covers: ${f.topics.join(", ")}` : "",
    "",
    `Work: ${f.teacherText}`,
    work ? `(${work})` : "",
    f.dueLabel ? `Due: ${f.dueLabel}` : "",
  ].filter((l) => l !== undefined && l !== "").join("\n");

  const hi = [
    `📘 ${f.classLabel} · ${f.subjectLabel}`,
    f.bookName ? `पुस्तक: ${f.bookName}` : "",
    f.chapterNumber ? `अध्याय ${f.chapterNumber} — ${f.chapterName}` : "",
    f.topics.length ? `इस अध्याय में: ${f.topics.join(", ")}` : "",
    "",
    `कार्य: ${f.teacherText}`,
    work ? `(${work})` : "",
    f.dueLabel ? `अंतिम तिथि: ${f.dueLabel}` : "",
  ].filter((l) => l !== undefined && l !== "").join("\n");

  const title = [f.subjectLabel, f.exercise ? `Exercise ${f.exercise}` : f.chapterName].filter(Boolean).join(" — ");
  return { title: title.slice(0, 80), bodyEn: en, bodyHi: hi };
}

/**
 * What the teacher is told when the reference could not be resolved.
 *
 * Only when they ASKED for a chapter. Most homework text contains ordinary
 * words that match no chapter title, and warning about every one of them
 * would train teachers to ignore the line — so "learn the spellings" gets
 * nothing, while "ch 19" of a twelve-chapter book gets told.
 */
export function resolutionNoteForTeacher(r: HomeworkResolution, ref: HomeworkReference): string {
  if (r.kind === "chapter") return "";
  if (r.kind === "ambiguous") {
    return `⚠️ Could not tell which chapter — ${r.reason}. Reply with the chapter number to add it, or YES to send as written.`;
  }
  if (r.reason === "no_match" && ref.chapterPosition > 0) {
    return `⚠️ This book has no chapter ${ref.chapterPosition}. Reply with the right number, or YES to send as written.`;
  }
  return "";
}

import { submitInviteLine } from "@/lib/homeworkSubmission";

/* ── 5. the same thing on WhatsApp ───────────────────────────────── */

/**
 * The one line a WhatsApp TEMPLATE variable can carry.
 *
 * Meta rejects a variable containing a newline, a tab, or four spaces in a
 * row, so the expanded message cannot ride inside `bhb_homework_published`.
 * What fits is the part a parent could not have worked out for themselves:
 * the chapter, then the work.
 *
 * Built from the post itself rather than the expansion, so homework typed
 * straight into the app — with no chapter resolved — still produces a
 * sensible line instead of nothing.
 */
export const WA_LINE_MAX = 220;

export function homeworkWaLine(post: { title: string; aiTutorHint?: string }): string {
  const chapter = (post.aiTutorHint || "").replace(/\s+/g, " ").trim();
  const title = (post.title || "").replace(/\s+/g, " ").trim();
  // A hint that is not a chapter reference — older posts stored the subject
  // code there ("ENG") — is not worth a parent's attention.
  const usable = /\bch\s*\d|अध्याय|पाठ/i.test(chapter) ? chapter : "";
  const line = [usable, title].filter(Boolean).join(" · ") || title || "See the parent app";
  return line.length > WA_LINE_MAX ? `${line.slice(0, WA_LINE_MAX - 1).trimEnd()}…` : line;
}

/** Meta forbids an empty template variable, and a due date is often absent. */
export function homeworkWaDue(dueLabel: string, language: "en" | "hi"): string {
  if (dueLabel) return dueLabel;
  return language === "hi" ? "बताई नहीं गई" : "not given";
}

export const WA_CHAPTER_LINE_MAX = 200;

/**
 * Book, chapter and what it covers, on ONE line, for the WhatsApp template.
 *
 * Meta cannot leave a line out of a template, so this line has to be true
 * whatever was resolved. It degrades: book and chapter and topics, then book
 * and chapter, then the book alone, then an em dash — which is what
 * `templateVariablePositions` substitutes for anything missing, and the only
 * honest thing to print when the school's book for that class is not loaded.
 *
 * Topics are the part a parent could not have worked out, so they stay until
 * the line runs out of room rather than being dropped first.
 */
export function formatChapterLine(input: {
  bookName: string;
  chapterNumber: number;
  chapterName: string;
  topics: string[];
}): string {
  const one = (v: string) => v.replace(/\s+/g, " ").trim();
  const book = one(input.bookName);
  const chapter = input.chapterNumber
    ? one(`Ch ${input.chapterNumber}${input.chapterName ? ` ${input.chapterName}` : ""}`)
    : "";
  const head = [book, chapter].filter(Boolean).join(" · ");
  if (!head) return "";
  const topics = input.topics.map(one).filter(Boolean).join(", ");
  const full = topics ? `${head} — ${topics}` : head;
  if (full.length <= WA_CHAPTER_LINE_MAX) return full;
  // Trim the topics, never the chapter: a parent can find the chapter
  // without the topic list, not the other way round.
  const room = WA_CHAPTER_LINE_MAX - head.length - 4;
  if (topics && room > 12) return `${head} — ${topics.slice(0, room).trimEnd()}…`;
  return head.length <= WA_CHAPTER_LINE_MAX ? head : `${head.slice(0, WA_CHAPTER_LINE_MAX - 1).trimEnd()}…`;
}

/**
 * The whole message, for a family whose 24-hour window is open.
 *
 * Worth trying before the template every time: the template can only carry
 * one line, and this carries the book, the chapter, what the chapter covers
 * and the teacher's own words. A shut window costs one refused send, which
 * Meta does not bill.
 */
export function homeworkWaBody(input: {
  expansion: HomeworkExpansion;
  language: "en" | "hi";
  schoolName: string;
}): string {
  const body = input.language === "hi" ? input.expansion.bodyHi : input.expansion.bodyEn;
  // No "open the app". The message already carries the book, the chapter and
  // the work, and the help on offer is the same tutor, on the channel the
  // parent is already reading. Director's instruction, 18 Sep 2026.
  const tail =
    input.language === "hi"
      ? `\n\nमदद चाहिए? इसी नंबर पर *TUTOR* लिखकर भेजें। 🎓\n— ${input.schoolName}`
      : `\n\nNeeds a hand with it? Reply *TUTOR* on this number. 🎓\n— ${input.schoolName}`;
  // Always offered, and always true: a photograph of finished work is
  // accepted against the most likely homework for that child, whether or not
  // the teacher ticked "requires submission". See submittablePostsFor.
  const invite = `\n\n${submitInviteLine(input.language)}`;
  return `${body}${invite}${tail}`;
}
