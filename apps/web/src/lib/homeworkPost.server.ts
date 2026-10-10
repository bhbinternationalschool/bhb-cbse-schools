/**
 * Publishing homework, server-side — one path, every caller.
 *
 * Getting a homework post to actually persist takes four steps that are
 * easy to get half-right: create it, write it into the server cache
 * (`saveHomework()` inside `createHomeworkPost` is a no-op off the browser,
 * by design), push the desk to the database, then notify the parents.
 * The v1 route had all four inline; the WhatsApp / app command desk needs
 * exactly the same thing, and a second copy is how two near-identical bugs
 * ship. Both callers now come here.
 *
 * Audit is the caller's business — the route stamps the request's IP and
 * user agent, the command desk stamps the channel and the original
 * message — so this function does not write one.
 */

import type { DemoSession } from "@/lib/auth";
import type { MastersState } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import {
  classLabel,
  createHomeworkPost,
  loadHomework,
  rosterForSection,
  subjectLabel,
  writeHomeworkLocalRaw,
  type HomeworkPost,
} from "@/lib/homework";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { sendPushToSubjects } from "@/lib/webPush.server";
import type { HomeworkWaResult } from "@/lib/homeworkWa.server";

export type PostHomeworkInput = {
  session: DemoSession;
  masters: MastersState;
  classId: string;
  sectionId: string;
  subjectId: string;
  title: string;
  bodyEn: string;
  bodyHi?: string;
  /** Defaults to today in IST. */
  date?: string;
  dueAt?: string;
  requiresSubmit?: boolean;
  /** "Ch 6 — Multiples and Factors" — opens the parent app's tutor on the right chapter. */
  aiTutorHint?: string;
  /**
   * Message the parents on WhatsApp too. Default true: a homework post the
   * family never hears about is the state this ERP was already in — one
   * post in production, nought WhatsApps. Pass false for a backfill or an
   * import, which must not message anybody about work set weeks ago.
   */
  notifyWhatsApp?: boolean;
};

export type PostHomeworkResult =
  | {
      ok: true;
      post: HomeworkPost;
      push: { sent: number; expired: number; failed: number };
      wa: HomeworkWaResult;
    }
  | { ok: false; error: string };

/** Today in IST, as the homework desk reckons it. */
export function homeworkTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export async function postHomeworkServer(
  input: PostHomeworkInput,
): Promise<PostHomeworkResult> {
  await ensureSchoolMirrorHydrated();
  await ensureHomeworkHydratedServer();

  // Written out for parents, unless the caller already did it. The class
  // channel expands at DRAFT time so the teacher confirms what the parents
  // will read, and passes both fields; the app, the command desk and the
  // online-class summary do not, and their families deserve the same
  // message. An expansion that fails leaves the teacher's words exactly as
  // typed — see homeworkExpand.server.ts.
  let bodyEn = input.bodyEn || "";
  let title = input.title || "";
  let bodyHi = input.bodyHi || "";
  let aiTutorHint = input.aiTutorHint || "";
  if (!bodyHi && !aiTutorHint && bodyEn.trim()) {
    try {
      const { expandHomeworkForParents } = await import("@/lib/homeworkExpand.server");
      const label = classLabel(input.masters, input.classId, input.sectionId);
      const x = await expandHomeworkForParents({
        classLabel: label,
        className: label,
        subjectLabel: subjectLabel(input.masters, input.subjectId),
        teacherText: bodyEn,
        dueAt: (input.dueAt || "").slice(0, 10),
      });
      bodyEn = x.bodyEn;
      title = title || x.title;
      bodyHi = x.bodyHi;
      aiTutorHint = x.chapterHint;
    } catch (e) {
      console.warn("[homeworkPost] not expanded", (e as Error)?.message);
    }
  }

  const result = createHomeworkPost({
    academicYearCode: input.session.academicYearCode,
    classId: input.classId || "",
    sectionId: input.sectionId || "",
    subjectId: input.subjectId || "",
    teacherStaffId: input.session.staffId || "",
    teacherName: input.session.fullName,
    date: input.date || homeworkTodayIso(),
    title,
    bodyEn,
    bodyHi,
    dueAt: input.dueAt || "",
    requiresSubmit: !!input.requiresSubmit,
    aiTutorHint,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // saveHomework() inside createHomeworkPost is a no-op on the server
  // (localStorage-first design), so persist the mutation into the server
  // cache explicitly before pushing the bundle to the DB.
  const prior = loadHomework();
  const state = prior.posts.some((p) => p.id === result.post.id)
    ? prior
    : { ...prior, posts: [result.post, ...prior.posts] };
  writeHomeworkLocalRaw(state);

  const { pushHomeworkDeskToDb } = await import("@/lib/homeworkNormalized.server");
  const dbPush = await pushHomeworkDeskToDb({
    version: 1,
    posts: state.posts,
    diary: state.diary,
    submissions: state.submissions,
    seen: state.seen,
    settings: state.settings,
  });
  if (!dbPush.ok) {
    console.warn("[homeworkPost] db push failed", dbPush.error);
  }

  // Parents of every active child in the section — best-effort, so a push
  // outage never costs the teacher their post.
  let push = { sent: 0, expired: 0, failed: 0 };
  try {
    await ensureSisHydratedServer();
    const households = rosterForSection(
      loadSis(),
      result.post.sectionId,
      result.post.academicYearCode,
    ).map((stu) => stu.householdId);
    const subject = subjectLabel(input.masters, result.post.subjectId);
    push = await sendPushToSubjects("parent", households, {
      title: `Homework · ${classLabel(input.masters, result.post.classId, result.post.sectionId)}`,
      body: `${subject ? `${subject}: ` : ""}${result.post.title}`,
      url: "/homework",
      data: { kind: "homework", postId: result.post.id },
    });
  } catch (e) {
    console.warn("[homeworkPost] push failed", (e as Error)?.message);
  }

  // The parents, on WhatsApp. Best-effort in exactly the same way as the
  // app push above: a teacher's homework is saved whether or not Meta is
  // reachable, and every failure is written down rather than thrown.
  let wa: HomeworkWaResult = { families: 0, sent: 0, failed: 0, skipped: 0 };
  if (input.notifyWhatsApp !== false) {
    try {
      const { sendHomeworkWhatsApp } = await import("@/lib/homeworkWa.server");
      wa = await sendHomeworkWhatsApp({
        post: result.post,
        classLabel: classLabel(input.masters, result.post.classId, result.post.sectionId),
        subjectLabel: subjectLabel(input.masters, result.post.subjectId),
        bodyHi: result.post.bodyHi,
      });
    } catch (e) {
      console.warn("[homeworkPost] whatsapp failed", (e as Error)?.message);
    }
  }

  return { ok: true, post: result.post, push, wa };
}
