/**
 * Apply confirmed class-channel drafts into homework / notices (browser).
 */

import { DEFAULT_AY } from "@/lib/masters";
import { createHomeworkPost } from "@/lib/homework";
import { upsertNotice } from "@/lib/schoolComms";

export type ClassChannelDraftLike = {
  id: string;
  channelId: string;
  kind: string;
  title: string;
  body: string;
  subjectId: string;
  subjectName: string;
  dueAt: string;
  eventDate: string;
  mediaNote: string;
  status: string;
  createdByStaffId?: string;
  createdByName: string;
  erpTarget: "homework" | "notice" | "none";
};

export function applyClassChannelDraftToErp(
  draft: ClassChannelDraftLike,
  channel: { classId: string; sectionId: string; academicYearCode: string },
): { ok: true; detail: string } | { ok: false; error: string } {
  if (draft.status !== "confirmed" && draft.status !== "applied") {
    return { ok: false, error: "Draft not confirmed" };
  }

  if (draft.erpTarget === "homework") {
    const res = createHomeworkPost({
      academicYearCode: channel.academicYearCode || DEFAULT_AY,
      classId: channel.classId,
      sectionId: channel.sectionId,
      subjectId: draft.subjectId,
      teacherStaffId: draft.createdByStaffId || "wa_channel",
      teacherName: draft.createdByName || "Teacher",
      date: new Date().toISOString().slice(0, 10),
      title: draft.title,
      bodyEn: draft.body + (draft.mediaNote ? `\n\n[${draft.mediaNote}]` : ""),
      dueAt: draft.dueAt || undefined,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, detail: `Homework posted (${res.post.id})` };
  }

  if (draft.erpTarget === "notice") {
    const audience =
      draft.kind === "timing" ? "all" : ("parents" as const);
    const res = upsertNotice({
      title: draft.title,
      body:
        draft.body +
        (draft.eventDate ? `\n\nDate: ${draft.eventDate}` : "") +
        (draft.mediaNote ? `\n\n[${draft.mediaNote}]` : ""),
      audience,
      pinned: draft.kind === "holiday" || draft.kind === "exam",
      createdBy: draft.createdByName || "WhatsApp channel",
      academicYearCode: channel.academicYearCode || DEFAULT_AY,
      publish: true,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, detail: `Notice published (${res.notice.id})` };
  }

  return { ok: true, detail: "No ERP module mapping" };
}
