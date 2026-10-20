/**
 * Learning games — the rows (tables from migration 20261020100000_learning_games).
 *
 * The rules are in ./learningGames.ts; this file reads and writes. Every
 * read that fails is an ApiError 503, never an empty list (R6): "no
 * competitions" and "could not read the competitions" must not look alike,
 * and a failed read of today's minutes must not be taken for "nothing
 * played yet" — that would hand a child a fresh allowance.
 *
 * The clock is the server's. On the local e2e stack only (E2E=1 and a
 * 127.0.0.1 Supabase URL) a request may carry `x-e2e-clock` so the tests can
 * stand at 5 pm or 10 pm on any runner; anywhere else the header is ignored.
 */

import "server-only";
import { randomUUID } from "crypto";
import { ApiError } from "@/lib/api/v1/errors";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { getServerTenantContext } from "@/lib/serverTenant";
import { householdChildren } from "@/lib/appPopups.server";
import type { SisStudent } from "@/lib/sis";
import { normalizePaper, type ExamPaper } from "@/lib/examPapers";
import { subjectDisplayName, subjectKeyFor } from "@/lib/tutorSyllabus";
import { classifyClassHolidayDay } from "@/lib/holidayPolicy";
import { currentAcademicYearCode } from "@/lib/masters";
import {
  checkAnswer,
  competitionItemsFor,
  competitionStandings,
  firstName,
  gameGrade,
  gameLengthSeconds,
  gameReview,
  gameQuestionFromPaper,
  istDayBefore,
  istParts,
  istWeekStart,
  mathsSpeedItems,
  MATHS_SPEED_ITEMS,
  normalizeGameSettings,
  pickQuizItems,
  playVerdict,
  publicItems,
  readItems,
  scoreAnswers,
  seedFrom,
  sessionSecondsUsed,
  starsFor,
  weeklyStandings,
  type CompetitionInput,
  type GameItem,
  type GameKind,
  type GameSettings,
  type PlayedSession,
  type QuestionDraft,
} from "@/lib/learningGames";

// ── Plumbing ──────────────────────────────────────────────────────────────

async function db() {
  const t = await getServerTenantContext();
  if (!t) throw new ApiError("server_error", "The school's database is not configured.", 503);
  return t;
}

function readFailed(what: string, error: { message?: string } | null): never {
  console.warn(`[games] ${what} read failed`, error?.message);
  throw new ApiError("server_error", `Could not read ${what} just now — please try again.`, 503);
}

function writeFailed(what: string, error: { message?: string } | null): never {
  console.warn(`[games] ${what} write failed`, error?.message);
  throw new ApiError("server_error", `Could not save ${what} just now — please try again.`, 503);
}

/** The server's now — or, on the local e2e stack only, the test's. */
export function gameNow(request: Request): number {
  const fake = request.headers.get("x-e2e-clock");
  if (
    fake &&
    process.env.E2E === "1" &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL || "")
  ) {
    const t = Date.parse(fake);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: unknown): number => (v ? Date.parse(String(v)) : NaN);

// ── Settings ──────────────────────────────────────────────────────────────

type SettingsRow = {
  enabled: boolean;
  daily_minutes: number;
  play_from: string;
  play_until: string;
  school_start: string;
  school_end: string;
  school_days: number[];
  updated_at: string | null;
  updated_by: string | null;
};

export async function readGameSettings(): Promise<GameSettings & { updatedAt: string | null; updatedBy: string }> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb.from("game_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) readFailed("the game settings", error);
  const r = data as SettingsRow | null;
  const s = normalizeGameSettings(
    r
      ? {
          enabled: r.enabled,
          dailyMinutes: r.daily_minutes,
          playFrom: r.play_from,
          playUntil: r.play_until,
          schoolStart: r.school_start,
          schoolEnd: r.school_end,
          schoolDays: r.school_days,
        }
      : null,
  );
  return { ...s, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? "" };
}

export async function saveGameSettings(s: GameSettings, by: string, nowMs: number): Promise<void> {
  const { sb, tenantId } = await db();
  const { error } = await sb.from("game_settings").upsert(
    {
      tenant_id: tenantId,
      enabled: s.enabled,
      daily_minutes: s.dailyMinutes,
      play_from: s.playFrom,
      play_until: s.playUntil,
      school_start: s.schoolStart,
      school_end: s.schoolEnd,
      school_days: s.schoolDays,
      updated_at: iso(nowMs),
      updated_by: by.slice(0, 120),
    },
    { onConflict: "tenant_id" },
  );
  if (error) writeFailed("the game settings", error);
}

// ── The child ─────────────────────────────────────────────────────────────

export type GameChild = {
  student: SisStudent;
  grade: number | null;
  className: string;
  classLabel: string;
  playerName: string;
};

/** One child of the signed-in family, on roll this year — or 404. */
export async function resolveGameChild(ctx: ApiAuthContext, studentId: string): Promise<GameChild> {
  const s = ctx.session;
  if (s.persona !== "parent" || !s.householdId) throw new ApiError("forbidden", "Games are played from the parent app.", 403);
  const children = await householdChildren(s.householdId, s.academicYearCode || "");
  const child = children.find((c) => c.id === studentId);
  if (!child) throw new ApiError("not_found", "That child is not on this family's record.", 404);
  return describeChild(ctx, child);
}

export function describeChild(ctx: ApiAuthContext, child: SisStudent): GameChild {
  const cls = ctx.masters.classes.find((c) => c.id === child.classId);
  const sec = ctx.masters.sections.find((x) => x.id === child.sectionId);
  const className = cls?.name || "";
  return {
    student: child,
    grade: gameGrade(className),
    className,
    classLabel: [className, sec?.name].filter(Boolean).join("-"),
    playerName: firstName(child.fullName),
  };
}

/**
 * Is `date` (IST, "YYYY-MM-DD") a full holiday for this child's class in the
 * school's calendar (Masters → Holidays, published, this year)? Then there
 * are no school hours to keep practice out of. A half holiday still has
 * school, so it is not one here. Masters comes with the request (ctx); a
 * year Masters cannot name falls back to the session's.
 */
export function isClassHoliday(ctx: ApiAuthContext, classId: string, date: string): boolean {
  let year = "";
  try {
    year = currentAcademicYearCode(ctx.masters) || "";
  } catch {
    year = "";
  }
  year ||= ctx.session.academicYearCode || "";
  if (!year || !classId) return false;
  return classifyClassHolidayDay(ctx.masters, date, year, classId).status === "holiday";
}

// ── Sessions ──────────────────────────────────────────────────────────────

type SessionRow = {
  id: string;
  student_id: string;
  household_id: string;
  player_name: string;
  class_id: string;
  section_id: string;
  class_label: string;
  competition_id: string | null;
  game: GameKind;
  grade: number | null;
  subject_key: string;
  textbook_id: string;
  chapter_position: number | null;
  items: unknown;
  started_at: string;
  deadline_at: string;
  ended_at: string | null;
  status: "playing" | "done";
  answered: number;
  correct: number;
  stars: number;
  seconds_played: number;
  play_date: string;
};

const SESSION_LIST_COLUMNS =
  "id, student_id, player_name, class_label, section_id, competition_id, game, started_at, deadline_at, ended_at, status, answered, correct, stars, seconds_played, play_date";

function usedSeconds(rows: Pick<SessionRow, "started_at" | "deadline_at" | "ended_at" | "status" | "seconds_played">[], nowMs: number): number {
  return rows.reduce(
    (sum, r) =>
      sum +
      (r.status === "done"
        ? r.seconds_played
        : sessionSecondsUsed({ startedAtMs: ms(r.started_at), deadlineAtMs: ms(r.deadline_at), endedAtMs: r.ended_at ? ms(r.ended_at) : null }, nowMs)),
    0,
  );
}

async function sessionsOfDays(studentId: string, fromDate: string): Promise<SessionRow[]> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_sessions")
    .select(SESSION_LIST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .gte("play_date", fromDate)
    .order("started_at", { ascending: true })
    .limit(1000);
  if (error) readFailed("today's games", error);
  return (data ?? []) as SessionRow[];
}

async function loadSession(sessionId: string, householdId: string): Promise<SessionRow> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", sessionId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) readFailed("this game", error);
  if (!data) throw new ApiError("not_found", "No such game.", 404);
  return data as SessionRow;
}

/** Ends a session: the score from its stored answers, the minutes from the clock. */
async function closeSession(row: SessionRow, nowMs: number): Promise<{ answered: number; correct: number; stars: number; seconds: number }> {
  if (row.status === "done") return { answered: row.answered, correct: row.correct, stars: row.stars, seconds: row.seconds_played };
  const { sb, tenantId } = await db();
  const { data: answers, error } = await sb
    .from("game_answers")
    .select("idx, chosen")
    .eq("tenant_id", tenantId)
    .eq("session_id", row.id)
    .limit(500);
  if (error) readFailed("this game's answers", error);
  const items = readItems(row.items);
  const score = scoreAnswers(items, (answers ?? []) as { idx: number; chosen: number }[]);
  const stars = starsFor(row.game, score.correct);
  const endedAt = Math.min(nowMs, ms(row.deadline_at));
  const seconds = sessionSecondsUsed({ startedAtMs: ms(row.started_at), deadlineAtMs: ms(row.deadline_at), endedAtMs: endedAt }, nowMs);
  const { error: upErr } = await sb
    .from("game_sessions")
    .update({ status: "done", ended_at: iso(endedAt), answered: score.answered, correct: score.correct, stars, seconds_played: seconds })
    .eq("tenant_id", tenantId)
    .eq("id", row.id)
    .eq("status", "playing");
  if (upErr) writeFailed("the game's score", upErr);
  return { answered: score.answered, correct: score.correct, stars, seconds };
}

async function closeOpenSessions(studentId: string, nowMs: number): Promise<void> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .eq("status", "playing")
    .limit(10);
  if (error) readFailed("the open game", error);
  for (const r of (data ?? []) as SessionRow[]) await closeSession(r, nowMs);
}

// ── Status (what the Games screen opens with) ──────────────────────────────

export async function gameStatus(ctx: ApiAuthContext, child: GameChild, nowMs: number) {
  const settings = await readGameSettings();
  const today = istParts(nowMs).date;
  const weekStart = istWeekStart(nowMs);
  const from = [istDayBefore(today, 6), weekStart].sort()[0]!;
  const rows = await sessionsOfDays(child.student.id, from);
  const todays = rows.filter((r) => r.play_date === today);
  const used = usedSeconds(todays, nowMs);
  const holiday = isClassHoliday(ctx, child.student.classId, today);
  const practice = playVerdict({ nowMs, settings, usedSecondsToday: used, gameSeconds: gameLengthSeconds("quiz", 10), holiday });
  const days: { date: string; seconds: number; stars: number; games: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = istDayBefore(today, i);
    const of = rows.filter((r) => r.play_date === d);
    days.push({ date: d, seconds: usedSeconds(of, nowMs), stars: of.reduce((s, r) => s + r.stars, 0), games: of.length });
  }
  const totals = await starTotal(child.student.id);
  const [competitions, pool] = await Promise.all([openCompetitionsFor(child, nowMs), poolSummary(child.grade)]);
  return {
    child: { studentId: child.student.id, name: child.playerName, classLabel: child.classLabel, grade: child.grade },
    limits: {
      dailyMinutes: settings.dailyMinutes,
      usedSeconds: used,
      leftSeconds: Math.max(0, settings.dailyMinutes * 60 - used),
      playFrom: settings.playFrom,
      playUntil: settings.playUntil,
      schoolStart: settings.schoolStart,
      schoolEnd: settings.schoolEnd,
      schoolDays: settings.schoolDays,
      holidayToday: holiday,
      canPracticeNow: practice.ok,
      reason: practice.ok ? null : practice.reason,
      message: practice.ok ? "" : practice.message,
      messageHi: practice.ok ? "" : practice.messageHi,
    },
    stars: {
      today: todays.reduce((s, r) => s + r.stars, 0),
      week: rows.filter((r) => r.play_date >= weekStart).reduce((s, r) => s + r.stars, 0),
      total: totals,
    },
    days,
    competitions,
    pool,
  };
}

async function starTotal(studentId: string): Promise<number> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_sessions")
    .select("stars")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId)
    .eq("status", "done")
    .gt("stars", 0)
    .limit(5000);
  if (error) readFailed("the stars", error);
  return ((data ?? []) as { stars: number }[]).reduce((s, r) => s + r.stars, 0);
}

// ── Pool ──────────────────────────────────────────────────────────────────

type QuestionRow = {
  id: string;
  grade: number;
  class_id: string;
  subject_key: string;
  textbook_id: string;
  chapter_position: number | null;
  chapter_name: string;
  lang: "en" | "hi";
  prompt: string;
  options: unknown;
  answer_index: number;
  source: "publisher_key" | "ai" | "teacher";
  review: "approved" | "pending" | "rejected";
  reviewed_by: string;
  batch_id: string;
  created_by: string;
  created_at: string;
};

async function approvedQuestions(grade: number, subjectKey?: string, textbookId?: string, chapterPosition?: number | null): Promise<QuestionRow[]> {
  const { sb, tenantId } = await db();
  let q = sb
    .from("game_questions")
    .select("id, grade, subject_key, textbook_id, chapter_position, chapter_name, lang, prompt, options, answer_index, source")
    .eq("tenant_id", tenantId)
    .eq("grade", grade)
    .eq("review", "approved");
  if (subjectKey) q = q.eq("subject_key", subjectKey);
  if (textbookId) q = q.eq("textbook_id", textbookId);
  if (chapterPosition !== null && chapterPosition !== undefined) q = q.eq("chapter_position", chapterPosition);
  const { data, error } = await q.order("id", { ascending: true }).limit(2000);
  if (error) readFailed("the question pool", error);
  return (data ?? []) as QuestionRow[];
}

/** What a child of this grade can practise: subjects and chapters with enough approved questions. */
export async function poolSummary(grade: number | null) {
  if (grade === null) return { subjects: [] as { subjectKey: string; label: string; questions: number; chapters: { textbookId: string; position: number; name: string; questions: number }[] }[] };
  const rows = await approvedQuestions(grade);
  const bySubject = new Map<string, { subjectKey: string; label: string; questions: number; chapters: Map<string, { textbookId: string; position: number; name: string; questions: number }> }>();
  for (const r of rows) {
    const s = bySubject.get(r.subject_key) ?? { subjectKey: r.subject_key, label: subjectDisplayName(r.subject_key), questions: 0, chapters: new Map() };
    s.questions += 1;
    if (r.textbook_id && r.chapter_position !== null) {
      const k = `${r.textbook_id}#${r.chapter_position}`;
      const c = s.chapters.get(k) ?? { textbookId: r.textbook_id, position: r.chapter_position, name: r.chapter_name, questions: 0 };
      c.questions += 1;
      s.chapters.set(k, c);
    }
    bySubject.set(r.subject_key, s);
  }
  return {
    subjects: [...bySubject.values()]
      .filter((s) => s.questions >= 3)
      .map((s) => ({
        ...s,
        chapters: [...s.chapters.values()].filter((c) => c.questions >= 3).sort((a, b) => a.textbookId.localeCompare(b.textbookId) || a.position - b.position),
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

// ── Start, answer, finish ──────────────────────────────────────────────────

export type StartInput = {
  game: GameKind;
  subjectKey?: string;
  textbookId?: string;
  chapterPosition?: number | null;
  competitionId?: string;
  /** Number dash's counting prompt in Hindi. */
  lang?: "en" | "hi";
};

export async function startGame(ctx: ApiAuthContext, child: GameChild, input: StartInput, nowMs: number) {
  const settings = await readGameSettings();
  const today = istParts(nowMs).date;
  // Whatever was left open (an app killed mid-game) is closed first, at its
  // own clock, so its minutes are counted before the allowance is worked out.
  await closeOpenSessions(child.student.id, nowMs);
  const used = usedSeconds(await sessionsOfDays(child.student.id, today), nowMs);

  let items: GameItem[];
  let game: GameKind = input.game;
  let competition: CompetitionRow | null = null;
  let source = { grade: child.grade, subjectKey: "", textbookId: "", chapterPosition: null as number | null };

  if (input.competitionId) {
    competition = await loadCompetition(input.competitionId);
    if (!competition || !competition.sections.some((s) => s.sectionId === child.student.sectionId)) {
      throw new ApiError("not_found", "This competition is not for your class.", 404);
    }
    game = competition.game;
    // The same questions for every player, but each in their own order with
    // their own option order — answers cannot be passed along by position.
    items = competitionItemsFor(readItems(competition.items), seedFrom(`${competition.id}:${child.student.id}`));
    source = {
      grade: competition.grade,
      subjectKey: competition.subject_key,
      textbookId: competition.textbook_id,
      chapterPosition: competition.chapter_position,
    };
  } else if (game === "maths_speed") {
    if (child.grade === null) throw new ApiError("bad_request", "This class has no number game yet.", 400);
    items = mathsSpeedItems(child.grade, seedFrom(`${child.student.id}:${nowMs}`), MATHS_SPEED_ITEMS, input.lang === "hi");
  } else {
    if (child.grade === null) throw new ApiError("bad_request", "This class has no quizzes yet.", 400);
    if (!input.subjectKey) throw new ApiError("bad_request", "Choose a subject.", 400);
    const pool = await approvedQuestions(child.grade, input.subjectKey, input.textbookId || undefined, input.chapterPosition ?? null);
    if (pool.length < 3) throw new ApiError("not_found", "Not enough questions here yet — your teacher is adding more.", 404);
    items = pickQuizItems(
      pool.map((q) => ({ id: q.id, prompt: q.prompt, options: (q.options as string[]) ?? [], answerIndex: q.answer_index })),
      10,
      seedFrom(`${child.student.id}:${nowMs}`),
    );
    source = { grade: child.grade, subjectKey: input.subjectKey, textbookId: input.textbookId || "", chapterPosition: input.chapterPosition ?? null };
  }
  if (!items.length) throw new ApiError("server_error", "This game has no questions.", 503);

  const verdict = playVerdict({
    nowMs,
    settings,
    usedSecondsToday: used,
    gameSeconds: gameLengthSeconds(game, items.length),
    competition: competition
      ? { opensAtMs: ms(competition.opens_at), closesAtMs: ms(competition.closes_at), cancelled: competition.status === "cancelled" }
      : null,
    holiday: isClassHoliday(ctx, child.student.classId, today),
  });
  if (!verdict.ok) {
    throw new ApiError("forbidden", verdict.message, 403, { reason: verdict.reason, messageHi: verdict.messageHi });
  }

  const { sb, tenantId } = await db();
  const id = newId("gms");
  const { error } = await sb.from("game_sessions").insert({
    id,
    tenant_id: tenantId,
    student_id: child.student.id,
    household_id: child.student.householdId,
    player_name: child.playerName,
    class_id: child.student.classId,
    section_id: child.student.sectionId,
    class_label: child.classLabel,
    competition_id: competition?.id ?? null,
    game,
    grade: source.grade,
    subject_key: source.subjectKey,
    textbook_id: source.textbookId,
    chapter_position: source.chapterPosition,
    items,
    started_at: iso(nowMs),
    deadline_at: iso(nowMs + verdict.allowSeconds * 1000),
    status: "playing",
    play_date: today,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(
        "conflict",
        competition ? "You have already played this competition." : "A game is already being played on another phone.",
        409,
        { reason: competition ? "already_played" : "already_playing" },
      );
    }
    writeFailed("the new game", error);
  }
  return {
    sessionId: id,
    game,
    competitionId: competition?.id ?? null,
    items: publicItems(items),
    startedAt: iso(nowMs),
    deadlineAt: iso(nowMs + verdict.allowSeconds * 1000),
    secondsLeft: verdict.allowSeconds,
    // In a competition the right option is shown only after it closes, so
    // a classmate sitting beside you cannot be told it.
    revealAnswers: !competition,
    answersAt: competition ? competition.closes_at : null,
  };
}

export async function answerGame(ctx: ApiAuthContext, sessionId: string, index: number, choice: number, nowMs: number) {
  const row = await loadSession(sessionId, ctx.session.householdId || "");
  const items = readItems(row.items);
  const verdict = checkAnswer({ items, index, choice, nowMs, deadlineAtMs: ms(row.deadline_at), finished: row.status === "done" });
  if (!verdict.ok) {
    const status = verdict.code === "bad_index" || verdict.code === "bad_choice" ? 400 : 409;
    throw new ApiError(status === 400 ? "bad_request" : "conflict", verdict.message, status, { reason: verdict.code });
  }
  const { sb, tenantId } = await db();
  const { error } = await sb
    .from("game_answers")
    .insert({ session_id: row.id, tenant_id: tenantId, idx: index, chosen: choice, correct: verdict.correct, answered_at: iso(nowMs) });
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiError("conflict", "That question is already answered.", 409, { reason: "answered" });
    writeFailed("the answer", error);
  }
  const reveal = !row.competition_id;
  return {
    // In a competition not even right/wrong is said per question.
    correct: reveal ? verdict.correct : null,
    correctIndex: reveal ? verdict.correctIndex : null,
    secondsLeft: Math.max(0, Math.floor((ms(row.deadline_at) - nowMs) / 1000)),
  };
}

/** Ends the game. Whatever the request says about the score is not read. */
export async function finishGame(ctx: ApiAuthContext, sessionId: string, nowMs: number) {
  const row = await loadSession(sessionId, ctx.session.householdId || "");
  const r = await closeSession(row, nowMs);
  const items = readItems(row.items);
  const { sb, tenantId } = await db();
  const { data, error } = await sb.from("game_answers").select("idx, chosen").eq("tenant_id", tenantId).eq("session_id", row.id).limit(500);
  if (error) readFailed("this game's answers", error);
  const chosen = new Map(((data ?? []) as { idx: number; chosen: number }[]).map((a) => [a.idx, a.chosen]));
  // A competition's right options stay on the server until it closes (a
  // finished child could read them out to one still playing); practice
  // shows them at once. Calling finish again after the close shows them.
  let closesAtMs: number | null = null;
  if (row.competition_id) {
    const c = await loadCompetition(row.competition_id);
    // A competition row that cannot be found: hold the answers back (safe side).
    closesAtMs = c ? ms(c.closes_at) : Number.POSITIVE_INFINITY;
  }
  const rv = gameReview(items, chosen, { competitionClosesAtMs: closesAtMs, nowMs });
  return {
    sessionId: row.id,
    game: row.game,
    competitionId: row.competition_id,
    total: items.length,
    answered: r.answered,
    correct: r.correct,
    stars: r.stars,
    seconds: r.seconds,
    // The review: each question, what was chosen and (when shown) the right option.
    answersShown: rv.answersShown,
    answersAt: rv.answersAt,
    review: rv.review,
  };
}

// ── Competitions ───────────────────────────────────────────────────────────

type CompetitionRow = {
  id: string;
  title: string;
  game: GameKind;
  sections: { classId: string; sectionId: string; label: string }[];
  grade: number | null;
  subject_key: string;
  textbook_id: string;
  chapter_position: number | null;
  items: unknown;
  opens_at: string;
  closes_at: string;
  status: "open" | "cancelled";
  created_by_staff_id: string;
  created_by_name: string;
  created_at: string;
};

const COMPETITION_COLUMNS =
  "id, title, game, sections, grade, subject_key, textbook_id, chapter_position, opens_at, closes_at, status, created_by_staff_id, created_by_name, created_at";

/** Who a competition is for, or null when there is none — read before anything is written for it. */
export async function competitionAudience(id: string): Promise<{ sections: CompetitionRow["sections"]; createdByStaffId: string } | null> {
  const c = await loadCompetition(id);
  return c ? { sections: c.sections, createdByStaffId: c.created_by_staff_id } : null;
}

async function loadCompetition(id: string): Promise<CompetitionRow | null> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb.from("game_competitions").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) readFailed("the competition", error);
  return (data as CompetitionRow | null) ?? null;
}

function competitionPhase(c: Pick<CompetitionRow, "opens_at" | "closes_at" | "status">, nowMs: number): "upcoming" | "open" | "closed" | "cancelled" {
  if (c.status === "cancelled") return "cancelled";
  if (nowMs < ms(c.opens_at)) return "upcoming";
  if (nowMs >= ms(c.closes_at)) return "closed";
  return "open";
}

function competitionView(c: CompetitionRow, nowMs: number) {
  return {
    id: c.id,
    title: c.title || defaultTitle(c),
    game: c.game,
    sections: c.sections,
    subjectKey: c.subject_key,
    subjectLabel: c.subject_key ? subjectDisplayName(c.subject_key) : "",
    chapterPosition: c.chapter_position,
    questionCount: readItems(c.items).length,
    opensAt: c.opens_at,
    closesAt: c.closes_at,
    phase: competitionPhase(c, nowMs),
    createdByName: c.created_by_name,
    createdAt: c.created_at,
  };
}

function defaultTitle(c: Pick<CompetitionRow, "game" | "subject_key">): string {
  return c.game === "maths_speed" ? "Number dash challenge" : `${subjectDisplayName(c.subject_key)} quiz challenge`;
}

/** Competitions for this child's section that are open or about to open, and recent ones. */
async function openCompetitionsFor(child: GameChild, nowMs: number) {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_competitions")
    .select(COMPETITION_COLUMNS + ", items")
    .eq("tenant_id", tenantId)
    .gte("closes_at", iso(nowMs - 3 * 86_400_000))
    .order("opens_at", { ascending: true })
    .limit(200);
  if (error) readFailed("the competitions", error);
  const mine = ((data ?? []) as unknown as CompetitionRow[]).filter(
    (c) => c.status === "open" && c.sections.some((s) => s.sectionId === child.student.sectionId),
  );
  const ids = mine.map((c) => c.id);
  let played = new Set<string>();
  if (ids.length) {
    const { data: s, error: e2 } = await sb
      .from("game_sessions")
      .select("competition_id")
      .eq("tenant_id", tenantId)
      .eq("student_id", child.student.id)
      .in("competition_id", ids);
    if (e2) readFailed("the competitions played", e2);
    played = new Set(((s ?? []) as { competition_id: string }[]).map((r) => r.competition_id));
  }
  return mine.map((c) => ({ ...competitionView(c, nowMs), played: played.has(c.id) }));
}

/** Who may see / run a competition: its creator, a school-wide session, or a teacher of one of its sections. */
export function canSeeCompetition(c: { sections: { sectionId: string; classId: string }[]; createdByStaffId: string }, staffId: string, unrestricted: boolean, sectionKeys: Set<string>): boolean {
  if (unrestricted) return true;
  if (staffId && c.createdByStaffId === staffId) return true;
  return c.sections.some((s) => sectionKeys.has(`${s.classId}|${s.sectionId}`));
}

export async function createCompetition(
  ctx: ApiAuthContext,
  input: CompetitionInput,
  grade: number | null,
  sectionLabel: (classId: string, sectionId: string) => string,
  nowMs: number,
) {
  let items: GameItem[];
  if (input.game === "maths_speed") {
    // Every section gets the same numbers — pitched to the youngest class in it.
    if (grade === null) throw new ApiError("bad_request", "Could not tell the class's level for the number game.", 400);
    items = mathsSpeedItems(grade, seedFrom(`competition:${nowMs}`));
  } else {
    if (grade === null) throw new ApiError("bad_request", "Choose the class whose questions to use.", 400);
    const pool = await approvedQuestions(grade, input.subjectKey, input.textbookId || undefined, input.chapterPosition);
    if (pool.length < input.questionCount) {
      throw new ApiError(
        "bad_request",
        `Only ${pool.length} approved question${pool.length === 1 ? "" : "s"} here — approve or add more, or ask for fewer.`,
        400,
        { reason: "pool_too_small", available: pool.length },
      );
    }
    items = pickQuizItems(
      pool.map((q) => ({ id: q.id, prompt: q.prompt, options: (q.options as string[]) ?? [], answerIndex: q.answer_index })),
      input.questionCount,
      seedFrom(`competition:${nowMs}`),
    );
  }
  const { sb, tenantId } = await db();
  const id = newId("gmc");
  const row = {
    id,
    tenant_id: tenantId,
    title: input.title,
    game: input.game,
    sections: input.sections.map((s) => ({ ...s, label: sectionLabel(s.classId, s.sectionId) })),
    grade,
    subject_key: input.subjectKey,
    textbook_id: input.textbookId,
    chapter_position: input.chapterPosition,
    items,
    opens_at: iso(input.opensAtMs),
    closes_at: iso(input.closesAtMs),
    status: "open",
    created_by_staff_id: ctx.session.staffId || "",
    created_by_name: ctx.session.fullName || "",
    created_at: iso(nowMs),
  };
  const { error } = await sb.from("game_competitions").insert(row);
  if (error) writeFailed("the competition", error);
  return competitionView(row as unknown as CompetitionRow, nowMs);
}

export async function cancelCompetition(id: string): Promise<void> {
  const { sb, tenantId } = await db();
  const { error } = await sb.from("game_competitions").update({ status: "cancelled" }).eq("tenant_id", tenantId).eq("id", id);
  if (error) writeFailed("the competition", error);
}

export async function listCompetitions(filter: (c: { sections: CompetitionRow["sections"]; createdByStaffId: string }) => boolean, nowMs: number) {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_competitions")
    .select(COMPETITION_COLUMNS + ", items")
    .eq("tenant_id", tenantId)
    .gte("closes_at", iso(nowMs - 30 * 86_400_000))
    .order("opens_at", { ascending: false })
    .limit(200);
  if (error) readFailed("the competitions", error);
  return ((data ?? []) as unknown as CompetitionRow[])
    .filter((c) => filter({ sections: c.sections, createdByStaffId: c.created_by_staff_id }))
    .map((c) => competitionView(c, nowMs));
}

export async function competitionDetail(id: string, nowMs: number) {
  const c = await loadCompetition(id);
  if (!c) throw new ApiError("not_found", "No such competition.", 404);
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_sessions")
    .select(SESSION_LIST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("competition_id", id)
    .order("started_at", { ascending: true })
    .limit(2000);
  if (error) readFailed("the competition's players", error);
  const rows = (data ?? []) as SessionRow[];
  const played: PlayedSession[] = rows.map((r) => {
    // A game still open whose clock ran out counts as it stands.
    const live = r.status === "playing" && nowMs < ms(r.deadline_at);
    return {
      studentId: r.student_id,
      playerName: r.player_name,
      classLabel: r.class_label,
      sectionId: r.section_id,
      correct: r.correct,
      stars: r.stars,
      secondsPlayed: r.seconds_played,
      done: !live,
    };
  });
  const standings = competitionStandings(c.sections, played.filter((p) => p.done));
  return {
    competition: { ...competitionView(c, nowMs), createdByStaffId: c.created_by_staff_id },
    playing: played.filter((p) => !p.done).length,
    finished: played.filter((p) => p.done).length,
    ...standings,
  };
}

/**
 * Closes games whose clock ran out without a "finish" (the app was closed),
 * so a leaderboard counts what they answered. Cheap: only this competition's
 * open rows past their deadline.
 */
export async function settleExpiredCompetitionGames(competitionId: string, nowMs: number): Promise<void> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("competition_id", competitionId)
    .eq("status", "playing")
    .lt("deadline_at", iso(nowMs))
    .limit(200);
  if (error) readFailed("the competition's games", error);
  for (const r of (data ?? []) as SessionRow[]) await closeSession(r, nowMs);
}

// ── Weekly leaderboard ─────────────────────────────────────────────────────

/** This week's stars in one section (or the whole school), first names and classes only. */
export async function weeklyBoard(nowMs: number, sectionId?: string) {
  const { sb, tenantId } = await db();
  let q = sb
    .from("game_sessions")
    .select("student_id, player_name, class_label, section_id, correct, stars, seconds_played, status")
    .eq("tenant_id", tenantId)
    .gte("play_date", istWeekStart(nowMs))
    .eq("status", "done");
  if (sectionId) q = q.eq("section_id", sectionId);
  const { data, error } = await q.limit(20000);
  if (error) readFailed("the leaderboard", error);
  const played: PlayedSession[] = ((data ?? []) as SessionRow[]).map((r) => ({
    studentId: r.student_id,
    playerName: r.player_name,
    classLabel: r.class_label,
    sectionId: r.section_id,
    correct: r.correct,
    stars: r.stars,
    secondsPlayed: r.seconds_played,
    done: true,
  }));
  return { weekStart: istWeekStart(nowMs), ...weeklyStandings(played) };
}

// ── Question pool (staff) ──────────────────────────────────────────────────

export function questionView(r: QuestionRow) {
  return {
    id: r.id,
    grade: r.grade,
    subjectKey: r.subject_key,
    subjectLabel: subjectDisplayName(r.subject_key),
    textbookId: r.textbook_id,
    chapterPosition: r.chapter_position,
    chapterName: r.chapter_name,
    lang: r.lang,
    prompt: r.prompt,
    options: Array.isArray(r.options) ? (r.options as string[]) : [],
    answerIndex: r.answer_index,
    source: r.source,
    review: r.review,
    reviewedBy: r.reviewed_by,
    batchId: r.batch_id ?? "",
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export async function listQuestions(grade: number, filter: { subjectKey?: string; review?: string }) {
  const { sb, tenantId } = await db();
  let q = sb.from("game_questions").select("*").eq("tenant_id", tenantId).eq("grade", grade);
  if (filter.subjectKey) q = q.eq("subject_key", filter.subjectKey);
  if (filter.review) q = q.eq("review", filter.review);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) readFailed("the question pool", error);
  return ((data ?? []) as QuestionRow[]).map(questionView);
}

export async function poolCounts(grade: number) {
  const { sb, tenantId } = await db();
  const { data, error } = await sb.from("game_questions").select("subject_key, review, source").eq("tenant_id", tenantId).eq("grade", grade).limit(5000);
  if (error) readFailed("the question pool", error);
  const out = new Map<string, { subjectKey: string; label: string; approved: number; pending: number; rejected: number }>();
  for (const r of (data ?? []) as Pick<QuestionRow, "subject_key" | "review">[]) {
    const s = out.get(r.subject_key) ?? { subjectKey: r.subject_key, label: subjectDisplayName(r.subject_key), approved: 0, pending: 0, rejected: 0 };
    s[r.review] += 1;
    out.set(r.subject_key, s);
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function addQuestions(
  rows: {
    grade: number;
    classId: string;
    subjectKey: string;
    textbookId: string;
    chapterPosition: number | null;
    chapterName: string;
    lang: "en" | "hi";
    q: QuestionDraft;
    source: "publisher_key" | "ai" | "teacher";
    sourceRef: string;
    review: "approved" | "pending";
    reviewedBy: string;
    /** One import run or one AI draft: a teacher can approve a reviewed publisher batch at once. */
    batchId?: string;
  }[],
  by: string,
  nowMs: number,
): Promise<{ added: number }> {
  if (!rows.length) return { added: 0 };
  const { sb, tenantId } = await db();
  const payload = rows.map((r) => {
    const id = newId("gmq");
    return {
    id,
    tenant_id: tenantId,
    grade: r.grade,
    class_id: r.classId,
    subject_key: r.subjectKey,
    textbook_id: r.textbookId,
    chapter_position: r.chapterPosition,
    chapter_name: r.chapterName.slice(0, 200),
    lang: r.lang,
    prompt: r.q.prompt,
    options: r.q.options,
    answer_index: r.q.answerIndex,
    source: r.source,
    source_ref: r.sourceRef || id,
    review: r.review,
    reviewed_by: r.review === "approved" ? r.reviewedBy.slice(0, 120) : "",
    reviewed_at: r.review === "approved" ? iso(nowMs) : null,
    batch_id: (r.batchId ?? "").slice(0, 60),
    created_by: by.slice(0, 120),
    created_at: iso(nowMs),
    };
  });
  let added = 0;
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    // An import run twice adds nothing: (source, source_ref) is unique.
    const { data, error } = await sb
      .from("game_questions")
      .upsert(chunk, { onConflict: "tenant_id,source,source_ref", ignoreDuplicates: true })
      .select("id");
    if (error) writeFailed("the questions", error);
    added += (data ?? []).length;
  }
  return { added };
}

/** `allowed(grade, subjectKey)`: the reviewer teaches that subject in that grade (or is school-wide). */
export async function reviewQuestion(
  id: string,
  review: "approved" | "rejected",
  by: string,
  nowMs: number,
  allowed: (grade: number, subjectKey: string) => boolean,
) {
  const { sb, tenantId } = await db();
  const { data, error } = await sb.from("game_questions").select("id, grade, subject_key").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) readFailed("the question", error);
  if (!data) throw new ApiError("not_found", "No such question.", 404);
  const q = data as { grade: number; subject_key: string };
  if (!allowed(q.grade, q.subject_key)) {
    throw new ApiError("forbidden", `That question is ${subjectDisplayName(q.subject_key)} for a class you do not teach it in.`, 403);
  }
  const { error: e2 } = await sb
    .from("game_questions")
    .update({ review, reviewed_by: by.slice(0, 120), reviewed_at: iso(nowMs) })
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (e2) writeFailed("the review", e2);
}

/**
 * "Approve all" for one reviewed import batch: the publisher-keyed questions
 * of one subject in one grade still waiting from that import run — of those,
 * only the ids the teacher was shown (`ids`). The
 * caller has checked the teacher teaches that subject in that grade. AI
 * drafts are never approved in bulk — each is read and approved alone.
 */
export async function approvePublisherBatch(
  batchId: string,
  grade: number,
  subjectKey: string,
  ids: string[],
  by: string,
  nowMs: number,
): Promise<{ approved: number }> {
  if (!batchId) throw new ApiError("bad_request", "Which import?", 400);
  // Only the questions the teacher had on screen: one they did not see is not approved.
  if (!ids.length) throw new ApiError("bad_request", "No questions to approve.", 400);
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_questions")
    .update({ review: "approved", reviewed_by: by.slice(0, 120), reviewed_at: iso(nowMs) })
    .eq("tenant_id", tenantId)
    .eq("batch_id", batchId)
    .eq("grade", grade)
    .eq("subject_key", subjectKey)
    .eq("source", "publisher_key")
    .eq("review", "pending")
    .in("id", ids)
    .select("id");
  if (error) writeFailed("the approvals", error);
  return { approved: (data ?? []).length };
}

/** Every question already filed under one chapter (any review), so a fresh AI draft can be told what not to repeat. */
export async function chapterPrompts(grade: number, textbookId: string, chapterPosition: number): Promise<string[]> {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("game_questions")
    .select("prompt")
    .eq("tenant_id", tenantId)
    .eq("grade", grade)
    .eq("textbook_id", textbookId)
    .eq("chapter_position", chapterPosition)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) readFailed("the chapter's questions", error);
  return ((data ?? []) as { prompt: string }[]).map((r) => r.prompt);
}

/**
 * The publisher's keyed questions for one class, from the imported papers
 * (exam_papers_desk_slices / papers), as game questions. Only questions that
 * gameQuestionFromPaper accepts; the rest are counted by reason.
 */
export async function questionsFromPapers(ctx: ApiAuthContext, classId: string) {
  const { sb, tenantId } = await db();
  const { data, error } = await sb
    .from("exam_papers_desk_slices")
    .select("payload")
    .eq("tenant_id", tenantId)
    .eq("slice_key", "papers")
    .maybeSingle();
  if (error) readFailed("the question papers", error);
  const raw = Array.isArray((data as { payload?: unknown } | null)?.payload) ? ((data as { payload: unknown[] }).payload as Partial<ExamPaper>[]) : [];
  const papers = raw.map((p) => normalizePaper(p)).filter((p): p is ExamPaper => !!p && p.classId === classId && p.status !== "archived");
  const skipped = new Map<string, number>();
  const accepted: { subjectKey: string; lang: "en" | "hi"; q: QuestionDraft; sourceRef: string }[] = [];
  for (const p of papers) {
    const subject = ctx.masters.subjects.find((s) => s.id === p.subjectId);
    const subjectKey = subjectKeyFor(subject?.nameEn || subject?.code || "") ?? subjectKeyFor(p.title);
    for (const set of p.sets ?? []) {
      for (const sec of set.sections ?? []) {
        for (const q of sec.questions ?? []) {
          if (!subjectKey) {
            skipped.set("subject not recognised", (skipped.get("subject not recognised") ?? 0) + 1);
            continue;
          }
          const g = gameQuestionFromPaper(q);
          if (!g.ok) {
            skipped.set(g.reason, (skipped.get(g.reason) ?? 0) + 1);
            continue;
          }
          accepted.push({ subjectKey, lang: g.lang, q: g.q, sourceRef: `${p.id}:${set.id}:${q.id}` });
        }
      }
    }
  }
  return { papers: papers.length, accepted, skipped: Object.fromEntries(skipped) };
}

/** The class's own books and chapters (Nursery–Class 8 are loaded), for the chapter picker. Fails closed. */
export async function classBooks(grade: number) {
  const { sb, tenantId } = await db();
  const { data: books, error } = await sb
    .from("school_textbooks")
    .select("id, subject_key, name")
    .eq("tenant_id", tenantId)
    .eq("grade", grade)
    .is("retired_at", null)
    .order("id", { ascending: true });
  if (error) readFailed("the class's books", error);
  const list = (books ?? []) as { id: string; subject_key: string; name: string }[];
  if (!list.length) return [];
  const { data: chapters, error: e2 } = await sb
    .from("school_textbook_chapters")
    .select("textbook_id, position, name, topics")
    .eq("tenant_id", tenantId)
    .in(
      "textbook_id",
      list.map((b) => b.id),
    )
    .order("textbook_id", { ascending: true })
    .order("position", { ascending: true })
    .limit(2000);
  if (e2) readFailed("the class's chapters", e2);
  const ch = (chapters ?? []) as { textbook_id: string; position: number; name: string; topics: string[] | null }[];
  return list.map((b) => ({
    textbookId: b.id,
    subjectKey: b.subject_key,
    subjectLabel: subjectDisplayName(b.subject_key),
    name: b.name,
    chapters: ch
      .filter((c) => c.textbook_id === b.id)
      .map((c) => ({ position: Number(c.position), name: c.name, topics: Array.isArray(c.topics) ? c.topics : [] })),
  }));
}
