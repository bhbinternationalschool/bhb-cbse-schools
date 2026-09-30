/**
 * A photographed book page → homework the teacher can post (2026-09-30).
 *
 * Teachers set homework from the page in front of them: "Exercise 5.2, do
 * 1 to 5". On a phone, typing that out is the slow part, so the teacher
 * photographs the page and the model reads it. What the model reads is a
 * DRAFT that lands in the ordinary homework form; the teacher edits it and
 * posts it the normal way. Nothing here saves or sends anything.
 *
 * The rule the whole file is built on: unknown must not become fact. A
 * homework message goes to every parent in the section, and "Exercise 5.3"
 * reads exactly as authoritative whether it was printed on the page or
 * made up. So:
 *
 *   - the model must TRANSCRIBE the lines it used (`transcript`), and every
 *     number it reports — page, exercise, question — is kept only when it
 *     can be found in that transcript. What cannot be found is dropped and
 *     named to the teacher, never quietly kept;
 *   - a page it cannot read comes back as unreadable, with the reason, and
 *     the screen says so plainly rather than offering an empty draft;
 *   - the message itself is built HERE from the checked fields, not written
 *     freehand by the model — the model contributes one short instruction
 *     sentence, which is refused if it carries a number the page did not.
 *
 * Pure: no network, no model call — see homeworkPageScanAi.selftest.ts.
 * The call itself is readHomeworkPageJson in aiLlm.server.ts.
 */

export const HOMEWORK_PAGE_SCAN_PROMPT_VERSION = "homework-page-scan/2026-09-30";

export type HomeworkPageLanguage = "en" | "hi";

/** An exercise can run onto the next page; three is plenty for one piece of homework. */
export const HOMEWORK_PAGE_MAX_IMAGES = 3;
/** ~1600 px JPEG is ~300–500 kB; this refuses a raw 4000 px camera file sent by mistake. */
export const HOMEWORK_PAGE_MAX_BASE64 = 4_000_000;
export const HOMEWORK_PAGE_MAX_QUESTIONS = 40;
/** How many question texts the drafted message quotes; the rest go by number only. */
export const HOMEWORK_PAGE_QUOTED_QUESTIONS = 10;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/* ── input ──────────────────────────────────────────────────────── */

export type HomeworkPageScanInput = {
  classId: string;
  sectionId: string;
  subjectId: string;
  language: HomeworkPageLanguage;
  images: { base64: string; mimeType: string }[];
};

/** Validate the request body; a string is the reason it was refused. */
export function cleanHomeworkPageScanInput(body: unknown): HomeworkPageScanInput | string {
  if (!body || typeof body !== "object") return "Send the photo of the page";
  const o = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const classId = str(o.classId);
  const sectionId = str(o.sectionId);
  const subjectId = str(o.subjectId);
  if (!classId || !sectionId || !subjectId) return "Pick the class, section and subject first";
  const language: HomeworkPageLanguage = o.language === "hi" ? "hi" : "en";
  const raw = Array.isArray(o.images) ? o.images : [];
  if (!raw.length) return "Send the photo of the page";
  if (raw.length > HOMEWORK_PAGE_MAX_IMAGES) {
    return `At most ${HOMEWORK_PAGE_MAX_IMAGES} pages at a time`;
  }
  const images: HomeworkPageScanInput["images"] = [];
  for (const [i, item] of raw.entries()) {
    const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    // A data: prefix is tolerated — it is the commonest client mistake and
    // costs nothing to strip.
    const base64 = str(it.imageBase64).replace(/^data:[^,]*,/, "");
    const mimeType = str(it.mimeType).toLowerCase() || "image/jpeg";
    const which = (msg: string) =>
      raw.length > 1 ? `Page ${i + 1}: ${msg}` : `${msg[0]!.toUpperCase()}${msg.slice(1)}`;
    if (!base64) return which("the photo is empty");
    if (!IMAGE_TYPES.has(mimeType)) return which("send a JPG or PNG photo");
    if (base64.length > HOMEWORK_PAGE_MAX_BASE64) return which("the photo is too large — retake it");
    images.push({ base64, mimeType });
  }
  return { classId, sectionId, subjectId, language, images };
}

/**
 * What goes into ai_generations instead of the photo: its shape, never its
 * bytes. A book page is not personal data, but a hash of megabytes of
 * base64 is useless to anyone reading the audit row.
 */
export function homeworkPageAuditDescriptor(input: {
  classLabel: string;
  subjectLabel: string;
  language: HomeworkPageLanguage;
  images: { base64: string; mimeType: string }[];
}): string {
  const pages = input.images
    .map((im, i) => `page ${i + 1}: ${im.mimeType}, ~${Math.round((im.base64.length * 3) / 4 / 1024)} kB`)
    .join("; ");
  return `homework page scan — ${input.classLabel} · ${input.subjectLabel} · ${input.language} · ${pages}`;
}

/* ── prompt ─────────────────────────────────────────────────────── */

export function buildHomeworkPageScanSystem(language: HomeworkPageLanguage): string {
  const lang = language === "hi" ? "simple Hindi (Devanagari)" : "simple English";
  return [
    "You read a photograph of a school textbook or workbook page that a teacher wants to set as homework.",
    "Report ONLY what is printed and legible on the page. Never guess a number, never complete a question you cannot read, never add a question that is not printed.",
    "transcript: copy, exactly as printed, the lines you used — the chapter heading, the exercise heading, the page number and the questions. Keep the page's own numbering and language. At most about 2500 characters.",
    "pageNumber: the printed page number, or \"\" if none is visible.",
    "chapterHeading: the chapter or lesson heading as printed, or \"\" if none is visible.",
    "exercise: the exercise label as printed (e.g. \"5.2\", \"3\", \"A\"), without the word Exercise, or \"\" if the page prints none.",
    "questions: every question or activity printed in that exercise, in order, as {\"number\": as printed, \"text\": the question, shortened to at most 160 characters}. If a question has no number, leave number \"\".",
    `instruction: ONE short sentence in ${lang} telling the student what to do with these questions (e.g. write the answers in the homework notebook). No numbers, no due date, no praise.`,
    "If the photo is not a textbook page, or is too blurred, dark or cut off to read, set readable to false and say why in unreadableReason (in simple English). Do not fill any other field then.",
    'Respond with JSON only: {"readable":true,"unreadableReason":"","transcript":"","pageNumber":"","chapterHeading":"","exercise":"","questions":[{"number":"","text":""}],"instruction":""}',
  ].join("\n");
}

export function buildHomeworkPageScanPrompt(f: {
  classLabel: string;
  subjectLabel: string;
  language: HomeworkPageLanguage;
  pageCount: number;
}): string {
  return [
    `Class: ${f.classLabel}`,
    `Subject: ${f.subjectLabel}`,
    `Instruction language: ${f.language === "hi" ? "Hindi" : "English"}`,
    f.pageCount > 1
      ? `${f.pageCount} photos, in order — one exercise may run from one onto the next.`
      : "One photo.",
    "Read the page and return the JSON.",
  ].join("\n");
}

/* ── the model's reply, checked ─────────────────────────────────── */

export type HomeworkPageQuestion = { number: string; text: string };

export type HomeworkPageReading =
  | { readable: false; reason: string }
  | {
      readable: true;
      transcript: string;
      pageNumber: string;
      chapterHeading: string;
      exercise: string;
      questions: HomeworkPageQuestion[];
      instruction: string;
      /** What the model reported but the page's own text did not bear out — told to the teacher. */
      dropped: string[];
    };

/** Devanagari digits, which Hindi-medium books print: "प्रश्न ३". */
function westernDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

function norm(s: string): string {
  return westernDigits(String(s || ""))
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Is this label printed in the transcript as a label of its own?
 * "5.2" must not be found inside "15.25", nor "1" inside "12".
 */
export function labelInTranscript(label: string, transcript: string): boolean {
  const l = norm(label).replace(/\.$/, "");
  if (!l) return false;
  // Before the label: a boundary, or a "Q"/"Q." prefix ("Q1.", "Q.1") —
  // but not a dot, so "2" is not found inside "5.2". After it: no letter or
  // digit, and no ".digit", so "15" is not found inside "15.25".
  const re = new RegExp(
    `(?:^|[^\\p{L}\\p{M}\\p{N}.]|(?:^|[^\\p{L}])q\\.?)${escapeRe(l)}(?![\\p{L}\\p{M}\\p{N}]|\\.[\\p{N}])`,
    "u",
  );
  return re.test(norm(transcript));
}

const UNREADABLE_DEFAULT = "The page could not be read";

export function parseHomeworkPageReading(text: string): HomeworkPageReading | null {
  let raw: unknown;
  try {
    raw = JSON.parse(String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const clean = (v: unknown, max: number) =>
    typeof v === "string" || typeof v === "number"
      ? String(v).replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max)
      : "";

  if (o.readable === false) {
    return { readable: false, reason: clean(o.unreadableReason, 200) || UNREADABLE_DEFAULT };
  }

  const transcript = clean(o.transcript, 4000);
  // No transcript means nothing below can be checked — and an unchecked
  // reading is exactly what this file exists to refuse.
  if (!transcript) {
    return { readable: false, reason: "Nothing legible was found on the page" };
  }

  const dropped: string[] = [];

  let pageNumber = clean(o.pageNumber, 12).replace(/^(?:page|pg|p|पृष्ठ)\.?\s*/i, "");
  if (pageNumber && !labelInTranscript(pageNumber, transcript)) {
    dropped.push(`page ${pageNumber}`);
    pageNumber = "";
  }

  let exercise = clean(o.exercise, 20).replace(/^(?:exercise|ex|अभ्यास)\.?\s*/i, "");
  if (exercise && !labelInTranscript(exercise, transcript)) {
    dropped.push(`exercise ${exercise}`);
    exercise = "";
  }

  let chapterHeading = clean(o.chapterHeading, 120);
  if (chapterHeading && !norm(transcript).includes(norm(chapterHeading))) {
    dropped.push(`chapter heading "${chapterHeading}"`);
    chapterHeading = "";
  }

  const questions: HomeworkPageQuestion[] = [];
  const seen = new Set<string>();
  const rawQuestions = Array.isArray(o.questions) ? o.questions : [];
  for (const q of rawQuestions) {
    if (questions.length >= HOMEWORK_PAGE_MAX_QUESTIONS) break;
    const qo = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
    const number = clean(qo.number, 12).replace(/^(?:q|qn|question|प्रश्न)\.?\s*/i, "").replace(/[.)]$/, "");
    const qText = clean(qo.text, 160);
    if (!qText) continue;
    if (number && !labelInTranscript(number, transcript)) {
      dropped.push(`question ${number}`);
      continue;
    }
    const key = number ? `n:${norm(number)}` : `t:${norm(qText)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push({ number, text: qText });
  }

  // The instruction is the model's own sentence, so it may carry no number
  // at all that the page did not print — "do 12 questions" on a page of
  // eight is precisely the invention this refuses.
  let instruction = clean(o.instruction, 200);
  const digits = westernDigits(instruction).match(/\d+(?:\.\d+)?/g) ?? [];
  if (digits.some((d) => !labelInTranscript(d, transcript))) {
    instruction = "";
  }

  if (!questions.length && !exercise && !chapterHeading) {
    return { readable: false, reason: "No exercise or questions could be found on the page" };
  }
  return { readable: true, transcript, pageNumber, chapterHeading, exercise, questions, instruction, dropped };
}

/* ── the draft for the homework form ────────────────────────────── */

/** ["1","2","3","5"] → "1–3, 5". Anything not a plain number is listed as printed. */
export function compactQuestionNumbers(numbers: string[]): string {
  const labels = numbers.map((n) => n.trim()).filter(Boolean);
  if (!labels.length) return "";
  if (!labels.every((n) => /^\d{1,3}$/.test(westernDigits(n)))) return labels.join(", ");
  const nums = [...new Set(labels.map((n) => Number(westernDigits(n))))].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = nums[0]!;
  let prev = start;
  for (const n of [...nums.slice(1), Number.NaN]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? String(start) : prev === start + 1 ? `${start}, ${prev}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(", ");
}

export type HomeworkPageDraft = { title: string; body: string };

/**
 * The homework text, built from the checked reading and the questions the
 * teacher kept ticked. Everything named comes from the page; a missing
 * field is left out, never filled with a placeholder that reads like fact.
 */
export function renderHomeworkFromPage(input: {
  reading: Extract<HomeworkPageReading, { readable: true }>;
  /** Indexes into reading.questions that the teacher kept. */
  selected: number[];
  language: HomeworkPageLanguage;
  subjectLabel: string;
}): HomeworkPageDraft {
  const { reading, language } = input;
  const hi = language === "hi";
  const kept = input.selected
    .filter((i) => i >= 0 && i < reading.questions.length)
    .sort((a, b) => a - b)
    .map((i) => reading.questions[i]!);
  const allKept = kept.length === reading.questions.length;

  const where = [
    reading.exercise ? (hi ? `अभ्यास ${reading.exercise}` : `Exercise ${reading.exercise}`) : "",
    reading.pageNumber ? (hi ? `पृष्ठ ${reading.pageNumber}` : `page ${reading.pageNumber}`) : "",
  ].filter(Boolean);
  const numbered = kept.filter((q) => q.number).map((q) => q.number);
  const range = compactQuestionNumbers(numbered);

  const lines: string[] = [];
  if (reading.chapterHeading) lines.push(hi ? `पाठ: ${reading.chapterHeading}` : `Chapter: ${reading.chapterHeading}`);
  if (where.length) lines.push(where.join(", "));
  if (kept.length) {
    if (range && numbered.length === kept.length) {
      lines.push(
        allKept
          ? hi ? `सभी प्रश्न (${range})` : `All questions (${range})`
          : hi ? `प्रश्न: ${range}` : `Questions: ${range}`,
      );
    }
    const quoted = kept.slice(0, HOMEWORK_PAGE_QUOTED_QUESTIONS);
    for (const q of quoted) lines.push(q.number ? `${q.number}. ${q.text}` : `• ${q.text}`);
    if (kept.length > quoted.length) {
      lines.push(hi ? `…और ${kept.length - quoted.length} प्रश्न` : `…and ${kept.length - quoted.length} more`);
    }
  }
  lines.push(
    reading.instruction ||
      (hi ? "ये प्रश्न गृहकार्य की कॉपी में करें।" : "Do these in your homework notebook."),
  );

  const titleBits = [
    input.subjectLabel,
    reading.exercise ? (hi ? `अभ्यास ${reading.exercise}` : `Exercise ${reading.exercise}`) : reading.chapterHeading,
  ].filter(Boolean);
  const qBit = range && !allKept ? (hi ? ` · प्र. ${range}` : ` · Q ${range}`) : "";
  return { title: `${titleBits.join(" — ")}${qBit}`.slice(0, 80), body: lines.join("\n") };
}

/**
 * The line the teacher reads when the reading dropped something — so a
 * page number that vanished from the draft is a known gap, not a surprise.
 */
export function droppedNote(dropped: string[]): string {
  if (!dropped.length) return "";
  const list = dropped.slice(0, 6).join(", ");
  return `Left out — not found in the text read from the page: ${list}${dropped.length > 6 ? "…" : ""}. Add them yourself if they are right.`;
}
