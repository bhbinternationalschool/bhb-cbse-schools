/**
 * Applying a confirmed class-channel draft into the ERP, server-side.
 *
 * The gap this closes: when a teacher WhatsApps "HW 6B maths page 42" and
 * replies YES, the parents were messaged immediately but the ERP record
 * was only written the next time somebody happened to open Comms → Class
 * Channels in a browser — `applyClassChannelDraftToErp` is called from a
 * React effect. Parents had the homework; the homework desk might not,
 * for hours or for good if nobody opened that screen.
 *
 * So the same mapping now runs where the confirmation happens, through the
 * server write paths that actually persist: `postHomeworkServer` (shared
 * with the v1 route and the command desk) and `publishNoticeServer`. The
 * browser path is left in place as a fallback for drafts confirmed before
 * this existed; it only touches drafts still marked `confirmed`, and a
 * draft applied here is marked `applied`, so the two cannot both write.
 *
 * The teacher, not the school, is the author: the post is attributed to
 * the staff member who sent the message, exactly as the browser path did.
 */

import { currentAcademicYearCode, loadMasters, type MastersState } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import type { DemoSession } from "@/lib/auth";
import { TENANT } from "@/lib/types";
import { postHomeworkServer } from "@/lib/homeworkPost.server";
import { publishNoticeServer } from "@/lib/schoolNoticePublish.server";
import {
  classChannelDraftIsApplicable,
  classChannelErpFields,
  type ClassChannelDraftLike,
} from "@/lib/waClassChannelApply";

export type ClassChannelApplyResult =
  | { ok: true; applied: boolean; detail: string }
  | { ok: false; error: string };

/** The teacher's own session, so the ERP records who actually posted. */
function draftAuthorSession(
  draft: ClassChannelDraftLike,
  masters: MastersState,
  academicYearCode: string,
): DemoSession {
  return {
    persona: "staff",
    fullName: draft.createdByName || "Teacher",
    roleCode: "",
    staffId: draft.createdByStaffId || "",
    tenantSlug: TENANT.slug,
    academicYearCode: academicYearCode || currentAcademicYearCode(masters),
  };
}

export async function applyClassChannelDraftServer(
  draft: ClassChannelDraftLike,
  channel: { classId: string; sectionId: string; academicYearCode: string },
): Promise<ClassChannelApplyResult> {
  if (!classChannelDraftIsApplicable(draft.status)) {
    return { ok: false, error: "Draft not confirmed" };
  }

  // The office can confirm from the panel without the WhatsApp path's
  // sync having run first, so masters may not be hydrated yet — and an
  // unhydrated masters gives the wrong academic year and a blank subject.
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const ay = channel.academicYearCode || currentAcademicYearCode(masters);
  const session = draftAuthorSession(draft, masters, ay);
  // Same mapping the browser panel applies — title, body, audience and
  // pinning are decided in one place for both callers.
  const fields = classChannelErpFields(draft);

  if (fields.target === "homework") {
    const res = await postHomeworkServer({
      session,
      masters,
      classId: channel.classId,
      sectionId: channel.sectionId,
      subjectId: fields.subjectId,
      title: fields.title,
      bodyEn: fields.body,
      dueAt: fields.dueAt,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, applied: true, detail: `Homework posted (${res.post.id})` };
  }

  if (fields.target === "notice") {
    const res = await publishNoticeServer({
      title: fields.title,
      body: fields.body,
      audience: fields.audience,
      pinned: fields.pinned,
      academicYearCode: ay,
      createdBy: draft.createdByName || "WhatsApp channel",
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, applied: true, detail: `Notice published (${res.notice.id})` };
  }

  return { ok: true, applied: false, detail: "No ERP module mapping" };
}
