/**
 * Publishing a school notice from the server.
 *
 * `upsertNotice` in `lib/schoolComms.ts` is the browser path: it checks the
 * signed-in user's module permission and saves through localStorage, both
 * of which are meaningless in a webhook. The scheduled-publish tick already
 * proved the server-side shape — load the desk state, change it, push it to
 * the blob and the database — so this reuses that loader and that persist
 * rather than inventing a third way to write a notice.
 *
 * The caller is responsible for deciding that this notice may be published;
 * there is no session here to check one against.
 */

import type { CommsAudience, SchoolCommsState, SchoolNotice } from "@/lib/schoolComms";
import {
  loadSchoolCommsStateServer,
  persistSchoolCommsStateServer,
} from "@/lib/schoolCommsScheduledPublish.server";

function nowIso() {
  return new Date().toISOString();
}

export type PublishNoticeResult =
  | { ok: true; notice: SchoolNotice }
  | { ok: false; error: string };

export async function publishNoticeServer(input: {
  title: string;
  body: string;
  audience: CommsAudience;
  pinned?: boolean;
  academicYearCode: string;
  createdBy: string;
}): Promise<PublishNoticeResult> {
  const title = (input.title || "").trim();
  const body = (input.body || "").trim();
  if (!title) return { ok: false, error: "Title is required" };
  if (!body) return { ok: false, error: "Body is required" };

  const state = await loadSchoolCommsStateServer();
  const now = nowIso();
  const notice: SchoolNotice = {
    id: `nt_${Math.random().toString(36).slice(2, 10)}`,
    title,
    body,
    audience: input.audience,
    status: "published",
    pinned: !!input.pinned,
    academicYearCode: input.academicYearCode,
    publishedAt: now,
    scheduledPublishAt: "",
    createdAt: now,
    createdBy: input.createdBy || "School",
    updatedAt: now,
  };
  const next: SchoolCommsState = { ...state, notices: [notice, ...state.notices] };
  try {
    await persistSchoolCommsStateServer(next);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save the notice",
    };
  }
  return { ok: true, notice };
}
