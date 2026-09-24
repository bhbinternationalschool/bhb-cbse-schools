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

import { subjectKeyFor } from "@/lib/tutorSyllabus";
import { whatsappFromMarkdown } from "@/lib/waMarkdown";

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
  /**
   * The paper is TODAY, not tomorrow — see `papersFromDate`: a tap before
   * 9 in the morning is about the paper that starts at 8:30 that day.
   */
  isToday: boolean;
}): string {
  const list = input.chapters
    .slice(0, SCOPE_LIST_MAX)
    .map((c) => `${c.position}. ${c.name}`)
    .join("\n");
  return input.hindi
    ? `📚 ${input.childName}, ${input.isToday ? "आज" : "कल"} *${input.paperLabel}* है।\n\nतैयारी शुरू करें? पहले बताइए — कक्षा में कहाँ तक पढ़ा है? आख़िरी अध्याय का नंबर भेजिए:\n\n${list}\n\n(नंबर लिखकर भेजें, जैसे *6*)`
    : `📚 ${input.childName}, ${input.isToday ? "today" : "tomorrow"} is *${input.paperLabel}*.\n\nShall we revise? First — how far has the class done? Send the number of the last chapter:\n\n${list}\n\n(just the number, like *6*)`;
}

/**
 * Devanagari, written in Latin letters, with the vowels dropped.
 *
 * A child answering on a phone types "Imandar balak", not "ईमानदार बालक" —
 * the Hindi keyboard is a setting most of them never turn on. Comparing the
 * consonant skeletons ("mndr blk") matches the two without needing a real
 * transliteration: vowels are exactly where transliteration disagrees with
 * itself (imandar / eemaandaar / imaandar are all the same word).
 */
const DEVA: Record<string, string> = {
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ए": "e", "ऐ": "ai",
  "ओ": "o", "औ": "au", "ऋ": "ri",
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "ळ": "l",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "े": "e", "ै": "ai",
  "ो": "o", "ौ": "au", "ृ": "ri", "ं": "n", "ँ": "n", "ः": "h",
  "्": "", "़": "",
};

function skeleton(text: string): string[] {
  const latin = String(text || "")
    .split("")
    .map((ch) => (ch in DEVA ? DEVA[ch]! : ch))
    .join("")
    .toLowerCase();
  return latin
    .split(/[^a-z0-9]+/)
    .map((w) => w.replace(/[aeiou]/g, ""))
    // One or two consonants ("ka", "hai", "the") carry no identity; they are
    // the words a child adds around the name, not the name.
    .filter((w) => w.length >= 2);
}

/** Every way a child says "all of it". */
// \b is defined on Latin letters only, so a Devanagari word can never be
// followed by one — the Hindi alternatives are matched without it.
const WHOLE_BOOK =
  /^\s*(?:(?:all|whole|full|complete|everything|poora|pura|sab|sabhi|sara)\b|सब|सभी|पूरा|पूरी|सारा|सारी|पूर्ण)/i;

export type ScopeReply =
  | { kind: "position"; position: number }
  /** Could not be read — ask once more, saying a name is fine too. */
  | { kind: "unclear" };

/**
 * How far the class has got, from whatever the child sent.
 *
 * WHY THIS IS NOT JUST A NUMBER (18 Sep 2026): the drill asked for "the
 * number of the last chapter" and refused everything else. A child answered
 * "Imandar balak" — the name of the chapter, in Latin letters — and was told
 * "कृपया केवल अध्याय का नंबर भेजिए". Nine of twelve drills that evening never
 * got past this question. The list is right there in the message; a child
 * reading it back by name has answered, and the drill must hear it.
 */
export function readScopeAnswer(text: string, chapters: DrillChapter[]): ScopeReply {
  const last = chapters.length ? chapters[chapters.length - 1]!.position : 0;
  if (last < 1) return { kind: "unclear" };
  const raw = String(text || "").trim();
  if (!raw) return { kind: "unclear" };

  // A number still wins: it is what the message asks for.
  const n = parseScopeAnswer(raw, last);
  if (n !== null) return { kind: "position", position: n };

  if (WHOLE_BOOK.test(raw)) return { kind: "position", position: last };

  // A name, in either script. The best overlap wins; a tie is unclear,
  // because guessing between two chapters sets questions from the wrong one.
  const said = skeleton(raw);
  if (!said.length) return { kind: "unclear" };
  let best: { position: number; score: number } | null = null;
  let tied = false;
  for (const c of chapters) {
    const name = skeleton(c.name);
    if (!name.length) continue;
    // Whole word, or one a real prefix of the other ("imandar" of
    // "imandarbalak"). NOT any substring: "hn" (हाँ) sits inside "chnd"
    // (चाँद), and a yes must never be read as chapter six.
    // A plural is the same word: "Role of computer" for "Roles of Computers"
    // (22 Sep 2026) otherwise tied with "Working of a Computer" on "of" and
    // "computer" alone, and a tie is read as no answer.
    const singular = (w: string) => (w.length >= 3 ? w.replace(/s$/, "") : w);
    const matched = said.filter((w) =>
      name.some(
        (t) =>
          t === w ||
          singular(t) === singular(w) ||
          (w.length >= 3 && t.startsWith(w)) ||
          (t.length >= 3 && w.startsWith(t)),
      ),
    );
    const hits = matched.length;
    // Two consonants can coincide; three are a word. Several short ones
    // agreeing is evidence too — "यह मेरा, यह मीत का" is five short words
    // and a child reading it back has still named the chapter.
    if (!hits || (hits < 2 && !matched.some((w) => w.length >= 3))) continue;
    // Both directions matter: "imandar" is half of "ईमानदार बालक", and
    // "imandar balak ch" is the whole of it plus noise.
    const score = hits / Math.max(said.length, name.length);
    if (!best || score > best.score) {
      best = { position: c.position, score };
      tied = false;
    } else if (score === best.score && c.position !== best.position) {
      tied = true;
    }
  }
  if (!best || tied || best.score < 0.5) return { kind: "unclear" };
  return { kind: "position", position: best.position };
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

/* ── what the child actually sent ────────────────────────────────── */

export type DrillReplyKind =
  /** An attempt at the question, right or wrong. */
  | "answer"
  /** "how?", "I don't know", "batao" — about THIS question. */
  | "help"
  /** A question of their own, about the subject — not an attempt at ours. */
  | "question"
  /** "bye", "बस", "so raha hoon" — the child is done for tonight. */
  | "stop"
  /** "ok", "ठीक है", a lone 🙏 — politeness, not an attempt at the question. */
  | "chatter"
  /** "Hello sir online registration" — a message to the school, for the ordinary bot. */
  | "school";

const HELP_RE =
  /^\s*(?:(?:help|hint|idk|dunno)\b)|don'?t know|do not know|no idea|kaise|kese|कैसे|समझ (?:नहीं|nahi)|samajh (?:nahi|nhi)|पता नहीं|pata nahi|nahi pata|pta nhi|nhi pta|nahi pta|नहीं आता|nahi aata|nhi aata|malum|maloom|मालूम|batao|बताओ|बताइए|बता दीजिए|sikha|सिखा|mushkil|मुश्किल/i;

/**
 * Asking us for the answer, in English.
 *
 * HELP_RE above has the Hindi forms — "batao", "बताइए" — and the English
 * "I don't know", but not a child who simply asks for it outright.
 *
 * 23 Sep 2026, 19:45 IST: MR. GHANSHYAM MAURYA's son RUDRA (VII) was asked
 * for the third angle of a triangle, wrote "Plz answer", and was told
 * "🟡 तरीका सही है, पर एक चूक रह गई" — *your method is right, one slip* —
 * about a method he had never shown. The drill already knows how to teach
 * instead of mark (renderCheck's askedForHelp); it just did not recognise
 * the ask. On 18 Sep "Ans que" was marked the same way.
 *
 * Narrow on purpose. A request needs a please, an imperative verb or a
 * question frame around the word: the answer "0,2,3,5,8 answer", which
 * MR. VINOD KUMAR GUPTA sent the same evening, is an ATTEMPT and is marked.
 */
const ASK_FOR_ANSWER_RE =
  /\b(?:plz|pls|please|kindly)\s+(?:me\s+)?(?:the\s+)?(?:ans(?:wer)?|solution|solve)\b|\b(?:ans(?:wer)?|solution)\s+(?:plz|pls|please)\b|\b(?:tell|give|send|show)\s+(?:me\s+)?(?:the\s+)?(?:ans(?:wer)?|solution)\b|\bwhat(?:'?s| is)\s+the\s+ans(?:wer)?\b|^\s*ans(?:wer)?\s+(?:que|ques|question|q)\b/i;

/**
 * A message to the SCHOOL, not an answer to our question.
 *
 * 21 Sep 2026: mid-drill, a parent wrote "Hello sir online registration" and
 * it was marked ❌ as a wrong answer to a question on pronouns. Messages
 * about the school's own business go to the ordinary bot; the question
 * waits for them.
 */
// Narrow on purpose: words a child could give as an ANSWER ("bus",
// "transport", "leave", "प्रवेश") are not here.
const SCHOOL_BUSINESS_RE =
  /\b(?:sir|madam|mam|ma'am|hello|registration|admission|fees?|dues|receipt|tc|holiday|chutti|marksheet|admit card|uniform|timetable|date ?sheet|payment)\b|फीस|रसीद|छुट्टी|एडमिशन|रजिस्ट्रेशन|रिज़ल्ट|रिजल्ट|सर जी|मैडम/i;

/**
 * Done for tonight — including the parent telling us where the child is.
 *
 * On 20 Sep 2026 a father wrote "बेटा कोचिंग गया है आएगा तो करेगा" — *he has
 * gone to coaching, he will do it when he gets back* — and the drill marked
 * it ❌ and explained the preposition he had got wrong. He had not got
 * anything wrong; he had told us his son was out. "Not now" belongs with
 * the good-nights: end kindly, never grade it.
 */
const STOP_RE =
  /^\s*(?:(?:bye|stop|quit|exit|enough|bas|khatam)\b)|bye ?bye|good ?night|shubh ratri|शुभ रात्रि|बंद कर|band kar|अब नहीं|ab nahi|nahi karna|नहीं करना|सो (?:रहा|रही|जा)|so raha|so rahi|रहने दो|rehne do|बस करो|kal karenge|कल करेंगे|^\s*बस\s*$|कोचिंग|coaching|आएगा तो|aayega to|आकर करेग|aakar kareg|अभी नहीं|abhi nahi|बाहर (?:गया|गयी|गई|है)|bahar (?:gaya|gayi|hai)/i;

/**
 * "ok", "ठीक है", a lone 🙏 — the parent acknowledging us.
 *
 * Deliberately narrow. "haan", "ji" and "yes" are NOT here: a drill question
 * can have yes for an answer, and reading a real attempt as small talk is
 * the worse mistake of the two.
 */
const ACK_RE =
  /^\s*(?:ok(?:ay)?|kk?|hmm+|thik ?hai|theek ?hai|thk|sahi hai|ठीक(?: है)?|अच्छा|accha|thanks?|thank ?you|dhanyavad|धन्यवाद|शुक्रिया|🙏|👍|✅|😊)[\s.!।]*$/i;

/**
 * A question word, in either language. Used ONLY together with the length
 * rule below — "क्या" alone is how half of Hindi's yes/no answers start.
 */
const ASKS_SOMETHING =
  /\b(what|why|how|which|when|where|who|whose|meaning|means|explain|define|difference)\b|\b(kya|kyu|kyun|kyon|kaun|kab|kahan|kahaan|matlab|arth|antar|kitna|kitne|samjhao|samjhaiye)\b|क्या|क्यों|कैसे|कौन|कब|कहाँ|कहां|किसे|किस|मतलब|अर्थ|समझाइए|समझाओ|बताइए|अंतर/i;

/**
 * Is the child asking something of their own, rather than answering ours?
 *
 * WHY (director, 19 Sep 2026): "when tutor asked question and if student is
 * asking any other question from class subject syllabus then should be get
 * right answer of their questions". Until now every reply was marked
 * against the question we had asked, so a child who paused to ask "समुच्चयबोधक
 * का मतलब क्या है?" was told they were wrong and moved on. The one moment a
 * child actually wants to learn something was the moment the drill refused
 * to teach.
 *
 * The length rule is what keeps this safe. An answer to a revision question
 * is a word or two — "चित्रकार", "सैनिक", "42". A question is a sentence.
 * So a short reply is always treated as an attempt, even if it contains a
 * question word, and only a longer one with a question mark or a question
 * word is treated as an ask.
 */
export function looksLikeOwnQuestion(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  // Two words cannot be a question and are very often the answer.
  if (words.length < 3) return false;
  const asksMark = /[?？]\s*$/.test(t);
  return asksMark || ASKS_SOMETHING.test(t);
}

/**
 * Keys pressed at random — a phone in a pocket, a toddler — not an attempt.
 *
 * 23 Sep 2026, 06:02 IST: "Tdhyhh fb hywu tb y, 475788" arrived on SHREYANSH's
 * open Computer question and was marked ❌ with "you typed random letters".
 * Nobody had tried to answer; the question is put back instead.
 *
 * Needs TWO signs together, because one alone is an ordinary answer: "CPU",
 * "RAM" and "rhythm" have no a/e/i/o/u, and "475788" is a number. The signs:
 * a long vowelless word that is not an abbreviation (not all capitals), a
 * digit run of four or more in a message that is also letters, and two or
 * more two-letter vowelless scraps ("fb", "tb").
 */
export function looksLikeKeyboardMash(text: string): boolean {
  const t = String(text || "").trim();
  if (!t || /[ऀ-ॿ]/.test(t)) return false;
  const tokens = t.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (tokens.length < 3) return false;
  const letterTokens = tokens.filter((w) => /[A-Za-z]/.test(w));
  const vowelless = (w: string) => /^[A-Za-z]+$/.test(w) && !/[aeiou]/i.test(w);
  let signs = 0;
  if (letterTokens.some((w) => w.length >= 4 && vowelless(w) && w !== w.toUpperCase())) signs += 1;
  if (letterTokens.length > 0 && tokens.some((w) => /^\d{4,}$/.test(w))) signs += 1;
  if (letterTokens.filter((w) => w.length === 2 && vowelless(w) && w !== w.toUpperCase()).length >= 2) signs += 1;
  return signs >= 2;
}

/**
 * Is this an answer at all?
 *
 * WHY (18 Sep 2026): a child who wrote "Lekin kaise" — *but how?* — was
 * marked ❌ and moved on to the next question, and a child who wrote
 * "Sorry 😔 bye bye" was told they had written an apology instead of an
 * answer and then asked question eight. Neither had got anything wrong.
 * One had asked for teaching, which is the whole point of the drill, and
 * the other had said good night.
 */
export function classifyDrillReply(text: string): DrillReplyKind {
  const t = String(text || "").trim();
  if (!t) return "help";
  if (STOP_RE.test(t)) return "stop";
  if (SCHOOL_BUSINESS_RE.test(t) && t.split(/\s+/).length >= 2) return "school";
  // "I don't know" is about OUR question, so it is help, not a new ask.
  if (HELP_RE.test(t) || ASK_FOR_ANSWER_RE.test(t)) return "help";
  if (ACK_RE.test(t)) return "chatter";
  // Random keys are not an attempt either: the question goes back, unmarked.
  if (looksLikeKeyboardMash(t)) return "chatter";
  if (looksLikeOwnQuestion(t)) return "question";
  return "answer";
}

/* ── the drill's own state ───────────────────────────────────────── */

export type DrillVerdict = "right" | "close" | "wrong";

export type DrillAsked = {
  /** The question as the child read it. */
  question: string;
  /** The same question in Hindi, for an English-medium paper (renderQuestion). */
  questionHi?: string;
  /** The idea it tests, in a few words — so a re-ask stays on the same idea. */
  skill: string;
  /**
   * The agreed micro-skill it was set from (a CASE component uuid), when the
   * model picked one off the menu — see lib/drillSkills.ts.
   *
   * Optional, and absent far more often than present: Classes 1–2, Science
   * and English have no components at all, and a chapter nobody has agreed
   * outcomes for has no menu. `skill` above stays the thing every reader
   * uses; this is what lets a wrong answer be walked back to the idea
   * underneath it, which a sentence the model wrote cannot be.
   */
  componentId?: string;
  chapterPosition: number;
  verdict?: DrillVerdict;
  /**
   * What the child typed, and what they were told about it.
   *
   * The verdict alone says a child got something wrong; it does not say what
   * they were taught, or whether the marking was fair. Reading back a
   * session without these is reading a scoreboard, not a lesson — and the
   * first thing anyone asks about a drill that upset a child is "what did it
   * actually say to them?".
   *
   * Capped, because this sits in a jsonb column that grows with every
   * question and nobody needs a thousand-word answer preserved.
   */
  answer?: string;
  whatWentWrong?: string;
  howToDoIt?: string;
  praise?: string;
  whatWentWrongHi?: string;
  howToDoItHi?: string;
  praiseHi?: string;
};

export const DRILL_ANSWER_MAX = 300;
export const DRILL_NOTE_MAX = 400;

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
  /** Their own questions, answered inside this drill (capped at MAX_ASIDES). */
  asides?: number;
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
/**
 * How many of their own questions get answered inside one drill.
 *
 * Generous, but not unlimited: the drill exists to get a child ready for a
 * paper tomorrow, and a night that becomes a free chat costs the school
 * money and the child their revision. Past this, the question is noted and
 * they are pointed at their teacher.
 */
export const MAX_ASIDES = 30;

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

/**
 * Has the paper this drill was for already been written?
 *
 * WHY (director, 21 Sep 2026): "if bot is stucked on any question in last
 * dated paper then it is not recognising yesterday paper and still demanding
 * earlier question answer which exam date has been passed". He was right.
 * `paperDate` was written once at the start and never read again, so a
 * session stayed open for ever. On the night of 20 Sep there were 31 of
 * them, every one pinned to the 19 Sep papers, and every one of those
 * children had a different paper coming: Science, Art Education, EVS.
 *
 * Worse, the trap baited itself. `openDrillFor` takes the most recently
 * touched open session, and each hijacked reply wrote the dead row back —
 * so the more a parent tried to escape it, the more firmly it held. A
 * mother tapping "अभ्यास शुरू करें" for her daughter's Science paper was
 * handed Friday's Hindi question, "'तारा' शब्द का बहुवचन रूप लिखिए", and
 * told she was wrong when she asked what was happening.
 *
 * The paper is written on its own morning, 8:30 to 11:30, and the drill ran
 * the evening before — so the drill is alive up to the moment the paper
 * starts, and dead from then on.
 *
 * WHY THE HOUR AND NOT JUST THE DATE (22 Sep 2026): SHIVANGI's drill was
 * opened at 23:03 on the 21st for her Maths paper on the 22nd. She never
 * sent a chapter number, so it sat at the chapter question. At 18:19 on the
 * 22nd — seven hours after that Maths paper had been handed in — her father
 * sent a voice note about the NEXT paper, "कल मेरा SST का paper है". The
 * drill was still counted as open, so it answered for the finished paper:
 *
 *   यह समझ नहीं आया 🙏 ऊपर की सूची में से अध्याय का *नंबर* भेजिए
 *
 * three times, and the question about the next paper never reached the bot
 * that could answer it.
 *
 * `istHour` defaults to 0, so a caller that knows only the date still gets
 * the old date-only answer rather than a guess about the time.
 *
 * An unparseable date is not a fact about the paper, so it is left alone
 * ([[erp-unknown-must-not-become-fact]]) — the ceiling and the finish
 * rules still end it.
 */
export function drillIsForAPastPaper(
  paperDate: string,
  todayIso: string,
  istHour = 0,
): boolean {
  const paper = String(paperDate || "").slice(0, 10);
  const today = String(todayIso || "").slice(0, 10);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(paper) || !iso.test(today)) return false;
  if (paper < today) return true;
  // Papers start at 8:30; 9 is the same cut-off the exam-eve message uses
  // to decide whether today's paper is still to come.
  return paper === today && istHour >= 9;
}

export type DrillStep =
  | { kind: "ask_scope" }
  /** Write a question. `avoid` are questions already asked, `avoidSkills` the ideas already tested, `retrySkill` the one to re-teach. */
  | {
      kind: "ask_question";
      retrySkill: string | null;
      /** The agreed micro-skill behind `retrySkill`, when there was one — the way in to its prerequisites. */
      retryComponentId: string | null;
      avoid: string[];
      avoidSkills: string[];
      /** Agreed micro-skills already tested this session, as stored ids. */
      askedComponentIds: string[];
      number: number;
    }
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
    // The same condition, so the hint about what is missing underneath can
    // never arrive for a question they actually got right.
    retryComponentId:
      last && last.verdict && last.verdict !== "right" ? (last.componentId ?? null) : null,
    avoid: state.asked.map((a) => a.question),
    // Ideas already tested this session, so a drill covers the chapter
    // instead of asking antonyms five times.
    avoidSkills: [...new Set(state.asked.map((a) => a.skill).filter(Boolean))],
    // The same thing said exactly: two questions on one idea are two names
    // for it in `avoidSkills` and one id here.
    askedComponentIds: [...new Set(state.asked.map((a) => a.componentId).filter((x): x is string => !!x))],
    number: state.asked.length + 1,
  };
}

/**
 * Record how the child did, and move the streak.
 *
 * `detail` is what they typed and what they were told — kept on the question
 * so a session can be read back as a lesson rather than a scoreboard.
 */
export function recordAnswer(
  state: DrillState,
  verdict: DrillVerdict,
  detail?: { answer?: string; check?: Pick<DrillCheck, "whatWentWrong" | "howToDoIt" | "praise" | "whatWentWrongHi" | "howToDoItHi" | "praiseHi"> },
): DrillState {
  const asked = [...state.asked];
  const cut = (v: string | undefined, max: number) =>
    (v || "").replace(/\s+/g, " ").trim().slice(0, max) || undefined;
  if (asked.length) {
    asked[asked.length - 1] = {
      ...asked[asked.length - 1]!,
      verdict,
      answer: cut(detail?.answer, DRILL_ANSWER_MAX),
      whatWentWrong: cut(detail?.check?.whatWentWrong, DRILL_NOTE_MAX),
      howToDoIt: cut(detail?.check?.howToDoIt, DRILL_NOTE_MAX),
      praise: cut(detail?.check?.praise, DRILL_NOTE_MAX),
      whatWentWrongHi: cut(detail?.check?.whatWentWrongHi, DRILL_NOTE_MAX),
      howToDoItHi: cut(detail?.check?.howToDoItHi, DRILL_NOTE_MAX),
      praiseHi: cut(detail?.check?.praiseHi, DRILL_NOTE_MAX),
    };
  }
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

// 19 Sep 2026: script no longer counts against an answer, and a child
// who asks instead of answering is taught rather than marked wrong.
export const DRILL_PROMPT_VERSION = "exam-drill/2026-09-22b";

/**
 * The language a paper is written in.
 *
 * WHY (director, 21 Sep 2026): the school is ENGLISH MEDIUM. Only the Hindi
 * paper (and Sanskrit) is written in Hindi. The drill was handed the
 * subject's Hindi display name ("विज्ञान") and a Hindi family, and set a
 * Science question in Hindi — then told the child "परीक्षा में उत्तर हिंदी
 * में लिखें" for a paper they will write in English. So the paper language
 * comes from what the subject IS, never from its display name or from the
 * family's language.
 */
export type PaperLanguage = "english" | "hindi" | "sanskrit";

export function paperLanguageFor(subjectLabel: string): PaperLanguage {
  const key = subjectKeyFor(subjectLabel);
  if (key === "hindi") return "hindi";
  if (key === "sanskrit") return "sanskrit";
  return "english";
}

const SUBJECT_NAME_EN: Record<string, string> = {
  maths: "Mathematics",
  science: "Science",
  social: "Social Science",
  evs: "Environmental Studies (EVS)",
  english: "English",
  gk: "General Knowledge",
  computer: "Computer",
  hindi: "Hindi",
  sanskrit: "Sanskrit",
  arts: "Art",
  pe: "Physical Education",
  vocational: "Vocational skills",
};

/** The subject as the model is told it: the English name, never "विज्ञान". */
export function subjectNameForModel(subjectLabel: string): string {
  const key = subjectKeyFor(subjectLabel);
  return (key && SUBJECT_NAME_EN[key]) || subjectLabel;
}

/** The instruction that fixes the language of the question and of the marking. */
export function paperLanguageRule(lang: PaperLanguage): string {
  if (lang === "hindi") {
    return "Paper language: HINDI. This is the Hindi paper: write the question and all marking in Hindi (Devanagari) only. Leave every *Hi field empty.";
  }
  if (lang === "sanskrit") {
    return "Paper language: SANSKRIT. Write the question in Sanskrit; write the marking in Hindi (Devanagari). Leave every *Hi field empty.";
  }
  return "Paper language: ENGLISH. The school is English medium and this paper is written in English. Write the question and the marking in simple English, and give the SAME text in simple Hindi (Devanagari) in the matching *Hi field for the parent — keep subject terms in English inside the Hindi, e.g. 'प्रकाश संश्लेषण (photosynthesis)'. NEVER tell the child to write anything in Hindi.";
}

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
  // The menu (lib/drillSkills.ts) is only present for chapters whose outcomes
  // a teacher has agreed with; most drills are given none and this rule then
  // has nothing to bite on.
  "skillRef: when you are given a numbered list of ideas this school has agreed are worth testing, and you set the question from one of them, put ITS NUMBER here. Copy the number exactly; never invent one. If the chapter you chose has no idea listed, or you set the question from the chapter's topics instead, skillRef is 0. Never change the question to fit a number.",
  "LANGUAGE — you are told the paper language below. The school is ENGLISH MEDIUM: every paper except Hindi and Sanskrit is taught and written in English, whatever language the subject's name or the chapters are given in. ENGLISH paper: `question` in simple English as the child's English-medium textbook words it, and `questionHi` the same question in simple Hindi for the parent. HINDI paper: `question` in Hindi, `questionHi` empty. SANSKRIT paper: `question` in Sanskrit, `questionHi` empty.",
  "skill is always in English.",
  'Respond with JSON only: {"question":"","questionHi":"","skill":"","chapter":0,"skillRef":0}',
].join("\n");

export const DRILL_CHECK_SYSTEM = [
  "You mark one school child's answer to one revision question, the evening before their exam. You are given the question, the expected idea, the child's answer and their class.",
  "verdict: right | close | wrong. 'close' is the right method with a slip — an arithmetic error, a spelling, a missing unit. Do not mark a wrong method 'close' to be kind: the child sits the paper tomorrow.",
  // Director, 21 Sep 2026: a question or request typed mid-practice was
  // marked a wrong answer to the pending question. It is not an answer.
  "FIRST decide whether the message is an ATTEMPT at this question at all. If it is not — a different question, a request, a greeting, something meant for the school, or anything unrelated — set notAnAnswer true and leave every other field empty: it is answered separately and nothing is marked. A real attempt, even one word and even wrong, is marked. A blank is 'wrong'.",
  // 18 Sep 2026: a child wrote "Darji" for दर्जी — the right answer, typed
  // on the Latin keyboard every family actually has — and was marked as
  // having made a mistake. Script is not the skill being tested.
  "SCRIPT AND LANGUAGE ARE NOT THE ANSWER. Mark the idea. A Hindi or Sanskrit answer typed in Latin letters — 'darji' for दर्जी — is the SAME answer: mark it 'right'. An ENGLISH-paper answer typed in Hindi or Hinglish ('red ho jayega') is marked on its idea too.",
  // 22 Sep 2026: "आघात वर्धनीयता" — malleability, the right answer, in
  // Hindi and slightly misspelt — was marked ❌ "You answered in Hindi
  // instead of English".
  "The Hindi NAME of the right term IS the right answer: आघातवर्धनीयता = malleability, तन्यता = ductility, प्रकाश संश्लेषण = photosynthesis. Mark it 'right' (a misspelling of it too), give the English term, and add the one line about writing it in English in the exam. Answering in Hindi is NEVER itself the mistake — never write 'you answered in Hindi' as whatWentWrong.",
  // 23 Sep 2026: ARNAV (VII) was asked for the largest 5-digit number from
  // 3,8,1,6,5 and wrote "8,6,5,3,1" — 86531, the right answer, with the
  // digits spaced out the way the question itself listed them. It was
  // marked 🟡 "You separated the digits with commas". So were his next two,
  // both also right. Three correct answers in a row told they were not.
  "HOW A NUMBER IS PUNCTUATED IS NOT THE ANSWER. 86531, 86,531 and 8,6,5,3,1 are the SAME number: mark the value. Separators, spaces, a trailing full stop, a missing leading zero in a date — none of these is the mistake, and 'you used commas' is NEVER whatWentWrong. Mark it 'right', and if it would lose a mark on the paper add the one short line about writing the digits joined up. The ONE exception is a question that is ITSELF about writing a number with commas or in place-value form — there the commas ARE the skill and are marked.",
  // 21 Sep 2026: a Science answer was followed by "परीक्षा में उत्तर हिंदी में
  // लिखें" — in an English-medium school.
  "WHICH LANGUAGE TO WRITE IN THE EXAM: only for a HINDI or SANSKRIT paper, when the child typed Latin letters, add one short line asking them to write it in Devanagari in the exam. For EVERY other paper NEVER tell the child to write in Hindi — the school is English medium; if they answered in Hindi or Hinglish, add one short line reminding them to write the answer in English in the exam.",
  // Same evening: a child who asked "but how?" was marked wrong and asked
  // the next question instead of being taught.
  "WHEN THE CHILD ASKS INSTEAD OF ANSWERING — you are told so — they have not got it wrong. verdict is 'close', whatWentWrong stays EMPTY, and howToDoIt teaches the idea and gives this question's answer plainly, so they can see how it is done.",
  "whatWentWrong (empty when right): ONE sentence naming the actual mistake, in plain words a child understands. Never 'incorrect' — say what they did.",
  "howToDoIt (empty when right): ONE or two short sentences showing the method, with the step they missed. Not the answer to a new question; the way to get this one.",
  "praise (right or close only): four or five words, specific to what they did well. No exclamation storms.",
  // 20 Sep 2026: a Hindi family was told, inside a Hindi frame, "You chose
  // 'won', which is the action verb, instead of the describing word." See
  // `familyLanguageRule` for why the old rule produced that.
  "LANGUAGE OF THE MARKING follows the paper language given below — never the family's phone, never what the child happened to type. ENGLISH paper: whatWentWrong, howToDoIt and praise in simple English, and the same in simple Hindi in whatWentWrongHi, howToDoItHi and praiseHi (empty where the English is empty). HINDI or SANSKRIT paper: Hindi only, every *Hi field empty.",
  "Words quoted FROM the question or FROM the child's answer stay exactly as they are — 'tall' is the adjective whichever language you explain that in. Quote them, do not translate them.",
  'Respond with JSON only: {"notAnAnswer":false,"verdict":"right","whatWentWrong":"","howToDoIt":"","praise":"","whatWentWrongHi":"","howToDoItHi":"","praiseHi":""}',
].join("\n");

export type DrillQuestion = {
  question: string;
  skill: string;
  chapter: number;
  /** Which numbered idea off the agreed menu it was set from; 0 for none. */
  skillRef: number;
  questionHi?: string;
};

export function buildQuestionPrompt(input: {
  className: string;
  subjectLabel: string;
  chapters: DrillChapter[];
  scope: number;
  retrySkill: string | null;
  avoid: string[];
  avoidSkills?: string[];
  number: number;
  /** The agreed micro-skills, already rendered (lib/drillSkills.ts). "" when there are none. */
  skillMenu?: string;
  /** Menu numbers already tested this session — the precise half of `avoidSkills`. */
  avoidRefs?: number[];
  /** What sits underneath the idea they just got wrong, already rendered. "" when unknown. */
  retryFoundation?: string;
}): string {
  const inScope = input.chapters.filter((c) => c.position <= input.scope);
  const lines = [
    `Class: ${input.className}`,
    `Subject: ${subjectNameForModel(input.subjectLabel)}`,
    paperLanguageRule(paperLanguageFor(input.subjectLabel)),
    "Chapters the class has covered:",
    ...inScope.map((c) => `  ${c.position}. ${c.name}${c.topics.length ? ` — ${c.topics.slice(0, 4).join(", ")}` : ""}`),
  ];
  // The agreed menu sits under the chapters it narrows, and is simply absent
  // when nothing has been agreed — which is the ordinary case and must leave
  // this prompt exactly as it was.
  if (input.skillMenu) lines.push("", input.skillMenu);
  lines.push("", `This is question ${input.number} of the session.`);
  if (input.retrySkill) {
    lines.push(
      `They just got a question on "${input.retrySkill}" wrong. Set a DIFFERENT and EASIER question on that same idea.`,
    );
    if (input.retryFoundation) lines.push(input.retryFoundation);
  } else if ((input.avoidSkills ?? []).length > 0) {
    lines.push(
      `Already tested this session: ${(input.avoidSkills ?? []).join(", ")}. Pick a different idea from the chapters above.`,
    );
    if ((input.avoidRefs ?? []).length > 0) {
      lines.push(
        `Ideas already used from the list above: ${(input.avoidRefs ?? []).map((n) => `[${n}]`).join(" ")}. Pick another.`,
      );
    }
  }
  if (input.avoid.length) {
    lines.push("", "Already asked — do not repeat any of these:", ...input.avoid.slice(-6).map((q) => `  - ${q}`));
  }
  return lines.join("\n");
}

/**
 * `menuSize` is how many agreed ideas the prompt actually listed. A skillRef
 * outside 1..menuSize is read as 0 rather than trusted: the number is used to
 * attribute the question to a stored component, and a wrong attribution
 * teaches the wrong prerequisite on the next wrong answer.
 */
export function parseDrillQuestion(text: string, scope: number, menuSize = 0): DrillQuestion | null {
  const o = safeJson(text);
  if (!o) return null;
  const question = clean(o.question, 400);
  const skill = clean(o.skill, 60);
  if (!question || !skill) return null;
  const chapter = Number(o.chapter);
  // A question the model attributes to a chapter beyond what the child has
  // been taught is refused outright rather than shown and apologised for.
  if (Number.isFinite(chapter) && chapter > scope) return null;
  const questionHi = clean(o.questionHi, 400);
  const ref = Number(o.skillRef);
  const skillRef = Number.isInteger(ref) && ref >= 1 && ref <= menuSize ? ref : 0;
  return {
    question,
    skill,
    chapter: Number.isFinite(chapter) && chapter > 0 ? chapter : 0,
    skillRef,
    ...(questionHi && questionHi !== question ? { questionHi } : {}),
  };
}

export type DrillCheck = {
  verdict: DrillVerdict;
  whatWentWrong: string;
  howToDoIt: string;
  praise: string;
  /** Not an attempt at the question at all — answer it, mark nothing. */
  notAnAnswer?: boolean;
  /** The same in Hindi, for an English-medium paper (empty for the Hindi paper). */
  whatWentWrongHi?: string;
  howToDoItHi?: string;
  praiseHi?: string;
};

export function buildCheckPrompt(input: {
  className: string;
  subjectLabel: string;
  question: string;
  skill: string;
  answer: string;
  /** The child asked for help rather than attempting it (classifyDrillReply). */
  askedForHelp?: boolean;
  /** The family's own language — whose phone this is read on. */
  hindi?: boolean;
}): string {
  return [
    `Class: ${input.className}`,
    `Subject: ${subjectNameForModel(input.subjectLabel)}`,
    paperLanguageRule(paperLanguageFor(input.subjectLabel)),
    `Question: ${input.question}`,
    `What it tests: ${input.skill}`,
    "",
    input.askedForHelp
      ? "The child did NOT attempt it. They asked for help, in these words — teach the idea and give the answer:"
      : "The child answered:",
    input.answer,
  ].join("\n");
}

export function parseDrillCheck(text: string): DrillCheck | null {
  const o = safeJson(text);
  if (!o) return null;
  if (o.notAnAnswer === true || o.notAnAnswer === "true") {
    return { verdict: "wrong", whatWentWrong: "", howToDoIt: "", praise: "", notAnAnswer: true };
  }
  const v = clean(o.verdict, 12).toLowerCase();
  const verdict: DrillVerdict = v === "right" ? "right" : v === "close" ? "close" : "wrong";
  const whatWentWrong = clean(o.whatWentWrong, 300);
  const howToDoIt = clean(o.howToDoIt, 400);
  // A wrong answer with nothing said about it is the failure this whole
  // module exists to prevent, so it is not accepted as a reading.
  if (verdict !== "right" && !whatWentWrong && !howToDoIt) return null;
  const hi = (k: string, max: number) => clean(o[k], max) || undefined;
  return {
    verdict,
    whatWentWrong,
    howToDoIt,
    praise: clean(o.praise, 80),
    ...(hi("whatWentWrongHi", 300) ? { whatWentWrongHi: hi("whatWentWrongHi", 300) } : {}),
    ...(hi("howToDoItHi", 400) ? { howToDoItHi: hi("howToDoItHi", 400) } : {}),
    ...(hi("praiseHi", 80) ? { praiseHi: hi("praiseHi", 80) } : {}),
  };
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

/**
 * The question as the child reads it. An English-medium paper's question
 * comes in English with the same question in Hindi below it for the parent
 * (the director's rule, 21 Sep 2026); the Hindi paper's comes in Hindi only.
 */
export function renderQuestion(input: { number: number; question: string; questionHi?: string; hindi: boolean }): string {
  const head = input.questionHi ? `Question ${input.number} / प्रश्न ${input.number}` : input.hindi ? `प्रश्न ${input.number}` : `Question ${input.number}`;
  return [`❓ *${head}*`, "", input.question, ...(input.questionHi ? ["", `🇮🇳 ${input.questionHi}`] : [])].join("\n");
}

/**
 * The reply to an answer. Right: a word of praise and straight on. Wrong:
 * what went wrong, then how to do it — and only then the next question, so
 * the child reads the correction before being asked anything else.
 */
export function renderCheck(input: {
  check: DrillCheck;
  hindi: boolean;
  /** They asked instead of answering: this is teaching, not marking. */
  askedForHelp?: boolean;
}): string {
  const { check } = input;
  const both = (en: string, hi?: string) => (hi && hi !== en ? `${en}\n${hi}` : en);
  if (check.verdict === "right") {
    return [
      `✅ ${both(check.praise || (check.praiseHi ? "That's right." : input.hindi ? "बिलकुल सही।" : "That's right."), check.praiseHi)}`,
      // Right, but written in the other script: said once, gently, and never
      // as a mark against the answer.
      check.howToDoIt ? `✍️ ${both(check.howToDoIt, check.howToDoItHi)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const head = input.askedForHelp
    ? input.hindi
      ? "🤝 कोई बात नहीं — ऐसे करते हैं:"
      : "🤝 No problem — here is how:"
    : check.verdict === "close"
      ? input.hindi
        ? "🟡 तरीका सही है, पर एक चूक रह गई।"
        : "🟡 Right method, one slip."
      : input.hindi
        ? "❌ यह सही नहीं है — देखिए क्यों:"
        : "❌ Not quite — here is why:";
  return [
    head,
    check.whatWentWrong ? `\n${both(check.whatWentWrong, check.whatWentWrongHi)}` : "",
    check.howToDoIt ? `\n💡 ${both(check.howToDoIt, check.howToDoItHi)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The invitation after a drill is mastered — and the marker that says the
 * next message may be a chapter for another round (isAnotherRoundInvite).
 *
 * 22 Sep 2026, 18:19 IST: MR. RAVI KUMAR PAL's son finished Computer with
 * three in a row, then sent "2" and "Role of computer" — chapter 2, "Roles
 * of Computers". The drill had closed, so "2" got the fees menu and the
 * chapter name got "इसकी जानकारी मेरे पास नहीं है".
 */
export const ANOTHER_ROUND_HI = "या और अभ्यास के लिए अध्याय का नंबर भेजिए";
export const ANOTHER_ROUND_EN = "or send a chapter number for another round";

/** Was this bot message the end of a drill that invited another round? */
export function isAnotherRoundInvite(botText: string | undefined): boolean {
  const t = botText || "";
  return t.includes(ANOTHER_ROUND_HI) || t.includes(ANOTHER_ROUND_EN);
}

export function renderFinish(input: {
  state: DrillState;
  reason: "mastered" | "ceiling" | "stopped";
  hindi: boolean;
}): string {
  const { right, asked } = drillScore(input.state);
  const score = input.hindi ? `${asked} में से ${right} सही।` : `${right} right out of ${asked}.`;
  // The child said good night. That is a decision, not a failure, and it is
  // answered with thanks rather than with question eight.
  if (input.reason === "stopped") {
    return input.hindi
      ? `👍 ठीक है, आज इतना ही। ${asked ? score + "\n\n" : ""}कल के पेपर के लिए शुभकामनाएँ 🙏 अच्छी नींद लीजिए।\n\nदोबारा अभ्यास के लिए *PRACTICE* लिखें।`
      : `👍 That's fine — we'll stop here. ${asked ? score + "\n\n" : ""}All the best for tomorrow 🙏 Sleep well.\n\nSend *PRACTICE* any time to go again.`;
  }
  if (input.reason === "mastered") {
    return input.hindi
      ? `🎉 शाबाश! लगातार ${STREAK_TO_FINISH} सही — ${input.state.subjectLabel} की तैयारी अच्छी है। ${score}\n\nअब आराम कीजिए। कल के पेपर के लिए शुभकामनाएँ 🙏\n\nदोबारा अभ्यास के लिए *PRACTICE* लिखें — ${ANOTHER_ROUND_HI}।`
      : `🎉 Well done — ${STREAK_TO_FINISH} right in a row. ${input.state.subjectLabel} is in good shape. ${score}\n\nRest now. All the best for tomorrow 🙏\n\nSend *PRACTICE* any time to go again — ${ANOTHER_ROUND_EN}.`;
  }
  return input.hindi
    ? `🌙 आज इतना बहुत है। ${score}\n\nजो छूट गया है उसे कल सुबह शिक्षक से पूछ लीजिए — अभी सो जाइए, नींद सबसे ज़रूरी है 🙏\n\nदोबारा अभ्यास के लिए *PRACTICE* लिखें।`
    : `🌙 That is enough for tonight. ${score}\n\nAsk your teacher in the morning about what did not go well — sleep matters more now 🙏\n\nSend *PRACTICE* any time to go again.`;
}

/**
 * The child's own question, answered, and then the drill's question put
 * back — so they can see where they were without scrolling.
 *
 * The answer is written by the chat model (homeworkTutor), so it arrives in
 * Markdown and has to be turned into WhatsApp's own formatting on the way
 * out — see lib/waMarkdown.ts. 23 Sep 2026, 21:27 IST: MR. VIKAL KUMAR GUPTA
 * asked mid-practice about a joystick and SHREYASH (Grade 1) was sent
 * "In **Click Code Connect Grade 1**, **Chapter 2: Parts of a Computer**".
 * The other way out of the tutor already converts; this one did not.
 */
export function renderAside(input: {
  answer: string;
  question: string;
  questionHi?: string;
  number: number;
  hindi: boolean;
}): string {
  return [
    whatsappFromMarkdown(input.answer),
    "",
    input.questionHi ? "— now back to the practice / अब वापस अभ्यास पर 👇" : input.hindi ? "— अब वापस अभ्यास पर 👇" : "— now back to the practice 👇",
    "",
    renderQuestion({ number: input.number, question: input.question, questionHi: input.questionHi, hindi: input.hindi }),
  ].join("\n");
}

/** When the model could not answer the child's own question. */
export function renderAsideFailed(hindi: boolean): string {
  return hindi
    ? "इस सवाल का जवाब अभी नहीं दे पा रहा 🙏 थोड़ी देर बाद फिर पूछिए। तब तक अभ्यास जारी रखें:"
    : "I could not answer that one just now 🙏 Please ask again in a little while. Meanwhile, back to the practice:";
}

/** The scope answer we could not read. Asked once more, never in a loop. */
export function renderScopeUnclear(hindi: boolean): string {
  return hindi
    ? "यह समझ नहीं आया 🙏 ऊपर की सूची में से अध्याय का *नंबर* भेजिए (जैसे *6*) — या अध्याय का *नाम* लिख दीजिए।"
    : "I did not follow that 🙏 Send the chapter *number* from the list above (like *6*) — or just type the chapter's *name*.";
}

/* ── videos to watch (director, 21 Sep 2026) ────────────────────── */

export type DrillVideo = { title: string; url: string };

/**
 * The one video after a wrong answer: the idea they missed, to watch
 * tonight. Nothing when no video was found — never a made-up link.
 */
export function renderTopicVideo(video: DrillVideo | null, hindi: boolean): string {
  if (!video) return "";
  return `📺 ${hindi ? "यह वीडियो देखिए / Watch this" : "Watch this"}: *${video.title}*\n${video.url}`;
}

/**
 * The whole portion, one video per chapter, at the end of the practice —
 * so the revision covers every chapter in the paper, not only the few ideas
 * the questions happened to touch.
 */
export function renderChapterVideos(rows: { chapter: string; video: DrillVideo | null }[], hindi: boolean, moreUrl: string): string {
  const found = rows.filter((r) => r.video);
  if (!found.length) return moreUrl ? `📺 ${hindi ? "पूरे पाठ के वीडियो / Chapter videos" : "Chapter videos"}: ${moreUrl}` : "";
  return [
    `📺 *${hindi ? "पूरे पाठ दोहराइए — हर पाठ का एक वीडियो / Revise every chapter" : "Revise every chapter — one video each"}*`,
    ...found.map((r) => `• ${r.chapter}: ${r.video!.url}`),
  ].join("\n");
}
