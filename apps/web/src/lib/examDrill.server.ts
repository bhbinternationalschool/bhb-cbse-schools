import "server-only";

/**
 * The revision drill, running. See examDrill.ts for the loop and its rules.
 *
 * This file holds the state, fetches the child's next paper and their own
 * book's chapters, asks the model for one question or one marking, and
 * answers on WhatsApp. It decides nothing about the drill itself — every
 * "what next" comes from `nextDrillStep`.
 *
 * OFF BY DEFAULT. `EXAM_DRILL_ENABLED` has to be set. The half-yearly is
 * running as this is written, with seven paper days left, and a drill engine
 * that has never spoken to a child does not get to introduce itself during
 * somebody's exam week without a person deciding so.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { childrenOfHousehold, loadSis, type Household, type SisStudent } from "@/lib/sis";
import { currentAcademicYearCode } from "@/lib/masters";
import { subjectKeyFor, subjectDisplayName, cleanChapterName } from "@/lib/tutorSyllabus";
import { schoolBooksForClass } from "@/lib/tutorSyllabus.server";
import {
  buildSkillMenu,
  foundationLine,
  refsForComponentIds,
  renderSkillMenu,
  skillAtRef,
  type AgreedSkill,
} from "@/lib/drillSkills";
import {
  loadAgreedSkillsByPosition,
  loadFoundationStatements,
} from "@/lib/chapterStandards.server";
import {
  MAX_QUESTIONS,
  STREAK_TO_FINISH,
  newDrill,
  nextDrillStep,
  parseScopeAnswer,
  recordAnswer,
  renderCheck,
  renderFinish,
  renderQuestion,
  renderScopeQuestion,
  renderScopeUnclear,
  type DrillChapter,
  type DrillAsked,
  type DrillState,
  classifyDrillReply,
  readScopeAnswer,
  MAX_ASIDES,
  renderAside,
  renderAsideFailed,
  drillIsForAPastPaper,
  paperLanguageFor,
  renderChapterVideos,
  renderTopicVideo,
  subjectNameForModel,
  type DrillVideo,
} from "@/lib/examDrill";
import { childNamedForPractice, familyPapersOn, isPracticeTap, isTimetableRequest } from "@/lib/examEve";
import { eveFamilyFor, istTodayIso, loadExamSetup, otherChildrenLine } from "@/lib/examEve.server";

export function examDrillEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.EXAM_DRILL_ENABLED || "");
}

/* ── the state, as the database keeps it ─────────────────────────── */

type Row = {
  id: string;
  student_id: string;
  paper_date: string;
  subject_label: string;
  paper_label: string;
  mobile10: string;
  scope: number;
  phase: DrillState["phase"];
  asked: DrillState["asked"];
  streak: number;
  asides?: number | null;
  started_at: string;
  ended_at: string | null;
};

function rowToState(r: Row): DrillState {
  return {
    studentId: r.student_id,
    subjectLabel: r.subject_label,
    paperLabel: r.paper_label,
    paperDate: r.paper_date,
    scope: Number(r.scope) || 0,
    phase: r.phase,
    asked: Array.isArray(r.asked) ? r.asked : [],
    streak: Number(r.streak) || 0,
    asides: Number(r.asides) || 0,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
  };
}

/**
 * The drill still running on this number, if any.
 *
 * "Still running" means two things, and until 21 Sep 2026 it only checked
 * one of them: not finished, AND about a paper that has not been written
 * yet. See `drillIsForAPastPaper` for the thirty-one families that proved
 * the second half was needed.
 */
export async function openDrillFor(mobile10: string): Promise<{ id: string; state: DrillState } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const today = istTodayIso();
  const { data, error } = await ctx.sb
    .from("exam_drill_sessions")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("mobile10", mobile10)
    .neq("phase", "done")
    .gte("paper_date", today)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[examDrill] could not read the open drill", error.message);
    return null;
  }
  const row = (data ?? [])[0] as Row | undefined;
  if (!row) return null;
  // The query above excludes yesterday's papers; this also ends the drill
  // for a paper written THIS morning, which the date alone cannot see. The
  // cost of being wrong is a child marked wrong — or, on 22 Sep 2026, a
  // father asking about tomorrow's paper and being asked for a chapter
  // number for a paper already handed in.
  const istHour = new Date(Date.now() + 330 * 60_000).getUTCHours();
  if (drillIsForAPastPaper(row.paper_date, today, istHour)) return null;
  return { id: row.id, state: rowToState(row) };
}

/**
 * Has this number practised tonight — any drill, open or finished, touched
 * since midnight IST?
 *
 * The context that turns a bare child's name into "practise this one now"
 * (childNamedForPractice). An unreadable table is "no": the name then goes
 * to the ordinary flow, which is where it went before.
 */
export async function drillTouchedToday(mobile10: string): Promise<boolean> {
  const ctx = await getServerTenantContext();
  if (!ctx) return false;
  const since = new Date(`${istTodayIso()}T00:00:00+05:30`).toISOString();
  const { data, error } = await ctx.sb
    .from("exam_drill_sessions")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("mobile10", mobile10)
    .gte("updated_at", since)
    .limit(1);
  if (error) {
    console.warn("[examDrill] could not read tonight's drills", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Brothers and sisters with a paper the same day as this drill, as the line
 * that tells the parent how to start theirs — "" when there are none or the
 * date sheet cannot be read.
 */
async function siblingsLine(household: Household, state: DrillState, hindi: boolean): Promise<string> {
  try {
    const setup = await loadExamSetup();
    const family = eveFamilyFor(household, setup.academicYearCode, setup.classNames);
    const papers = familyPapersOn(family, setup.slots, setup.subjectNames, state.paperDate);
    return otherChildrenLine(papers, state.studentId, hindi);
  } catch (e) {
    console.warn("[examDrill] could not list the other children", (e as Error)?.message);
    return "";
  }
}

/**
 * Tonight's most recent drill on this number, if it has finished and its
 * paper is still to come — the one "another round" restarts.
 */
async function finishedDrillTonight(mobile10: string): Promise<{ id: string; state: DrillState } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const today = istTodayIso();
  const { data, error } = await ctx.sb
    .from("exam_drill_sessions")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("mobile10", mobile10)
    .gte("paper_date", today)
    .gte("updated_at", new Date(`${today}T00:00:00+05:30`).toISOString())
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[examDrill] could not read tonight's finished drill", error.message);
    return null;
  }
  const row = (data ?? [])[0] as Row | undefined;
  if (!row || row.phase !== "done") return null;
  const istHour = new Date(Date.now() + 330 * 60_000).getUTCHours();
  if (drillIsForAPastPaper(row.paper_date, today, istHour)) return null;
  const done = rowToState(row);
  return {
    id: row.id,
    state: newDrill({
      studentId: done.studentId,
      subjectLabel: done.subjectLabel,
      paperLabel: done.paperLabel,
      paperDate: done.paperDate,
      nowIso: new Date().toISOString(),
    }),
  };
}

/**
 * Close every open drill on this number except `keepId`.
 *
 * A drill's id is `drl_<student>_<paperDate>`, so each paper gets a row of
 * its own and the previous one was simply abandoned where it stood. Those
 * abandoned rows are what `openDrillFor` kept finding.
 */
async function closeOtherDrills(mobile10: string, keepId: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { error } = await ctx.sb
    .from("exam_drill_sessions")
    .update({ phase: "done", ended_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("mobile10", mobile10)
    .neq("phase", "done")
    .neq("id", keepId);
  if (error) console.warn("[examDrill] could not close the earlier drills", error.message);
}

/**
 * Every number the tutor is currently waiting on for an answer.
 *
 * The chat-close sweep uses this. On 18 Sep 2026 it thanked 24 families
 * for their chat thirty minutes after they tapped "practice" — and ten of
 * those were mid-drill, nine of them sitting on the tutor's own question
 * ("which portion is the exam on?"). A child who goes to fetch the book
 * came back to a goodbye.
 *
 * `null` means the table could not be read. That is NOT "nobody is
 * waiting": the caller must treat an unreadable state as a reason to stay
 * quiet, never as permission to send ([[erp-unknown-must-not-become-fact]]).
 */
export async function mobilesAwaitingDrillReply(
  now: Date = new Date(),
): Promise<Set<string> | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  // A drill nobody has touched for half a day is abandoned, not waiting —
  // otherwise one unanswered question silences that family for good.
  const since = new Date(now.getTime() - 12 * 3_600_000).toISOString();
  const { data, error } = await ctx.sb
    .from("exam_drill_sessions")
    .select("mobile10")
    .eq("tenant_id", ctx.tenantId)
    .neq("phase", "done")
    // A drill for a paper already written is not waiting on anybody either.
    .gte("paper_date", istTodayIso())
    .gte("updated_at", since);
  if (error) {
    console.warn("[examDrill] could not read open drills", error.message);
    return null;
  }
  const out = new Set<string>();
  for (const r of (data ?? []) as { mobile10: string | null }[]) {
    if (r.mobile10) out.add(String(r.mobile10));
  }
  return out;
}

async function saveDrill(id: string, state: DrillState, mobile10: string): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { error } = await ctx.sb.from("exam_drill_sessions").upsert(
    {
      tenant_id: ctx.tenantId,
      id,
      student_id: state.studentId,
      paper_date: state.paperDate,
      subject_label: state.subjectLabel,
      paper_label: state.paperLabel,
      mobile10,
      scope: state.scope,
      phase: state.phase,
      asked: state.asked,
      streak: state.streak,
      asides: state.asides ?? 0,
      started_at: state.startedAt,
      ended_at: state.endedAt ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,id" },
  );
  if (error) console.warn("[examDrill] could not save the drill", error.message);
}

/* ── the chapters the questions may come from ────────────────────── */

/**
 * The child's own book for that subject, as chapters.
 *
 * Empty when the school's book for that class is not loaded — and then the
 * drill does not run at all, because a question set from nothing is a
 * question set from the model's memory of some other school's syllabus.
 */
async function chaptersFor(className: string, subjectLabel: string): Promise<DrillChapter[]> {
  const key = subjectKeyFor(subjectLabel);
  if (!key) return [];
  const wanted = subjectDisplayName(key);
  const { books, chapters } = await schoolBooksForClass(className);
  const book = books.filter((b) => b.subjects.includes(wanted))[0];
  if (!book) return [];
  return chapters
    .filter((c) => c.textbookId === book.id)
    .map((c) => ({ position: c.position, name: cleanChapterName(c.name), topics: c.topics ?? [] }))
    .sort((a, b) => a.position - b.position);
}

/**
 * The agreed micro-skills for this paper's chapters, as a numbered menu.
 *
 * Empty for most drills, and that is the point: Classes 1–2, Science and
 * English carry no components, and a chapter nobody has agreed outcomes for
 * contributes nothing. An empty menu puts nothing in the prompt and the
 * question is set exactly as it was before any of this existed.
 *
 * Never throws. A revision question the night before a paper must not fail
 * because a lookup did.
 */
async function skillMenuFor(
  className: string,
  subjectLabel: string,
  scope: number,
): Promise<AgreedSkill[]> {
  if (!(scope >= 1)) return [];
  try {
    const byPosition = await loadAgreedSkillsByPosition({
      classLabel: className,
      subjectName: subjectLabel,
    });
    return buildSkillMenu(byPosition, scope);
  } catch (e) {
    console.warn("[examDrill] agreed skills lookup failed", (e as Error)?.message);
    return [];
  }
}

/** What sits underneath the idea they just got wrong. "" whenever unknown. */
async function foundationFor(componentId: string | null): Promise<string> {
  if (!componentId) return "";
  try {
    return foundationLine(await loadFoundationStatements(componentId));
  } catch (e) {
    console.warn("[examDrill] prerequisite lookup failed", (e as Error)?.message);
    return "";
  }
}

/* ── starting, and every turn after ──────────────────────────────── */

export type DrillTurn = { handled: boolean; replyText: string };

function childClassName(student: SisStudent, masters: Awaited<ReturnType<typeof loadServerMasters>>): string {
  return (masters.classes ?? []).find((c) => c.id === student.classId)?.name ?? "";
}

/**
 * Begin a drill for one child and one paper, and ask the first thing — which
 * is never a question, always the scope.
 */
/**
 * A video for one topic of this paper — English-medium for every paper but
 * Hindi/Sanskrit. Bounded: the reply to a child waits for it at most a few
 * seconds, and a slow or failed search simply sends no video.
 */
async function drillVideo(opts: {
  topic: string;
  subjectLabel: string;
  className: string;
  householdId: string;
  timeoutMs?: number;
}): Promise<{ video: DrillVideo | null; searchUrl: string }> {
  try {
    const { searchTutorVideos } = await import("@/lib/tutorVideos.server");
    const lang = paperLanguageFor(opts.subjectLabel) === "english" ? "en" : "hi";
    const search = searchTutorVideos({
      topic: `${subjectNameForModel(opts.subjectLabel)}: ${opts.topic}`,
      classLabel: opts.className,
      language: lang,
      formats: ["youtube", "mp4"],
      requester: `hh:${opts.householdId}`,
    });
    const r = await Promise.race([
      search,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), opts.timeoutMs ?? 6000)),
    ]);
    if (!r) return { video: null, searchUrl: "" };
    const first = r.items[0];
    return { video: first ? { title: first.title, url: first.url } : null, searchUrl: r.searchUrl };
  } catch (e) {
    console.warn("[examDrill] video search failed", (e as Error)?.message);
    return { video: null, searchUrl: "" };
  }
}

/** One video per chapter of the portion, searched together. */
async function chapterVideos(opts: {
  chapters: DrillChapter[];
  scope: number;
  subjectLabel: string;
  className: string;
  householdId: string;
  hindi: boolean;
}): Promise<string> {
  const inScope = opts.chapters.filter((c) => c.position <= opts.scope).slice(0, 6);
  if (!inScope.length) return "";
  const rows = await Promise.all(
    inScope.map(async (c) => ({
      chapter: c.name,
      ...(await drillVideo({ topic: c.name, subjectLabel: opts.subjectLabel, className: opts.className, householdId: opts.householdId, timeoutMs: 9000 })),
    })),
  );
  return renderChapterVideos(rows, opts.hindi, rows.find((r) => r.searchUrl)?.searchUrl ?? "");
}

/**
 * Anything asked in the middle of the practice — a question of their own, a
 * request, general knowledge — answered in full, then the practice question
 * put back. Never marked (director, 21 Sep 2026: "treat it as an AI search
 * engine").
 */
async function answerAside(opts: {
  text: string;
  state: DrillState;
  pendingQ: DrillAsked;
  child: SisStudent;
  className: string;
  mobile10: string;
  drillId: string;
  hindi: boolean;
}): Promise<DrillTurn> {
  const used = opts.state.asides ?? 0;
  const back = renderQuestion({ number: opts.state.asked.length, question: opts.pendingQ.question, questionHi: opts.pendingQ.questionHi, hindi: opts.hindi });
  if (used >= MAX_ASIDES) {
    return {
      handled: true,
      replyText: [
        opts.hindi ? "आज के लिए बहुत सवाल हो गए 🙏 पेपर कल है — अभ्यास पूरा कर लेते हैं:" : "That's plenty of questions for tonight 🙏 The paper is tomorrow — let's finish the practice:",
        "",
        back,
      ].join("\n"),
    };
  }
  const { replyHomeworkTutor } = await import("@/lib/homeworkTutor.server");
  const answered = await replyHomeworkTutor({
    message: opts.text.slice(0, 600),
    mode: "teach",
    language: paperLanguageFor(opts.state.subjectLabel) === "english" ? "both" : "hi",
    context: {
      childName: opts.child.fullName.split(/\s+/)[0] || opts.child.fullName,
      className: opts.className,
      subjectLabel: opts.state.subjectLabel,
      openQuestion: true,
    },
  });
  const state = { ...opts.state, asides: used + 1 };
  await saveDrill(opts.drillId, state, opts.mobile10);
  return {
    handled: true,
    replyText: answered.ok
      ? renderAside({ answer: answered.text, question: opts.pendingQ.question, questionHi: opts.pendingQ.questionHi, number: state.asked.length, hindi: opts.hindi })
      : [renderAsideFailed(opts.hindi), "", back].join("\n"),
  };
}

export async function startExamDrill(input: {
  household: Household;
  studentId: string;
  mobile10: string;
  subjectLabel: string;
  paperLabel: string;
  paperDate: string;
  hindi: boolean;
}): Promise<DrillTurn> {
  if (!examDrillEnabled()) return { handled: false, replyText: "" };
  await ensureSisHydratedServer();
  const masters = await loadServerMasters();
  const ay = currentAcademicYearCode(masters);
  const child = childrenOfHousehold(loadSis(), input.household.id, ay).find((c) => c.id === input.studentId);
  if (!child) return { handled: false, replyText: "" };

  const chapters = await chaptersFor(childClassName(child, masters), input.subjectLabel);
  if (!chapters.length) {
    // No book, no drill. The ordinary tutor still answers whatever they ask;
    // this only declines to invent a syllabus.
    console.warn("[examDrill] no chapters for", childClassName(child, masters), input.subjectLabel);
    return { handled: false, replyText: "" };
  }

  const state = newDrill({
    studentId: child.id,
    subjectLabel: input.subjectLabel,
    paperLabel: input.paperLabel,
    paperDate: input.paperDate,
    nowIso: new Date().toISOString(),
  });
  const id = `drl_${child.id}_${input.paperDate}`.replace(/[^A-Za-z0-9_-]/g, "");
  await saveDrill(id, state, input.mobile10);
  // Tonight's paper is the only one being revised. Anything still open on
  // this number is last paper's, and leaving it open is what let it come
  // back to haunt the family two days later.
  await closeOtherDrills(input.mobile10, id);

  return {
    handled: true,
    replyText: renderScopeQuestion({
      childName: child.fullName.split(/\s+/)[0] || child.fullName,
      subjectLabel: input.subjectLabel,
      paperLabel: input.paperLabel,
      chapters,
      hindi: input.hindi,
    }),
  };
}

/**
 * One inbound message from a family with a drill running: the scope, or an
 * answer. Never throws; a failure hands the message back to the ordinary
 * tutor rather than swallowing a child's reply.
 */
export async function continueExamDrill(input: {
  household: Household;
  mobile10: string;
  text: string;
  hindi: boolean;
  /**
   * The bot's last message on this thread ended a drill with an invitation
   * to send a chapter for another round (isAnotherRoundInvite).
   */
  afterFinish?: boolean;
}): Promise<DrillTurn> {
  const nothing: DrillTurn = { handled: false, replyText: "" };
  if (!examDrillEnabled()) return nothing;
  // The practice button is never an answer. It is a parent starting again,
  // so it belongs to exam-eve, which knows which paper is next — and this
  // handler runs first. On 20 Sep 2026 thirteen of the forty-six taps were
  // eaten here: six graded ❌ against a question from a paper already
  // written, seven answered with "send the chapter number" for a syllabus
  // nobody had asked about.
  if (isPracticeTap(input.text)) return nothing;
  try {
    let open = await openDrillFor(input.mobile10);
    // "2" or "Role of computer" straight after "send a chapter number for
    // another round": a fresh round of the same paper, from that chapter.
    // Only when the reply actually names a chapter (checked below) — "ok"
    // after a finished drill is still the end of the evening.
    const anotherRound = !open && !!input.afterFinish;
    if (anotherRound) open = await finishedDrillTonight(input.mobile10);
    if (!open) return nothing;

    await ensureSisHydratedServer();
    const masters = await loadServerMasters();
    const sis = loadSis();
    const child = sis.students.find((s) => s.id === open.state.studentId);
    if (!child) return nothing;
    const className = childClassName(child, masters);
    const chapters = await chaptersFor(className, open.state.subjectLabel);
    if (!chapters.length) return nothing;
    if (anotherRound && readScopeAnswer(input.text, chapters).kind !== "position") return nothing;

    // Not for this drill at all — the date sheet, or a brother or sister.
    //
    // 23 Sep 2026: MR. GHANSHYAM MAURYA asked mid-way through RUDRA's Maths
    // which subject his other son ABHISHEK had tomorrow, and was told by the
    // drill's tutor to ask the office. The date sheet is in this bot; the
    // exam-eve handler right after this one answers it. The same evening
    // MR. VIKAL KUMAR GUPTA typed "Jayash", his other son's name, and got a
    // lesson on joysticks. Both go on to exam-eve, which answers the first
    // and starts the named child's practice for the second. The question
    // left here waits; the drill for this child is closed only if the other
    // child's practice starts (startExamDrill closes the rest).
    if (isTimetableRequest(input.text)) return nothing;
    const siblings = childrenOfHousehold(sis, input.household.id, currentAcademicYearCode(masters))
      .filter((s) => s.id !== child.id)
      .map((s) => ({ studentId: s.id, name: s.fullName }));
    if (siblings.length && childNamedForPractice(input.text, siblings)) return nothing;

    let state = open.state;
    const parts: string[] = [];
    const said = classifyDrillReply(input.text);
    // A message to the school ("Hello sir online registration") is not an
    // answer: the ordinary bot takes it, and the question waits.
    if (said === "school") return nothing;

    // 0. "bye", "बस", "so raha hoon" — the child has finished for tonight.
    //    Ending is a decision they are allowed to make; the old loop marked
    //    the goodbye wrong and asked the next question.
    // Also while the chapter is still being asked for (22 Sep 2026: "मैं
    // तुमसे सुबह पूछूंगी" got "यह समझ नहीं आया" — the drill had not started).
    if (said === "stop") {
      state = { ...state, phase: "done", endedAt: new Date().toISOString() };
      await saveDrill(open.id, state, input.mobile10);
      const stopChapters = state.scope ? await chaptersFor(className, state.subjectLabel) : [];
      const videos = stopChapters.length
        ? await chapterVideos({ chapters: stopChapters, scope: state.scope, subjectLabel: state.subjectLabel, className, householdId: input.household.id, hindi: input.hindi })
        : "";
      return {
        handled: true,
        replyText: [renderFinish({ state, reason: "stopped", hindi: input.hindi }), videos].filter(Boolean).join("\n\n"),
      };
    }

    const pendingQ = state.asked[state.asked.length - 1];

    // 0a. "ok", "ठीक है", a folded-hands emoji. Politeness, not an attempt.
    //     Put the question back rather than marking it wrong — and ask the
    //     scope again in full, which is more use than "that was not a
    //     chapter number".
    if (said === "chatter") {
      if (state.phase === "need_scope") {
        return {
          handled: true,
          replyText: renderScopeQuestion({
            childName: child.fullName.split(/\s+/)[0] || child.fullName,
            subjectLabel: state.subjectLabel,
            paperLabel: state.paperLabel,
            chapters,
            hindi: input.hindi,
          }),
        };
      }
      if (pendingQ && !pendingQ.verdict) {
        return {
          handled: true,
          replyText: renderQuestion({
            number: state.asked.length,
            question: pendingQ.question,
            questionHi: pendingQ.questionHi,
            hindi: input.hindi,
          }),
        };
      }
      return nothing;
    }

    // 0b. A question of their own, about their own subject. The drill
    //     answers it from their own textbook and then puts its question
    //     back — until 19 Sep 2026 this was marked wrong and the child was
    //     moved on, which is the opposite of teaching.
    if (
      said === "question" &&
      state.phase === "asking" &&
      pendingQ &&
      !pendingQ.verdict
    ) {
      return await answerAside({ text: input.text, state, pendingQ, child, className, mobile10: input.mobile10, drillId: open.id, hindi: input.hindi });
    }

    // 1. The scope, if we are still waiting for it.
    if (state.phase === "need_scope") {
      const scope = readScopeAnswer(input.text, chapters);
      if (scope.kind !== "position") {
        // A question of their own before the practice starts ("Maths ka
        // first chapter ascending order kaise karein?", 22 Sep 2026) is
        // answered, then the chapter question is asked again — it used to
        // get "यह समझ नहीं आया" three times running.
        if (said === "question" || said === "help" || input.text.trim().split(/\s+/).length >= 4) {
          const { replyHomeworkTutor } = await import("@/lib/homeworkTutor.server");
          const answered = await replyHomeworkTutor({
            message: input.text.slice(0, 600),
            mode: "teach",
            language: paperLanguageFor(state.subjectLabel) === "english" ? "both" : "hi",
            context: {
              childName: child.fullName.split(/\s+/)[0] || child.fullName,
              className,
              subjectLabel: state.subjectLabel,
              openQuestion: true,
            },
          });
          if (answered.ok) {
            return {
              handled: true,
              replyText: [
                answered.text.trim(),
                "",
                input.hindi ? "— अब अभ्यास के लिए 👇" : "— now for the practice 👇",
                "",
                renderScopeQuestion({
                  childName: child.fullName.split(/\s+/)[0] || child.fullName,
                  subjectLabel: state.subjectLabel,
                  paperLabel: state.paperLabel,
                  chapters,
                  hindi: input.hindi,
                }),
              ].join("\n"),
            };
          }
        }
        return { handled: true, replyText: renderScopeUnclear(input.hindi) };
      }
      state = { ...state, scope: scope.position, phase: "asking" };
    } else if (state.asked.length && !state.asked[state.asked.length - 1]!.verdict) {
      // 2. An answer to the question we asked. Marked before anything else
      //    happens, and the child reads the marking before the next question.
      const last = state.asked[state.asked.length - 1]!;
      const { drillCheckJson } = await import("@/lib/aiLlm.server");
      const askedForHelp = said === "help";
      const checked = await drillCheckJson({
        className,
        subjectLabel: state.subjectLabel,
        question: last.question,
        skill: last.skill,
        answer: input.text.slice(0, 600),
        askedForHelp,
        // Whose phone this is read on. The frames around the marking have
        // always been in this language; until 21 Sep 2026 the marking
        // itself followed the subject instead, so the two disagreed.
        hindi: input.hindi,
      });
      if (!checked.ok) {
        // Say nothing rather than guess a verdict about a child's work.
        console.warn("[examDrill] could not mark", checked.error);
        return {
          handled: true,
          replyText: input.hindi
            ? "अभी जाँच नहीं हो पा रही 🙏 थोड़ी देर बाद उत्तर दोबारा भेजिए।"
            : "I could not check that just now 🙏 Please send your answer again in a moment.",
        };
      }
      // Not an attempt at the question at all — a question of their own, a
      // request, anything else (director, 21 Sep 2026). Answer it properly
      // and put the practice question back; nothing is marked.
      if (checked.draft.notAnAnswer && !askedForHelp) {
        if (classifyDrillReply(input.text) === "school") return nothing;
        return await answerAside({ text: input.text, state, pendingQ: last, child, className, mobile10: input.mobile10, drillId: open.id, hindi: input.hindi });
      }
      // A child who asked for help has not got it wrong, whatever the model
      // returns: 'close' holds the streak where it is, so asking costs them
      // nothing but does not count as having done it either.
      const verdict = askedForHelp ? "close" : checked.draft.verdict;
      state = recordAnswer(state, verdict, {
        answer: input.text,
        check: checked.draft,
      });
      parts.push(renderCheck({ check: checked.draft, hindi: input.hindi, askedForHelp }));
      // Wrong, close or asked for help: a video on the idea they missed.
      if (verdict !== "right") {
        const chapterName = chapters.find((c) => c.position === last.chapterPosition)?.name ?? "";
        const v = await drillVideo({
          topic: [last.skill, chapterName].filter(Boolean).join(" — "),
          subjectLabel: state.subjectLabel,
          className,
          householdId: input.household.id,
        });
        const line = renderTopicVideo(v.video, input.hindi);
        if (line) parts.push(line);
      }
    }

    // 3. What next — the only place this is decided.
    const step = nextDrillStep(state);
    if (step.kind === "finish") {
      state = { ...state, phase: "done", endedAt: new Date().toISOString() };
      await saveDrill(open.id, state, input.mobile10);
      parts.push(renderFinish({ state, reason: step.reason, hindi: input.hindi }));
      const videos = await chapterVideos({ chapters, scope: state.scope, subjectLabel: state.subjectLabel, className, householdId: input.household.id, hindi: input.hindi });
      if (videos) parts.push(videos);
      // One child is done; say how to start the next one's.
      const next = await siblingsLine(input.household, state, input.hindi);
      if (next) parts.push(next);
      return { handled: true, replyText: parts.join("\n\n") };
    }
    if (step.kind === "ask_scope") {
      await saveDrill(open.id, state, input.mobile10);
      return {
        handled: true,
        replyText: renderScopeQuestion({
          childName: child.fullName.split(/\s+/)[0] || child.fullName,
          subjectLabel: state.subjectLabel,
          paperLabel: state.paperLabel,
          chapters,
          hindi: input.hindi,
        }),
      };
    }

    const { drillQuestionJson } = await import("@/lib/aiLlm.server");
    // Both reads are for the same question, and neither is on the critical
    // path of the other, so they go together — a child waiting on WhatsApp
    // should not pay for them twice.
    const [menu, retryFoundation] = await Promise.all([
      skillMenuFor(className, state.subjectLabel, state.scope),
      foundationFor(step.retryComponentId),
    ]);
    const q = await drillQuestionJson({
      className,
      subjectLabel: state.subjectLabel,
      chapters,
      scope: state.scope,
      retrySkill: step.retrySkill,
      avoid: step.avoid,
      avoidSkills: step.avoidSkills,
      number: step.number,
      skillMenu: renderSkillMenu(menu),
      menuSize: menu.length,
      avoidRefs: refsForComponentIds(menu, step.askedComponentIds),
      retryFoundation,
    });
    if (!q.ok) {
      await saveDrill(open.id, state, input.mobile10);
      parts.push(
        input.hindi
          ? "अगला प्रश्न अभी नहीं बन पाया 🙏 *PRACTICE* लिखकर दोबारा कोशिश कीजिए।"
          : "I could not set the next question just now 🙏 Send *PRACTICE* to try again.",
      );
      return { handled: true, replyText: parts.join("\n\n") };
    }

    const pickedSkill = skillAtRef(menu, q.draft.skillRef);
    state = {
      ...state,
      asked: [
        ...state.asked,
        {
          question: q.draft.question,
          ...(q.draft.questionHi ? { questionHi: q.draft.questionHi } : {}),
          skill: q.draft.skill,
          // Stored only when the model named a menu item we actually listed;
          // `skillAtRef` refuses anything else, so an invented number leaves
          // the question unattributed rather than attributed to the wrong idea.
          ...(pickedSkill ? { componentId: pickedSkill.componentId } : {}),
          chapterPosition: q.draft.chapter,
        },
      ],
    };
    await saveDrill(open.id, state, input.mobile10);
    parts.push(renderQuestion({ number: state.asked.length, question: q.draft.question, questionHi: q.draft.questionHi, hindi: input.hindi }));
    return { handled: true, replyText: parts.join("\n\n") };
  } catch (e) {
    console.error("[examDrill] turn failed", (e as Error)?.message);
    return nothing;
  }
}

export const DRILL_LIMITS = { STREAK_TO_FINISH, MAX_QUESTIONS };
