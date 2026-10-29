import "server-only";

/**
 * Homework, classwork and notices in a class's school chat (director, 29 Oct
 * 2026: "In this chat also add posting of homework, classwork or any other
 * messages").
 *
 * ONE RECORD. A homework card in a class or subject group IS the homework
 * desk's post (homework_desk_posts); a classwork card IS its class-diary
 * entry (homework_desk_diary). The chat never copies them: it reads them
 * when the conversation is read, so
 *  - homework posted from the Homework screen (web or app) shows in the
 *    class chat at once, and a post made from the chat is in the Homework
 *    module, the parent app's Homework tab and the WhatsApp homework loop;
 *  - an edit shows everywhere; a withdrawal removes the card.
 * A notice is a chat message (the Notices module has no class audience); it
 * goes through the ordinary send path, so it is checked like any message.
 *
 * WHO POSTS: exactly the Homework module's own rule — homework · edit and
 * the section/subject scope (class teacher: any subject of the class; a
 * subject teacher: their subjects there), the same checks as
 * POST /api/v1/homework/post. And they must be a member of the group.
 *
 * WHATSAPP: unchanged and once. Homework goes through postHomeworkServer,
 * which sends the homework WhatsApp exactly as a Homework-screen post does;
 * the chat adds no WhatsApp of its own. Classwork and notices send none.
 *
 * PUSH: one per post. Homework: postHomeworkServer's parent push (as
 * today). Classwork: one parent push from here. Notice: school chat's own
 * push. Staff members of the group get no extra push for homework or
 * classwork.
 */

import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { assertPermission } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { assertSubjectScope, staffSectionScope, type StaffScope } from "@/lib/api/v1/staffScope";
import type { DiaryEntry, HomeworkPost } from "@/lib/homework";
import { homeworkAttachmentsForReaders, validateHomeworkAttachmentRefs } from "@/lib/homeworkAttachments";
import type { MastersState } from "@/lib/masters";
import { cardText, workForGroup, type WorkCard, type WorkItem } from "@/lib/schoolChatWork";

export { cardText, workForGroup, type WorkCard, type WorkItem };

const subjectName = (masters: MastersState, id: string) => masters.subjects.find((s) => s.id === id)?.nameEn || "";

export function postCard(masters: MastersState, p: HomeworkPost): WorkCard {
  return {
    kind: "homework",
    refId: p.id,
    subjectId: p.subjectId,
    subject: subjectName(masters, p.subjectId),
    title: p.title,
    body: p.bodyEn,
    bodyHi: p.bodyHi,
    dueAt: (p.dueAt || "").slice(0, 10),
    date: p.date,
    attachments: homeworkAttachmentsForReaders(p),
    teacherStaffId: p.teacherStaffId,
    teacherName: p.teacherName,
  };
}

export function diaryCard(d: DiaryEntry): WorkCard {
  return {
    kind: "classwork",
    refId: d.id,
    subjectId: "",
    subject: "",
    title: d.title,
    body: d.bodyEn,
    bodyHi: d.bodyHi,
    dueAt: "",
    date: d.date,
    attachments: [],
    teacherStaffId: d.teacherStaffId,
    teacherName: d.teacherName,
  };
}

/** How long back a chat shows homework and classwork cards. */
export const WORK_DAYS = 45;

/**
 * Cards for these sections (homework of every subject; classwork too),
 * newest first. Throws 503 when the homework desk cannot be read — an
 * empty card list would say "no homework" when the truth is unknown.
 */
export async function readWorkForSections(masters: MastersState, ay: string, sectionIds: string[]): Promise<WorkItem[]> {
  if (!sectionIds.length) return [];
  const { readSectionWorkRows } = await import("@/lib/homeworkNormalized.server");
  const r = await readSectionWorkRows({ academicYearCode: ay, sectionIds, sinceIso: new Date(Date.now() - WORK_DAYS * 86400_000).toISOString() });
  if (!r.ok) {
    console.error(`[school-chat] homework read failed: ${r.reason}`);
    throw new ApiError("server_error", "Could not read the class's homework — please try again.", 503);
  }
  return [
    ...r.posts.map((p) => ({ card: postCard(masters, p), classId: p.classId, sectionId: p.sectionId, createdAt: p.createdAt })),
    ...r.diary.map((d) => ({ card: diaryCard(d), classId: d.classId, sectionId: d.sectionId, createdAt: d.createdAt })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The subjects this person may post homework for in this section — the
 * rule POST /api/v1/homework/post enforces (homework feed's compose list),
 * so the form never offers what will be refused.
 */
export function composeSubjects(masters: MastersState, scope: StaffScope, classId: string, sectionId: string): { id: string; name: string }[] {
  const mine = !scope.unrestricted ? scope.teaching.find((t) => t.classId === classId && t.sectionId === sectionId) : null;
  if (!scope.unrestricted && !(mine?.isClassTeacher && !mine.subjects.length)) {
    return (mine?.subjects ?? []).map((x) => ({ id: x.id, name: x.name }));
  }
  const fromClass = masters.classSubjects
    .filter((l) => l.classId === classId && l.isActive !== false)
    .map((l) => ({ id: l.subjectId, name: subjectName(masters, l.subjectId) }))
    .filter((s) => s.name);
  if (fromClass.length) return fromClass;
  return masters.subjects
    .filter((s) => s.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({ id: s.id, name: s.nameEn }))
    .filter((s) => s.name);
}

/** May this staff session post work in this section at all (homework · edit + a section they teach)? */
export async function workComposerFor(
  ctx: ApiAuthContext,
  classId: string,
  sectionId: string,
): Promise<{ subjects: { id: string; name: string }[] } | null> {
  if (ctx.session.persona !== "staff") return null;
  try {
    assertPermission(ctx, "homework", "edit");
  } catch {
    return null;
  }
  const scope = await staffSectionScope(ctx);
  const key = `${classId}|${sectionId}`;
  if (!scope.unrestricted && !scope.sections.has(key) && !scope.classTeacherOf.has(key)) return null;
  const subjects = composeSubjects(ctx.masters, scope, classId, sectionId);
  return { subjects };
}

export type PostWorkInput = {
  kind?: unknown;
  subjectId?: unknown;
  title?: unknown;
  body?: unknown;
  dueAt?: unknown;
  attachments?: unknown;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Post homework / classwork / a notice into a class or subject group.
 * Returns what was made; the caller re-reads the conversation.
 */
export async function postClassWork(
  ctx: ApiAuthContext,
  conversationId: string,
  input: PostWorkInput,
): Promise<{ kind: "homework" | "classwork" | "notice"; refId: string; wa?: { families: number; sent: number } }> {
  const { chatActor, chatTenant, accessConversation, sendMessage } = await import("@/lib/schoolChat.server");
  if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Only staff post homework, classwork and notices.", 403);
  const kind = String(input.kind || "");
  if (kind !== "homework" && kind !== "classwork" && kind !== "notice") throw new ApiError("bad_request", "Say what this is: homework, classwork or notice.", 400);
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim().slice(0, 1800);
  if (!title) throw new ApiError("bad_request", "Give it a title.", 400);

  const actor = await chatActor(ctx, null);
  const t = await chatTenant();
  const { access } = await accessConversation(ctx, t, actor, conversationId);
  const g = access.group;
  if (!g) throw new ApiError("bad_request", "Homework, classwork and notices go in a class or subject group.", 400);
  if (access.oversight) throw new ApiError("forbidden", "You are looking in as a moderator — you are not a member of this group.", 403);

  if (kind === "notice") {
    const r = await sendMessage(ctx, actor, conversationId, `Notice: ${title}${body ? `\n\n${body}` : ""}`);
    return { kind: "notice", refId: r.message.id };
  }

  // The Homework module's own gates, exactly as POST /api/v1/homework/post.
  assertPermission(ctx, "homework", "edit");
  const subjectId = g.kind === "subject" ? g.subjectId : String(input.subjectId ?? "");
  if (kind === "homework" && !subjectId) throw new ApiError("bad_request", "Pick the subject.", 400);
  await assertSubjectScope(ctx, g.classId, g.sectionId, subjectId);

  if (kind === "homework") {
    const dueAt = String(input.dueAt ?? "").trim();
    if (dueAt && !DATE_RE.test(dueAt)) throw new ApiError("bad_request", "Due date must be a date (YYYY-MM-DD).", 400);
    const files = validateHomeworkAttachmentRefs(input.attachments, g.classId, g.sectionId);
    if (!files.ok) throw new ApiError("bad_request", files.error, 400);
    const { postHomeworkServer } = await import("@/lib/homeworkPost.server");
    const r = await postHomeworkServer({
      // The year and staff id the chat reads cards with (staffWorkingYear,
      // staffChatId), so the post shows in this chat whatever the cookie says.
      session: { ...ctx.session, academicYearCode: actor.ay, staffId: actor.kind === "staff" ? actor.staffId : ctx.session.staffId },
      masters: ctx.masters,
      classId: g.classId,
      sectionId: g.sectionId,
      subjectId,
      title,
      bodyEn: body || title,
      dueAt,
      attachments: files.attachments,
    });
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);
    const { writeAudit } = await import("@/lib/audit.server");
    await writeAudit({
      session: ctx.session,
      module: "homework",
      action: "edit",
      entityType: "post",
      entityId: r.post.id,
      summary: `Posted homework "${r.post.title}" for section ${g.sectionId} from school chat`,
      after: { date: r.post.date, subjectId: r.post.subjectId, attachments: r.post.attachments.length, via: "school-chat" },
    });
    return { kind: "homework", refId: r.post.id, wa: { families: r.wa.families, sent: r.wa.sent } };
  }

  // Classwork = the class diary (what was done in class today). The diary
  // has no subject column, so the subject leads the title.
  const sub = subjectId ? subjectName(ctx.masters, subjectId) : "";
  const now = new Date().toISOString();
  const entry: DiaryEntry = {
    id: `dy_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    academicYearCode: actor.ay,
    classId: g.classId,
    sectionId: g.sectionId,
    teacherStaffId: actor.kind === "staff" ? actor.staffId : "",
    teacherName: ctx.session.fullName,
    date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    title: sub && !title.toLowerCase().startsWith(sub.toLowerCase()) ? `${sub}: ${title}` : title,
    bodyEn: body || title,
    bodyHi: "",
    createdAt: now,
    updatedAt: now,
  };
  const { writeHomeworkLists } = await import("@/lib/homeworkNormalized.server");
  const w = await writeHomeworkLists(t.sb, t.tenantId, { posts: [], diary: [entry], submissions: [], seen: [] });
  if (!w.ok) {
    console.error(`[school-chat] classwork write failed: ${w.error}`);
    throw new ApiError("server_error", "Could not save the classwork — nothing was changed. Please try again.", 503);
  }
  // One push to the section's families (best-effort; the entry is saved).
  try {
    const { sendPushToSubjects } = await import("@/lib/webPush.server");
    const { data } = await t.sb
      .from("sis_students")
      .select("household_id")
      .eq("tenant_id", t.tenantId)
      .eq("class_id", g.classId)
      .eq("section_id", g.sectionId)
      .eq("academic_year_code", actor.ay)
      .eq("status", "active")
      .limit(500);
    const households = [...new Set(((data ?? []) as { household_id: string | null }[]).map((r) => r.household_id || "").filter(Boolean))];
    await sendPushToSubjects("parent", households, {
      title: `Classwork · ${access.title.split(" · ")[0]}`,
      body: entry.title,
      url: `/school-chat?c=${encodeURIComponent(conversationId)}`,
      data: { kind: "school_chat", conversationId },
    });
  } catch (e) {
    console.warn("[school-chat] classwork push failed:", e instanceof Error ? e.message : e);
  }
  return { kind: "classwork", refId: entry.id };
}

/**
 * Withdraw a homework post from the chat — the Homework module's own
 * withdrawal (status "withdrawn", stamped now so no older copy brings it
 * back). The card leaves the chat, the post leaves the Homework tab. Only
 * someone who may post that homework (homework · edit and its scope).
 */
export async function withdrawHomeworkFromChat(ctx: ApiAuthContext, postId: string): Promise<{ id: string; status: "withdrawn" }> {
  if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff only.", 403);
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(postId)) throw new ApiError("bad_request", "postId required", 400);
  assertPermission(ctx, "homework", "edit");
  const { readHomeworkPostById, writeHomeworkLists } = await import("@/lib/homeworkNormalized.server");
  const r = await readHomeworkPostById(postId);
  if (!r.ok) throw new ApiError("server_error", "Could not read the homework — please try again.", 503);
  if (!r.post) throw new ApiError("not_found", "No such homework.", 404);
  await assertSubjectScope(ctx, r.post.classId, r.post.sectionId, r.post.subjectId);
  if (r.post.status === "withdrawn") return { id: postId, status: "withdrawn" };
  const { chatTenant } = await import("@/lib/schoolChat.server");
  const t = await chatTenant();
  const w = await writeHomeworkLists(t.sb, t.tenantId, {
    posts: [{ ...r.post, status: "withdrawn", updatedAt: new Date().toISOString() }],
    diary: [],
    submissions: [],
    seen: [],
  });
  if (!w.ok) throw new ApiError("server_error", "Could not withdraw it — nothing was changed. Please try again.", 503);
  const { writeAudit } = await import("@/lib/audit.server");
  await writeAudit({
    session: ctx.session,
    module: "homework",
    action: "edit",
    entityType: "post",
    entityId: postId,
    summary: `Withdrew homework "${r.post.title}" from school chat`,
    after: { status: "withdrawn", via: "school-chat" },
  });
  return { id: postId, status: "withdrawn" };
}
