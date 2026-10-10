import "server-only";

/**
 * Homework submitted on WhatsApp — the side that touches the world.
 *
 * See homeworkSubmission.ts for what this is and why the 24-hour window
 * makes it worth more than convenience. This file finds the homework a
 * photograph belongs to, files it, tells the teacher, and carries the
 * teacher's reply back to the family.
 *
 * Gated, like the transport pin intake: a photograph is only read as
 * homework when homework is actually OPEN for that family. Without the gate
 * every Aadhaar card a parent sends would be filed as somebody's classwork.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { ensureHomeworkHydratedServer } from "@/lib/homeworkPersistence";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { classLabel, loadHomework, subjectLabel } from "@/lib/homework";
import { childrenOfHousehold, householdWhatsApp, loadSis, type Household } from "@/lib/sis";
import { currentAcademicYearCode } from "@/lib/masters";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { uploadFileToDrive } from "@/lib/googleDrive.server";
import { fetchWaMediaAsDataUrl } from "@/lib/waInboundMedia.server";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import {
  sendWaWithFailover,
  sendWhatsAppDocument,
  sendWhatsAppText,
  waNormalizeLocal10,
} from "@/lib/waSend";
import {
  chooseSubmissionTarget,
  makeSubmissionCode,
  renderRemarkSent,
  renderRemarkToParent,
  renderSubmissionAck,
  renderSubmissionAsk,
  renderTeacherPacket,
  renderUnknownCode,
  type SubmittablePost,
} from "@/lib/homeworkSubmission";

/** How long a post keeps accepting photographs. */
export const SUBMIT_WINDOW_DAYS = 7;
const ALLOWED = /^(image\/(jpeg|jpg|png|webp)|application\/pdf)$/;
const MAX_BYTES = 6 * 1024 * 1024;

export type HomeworkSubmitResult = {
  /** False when this photo is not homework and the caller should carry on. */
  handled: boolean;
  ok: boolean;
  reason?: string;
  submissionId?: string;
};

function daysAgo(dateIso: string): number {
  const t = Date.parse(`${(dateIso || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 86_400_000;
}

/**
 * The homework this family could be sending a photograph of.
 *
 * Only posts that ASKED for a submission, only the last week, and only where
 * that child has not already sent one — a family that submits twice gets the
 * second photo attached to the same homework rather than a second row the
 * teacher has to reconcile.
 */
export async function submittablePostsFor(household: Household): Promise<SubmittablePost[]> {
  await ensureHomeworkHydratedServer();
  await ensureSisHydratedServer();
  const masters = await loadServerMasters();
  const ay = currentAcademicYearCode(masters);
  const children = childrenOfHousehold(loadSis(), household.id, ay);
  if (!children.length) return [];

  const state = loadHomework();
  const asked: SubmittablePost[] = [];
  const rest: SubmittablePost[] = [];
  for (const child of children) {
    for (const post of state.posts) {
      if (post.status !== "published") continue;
      if (post.sectionId !== child.sectionId) continue;
      if (post.academicYearCode !== child.academicYearCode) continue;
      if (daysAgo(post.date) > SUBMIT_WINDOW_DAYS) continue;
      if (state.submissions.some((s) => s.postId === post.id && s.studentId === child.id)) continue;
      const row: SubmittablePost = {
        postId: post.id,
        studentId: child.id,
        studentName: child.fullName,
        subjectLabel: subjectLabel(masters, post.subjectId) || "Homework",
        title: post.title,
        date: post.date,
      };
      (post.requiresSubmit ? asked : rest).push(row);
    }
  }
  // Newest first: the homework set today is the one a parent is answering.
  const byDate = (a: SubmittablePost, b: SubmittablePost) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  // Homework that ASKED for the work back comes first, and when some did,
  // nothing else is offered — a parent answering "send it here" means that
  // one. The rest exist because the message invites a photograph from every
  // family, and an invitation the school ignores is worse than no invitation.
  return asked.length ? asked.sort(byDate) : rest.sort(byDate);
}

/** A code no open submission is already using. */
async function freeCode(): Promise<string> {
  const ctx = await getServerTenantContext();
  for (let i = 0; i < 8; i += 1) {
    const code = makeSubmissionCode();
    if (!ctx) return code;
    const { data } = await ctx.sb
      .from("homework_desk_submissions")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("reply_code", code)
      .eq("teacher_remark", "")
      .limit(1);
    if (!data || data.length === 0) return code;
  }
  return makeSubmissionCode() + makeSubmissionCode().slice(0, 1);
}

/** Who reads this child's work: the teacher who set it, else the office. */
async function teacherFor(postId: string): Promise<{ name: string; mobile: string } | null> {
  const masters = await loadServerMasters();
  const state = loadHomework();
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return null;
  const staff = (masters.staff ?? []).find((s) => s.id === post.teacherStaffId && s.status === "active");
  if (staff && (staff.mobile || "").trim()) {
    return { name: staff.fullName, mobile: waNormalizeLocal10(staff.mobile) };
  }
  // The teacher who set it has no number on record. The subject's teacher
  // for that section is the next best person, and named rather than assumed.
  const ay = post.academicYearCode;
  const alt = (masters.staff ?? []).find(
    (s) =>
      s.status === "active" &&
      (s.mobile || "").trim() &&
      (s.subjectTeachingLinks ?? []).some(
        (l) =>
          l.classId === post.classId &&
          (!l.sectionId || l.sectionId === post.sectionId) &&
          l.subjectId === post.subjectId &&
          (!l.academicYearCode || l.academicYearCode === ay),
      ),
  );
  return alt ? { name: alt.fullName, mobile: waNormalizeLocal10(alt.mobile) } : null;
}

export type InsertOutcome = "saved" | "duplicate" | "failed";

/**
 * One submission row.
 *
 * `homework_desk_submissions` is UNIQUE on (post_id, student_id), so a
 * webhook Meta delivers twice — which it does whenever it does not get a
 * prompt 200 — races the desk read that filters out work already submitted.
 * The loser gets a 23505, and that is not a failure: the child's homework
 * IS recorded. Telling the family "we could not save it, please send it
 * again" would be false, and would invite a third copy.
 */
async function insertSubmission(row: {
  id: string;
  postId: string;
  studentId: string;
  note: string;
  driveNote: string;
  code: string;
}): Promise<InsertOutcome> {
  const ctx = await getServerTenantContext();
  if (!ctx) return "failed";
  const { error } = await ctx.sb.from("homework_desk_submissions").insert({
    id: row.id,
    tenant_id: ctx.tenantId,
    post_id: row.postId,
    student_id: row.studentId,
    note: row.note.slice(0, 500),
    photo_url: "",
    submitted_at: new Date().toISOString(),
    teacher_ack_at: "",
    teacher_ack_by: "",
    channel: "whatsapp",
    reply_code: row.code,
    teacher_remark: "",
    remark_at: "",
    drive_note: row.driveNote,
  });
  // A single-row insert, deliberately, rather than pushing the whole desk
  // bundle: a webhook that rewrites every homework row is how this codebase
  // has lost a book of records before.
  if (error) {
    if (String((error as { code?: string }).code || "") === "23505") {
      return "duplicate";
    }
    console.error("[homeworkSubmit] could not save the submission", error.message);
    return "failed";
  }
  return "saved";
}

/**
 * A photograph from a family that has homework open. Never throws.
 *
 * Returns handled:false when nothing is expecting a photograph, so the
 * document intake still gets its turn at the same image.
 */
export async function captureHomeworkSubmissionFromWhatsApp(input: {
  mediaId: string;
  mimeType?: string;
  fileName?: string;
  caption: string;
  mobile10: string;
  household: Household;
  waMessageId?: string;
}): Promise<HomeworkSubmitResult> {
  const none: HomeworkSubmitResult = { handled: false, ok: false };
  try {
    const hinted = (input.mimeType || "").toLowerCase();
    if (hinted && !ALLOWED.test(hinted)) return { ...none, reason: "unsupported_type" };

    const candidates = await submittablePostsFor(input.household);
    if (!candidates.length) return { ...none, reason: "no_open_homework" };

    const language = waTemplateLanguageFor(input.household);
    const target = chooseSubmissionTarget({ candidates, caption: input.caption || "" });

    if (target.kind === "ask") {
      await sendWhatsAppText({
        toMobile: input.mobile10,
        body: renderSubmissionAsk({ options: target.options, language }),
        clientMessageId: `hw_submit_ask_${input.waMessageId || input.mediaId}`,
      }).catch(() => null);
      // Handled: the family has been answered and will send it again with a
      // number. Reading the same photo as an Aadhaar card meanwhile would be
      // the old bug in a new place.
      return { handled: true, ok: false, reason: "which_homework" };
    }
    if (target.kind === "none") return { ...none, reason: "no_open_homework" };

    const media = await fetchWaMediaAsDataUrl(input.mediaId);
    if (!media.ok) return { ...none, reason: media.error };
    const m = media.dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!m) return { ...none, reason: "bad_media" };
    const mimeType = m[1]!.toLowerCase();
    const base64 = m[2]!;
    if (!ALLOWED.test(mimeType)) return { ...none, reason: "unsupported_type" };
    if (Math.floor((base64.length * 3) / 4) > MAX_BYTES) return { ...none, reason: "too_large" };

    const post = target.post;
    const ext = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : "jpg";
    const bytes = Buffer.from(base64, "base64");
    const fileName = `homework-${post.postId}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    let driveNote = "";
    const up = await uploadFileToDrive({
      folderPath: ["students", post.studentId],
      fileName,
      mimeType,
      data: bytes,
    });
    if (up.ok) driveNote = `Drive: students/${post.studentId}/${fileName}`;
    else console.warn("[homeworkSubmit] drive upload failed", up.error);

    const code = await freeCode();
    const id = `hws_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const saved = await insertSubmission({
      id,
      postId: post.postId,
      studentId: post.studentId,
      note: (input.caption || "").trim(),
      driveNote,
      code,
    });
    if (saved === "duplicate") {
      // Already recorded — a re-delivered webhook, or the family sending the
      // same photo twice. Thank them and stop: a second copy to the teacher
      // would be the school, not the parent, repeating itself.
      await sendWhatsAppText({
        toMobile: input.mobile10,
        body:
          language === "hi"
            ? "✅ यह पहले ही मिल चुका है, धन्यवाद 🙏 शिक्षक तक पहुँच गया है।"
            : "✅ We already have this, thank you 🙏 It has reached the teacher.",
        clientMessageId: `hw_submit_dup_${input.waMessageId || input.mediaId}`,
      }).catch(() => null);
      return { handled: true, ok: true, reason: "already_submitted" };
    }
    if (saved === "failed") {
      // Say so rather than thanking them for something we did not keep.
      await sendWhatsAppText({
        toMobile: input.mobile10,
        body:
          language === "hi"
            ? "फ़ोटो मिल गई, पर अभी सहेजी नहीं जा सकी 🙏 कृपया थोड़ी देर बाद दोबारा भेजें, या कार्यालय से बात करें।"
            : "We got the photo but could not save it just now 🙏 Please send it again in a little while, or speak to the office.",
        clientMessageId: `hw_submit_fail_${input.waMessageId || input.mediaId}`,
      }).catch(() => null);
      return { handled: true, ok: false, reason: "not_saved" };
    }

    const masters = await loadServerMasters();
    const state = loadHomework();
    const full = state.posts.find((p) => p.id === post.postId);
    const teacher = await teacherFor(post.postId);

    await sendWhatsAppText({
      toMobile: input.mobile10,
      body: renderSubmissionAck({
        childName: post.studentName.split(/\s+/)[0] || post.studentName,
        subjectLabel: post.subjectLabel,
        teacherName: teacher?.name || "",
        language,
      }),
      clientMessageId: `hw_submit_ack_${id}`,
    }).catch(() => null);

    if (teacher?.mobile) {
      const packet = renderTeacherPacket({
        childName: post.studentName,
        classLabel: full ? classLabel(masters, full.classId, full.sectionId) : "—",
        subjectLabel: post.subjectLabel,
        title: post.title,
        code,
        submittedAtLabel: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }),
        note: (input.caption || "").trim(),
      });
      const r = await sendWaWithFailover({
        primaryMobile: teacher.mobile,
        body: packet,
        clientMessageId: `hw_submit_teacher_${id}`,
      });
      if (r.ok) {
        // The work itself. Best-effort: the packet already says whose it is
        // and carries the code, so a failed attachment costs the picture,
        // not the loop.
        await sendWhatsAppDocument({
          toMobile: teacher.mobile,
          bytes,
          filename: fileName,
          mimeType,
          caption: `#${code} · ${post.studentName}`,
        }).catch((e) => console.warn("[homeworkSubmit] photo to teacher failed", (e as Error)?.message));
      } else {
        console.warn("[homeworkSubmit] teacher not reached", teacher.name, r.error);
      }
    } else {
      console.warn("[homeworkSubmit] no teacher with a mobile for post", post.postId);
    }

    return { handled: true, ok: true, submissionId: id };
  } catch (e) {
    console.error("[homeworkSubmit] failed", (e as Error)?.message);
    return { ...none, reason: "error" };
  }
}

/* ── the teacher's remark, coming back ───────────────────────────── */

export type HomeworkRemarkResult = { handled: boolean; ok: boolean; reason?: string };

/**
 * A staff message beginning "#A7K2 …". Never throws.
 *
 * Returns handled:false when the code matches no open submission, so the
 * office relay — which uses the same code shape — still gets its turn.
 */
export async function handleHomeworkRemark(input: {
  fromMobile10: string;
  code: string;
  remark: string;
}): Promise<HomeworkRemarkResult> {
  const none: HomeworkRemarkResult = { handled: false, ok: false };
  try {
    const ctx = await getServerTenantContext();
    if (!ctx) return none;
    const { data, error } = await ctx.sb
      .from("homework_desk_submissions")
      .select("id, post_id, student_id, reply_code, teacher_remark")
      .eq("tenant_id", ctx.tenantId)
      .eq("reply_code", input.code)
      .limit(2);
    if (error) {
      console.warn("[homeworkRemark] lookup failed", error.message);
      return none;
    }
    const row = (data ?? [])[0] as { id: string; post_id: string; student_id: string; teacher_remark: string } | undefined;
    if (!row) return none;

    if (!input.remark) {
      await sendWhatsAppText({
        toMobile: input.fromMobile10,
        body: `Send the code with your remark, like:\n#${input.code} Well done, check question 3 again`,
        clientMessageId: `hw_remark_empty_${row.id}`,
      }).catch(() => null);
      return { handled: true, ok: false, reason: "empty_remark" };
    }

    await ensureHomeworkHydratedServer();
    await ensureSisHydratedServer();
    const masters = await loadServerMasters();
    const sis = loadSis();
    const state = loadHomework();
    const post = state.posts.find((p) => p.id === row.post_id);
    const student = sis.students.find((s) => s.id === row.student_id);
    const household = sis.households.find((h) => h.id === student?.householdId);
    const staff = (masters.staff ?? []).find(
      (s) => waNormalizeLocal10(s.mobile || "") === input.fromMobile10,
    );

    const now = new Date().toISOString();
    const { error: upErr } = await ctx.sb
      .from("homework_desk_submissions")
      .update({
        teacher_remark: input.remark.slice(0, 1000),
        remark_at: now,
        teacher_ack_at: now,
        teacher_ack_by: staff?.fullName || "",
      })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", row.id);
    if (upErr) console.warn("[homeworkRemark] could not save", upErr.message);

    const childName = student?.fullName?.split(/\s+/)[0] || "your child";
    const mobile = householdWhatsApp(household ?? undefined);
    let sentOk = false;
    let sendError = "";
    if (mobile) {
      const language = waTemplateLanguageFor(household ?? undefined);
      // Free text, and it usually lands: the family opened their own 24-hour
      // window when they sent the photograph. When it has closed the teacher
      // is told so plainly rather than the remark disappearing.
      const r = await sendWaWithFailover({
        primaryMobile: mobile,
        fallbackMobile: household?.altMobile || undefined,
        body: renderRemarkToParent({
          childName,
          subjectLabel: post ? subjectLabel(masters, post.subjectId) : "homework",
          teacherName: staff?.fullName || "",
          remark: input.remark,
          language,
        }),
        clientMessageId: `hw_remark_${row.id}`,
      });
      sentOk = r.ok;
      sendError = r.ok ? "" : r.error || "";
      await logHouseholdWaSend({
        mobile,
        purpose: "homework_remark",
        via: "text",
        preview: input.remark.slice(0, 120),
        status: r.ok ? "sent" : "failed",
        error: r.error,
        waMessageId: r.providerId,
      }).catch(() => undefined);
    } else {
      sendError = "the family has no WhatsApp number on record";
    }

    await sendWhatsAppText({
      toMobile: input.fromMobile10,
      body: renderRemarkSent({ childName, ok: sentOk, error: sendError }),
      clientMessageId: `hw_remark_done_${row.id}`,
    }).catch(() => null);

    return { handled: true, ok: sentOk };
  } catch (e) {
    console.error("[homeworkRemark] failed", (e as Error)?.message);
    return none;
  }
}

/** A "#code" from staff that matched nothing here — say so, once. */
export async function tellStaffCodeUnknown(mobile10: string, code: string): Promise<void> {
  await sendWhatsAppText({
    toMobile: mobile10,
    body: renderUnknownCode(code),
    clientMessageId: `hw_remark_unknown_${code}_${Date.now()}`,
  }).catch(() => null);
}
