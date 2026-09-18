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
  type DrillState,
  classifyDrillReply,
  readScopeAnswer,
} from "@/lib/examDrill";

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
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
  };
}

/** The drill still running on this number, if any. */
export async function openDrillFor(mobile10: string): Promise<{ id: string; state: DrillState } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("exam_drill_sessions")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("mobile10", mobile10)
    .neq("phase", "done")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[examDrill] could not read the open drill", error.message);
    return null;
  }
  const row = (data ?? [])[0] as Row | undefined;
  return row ? { id: row.id, state: rowToState(row) } : null;
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

/* ── starting, and every turn after ──────────────────────────────── */

export type DrillTurn = { handled: boolean; replyText: string };

function childClassName(student: SisStudent, masters: Awaited<ReturnType<typeof loadServerMasters>>): string {
  return (masters.classes ?? []).find((c) => c.id === student.classId)?.name ?? "";
}

/**
 * Begin a drill for one child and one paper, and ask the first thing — which
 * is never a question, always the scope.
 */
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
}): Promise<DrillTurn> {
  const nothing: DrillTurn = { handled: false, replyText: "" };
  if (!examDrillEnabled()) return nothing;
  try {
    const open = await openDrillFor(input.mobile10);
    if (!open) return nothing;

    await ensureSisHydratedServer();
    const masters = await loadServerMasters();
    const sis = loadSis();
    const child = sis.students.find((s) => s.id === open.state.studentId);
    if (!child) return nothing;
    const className = childClassName(child, masters);
    const chapters = await chaptersFor(className, open.state.subjectLabel);
    if (!chapters.length) return nothing;

    let state = open.state;
    const parts: string[] = [];
    const said = classifyDrillReply(input.text);

    // 0. "bye", "बस", "so raha hoon" — the child has finished for tonight.
    //    Ending is a decision they are allowed to make; the old loop marked
    //    the goodbye wrong and asked the next question.
    if (said === "stop" && state.phase !== "need_scope") {
      state = { ...state, phase: "done", endedAt: new Date().toISOString() };
      await saveDrill(open.id, state, input.mobile10);
      return {
        handled: true,
        replyText: renderFinish({ state, reason: "stopped", hindi: input.hindi }),
      };
    }

    // 1. The scope, if we are still waiting for it.
    if (state.phase === "need_scope") {
      const scope = readScopeAnswer(input.text, chapters);
      if (scope.kind !== "position") {
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
      // A child who asked for help has not got it wrong, whatever the model
      // returns: 'close' holds the streak where it is, so asking costs them
      // nothing but does not count as having done it either.
      const verdict = askedForHelp ? "close" : checked.draft.verdict;
      state = recordAnswer(state, verdict, {
        answer: input.text,
        check: checked.draft,
      });
      parts.push(renderCheck({ check: checked.draft, hindi: input.hindi, askedForHelp }));
    }

    // 3. What next — the only place this is decided.
    const step = nextDrillStep(state);
    if (step.kind === "finish") {
      state = { ...state, phase: "done", endedAt: new Date().toISOString() };
      await saveDrill(open.id, state, input.mobile10);
      parts.push(renderFinish({ state, reason: step.reason, hindi: input.hindi }));
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
    const q = await drillQuestionJson({
      className,
      subjectLabel: state.subjectLabel,
      chapters,
      scope: state.scope,
      retrySkill: step.retrySkill,
      avoid: step.avoid,
      avoidSkills: step.avoidSkills,
      number: step.number,
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

    state = {
      ...state,
      asked: [...state.asked, { question: q.draft.question, skill: q.draft.skill, chapterPosition: q.draft.chapter }],
    };
    await saveDrill(open.id, state, input.mobile10);
    parts.push(renderQuestion({ number: state.asked.length, question: q.draft.question, hindi: input.hindi }));
    return { handled: true, replyText: parts.join("\n\n") };
  } catch (e) {
    console.error("[examDrill] turn failed", (e as Error)?.message);
    return nothing;
  }
}

export const DRILL_LIMITS = { STREAK_TO_FINISH, MAX_QUESTIONS };
