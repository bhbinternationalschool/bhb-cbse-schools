/**
 * Learning games — the rules, with no I/O (director's request, 15 Oct 2026).
 *
 * Everything that decides whether a child may play, what a game contains,
 * whether an answer is right and how many stars it earns lives here, so the
 * self-test (learningGames.selftest.ts) can pin it and the server
 * (learningGames.server.ts) only reads and writes rows.
 *
 * The rules the director set:
 *   - stars only for learning: a star per right answer (quiz), a star per two
 *     (number dash); no streaks, no loot, nothing to buy;
 *   - a daily allowance per child (default 30 minutes, school-settable);
 *   - no practice in school hours on a school day, unless it is a
 *     competition a teacher launched;
 *   - nothing after 9 pm (and nothing before 6 am) — competitions included;
 *   - leaderboards show a first name and a class, never a surname, phone or
 *     photo.
 * And the ones that make those rules real: the server holds the answers, the
 * score and the clock. A phone sends "I chose option 2 for question 3" and
 * nothing else it says about the score is read.
 */

// ── Kinds and settings ────────────────────────────────────────────────────

export type GameKind = "quiz" | "maths_speed";
export const GAME_KINDS: readonly GameKind[] = ["quiz", "maths_speed"];

export type GameSettings = {
  enabled: boolean;
  dailyMinutes: number;
  /** "HH:MM" IST. No play before. */
  playFrom: string;
  /** "HH:MM" IST; "24:00" = no evening cut-off. No play from this time on. */
  playUntil: string;
  schoolStart: string;
  schoolEnd: string;
  /** 0 = Sunday … 6 = Saturday. */
  schoolDays: number[];
};

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  enabled: true,
  dailyMinutes: 30,
  playFrom: "06:00",
  playUntil: "21:00",
  schoolStart: "08:00",
  schoolEnd: "14:30",
  schoolDays: [1, 2, 3, 4, 5, 6],
};

const HHMM = /^(\d{1,2}):(\d{2})$/;

/** "08:30" → 510; "24:00" → 1440; anything else → null. */
export function hhmmToMinutes(v: string): number | null {
  const m = HHMM.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (mm > 59) return null;
  if (h === 24 && mm === 0) return 1440;
  if (h > 23) return null;
  return h * 60 + mm;
}

function hhmm(v: unknown, fallback: string): string {
  const n = hhmmToMinutes(String(v ?? ""));
  if (n === null) return fallback;
  if (n === 1440) return "24:00";
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** Settings as stored or as posted, made safe. Unknown or broken fields keep the default. */
export function normalizeGameSettings(raw: Partial<Record<keyof GameSettings, unknown>> | null | undefined): GameSettings {
  const d = DEFAULT_GAME_SETTINGS;
  const r = raw ?? {};
  const minutes = Math.round(Number(r.dailyMinutes));
  const days = Array.isArray(r.schoolDays)
    ? [...new Set(r.schoolDays.map((x) => Math.round(Number(x))).filter((x) => x >= 0 && x <= 6))].sort()
    : d.schoolDays;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    dailyMinutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 240 ? minutes : d.dailyMinutes,
    playFrom: hhmm(r.playFrom, d.playFrom),
    playUntil: hhmm(r.playUntil, d.playUntil),
    schoolStart: hhmm(r.schoolStart, d.schoolStart),
    schoolEnd: hhmm(r.schoolEnd, d.schoolEnd),
    schoolDays: days,
  };
}

/** A settings form's problems, worded for the office; [] = fine. */
export function settingsProblems(s: GameSettings): string[] {
  const out: string[] = [];
  const from = hhmmToMinutes(s.playFrom)!;
  const until = hhmmToMinutes(s.playUntil)!;
  const start = hhmmToMinutes(s.schoolStart)!;
  const end = hhmmToMinutes(s.schoolEnd)!;
  if (until <= from) out.push("Play must end after it starts.");
  if (until > 21 * 60) out.push("Play may not run past 9 pm.");
  if (end <= start) out.push("School must end after it starts.");
  return out;
}

// ── India time ────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 330 * 60_000;

/** The IST calendar day, minute of the day and weekday (0 = Sunday) of an instant. */
export function istParts(ms: number): { date: string; minutes: number; weekday: number } {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** The IST day `n` days before `date` ("YYYY-MM-DD"). */
export function istDayBefore(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return new Date(t - n * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the IST week holding `ms`. */
export function istWeekStart(ms: number): string {
  const p = istParts(ms);
  const back = (p.weekday + 6) % 7;
  return istDayBefore(p.date, back);
}

// ── How long a game runs ──────────────────────────────────────────────────

export const QUIZ_DEFAULT_COUNT = 10;
export const QUIZ_MIN_COUNT = 3;
export const QUIZ_MAX_COUNT = 20;
/** Thinking time per quiz question; the session's deadline is count × this. */
export const QUIZ_SECONDS_PER_ITEM = 30;
export const MATHS_SPEED_SECONDS = 60;
export const MATHS_SPEED_ITEMS = 40;
/** Fewer seconds than this left is not a game: refused as "time is up for today". */
export const MIN_PLAY_SECONDS = 20;

export function gameLengthSeconds(game: GameKind, items: number): number {
  return game === "quiz" ? Math.max(1, items) * QUIZ_SECONDS_PER_ITEM : MATHS_SPEED_SECONDS;
}

// ── May this child play now? ──────────────────────────────────────────────

export type RefusalReason = "disabled" | "night" | "school_hours" | "daily_cap" | "competition_closed";

export type PlayVerdict =
  | { ok: true; allowSeconds: number }
  | { ok: false; reason: RefusalReason; message: string; messageHi: string };

const REFUSALS: Record<RefusalReason, { en: string; hi: string }> = {
  disabled: { en: "Games are switched off by the school.", hi: "स्कूल ने खेल अभी बंद रखे हैं।" },
  night: { en: "Games rest at night — come back in the morning.", hi: "रात में खेल बंद रहते हैं — सुबह फिर आइए।" },
  school_hours: {
    en: "It is school time. Practice games open after school (a competition your teacher starts can be played now).",
    hi: "अभी स्कूल का समय है। अभ्यास के खेल स्कूल के बाद खुलेंगे (शिक्षक की प्रतियोगिता अभी खेली जा सकती है)।",
  },
  daily_cap: { en: "Today's game time is used up. See you tomorrow!", hi: "आज के खेल का समय पूरा हुआ। कल फिर मिलेंगे!" },
  competition_closed: { en: "This competition is not open now.", hi: "यह प्रतियोगिता अभी खुली नहीं है।" },
};

function refuse(reason: RefusalReason): PlayVerdict {
  return { ok: false, reason, message: REFUSALS[reason].en, messageHi: REFUSALS[reason].hi };
}

export function refusalText(reason: RefusalReason): { en: string; hi: string } {
  return REFUSALS[reason];
}

/**
 * Whether a game may start now, and for how many seconds at most.
 *
 * Order: switched off → night (applies to everyone, competitions too) →
 * a competition: inside its window, not refused by school hours or the
 * allowance → practice: not in school hours on a school day, and only what
 * is left of today's allowance.
 *
 * `usedSecondsToday` is every minute played today, competitions included,
 * so a competition shortens the practice left — it is still time on a
 * screen.
 */
export function playVerdict(opts: {
  nowMs: number;
  settings: GameSettings;
  usedSecondsToday: number;
  gameSeconds: number;
  competition?: { opensAtMs: number; closesAtMs: number; cancelled?: boolean } | null;
}): PlayVerdict {
  const s = opts.settings;
  if (!s.enabled) return refuse("disabled");
  const p = istParts(opts.nowMs);
  const from = hhmmToMinutes(s.playFrom) ?? 360;
  const until = hhmmToMinutes(s.playUntil) ?? 1260;
  if (p.minutes < from || p.minutes >= until) return refuse("night");
  const secondsToNight = (until - p.minutes) * 60 - Math.floor(((opts.nowMs + IST_OFFSET_MS) % 60_000) / 1000);

  const c = opts.competition;
  if (c) {
    if (c.cancelled || opts.nowMs < c.opensAtMs || opts.nowMs >= c.closesAtMs) return refuse("competition_closed");
    const allow = Math.min(opts.gameSeconds, secondsToNight, Math.floor((c.closesAtMs - opts.nowMs) / 1000));
    return allow < MIN_PLAY_SECONDS ? refuse("competition_closed") : { ok: true, allowSeconds: allow };
  }

  const start = hhmmToMinutes(s.schoolStart) ?? 480;
  const end = hhmmToMinutes(s.schoolEnd) ?? 870;
  if (s.schoolDays.includes(p.weekday) && p.minutes >= start && p.minutes < end) return refuse("school_hours");

  const left = s.dailyMinutes * 60 - Math.max(0, Math.floor(opts.usedSecondsToday));
  const allow = Math.min(opts.gameSeconds, left, secondsToNight);
  if (left < MIN_PLAY_SECONDS) return refuse("daily_cap");
  if (allow < MIN_PLAY_SECONDS) return refuse(secondsToNight < left ? "night" : "daily_cap");
  return { ok: true, allowSeconds: allow };
}

/** Seconds a session has used: from its start to its end, or to now, never past its deadline. */
export function sessionSecondsUsed(s: { startedAtMs: number; deadlineAtMs: number; endedAtMs: number | null }, nowMs: number): number {
  const stop = Math.min(s.endedAtMs ?? nowMs, s.deadlineAtMs);
  return Math.max(0, Math.round((stop - s.startedAtMs) / 1000));
}

// ── Items ─────────────────────────────────────────────────────────────────

/** One question as the server keeps it. `answer` never leaves the server. */
export type GameItem = {
  prompt: string;
  options: string[];
  answer: number;
  /** Emoji / picture line shown big above the prompt (counting games). */
  picture?: string;
  /** game_questions.id, when it came from the pool. */
  qid?: string;
};

export type PublicGameItem = { prompt: string; options: string[]; picture?: string };

/** What a phone is sent: the question and its options, no answer. */
export function publicItems(items: GameItem[]): PublicGameItem[] {
  return items.map((it) => (it.picture ? { prompt: it.prompt, options: [...it.options], picture: it.picture } : { prompt: it.prompt, options: [...it.options] }));
}

/** Stored items read back: anything malformed is dropped, never repaired into a different question. */
export function readItems(raw: unknown): GameItem[] {
  if (!Array.isArray(raw)) return [];
  const out: GameItem[] = [];
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const options = Array.isArray(o.options) ? o.options.map((x) => String(x ?? "")) : [];
    const answer = Number(o.answer);
    if (typeof o.prompt !== "string" || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    const item: GameItem = { prompt: o.prompt, options, answer };
    if (typeof o.picture === "string" && o.picture) item.picture = o.picture;
    if (typeof o.qid === "string" && o.qid) item.qid = o.qid;
    out.push(item);
  }
  return out;
}

// ── Deterministic shuffles (a seed, so a test can reproduce a game) ────────

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffled<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** The item with its options in a new order, the answer following its option. True/False keep their order. */
export function shuffleOptions(item: GameItem, rnd: () => number): GameItem {
  if (item.options.length === 2 && isTrueFalse(item.options)) return item;
  const order = shuffled(
    item.options.map((_, i) => i),
    rnd,
  );
  return { ...item, options: order.map((i) => item.options[i]!), answer: order.indexOf(item.answer) };
}

function isTrueFalse(options: string[]): boolean {
  const o = options.map((x) => x.trim().toLowerCase());
  return (o[0] === "true" && o[1] === "false") || (o[0] === "सही" && o[1] === "गलत");
}

/** `count` questions from an approved pool, in a fresh order with shuffled options. */
export function pickQuizItems(
  pool: { id: string; prompt: string; options: string[]; answerIndex: number }[],
  count: number,
  seed: number,
): GameItem[] {
  const rnd = seededRandom(seed);
  return shuffled(pool, rnd)
    .slice(0, Math.max(0, count))
    .map((q) => shuffleOptions({ prompt: q.prompt, options: [...q.options], answer: q.answerIndex, qid: q.id }, rnd));
}

// ── Number dash (the brain game), by age ───────────────────────────────────

const COUNT_PICTURES = ["🍎", "⭐", "🐟", "🌸", "⚽", "🐥", "🍌", "🎈"];

function numberOptions(answer: number, rnd: () => number, spread: number, min = 0): string[] {
  const set = new Set<number>([answer]);
  let guard = 0;
  while (set.size < 4 && guard++ < 50) {
    const delta = 1 + Math.floor(rnd() * Math.max(2, spread));
    const v = rnd() < 0.5 ? answer - delta : answer + delta;
    if (v >= min) set.add(v);
  }
  for (let v = answer + 1; set.size < 4; v++) set.add(v);
  return shuffled([...set], rnd).map(String);
}

function item(prompt: string, answer: number, rnd: () => number, spread: number, picture?: string, min = 0): GameItem {
  const options = numberOptions(answer, rnd, spread, min);
  const it: GameItem = { prompt, options, answer: options.indexOf(String(answer)) };
  if (picture) it.picture = picture;
  return it;
}

/**
 * Number dash: as many as you can in a minute, pitched to the class.
 *   Nursery / LKG / UKG — count the pictures (1–5 / 1–7 / 1–10), a picture
 *     game: the question is the picture, not a sentence to read;
 *   Classes 1–2 — add and take away within 20;
 *   Classes 3–5 — within 100, and tables up to 10;
 *   Classes 6–8 — tables to 15, two-digit take-away, simple halves;
 *   Classes 9–12 — squares, mixed operations, negatives.
 * `hindi` words the counting prompt in Hindi; numbers are numbers.
 */
export function mathsSpeedItems(grade: number, seed: number, count = MATHS_SPEED_ITEMS, hindi = false): GameItem[] {
  const rnd = seededRandom(seed);
  const n = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const out: GameItem[] = [];
  for (let i = 0; i < count; i++) {
    if (grade <= 0) {
      const max = grade <= -2 ? 5 : grade === -1 ? 7 : 10;
      const k = n(1, max);
      const pic = COUNT_PICTURES[n(0, COUNT_PICTURES.length - 1)]!;
      out.push(item(hindi ? "कितने हैं?" : "How many?", k, rnd, 2, pic.repeat(k), 1));
    } else if (grade <= 2) {
      if (rnd() < 0.5) {
        const a = n(1, 10);
        const b = n(1, 10);
        out.push(item(`${a} + ${b} = ?`, a + b, rnd, 3));
      } else {
        const a = n(5, 20);
        const b = n(1, a);
        out.push(item(`${a} − ${b} = ?`, a - b, rnd, 3));
      }
    } else if (grade <= 5) {
      const r = rnd();
      if (r < 0.35) {
        const a = n(10, 60);
        const b = n(5, 39);
        out.push(item(`${a} + ${b} = ?`, a + b, rnd, 10));
      } else if (r < 0.65) {
        const a = n(30, 99);
        const b = n(5, a);
        out.push(item(`${a} − ${b} = ?`, a - b, rnd, 10));
      } else {
        const a = n(2, 10);
        const b = n(2, 10);
        out.push(item(`${a} × ${b} = ?`, a * b, rnd, Math.max(a, b)));
      }
    } else if (grade <= 8) {
      const r = rnd();
      if (r < 0.4) {
        const a = n(6, 15);
        const b = n(3, 12);
        out.push(item(`${a} × ${b} = ?`, a * b, rnd, Math.max(a, b)));
      } else if (r < 0.7) {
        const a = n(100, 999);
        const b = n(10, 99);
        out.push(item(`${a} − ${b} = ?`, a - b, rnd, 10));
      } else {
        const a = 2 * n(10, 250);
        out.push(item(`½ of ${a} = ?`, a / 2, rnd, 10));
      }
    } else {
      const r = rnd();
      if (r < 0.35) {
        const a = n(11, 25);
        out.push(item(`${a}² = ?`, a * a, rnd, 2 * a));
      } else if (r < 0.7) {
        const a = n(2, 12);
        const b = n(2, 12);
        const c = n(1, 30);
        out.push(item(`${a} × ${b} − ${c} = ?`, a * b - c, rnd, 10, undefined, -1000));
      } else {
        const a = n(-20, 20);
        const b = n(-20, 20);
        out.push(item(`(${a}) + (${b}) = ?`, a + b, rnd, 6, undefined, -1000));
      }
    }
  }
  return out;
}

// ── Answers, scores, stars ─────────────────────────────────────────────────

export type AnswerCheck =
  | { ok: true; correct: boolean; correctIndex: number }
  | { ok: false; code: "bad_index" | "bad_choice" | "time_up" | "finished"; message: string };

/** One answer, judged against the server's copy of the item. */
export function checkAnswer(opts: {
  items: GameItem[];
  index: number;
  choice: number;
  nowMs: number;
  deadlineAtMs: number;
  finished: boolean;
}): AnswerCheck {
  if (opts.finished) return { ok: false, code: "finished", message: "This game is over." };
  if (opts.nowMs > opts.deadlineAtMs) return { ok: false, code: "time_up", message: "Time is up for this game." };
  const it = Number.isInteger(opts.index) ? opts.items[opts.index] : undefined;
  if (!it) return { ok: false, code: "bad_index", message: "No such question in this game." };
  if (!Number.isInteger(opts.choice) || opts.choice < 0 || opts.choice >= it.options.length) {
    return { ok: false, code: "bad_choice", message: "No such option." };
  }
  return { ok: true, correct: opts.choice === it.answer, correctIndex: it.answer };
}

/**
 * The score, from the stored answers alone. An answer whose stored verdict
 * disagrees with the item (it cannot, unless a row was written by hand) is
 * re-judged against the item — the item is the truth.
 */
export function scoreAnswers(items: GameItem[], answers: { idx: number; chosen: number }[]): { answered: number; correct: number } {
  const seen = new Set<number>();
  let correct = 0;
  for (const a of answers) {
    const it = items[a.idx];
    if (!it || seen.has(a.idx)) continue;
    seen.add(a.idx);
    if (a.chosen === it.answer) correct++;
  }
  return { answered: seen.size, correct };
}

/** Stars: one per right answer in a quiz; one per two in number dash (it moves faster). */
export function starsFor(game: GameKind, correct: number): number {
  const c = Math.max(0, Math.floor(correct));
  return game === "quiz" ? c : Math.floor(c / 2);
}

// ── Classes, names ─────────────────────────────────────────────────────────

/** A class name → grade: Nursery -2, LKG -1, UKG 0, Class 1–12; null when it names none. */
export function gameGrade(className: string | undefined): number | null {
  const n = ` ${(className || "").toLowerCase()} `;
  if (/[^a-z](nursery|nur|play ?group|pre-?nursery)[^a-z]/.test(n)) return -2;
  if (/[^a-z]lkg[^a-z]/.test(n)) return -1;
  if (/[^a-z](ukg|kg)[^a-z]/.test(n)) return 0;
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  const m = n.match(/[^a-z0-9](xii|xi|ix|x|viii|vii|vi|iv|v|iii|ii|i|1[0-2]|[1-9])[^a-z0-9]/);
  if (!m) return null;
  return roman[m[1]!] ?? Number(m[1]);
}

/** "Aarav Kumar Singh" → "Aarav". Nothing else of a child's name reaches a leaderboard. */
export function firstName(fullName: string): string {
  const t = String(fullName ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")[0];
  return (t || "Player").slice(0, 24);
}

// ── Questions coming in ────────────────────────────────────────────────────

export type QuestionDraft = { prompt: string; options: string[]; answerIndex: number };

/** A question a teacher typed or the AI drafted, checked; a reason when it cannot be used. */
export function checkQuestionDraft(raw: Partial<QuestionDraft> | null | undefined): { ok: true; q: QuestionDraft } | { ok: false; reason: string } {
  const prompt = String(raw?.prompt ?? "").replace(/\s+/g, " ").trim();
  const options = Array.isArray(raw?.options) ? raw!.options.map((o) => String(o ?? "").replace(/\s+/g, " ").trim()) : [];
  const answerIndex = Number(raw?.answerIndex);
  if (!prompt) return { ok: false, reason: "no question" };
  if (prompt.length > 400) return { ok: false, reason: "question too long" };
  if (options.length < 2 || options.length > 4) return { ok: false, reason: "needs 2 to 4 options" };
  if (options.some((o) => !o || o.length > 120)) return { ok: false, reason: "an option is empty or too long" };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { ok: false, reason: "two options are the same" };
  if (options.some((o) => /^(all|none|both) of (the )?(above|these)$/i.test(o))) return { ok: false, reason: "'all/none of the above' cannot be shuffled" };
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) return { ok: false, reason: "the right answer is not one of the options" };
  return { ok: true, q: { prompt, options, answerIndex } };
}

/** "(i) ताप्ती", "a) Iron", "(B). Iron" → the option's own text. */
export function stripOptionLabel(s: string): string {
  return String(s ?? "")
    .replace(/^\s*\(?\s*([a-d]|i{1,3}|iv|[1-4])\s*[).:]\s*\.?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NEEDS_PICTURE = /\b(picture|pictures|figure|diagram|image|shown (above|below)|given (above|below)|observe the|look at the)\b|चित्र/i;
const HAS_DEVANAGARI = /[ऀ-ॿ]/;

/**
 * A question from an imported paper, as a game question — or null with the
 * reason. Only what can be played without the paper in hand:
 *   - multiple choice or true/false, with the publisher's key filled in;
 *   - the key names exactly ONE of the options (after "(i)", "a)" labels);
 *   - a question text, no pictures, and no "look at the picture" wording;
 *   - 2–4 options that are all different.
 * Anything else stays on paper. Nothing is repaired or guessed.
 */
export function gameQuestionFromPaper(q: {
  type?: string;
  text?: string;
  options?: string[];
  answerKey?: string;
  images?: unknown[];
}): { ok: true; q: QuestionDraft; lang: "en" | "hi" } | { ok: false; reason: string } {
  const text = String(q.text ?? "").replace(/\s+/g, " ").trim();
  const key = String(q.answerKey ?? "").trim();
  if (q.type !== "mcq" && q.type !== "true_false") return { ok: false, reason: "not multiple choice" };
  if (!text) return { ok: false, reason: "no question text" };
  if (!key) return { ok: false, reason: "no answer in the key" };
  if (Array.isArray(q.images) && q.images.length) return { ok: false, reason: "needs its picture" };
  if (NEEDS_PICTURE.test(text)) return { ok: false, reason: "refers to a picture" };
  const lang: "en" | "hi" = HAS_DEVANAGARI.test(text) ? "hi" : "en";
  if (q.type === "true_false") {
    const k = key.toLowerCase();
    const idx = k === "true" || k === "सही" ? 0 : k === "false" || k === "गलत" ? 1 : -1;
    if (idx < 0) return { ok: false, reason: "key is not True or False" };
    const options = lang === "hi" ? ["सही", "गलत"] : ["True", "False"];
    return { ok: true, q: { prompt: text, options, answerIndex: idx }, lang };
  }
  const options = (q.options ?? []).map(stripOptionLabel);
  const wanted = stripOptionLabel(key).toLowerCase();
  const hits = options.map((o, i) => (o.toLowerCase() === wanted ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) return { ok: false, reason: "key does not name exactly one option" };
  const checked = checkQuestionDraft({ prompt: text, options, answerIndex: hits[0] });
  return checked.ok ? { ok: true, q: checked.q, lang } : { ok: false, reason: checked.reason };
}

// ── Leaderboards ───────────────────────────────────────────────────────────

export type PlayedSession = {
  studentId: string;
  playerName: string;
  classLabel: string;
  sectionId: string;
  correct: number;
  stars: number;
  secondsPlayed: number;
  done: boolean;
};

export type SectionStanding = {
  sectionId: string;
  label: string;
  players: number;
  correct: number;
  stars: number;
  /** Right answers per player — the ranking, so a big section does not win by size. */
  averageCorrect: number;
};

export type PlayerStanding = { name: string; classLabel: string; correct: number; stars: number; seconds: number };

/**
 * A competition's standings. Sections rank by right answers per player
 * (then by players, then by name); players by right answers, then by the
 * faster time. A child counts once — the competition allows one attempt.
 */
export function competitionStandings(
  sections: { sectionId: string; label: string }[],
  sessions: PlayedSession[],
  topPlayers = 10,
): { sections: SectionStanding[]; players: PlayerStanding[] } {
  const bySection = new Map(sections.map((s) => [s.sectionId, { ...s, players: 0, correct: 0, stars: 0, averageCorrect: 0 }]));
  const seen = new Set<string>();
  const counted: PlayedSession[] = [];
  for (const s of sessions) {
    if (seen.has(s.studentId) || !bySection.has(s.sectionId)) continue;
    seen.add(s.studentId);
    counted.push(s);
    const row = bySection.get(s.sectionId)!;
    row.players += 1;
    row.correct += s.correct;
    row.stars += s.stars;
  }
  const rows = [...bySection.values()].map((r) => ({ ...r, averageCorrect: r.players ? Math.round((r.correct / r.players) * 10) / 10 : 0 }));
  rows.sort((a, b) => b.averageCorrect - a.averageCorrect || b.players - a.players || a.label.localeCompare(b.label));
  const players = counted
    .map((s) => ({ name: firstName(s.playerName), classLabel: s.classLabel, correct: s.correct, stars: s.stars, seconds: s.secondsPlayed }))
    .sort((a, b) => b.correct - a.correct || a.seconds - b.seconds || a.name.localeCompare(b.name))
    .slice(0, topPlayers);
  return { sections: rows, players };
}

/** A week's stars: per section, and the top players (first name + class). */
export function weeklyStandings(
  sessions: PlayedSession[],
  topPlayers = 10,
): { sections: { sectionId: string; label: string; stars: number; players: number }[]; players: { name: string; classLabel: string; stars: number }[] } {
  const sec = new Map<string, { sectionId: string; label: string; stars: number; kids: Set<string> }>();
  const kid = new Map<string, { name: string; classLabel: string; stars: number }>();
  for (const s of sessions) {
    if (!s.done) continue;
    const r = sec.get(s.sectionId) ?? { sectionId: s.sectionId, label: s.classLabel, stars: 0, kids: new Set<string>() };
    r.stars += s.stars;
    r.kids.add(s.studentId);
    sec.set(s.sectionId, r);
    const k = kid.get(s.studentId) ?? { name: firstName(s.playerName), classLabel: s.classLabel, stars: 0 };
    k.stars += s.stars;
    kid.set(s.studentId, k);
  }
  return {
    sections: [...sec.values()]
      .map((r) => ({ sectionId: r.sectionId, label: r.label, stars: r.stars, players: r.kids.size }))
      .sort((a, b) => b.stars - a.stars || a.label.localeCompare(b.label)),
    players: [...kid.values()].filter((k) => k.stars > 0).sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name)).slice(0, topPlayers),
  };
}

// ── Competitions coming in ─────────────────────────────────────────────────

export type CompetitionInput = {
  title: string;
  game: GameKind;
  sections: { classId: string; sectionId: string }[];
  subjectKey: string;
  textbookId: string;
  chapterPosition: number | null;
  questionCount: number;
  opensAtMs: number;
  closesAtMs: number;
};

/** A launch form, checked. Times are instants; the window is 5 minutes to 7 days. */
export function readCompetitionInput(raw: Record<string, unknown>, nowMs: number): { ok: true; input: CompetitionInput } | { ok: false; error: string } {
  const game = raw.game === "maths_speed" ? "maths_speed" : raw.game === "quiz" ? "quiz" : null;
  if (!game) return { ok: false, error: "Choose a game." };
  const sectionsRaw = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: { classId: string; sectionId: string }[] = [];
  const seen = new Set<string>();
  for (const s of sectionsRaw) {
    const o = (s ?? {}) as Record<string, unknown>;
    const classId = String(o.classId ?? "").slice(0, 80);
    const sectionId = String(o.sectionId ?? "").slice(0, 80);
    if (!classId || !sectionId || seen.has(sectionId)) continue;
    seen.add(sectionId);
    sections.push({ classId, sectionId });
  }
  if (sections.length < 2) return { ok: false, error: "Pick at least two sections to compete." };
  if (sections.length > 20) return { ok: false, error: "At most 20 sections in one competition." };
  const opensAtMs = raw.opensAt ? Date.parse(String(raw.opensAt)) : nowMs;
  const minutes = Math.round(Number(raw.durationMinutes));
  if (!Number.isFinite(opensAtMs)) return { ok: false, error: "The start time is not a time." };
  if (opensAtMs < nowMs - 5 * 60_000) return { ok: false, error: "The start time is in the past." };
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 7 * 24 * 60) return { ok: false, error: "Run it for 5 minutes to 7 days." };
  const count = Math.round(Number(raw.questionCount ?? QUIZ_DEFAULT_COUNT));
  const subjectKey = String(raw.subjectKey ?? "").slice(0, 30);
  if (game === "quiz" && !subjectKey) return { ok: false, error: "Choose the subject the questions come from." };
  const chapter = raw.chapterPosition === null || raw.chapterPosition === undefined || raw.chapterPosition === "" ? null : Math.round(Number(raw.chapterPosition));
  return {
    ok: true,
    input: {
      title: String(raw.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      game,
      sections,
      subjectKey: game === "quiz" ? subjectKey : "",
      textbookId: game === "quiz" ? String(raw.textbookId ?? "").slice(0, 120) : "",
      chapterPosition: game === "quiz" && chapter !== null && Number.isFinite(chapter) ? chapter : null,
      questionCount: Math.min(QUIZ_MAX_COUNT, Math.max(QUIZ_MIN_COUNT, Number.isFinite(count) ? count : QUIZ_DEFAULT_COUNT)),
      opensAtMs: Math.max(opensAtMs, nowMs - 5 * 60_000),
      closesAtMs: Math.max(opensAtMs, nowMs) + minutes * 60_000,
    },
  };
}
