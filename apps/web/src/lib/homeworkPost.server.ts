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
};

export type PostHomeworkResult =
  | {
      ok: true;
      post: HomeworkPost;
      push: { sent: number; expired: number; failed: number };
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

  const result = createHomeworkPost({
    academicYearCode: input.session.academicYearCode,
    classId: input.classId || "",
    sectionId: input.sectionId || "",
    subjectId: input.subjectId || "",
    teacherStaffId: input.session.staffId || "",
    teacherName: input.session.fullName,
    date: input.date || homeworkTodayIso(),
    title: input.title || "",
    bodyEn: input.bodyEn || "",
    bodyHi: input.bodyHi || "",
    dueAt: input.dueAt || "",
    requiresSubmit: !!input.requiresSubmit,
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

  return { ok: true, post: result.post, push };
}
