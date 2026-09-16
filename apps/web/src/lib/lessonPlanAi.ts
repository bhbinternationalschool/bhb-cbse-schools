/**
 * AI lesson-plan drafting — pure helpers shared by the Lesson plans editor
 * (which assembles the facts from the syllabus units the teacher ticked)
 * and the server route (which turns them into a prompt and parses the
 * reply).
 *
 * Design rules — same as report remarks:
 *  - The model sees only what is in `LessonPlanAiInput`: class label,
 *    subject, the ticked chapters/topics with their learning outcomes,
 *    period count and whatever the teacher already typed. No student data,
 *    no ids.
 *  - Nothing is saved by the route. The draft lands in the editor; the
 *    teacher edits and saves, and `LessonPlan.source` records whether the
 *    saved plan was AI-drafted, AI-drafted-then-edited, or typed.
 *  - Missing learning outcomes are passed as absent — the model is told to
 *    derive them from the chapter title, not to invent CBSE codes.
 *  - The class's current NCERT books for the subject, when the DIKSHA
 *    chapter index has them, are added by the server (never by the client)
 *    so the plan can follow the real chapter and name it. Without that list
 *    the prompt says the edition is unknown, as before.
 */

export type LessonPlanLanguage = "en" | "hi";

export type LessonPlanUnitFact = {
  /** "chapter" | "topic" */
  level: string;
  /** School's own label — "Ch 3", "" if unnumbered */
  code: string;
  title: string;
  /** Free text, one outcome per line; "" if the plan has none */
  learningOutcomes: string;
  /** Periods the year plan allots; 0 = not estimated */
  plannedPeriods: number;
};

export type LessonPlanAiInput = {
  classLabel: string;
  subjectName: string;
  units: LessonPlanUnitFact[];
  /** Periods this lesson should span */
  periods: number;
  language: LessonPlanLanguage;
  /** What the teacher already typed — the model refines, never contradicts */
  existing: {
    title: string;
    objectives: string;
    teachingAids: string;
    activities: string;
    assessment: string;
    homework: string;
  };
  /** Free instruction from the teacher, e.g. "focus on word problems" */
  teacherNote: string;
};

export type LessonPlanDraft = {
  title: string;
  objectives: string;
  teachingAids: string;
  activities: string;
  assessment: string;
  homework: string;
};

/** A lesson can't sensibly cover more than this many syllabus nodes. */
export const LESSON_PLAN_MAX_UNITS = 12;
export const LESSON_PLAN_MAX_PERIODS = 20;

const PERIOD_MINUTES = 40;

export function buildLessonPlanSystemPrompt(opts: {
  language: LessonPlanLanguage;
  schoolName: string;
  /** The NCERT list for the class and subject, built on the server; "" when there is none. */
  textbooks?: string;
  /**
   * "chapters" (Classes 1–8: textbooksListing) or "outcomes" (Nursery–UKG:
   * NCERT's learning outcomes as a minimum, outcomesListing). Chapters when
   * omitted.
   */
  textbooksKind?: "chapters" | "outcomes";
}): string {
  const textbooks = (opts.textbooks ?? "").trim();
  const outcomes = !!textbooks && opts.textbooksKind === "outcomes";
  const lang =
    opts.language === "hi"
      ? "Write every field in Hindi (Devanagari script). Keep subject-specific technical terms in their standard Hindi form and put the English term in brackets the first time it appears."
      : "Write in clear, plain English suitable for an Indian CBSE school teacher.";
  const homework = outcomes
    ? "Homework: 1–2 lines — a short play activity a parent can do with the child at home in 10–15 minutes (everyday objects, a song, drawing, a game), no written drills."
    : textbooks
      ? 'Homework: 1–3 lines, doable in 20–30 minutes. Refer to the textbook by book and chapter as listed ("questions at the end of <book>, Chapter <number>"), never by page or exercise number.'
      : 'Homework: 1–3 lines, doable in 20–30 minutes, referring to the textbook generically ("exercise questions on …") since the edition is unknown.';
  // Pre-primary: the school's own publisher books are the syllabus; NCERT's
  // outcomes are the floor the director set, never the ceiling, and there
  // are no NCERT chapters to cite.
  const grounding = outcomes
    ? `
- Pre-primary: the school teaches from its own publisher books. NCERT's learning outcomes for this year, listed at the end, are the minimum a child should reach — not the syllabus and not a ceiling. Plan play-based, hands-on activities (objects, songs, stories, drawing, movement) for what the ticked units ask, building towards the outcomes they touch; where the unit goes beyond them, follow the unit. Name the outcome in plain words in an objective when one clearly fits — never an outcome code, and never an NCERT book or chapter: pre-primary has none.`
    : textbooks
      ? `
- Textbooks: the school uses the current NCERT books listed at the end. Plan within the chapter the ticked units belong to and use that chapter's own words for things. When the match is clear, begin the title with the book and chapter ("<book>, Ch <number> — <topic>"). The school's unit titles can come from an older NCERT edition: if a ticked unit matches none of the listed chapters, plan it from its title and name no chapter. Never name a book, chapter or chapter number that is not listed.`
      : "";
  // "Following the CBSE pattern", not "CBSE-affiliated": the school is
  // state-recognised for Nursery–VIII and teaches from NCERT books.
  return `You draft lesson plans for teachers at ${opts.schoolName}, an Indian school following the CBSE pattern and NCERT textbooks. One period is ${PERIOD_MINUTES} minutes.

${lang}

Rules:
- Ground the plan in the chapters/topics and learning outcomes given. If no outcomes are given for a unit, derive sensible ones from its title at the level of the class; do not invent CBSE competency codes or textbook page numbers.${grounding}
- Objectives: 3–5 lines, each starting with a measurable verb (identify, explain, solve, compare, demonstrate…). One objective per line.
- Teaching aids: a short comma-separated list of things a real classroom has (board, chart, model, lab kit, smart-board slide, textbook exercise) — no expensive or unusual equipment unless the topic requires it.
- Activities: a period-by-period sequence with minutes, e.g. "Period 1 — Recap (5 min): …". Total minutes per period must add up to ${PERIOD_MINUTES}. Include at least one student-active step (pair work, board work, quick experiment, discussion) per period.
- Assessment: how understanding is checked in class — 2–4 lines (oral questions, exit ticket, worksheet items, observation).
- ${homework}
- If the teacher already typed something in a field, keep its intent and improve it — do not replace it with something unrelated. If the teacher gave a note, follow it.
- Age-appropriate language for the class named. No student names, no marks.

Respond with JSON only, exactly this shape:
{"title":"…","objectives":"…","teachingAids":"…","activities":"…","assessment":"…","homework":"…"}
Use "\\n" for line breaks inside a field. Every key required, strings only.${textbooks ? `\n\n${textbooks}` : ""}`;
}

export function buildLessonPlanUserPrompt(input: LessonPlanAiInput): string {
  const lines: string[] = [];
  lines.push(`Class: ${input.classLabel || "(not given)"}`);
  lines.push(`Subject: ${input.subjectName || "(not given)"}`);
  lines.push(`Periods for this lesson: ${input.periods}`);
  lines.push("");
  lines.push("Covers:");
  if (input.units.length === 0) {
    lines.push("- (no chapter linked — plan from the title and note below)");
  }
  for (const u of input.units) {
    const head = `- [${u.level}] ${u.code ? `${u.code} · ` : ""}${u.title}${
      u.plannedPeriods > 0 ? ` (year plan: ${u.plannedPeriods} periods)` : ""
    }`;
    lines.push(head);
    const outcomes = u.learningOutcomes
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (outcomes.length === 0) {
      lines.push("    learning outcomes: (none recorded)");
    } else {
      for (const o of outcomes.slice(0, 12)) lines.push(`    outcome: ${o}`);
    }
  }
  const ex = input.existing;
  const typed = (
    [
      ["title", ex.title],
      ["objectives", ex.objectives],
      ["teachingAids", ex.teachingAids],
      ["activities", ex.activities],
      ["assessment", ex.assessment],
      ["homework", ex.homework],
    ] as const
  ).filter(([, v]) => v.trim());
  if (typed.length) {
    lines.push("");
    lines.push("Teacher has already typed (keep the intent, improve):");
    for (const [k, v] of typed) lines.push(`${k}: ${v.trim()}`);
  }
  if (input.teacherNote.trim()) {
    lines.push("");
    lines.push(`Teacher's note: ${input.teacherNote.trim()}`);
  }
  return lines.join("\n");
}

/** Parse the model's JSON. Null when it is not a usable draft. */
export function parseLessonPlanJson(text: string): LessonPlanDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (k: string, max: number) =>
    String(r[k] ?? "")
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, max);
  const draft: LessonPlanDraft = {
    title: s("title", 120),
    objectives: s("objectives", 1500),
    teachingAids: s("teachingAids", 600),
    activities: s("activities", 4000),
    assessment: s("assessment", 1200),
    homework: s("homework", 800),
  };
  // A draft with no objectives and no activities is not a lesson plan.
  if (!draft.objectives && !draft.activities) return null;
  return draft;
}

/** Sanitise a client payload into `LessonPlanAiInput`; null if unusable. */
export function cleanLessonPlanAiInput(raw: unknown): LessonPlanAiInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  const periodsRaw = Math.floor(num(r.periods));
  const periods = Number.isFinite(periodsRaw)
    ? Math.min(LESSON_PLAN_MAX_PERIODS, Math.max(1, periodsRaw))
    : 1;
  const units = Array.isArray(r.units)
    ? r.units
        .map((u) => {
          const x = (u ?? {}) as Record<string, unknown>;
          const title = str(x.title, 120);
          if (!title) return null;
          const pp = Math.floor(num(x.plannedPeriods));
          return {
            level: x.level === "topic" ? "topic" : "chapter",
            code: str(x.code, 20),
            title,
            learningOutcomes: str(x.learningOutcomes, 2000),
            plannedPeriods: Number.isFinite(pp) && pp > 0 ? pp : 0,
          };
        })
        .filter((u): u is NonNullable<typeof u> => !!u)
        .slice(0, LESSON_PLAN_MAX_UNITS)
    : [];
  const ex = (r.existing ?? {}) as Record<string, unknown>;
  const existing = {
    title: str(ex.title, 120),
    objectives: str(ex.objectives, 1500),
    teachingAids: str(ex.teachingAids, 600),
    activities: str(ex.activities, 4000),
    assessment: str(ex.assessment, 1200),
    homework: str(ex.homework, 800),
  };
  const subjectName = str(r.subjectName, 60);
  // Nothing to plan from: no subject, no units, no title, no note.
  if (!subjectName && units.length === 0 && !existing.title && !str(r.teacherNote, 1)) {
    return null;
  }
  return {
    classLabel: str(r.classLabel, 30),
    subjectName,
    units,
    periods,
    language: r.language === "hi" ? "hi" : "en",
    existing,
    teacherNote: str(r.teacherNote, 500),
  };
}
