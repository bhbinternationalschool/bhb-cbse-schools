/**
 * What a confirmed class-channel draft becomes in the ERP.
 *
 * The mapping — homework or notice, which audience, whether it is pinned,
 * where the media note and the event date go — lives here, once, because
 * two callers apply it: the browser panel (below) and the server-side
 * applier that runs the moment a teacher confirms on WhatsApp
 * (`waClassChannelApply.server.ts`). A second copy of these rules is how
 * the same post ends up worded differently depending on who filed it.
 */

import { DEFAULT_AY } from "@/lib/masters";
import { createHomeworkPost } from "@/lib/homework";
import { upsertNotice } from "@/lib/schoolComms";
import type { CommsAudience } from "@/lib/schoolComms";

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

export type ClassChannelErpFields =
  | { target: "homework"; title: string; body: string; subjectId: string; dueAt: string }
  | { target: "notice"; title: string; body: string; audience: CommsAudience; pinned: boolean }
  | { target: "none" };

/**
 * The ERP has no copy of a WhatsApp attachment, so the note describing it
 * rides at the end of the body — the same place it has always gone.
 */
export function classChannelBodyWithMedia(body: string, mediaNote: string): string {
  return mediaNote ? `${body}\n\n[${mediaNote}]` : body;
}

export function classChannelErpFields(draft: ClassChannelDraftLike): ClassChannelErpFields {
  if (draft.erpTarget === "homework") {
    return {
      target: "homework",
      title: draft.title,
      body: classChannelBodyWithMedia(draft.body, draft.mediaNote),
      subjectId: draft.subjectId,
      dueAt: draft.dueAt || "",
    };
  }
  if (draft.erpTarget === "notice") {
    return {
      target: "notice",
      title: draft.title,
      body: classChannelBodyWithMedia(
        draft.body + (draft.eventDate ? `\n\nDate: ${draft.eventDate}` : ""),
        draft.mediaNote,
      ),
      // A timing change concerns staff as well as families; everything else
      // from a class channel is for the parents of that class.
      audience: draft.kind === "timing" ? "all" : "parents",
      pinned: draft.kind === "holiday" || draft.kind === "exam",
    };
  }
  return { target: "none" };
}

/** Only a confirmed draft may be filed; an applied one is already filed. */
export function classChannelDraftIsApplicable(status: string): boolean {
  return status === "confirmed" || status === "applied";
}

export function applyClassChannelDraftToErp(
  draft: ClassChannelDraftLike,
  channel: { classId: string; sectionId: string; academicYearCode: string },
): { ok: true; detail: string } | { ok: false; error: string } {
  if (!classChannelDraftIsApplicable(draft.status)) {
    return { ok: false, error: "Draft not confirmed" };
  }
  const fields = classChannelErpFields(draft);

  if (fields.target === "homework") {
    const res = createHomeworkPost({
      academicYearCode: channel.academicYearCode || DEFAULT_AY,
      classId: channel.classId,
      sectionId: channel.sectionId,
      subjectId: fields.subjectId,
      teacherStaffId: draft.createdByStaffId || "wa_channel",
      teacherName: draft.createdByName || "Teacher",
      date: new Date().toISOString().slice(0, 10),
      title: fields.title,
      bodyEn: fields.body,
      dueAt: fields.dueAt || undefined,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, detail: `Homework posted (${res.post.id})` };
  }

  if (fields.target === "notice") {
    const res = upsertNotice({
      title: fields.title,
      body: fields.body,
      audience: fields.audience,
      pinned: fields.pinned,
      createdBy: draft.createdByName || "WhatsApp channel",
      academicYearCode: channel.academicYearCode || DEFAULT_AY,
      publish: true,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, detail: `Notice published (${res.notice.id})` };
  }

  return { ok: true, detail: "No ERP module mapping" };
}
