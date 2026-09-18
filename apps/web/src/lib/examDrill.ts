/**
 * Revision drill for the paper a child sits next — ask, check, correct, again.
 *
 * The exam-eve message (lib/examEve.ts) already finds tomorrow's paper and
 * opens the tutor on it. What it then does is hand the chat model one
 * sentence — "ask 5 practice questions, say whether each answer is right" —
 * and hope. A chat model given that instruction loses count, accepts a wrong
 * answer as nearly right, drifts onto a different chapter, and stops when the
 * child says "ok". None of which anybody sees.
 *
 * So the loop lives HERE, on the server, and the model is used for the two
 * things only a model can do: write one question, and judge one answer. What
 * happens next is decided by this file, from a state the database holds.
 *
 * Two rules worth stating plainly, because a child reads the result the night
 * before a paper:
 *
 *   NOTHING IS ASKED FROM OUTSIDE WHAT THEY HAVE BEEN TAUGHT. No record in
 *   this ERP says which chapters a paper covers — the date sheet's notes
 *   describe the paper ("Maths — Oral & Written"), not the portion, and the
 *   Nucleus progress table is empty. Rather than guess, the drill ASKS the
 *   child how far the class has got, from the real chapter list of their own
 *   book, and never sets a question beyond it.
 *
 *   A WRONG ANSWER IS NEVER JUST "WRONG". It is answered with what went
 *   wrong and how to do it, and then a FRESH question on the same idea —
 *   repeating the identical question teaches a child to recall an answer,
 *   not to do the work.
 */

/* ── how far the class has got ───────────────────────────────────── */

export type DrillChapter = { position: number; name: string; topics: string[] };

/**
 * The question that grounds everything: which chapters are in the paper.
 *
 * Numbered, so the answer is one character. Capped, because a child does not
 * read a list of twenty at nine at night — the later chapters of a book are
 * not in a half-yearly anyway, and the cap is generous enough to say so.
 */
export const SCOPE_LIST_MAX = 12;

export function renderScopeQuestion(input: {
  childName: string;
  subjectLabel: string;
  paperLabel: string;
  chapters: DrillChapter[];
  hindi: boolean;
}): string {
  const list = input.chapters
    .slice(0, SCOPE_LIST_MAX)
    .map((c) => `${c.position}. ${c.name}`)
    .join("\n");
  return input.hindi
    ? `📚 ${input.childName}, कल *${input.paperLabel}* है।\n\nतैयारी शुरू करें? पहले बताइए — कक्षा में कहाँ तक पढ़ा है? आख़िरी अध्याय का नंबर भेजिए:\n\n${list}\n\n(नंबर लिखकर भेजें, जैसे *6*)`
    : `📚 ${input.childName}, tomorrow is *${input.paperLabel}*.\n\nShall we revise? First — how far has the class done? Send the number of the last chapter:\n\n${list}\n\n(just the number, like *6*)`;
}

/** "6", "chapter 6", "६" → 6. Anything else → null, and we ask again. */
export function parseScopeAnswer(text: string, maxPosition: number): number | null {
  const western = String(text || "").replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
  const m = /(\d{1,2})/.exec(western);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > maxPosition) return null;
  return n;
}

/* ── the drill's own state ───────────────────────────────────────── */

export type DrillVerdict = "right" | "close" | "wrong";

export type DrillAsked = {
  /** The question as the child read it. */
  question: string;
  /** The idea it tests, in a few words — so a re-ask stays on the same idea. */
  skill: string;
  chapterPosition: number;
  verdict?: DrillVerdict;
};

export type DrillPhase = "need_scope" | "asking" | "done";

export type DrillState = {
  studentId: string;
  subjectLabel: string;
  paperLabel: string;
  paperDate: string;
  /** Chapters 1..scope are fair game; 0 until the child says. */
  scope: number;
  phase: DrillPhase;
  asked: DrillAsked[];
  /** Consecutive right answers. The bar is STREAK_TO_FINISH. */
  streak: number;
  startedAt: string;
  endedAt?: string;
};

/**
 * "Till the student becomes perfect", made into something that can end.
 *
 * Three right in a row, because one is luck and two is a coin. And a ceiling
 * either way: a child who cannot get three in a row at ten at night needs
 * sleep and a teacher in the morning, not a fourteenth question. The drill
 * says so kindly and stops.
 */
export const STREAK_TO_FINISH = 3;
export const MAX_QUESTIONS = 12;

export function newDrill(input: {
  studentId: string;
  subjectLabel: string;
  paperLabel: string;
  paperDate: string;
  nowIso: string;
}): DrillState {
  return {
    studentId: input.studentId,
    subjectLabel: input.subjectLabel,
    paperLabel: input.paperLabel,
    paperDate: input.paperDate,
    scope: 0,
    phase: "need_scope",
    asked: [],
    streak: 0,
    startedAt: input.nowIso,
  };
}

export type DrillStep =
  | { kind: "ask_scope" }
  /** Write a question. `avoid` are questions already asked, `avoidSkills` the ideas already tested, `retrySkill` the one to re-teach. */
  | { kind: "ask_question"; retrySkill: string | null; avoid: string[]; avoidSkills: string[]; number: number }
  | { kind: "finish"; reason: "mastered" | "ceiling" };

/**
 * What to do next. Pure, and the only place the loop is decided.
 */
export function nextDrillStep(state: DrillState): DrillStep {
  if (state.phase === "need_scope" || state.scope < 1) return { kind: "ask_scope" };
  if (state.streak >= STREAK_TO_FINISH) return { kind: "finish", reason: "mastered" };
  if (state.asked.length >= MAX_QUESTIONS) return { kind: "finish", reason: "ceiling" };
  const last = state.asked[state.asked.length - 1];
  return {
    kind: "ask_question",
    // A wrong answer is followed by a NEW question on the same idea.
    retrySkill: last && last.verdict && last.verdict !== "right" ? last.skill : null,
    avoid: state.asked.map((a) => a.question),
    // Ideas already tested this session, so a drill covers the chapter
    // instead of asking antonyms five times.
    avoidSkills: [...new Set(state.asked.map((a) => a.skill).filter(Boolean))],
    number: state.asked.length + 1,
  };
}

/** Record how the child did, and move the streak. */
export function recordAnswer(state: DrillState, verdict: DrillVerdict): DrillState {
  const asked = [...state.asked];
  if (asked.length) asked[asked.length - 1] = { ...asked[asked.length - 1]!, verdict };
  // "Close" keeps the streak where it is: it is not a win, and treating it as
  // a loss would punish a child who had the method right and the arithmetic
  // wrong.
  const streak = verdict === "right" ? state.streak + 1 : verdict === "close" ? state.streak : 0;
  return { ...state, asked, streak };
}

export function drillScore(state: DrillState): { right: number; asked: number } {
  const marked = state.asked.filter((a) => a.verdict);
  return { right: marked.filter((a) => a.verdict === "right").length, asked: marked.length };
}

/* ── what the model is asked, and what it may answer ─────────────── */

export const DRILL_PROMPT_VERSION = "exam-drill/2026-09-18";

export const DRILL_QUESTION_SYSTEM = [
  "You set ONE revision question for a school child the evening before their exam. You are given the class, the subject, the chapters the class has actually covered, and what those chapters teach.",
  "Set the question ONLY from those chapters. Never from a later one, never from general knowledge of the subject: a question on something the class has not been taught, the night before a paper, does harm.",
  "One question, answerable in a sentence or a short working. No multi-part questions, no 'explain in detail'. A child answers this on a phone keypad.",
  // Measured failure, 18 Sep 2026: asked for Class III Hindi, the model
  // produced सकारात्मक, चिंता and जीवित — words an eight-year-old has not
  // met — and 'पानी' का विलोम, which has no answer at all. A child sitting
  // a paper tomorrow reads that as their own failure.
  "LEVEL IS NOT OPTIONAL. Use only words and numbers a child of THIS class meets in their own reader — everyday, concrete, the kind of example their textbook itself would use. Class 3 means an eight-year-old. If you would have to explain the words of the question before the child could attempt it, the question is wrong.",
  "Every question must have ONE clear short answer that a child of this class can actually give. Never ask for the opposite, the plural or the meaning of a word that has no clear one.",
  // Measured failure, same run: five questions in a row were all विलोम,
  // while the chapter also taught संज्ञा, वचन and क्रिया. Revision that
  // drills one idea five times is not revision.
  "COVER THE CHAPTER, not one corner of it. You are told which ideas have already been tested this session — pick a DIFFERENT one from the chapter's topics unless you are explicitly asked to revisit a skill.",
  "When a skill to revisit is given, set a different and EASIER question on that same idea — never repeat the question they just got wrong, and never make the second attempt harder than the first. They got it wrong; the next one is a way back in, not a second hurdle.",
  "skill: three or four words naming what the question tests, e.g. 'unitary method' or 'plural nouns'.",
  "Write the question in the language the child is being taught in, as the class and subject imply: a Hindi paper is asked in Hindi, a Sanskrit paper in Sanskrit, everything else in simple English.",
  'Respond with JSON only: {"question":"","skill":"","chapter":0}',
].join("\n");

export const DRILL_CHECK_SYSTEM = [
  "You mark one school child's answer to one revision question, the evening before their exam. You are given the question, the expected idea, the child's answer and their class.",
  "verdict: right | close | wrong. 'close' is the right method with a slip — an arithmetic error, a spelling, a missing unit. Do not mark a wrong method 'close' to be kind: the child sits the paper tomorrow.",
  "A blank, a shrug, 'I don't know', or an answer to a different question is 'wrong'.",
  "whatWentWrong (empty when right): ONE sentence naming the actual mistake, in plain words a child understands. Never 'incorrect' — say what they did.",
  "howToDoIt (empty when right): ONE or two short sentences showing the method, with the step they missed. Not the answer to a new question; the way to get this one.",
  "praise (right or close only): four or five words, specific to what they did well. No exclamation storms.",
  "Write in the same language the child answered in, or the question's language when their answer is too short to tell.",
  'Respond with JSON only: {"verdict":"right","whatWentWrong":"","howToDoIt":"","praise":""}',
].join("\n");

export type DrillQuestion = { question: string; skill: string; chapter: number };

export function buildQuestionPrompt(input: {
  className: string;
  subjectLabel: string;
  chapters: DrillChapter[];
  scope: number;
  retrySkill: string | null;
  avoid: string[];
  avoidSkills?: string[];
  number: number;
}): string {
  const inScope = input.chapters.filter((c) => c.position <= input.scope);
  const lines = [
    `Class: ${input.className}`,
    `Subject: ${input.subjectLabel}`,
    "Chapters the class has covered:",
    ...inScope.map((c) => `  ${c.position}. ${c.name}${c.topics.length ? ` — ${c.topics.slice(0, 4).join(", ")}` : ""}`),
    "",
    `This is question ${input.number} of the session.`,
  ];
  if (input.retrySkill) {
    lines.push(
      `They just got a question on "${input.retrySkill}" wrong. Set a DIFFERENT and EASIER question on that same idea.`,
    );
  } else if ((input.avoidSkills ?? []).length > 0) {
    lines.push(
      `Already tested this session: ${(input.avoidSkills ?? []).join(", ")}. Pick a different idea from the chapters above.`,
    );
  }
  if (input.avoid.length) {
    lines.push("", "Already asked — do not repeat any of these:", ...input.avoid.slice(-6).map((q) => `  - ${q}`));
  }
  return lines.join("\n");
}

export function parseDrillQuestion(text: string, scope: number): DrillQuestion | null {
  const o = safeJson(text);
  if (!o) return null;
  const question = clean(o.question, 400);
  const skill = clean(o.skill, 60);
  if (!question || !skill) return null;
  const chapter = Number(o.chapter);
  // A question the model attributes to a chapter beyond what the child has
  // been taught is refused outright rather than shown and apologised for.
  if (Number.isFinite(chapter) && chapter > scope) return null;
  return { question, skill, chapter: Number.isFinite(chapter) && chapter > 0 ? chapter : 0 };
}

export type DrillCheck = {
  verdict: DrillVerdict;
  whatWentWrong: string;
  howToDoIt: string;
  praise: string;
};

export function buildCheckPrompt(input: {
  className: string;
  subjectLabel: string;
  question: string;
  skill: string;
  answer: string;
}): string {
  return [
    `Class: ${input.className}`,
    `Subject: ${input.subjectLabel}`,
    `Question: ${input.question}`,
    `What it tests: ${input.skill}`,
    "",
    "The child answered:",
    input.answer,
  ].join("\n");
}

export function parseDrillCheck(text: string): DrillCheck | null {
  const o = safeJson(text);
  if (!o) return null;
  const v = clean(o.verdict, 12).toLowerCase();
  const verdict: DrillVerdict = v === "right" ? "right" : v === "close" ? "close" : "wrong";
  const whatWentWrong = clean(o.whatWentWrong, 300);
  const howToDoIt = clean(o.howToDoIt, 400);
  // A wrong answer with nothing said about it is the failure this whole
  // module exists to prevent, so it is not accepted as a reading.
  if (verdict !== "right" && !whatWentWrong && !howToDoIt) return null;
  return { verdict, whatWentWrong, howToDoIt, praise: clean(o.praise, 80) };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/* ── what the child reads ────────────────────────────────────────── */

export function renderQuestion(input: { number: number; question: string; hindi: boolean }): string {
  const head = input.hindi ? `प्रश्न ${input.number}` : `Question ${input.number}`;
  return `❓ *${head}*\n\n${input.question}`;
}

/**
 * The reply to an answer. Right: a word of praise and straight on. Wrong:
 * what went wrong, then how to do it — and only then the next question, so
 * the child reads the correction before being asked anything else.
 */
export function renderCheck(input: { check: DrillCheck; hindi: boolean }): string {
  const { check } = input;
  if (check.verdict === "right") {
    return `✅ ${check.praise || (input.hindi ? "बिलकुल सही।" : "That's right.")}`;
  }
  const head =
    check.verdict === "close"
      ? input.hindi
        ? "🟡 तरीका सही है, पर एक चूक रह गई।"
        : "🟡 Right method, one slip."
      : input.hindi
        ? "❌ यह सही नहीं है — देखिए क्यों:"
        : "❌ Not quite — here is why:";
  return [head, check.whatWentWrong ? `\n${check.whatWentWrong}` : "", check.howToDoIt ? `\n💡 ${check.howToDoIt}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function renderFinish(input: {
  state: DrillState;
  reason: "mastered" | "ceiling";
  hindi: boolean;
}): string {
  const { right, asked } = drillScore(input.state);
  const score = input.hindi ? `${asked} में से ${right} सही।` : `${right} right out of ${asked}.`;
  if (input.reason === "mastered") {
    return input.hindi
      ? `🎉 शाबाश! लगातार ${STREAK_TO_FINISH} सही — ${input.state.subjectLabel} की तैयारी अच्छी है। ${score}\n\nअब आराम कीजिए। कल के पेपर के लिए शुभकामनाएँ 🙏\n\nदोबारा अभ्यास के लिए *PRACTICE* लिखें।`
      : `🎉 Well done — ${STREAK_TO_FINISH} right in a row. ${input.state.subjectLabel} is in good shape. ${score}\n\nRest now. All the best for tomorrow 🙏\n\nSend *PRACTICE* any time to go again.`;
  }
  return input.hindi
    ? `🌙 आज इतना बहुत है। ${score}\n\nजो छूट गया है उसे कल सुबह शिक्षक से पूछ लीजिए — अभी सो जाइए, नींद सबसे ज़रूरी है 🙏\n\nदोबारा अभ्यास के लिए *PRACTICE* लिखें।`
    : `🌙 That is enough for tonight. ${score}\n\nAsk your teacher in the morning about what did not go well — sleep matters more now 🙏\n\nSend *PRACTICE* any time to go again.`;
}

/** The scope answer we could not read. Asked once more, never in a loop. */
export function renderScopeUnclear(hindi: boolean): string {
  return hindi
    ? "कृपया केवल अध्याय का नंबर भेजिए, जैसे *6*।"
    : "Please send just the chapter number, like *6*.";
}
