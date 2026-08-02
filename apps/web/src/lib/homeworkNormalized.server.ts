/**
 * Homework desk — Supabase normalized tables (homework_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DiaryEntry,
  HomeworkAttachment,
  HomeworkPost,
  HomeworkSeen,
  HomeworkSettings,
  HomeworkState,
  HomeworkSubmission,
} from "@/lib/homework";
import { homeworkDualWriteDbEnabled } from "@/lib/homeworkDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type HomeworkDeskSyncMeta = {
  postCount: number;
  diaryCount: number;
  submissionCount: number;
  seenCount: number;
  lastPostAt: string | null;
  updatedAt: string;
};

export type HomeworkDeskBundle = {
  posts: HomeworkPost[];
  diary: DiaryEntry[];
  submissions: HomeworkSubmission[];
  seen: HomeworkSeen[];
  settings: HomeworkSettings;
};

const META_SELECT =
  "post_count, diary_count, submission_count, seen_count, last_post_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function postToRow(tenantId: string, p: HomeworkPost): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: p.id,
    tenant_id: tenantId,
    academic_year_code: p.academicYearCode,
    class_id: p.classId,
    section_id: p.sectionId,
    subject_id: p.subjectId || "",
    teacher_staff_id: p.teacherStaffId || "",
    teacher_name: p.teacherName || "",
    post_date: p.date,
    title: p.title || "",
    body_en: p.bodyEn || "",
    body_hi: p.bodyHi || "",
    attachments_json: p.attachments ?? [],
    due_at: p.dueAt || "",
    requires_submit: !!p.requiresSubmit,
    ai_tutor_hint: p.aiTutorHint || "",
    status: p.status === "withdrawn" ? "withdrawn" : "published",
    created_at: p.createdAt || now,
    whatsapp_notified_at: p.whatsappNotifiedAt || "",
    whatsapp_notified_count: p.whatsappNotifiedCount ?? 0,
    source: p.source === "google_classroom" ? "google_classroom" : "erp",
    google_course_work_id: p.googleCourseWorkId || "",
    google_course_id: p.googleCourseId || "",
    updated_at: now,
  };
}

function rowToPost(r: Record<string, unknown>): HomeworkPost {
  const attachments = Array.isArray(r.attachments_json)
    ? (r.attachments_json as HomeworkAttachment[])
    : [];
  return {
    id: String(r.id),
    academicYearCode: String(r.academic_year_code),
    classId: String(r.class_id),
    sectionId: String(r.section_id),
    subjectId: String(r.subject_id || ""),
    teacherStaffId: String(r.teacher_staff_id || ""),
    teacherName: String(r.teacher_name || ""),
    date: String(r.post_date).slice(0, 10),
    title: String(r.title || ""),
    bodyEn: String(r.body_en || ""),
    bodyHi: String(r.body_hi || ""),
    attachments,
    dueAt: String(r.due_at || ""),
    requiresSubmit: !!r.requires_submit,
    aiTutorHint: String(r.ai_tutor_hint || ""),
    status: r.status === "withdrawn" ? "withdrawn" : "published",
    createdAt: String(r.created_at),
    whatsappNotifiedAt: String(r.whatsapp_notified_at || ""),
    whatsappNotifiedCount: Number(r.whatsapp_notified_count || 0),
    source: r.source === "google_classroom" ? "google_classroom" : "erp",
    googleCourseWorkId: String(r.google_course_work_id || ""),
    googleCourseId: String(r.google_course_id || ""),
  };
}

function diaryToRow(tenantId: string, d: DiaryEntry): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: d.id,
    tenant_id: tenantId,
    academic_year_code: d.academicYearCode,
    class_id: d.classId,
    section_id: d.sectionId,
    teacher_staff_id: d.teacherStaffId || "",
    teacher_name: d.teacherName || "",
    diary_date: d.date,
    title: d.title || "",
    body_en: d.bodyEn || "",
    body_hi: d.bodyHi || "",
    created_at: d.createdAt || now,
    updated_at: now,
  };
}

function rowToDiary(r: Record<string, unknown>): DiaryEntry {
  return {
    id: String(r.id),
    academicYearCode: String(r.academic_year_code),
    classId: String(r.class_id),
    sectionId: String(r.section_id),
    teacherStaffId: String(r.teacher_staff_id || ""),
    teacherName: String(r.teacher_name || ""),
    date: String(r.diary_date).slice(0, 10),
    title: String(r.title || ""),
    bodyEn: String(r.body_en || ""),
    bodyHi: String(r.body_hi || ""),
    createdAt: String(r.created_at),
  };
}

function submissionToRow(
  tenantId: string,
  s: HomeworkSubmission,
): Record<string, unknown> {
  return {
    id: s.id,
    tenant_id: tenantId,
    post_id: s.postId,
    student_id: s.studentId,
    note: s.note || "",
    photo_url: s.photoUrl || "",
    submitted_at: s.submittedAt || new Date().toISOString(),
    teacher_ack_at: s.teacherAckAt || "",
    teacher_ack_by: s.teacherAckBy || "",
  };
}

function rowToSubmission(r: Record<string, unknown>): HomeworkSubmission {
  return {
    id: String(r.id),
    postId: String(r.post_id),
    studentId: String(r.student_id),
    note: String(r.note || ""),
    photoUrl: String(r.photo_url || ""),
    submittedAt: String(r.submitted_at),
    teacherAckAt: String(r.teacher_ack_at || ""),
    teacherAckBy: String(r.teacher_ack_by || ""),
  };
}

function seenToRow(tenantId: string, s: HomeworkSeen): Record<string, unknown> {
  return {
    id: s.id,
    tenant_id: tenantId,
    kind: s.kind,
    ref_id: s.refId,
    student_id: s.studentId,
    household_id: s.householdId || "",
    seen_at: s.seenAt || new Date().toISOString(),
  };
}

function rowToSeen(r: Record<string, unknown>): HomeworkSeen {
  const kind = String(r.kind);
  return {
    id: String(r.id),
    kind: kind === "diary" ? "diary" : "post",
    refId: String(r.ref_id),
    studentId: String(r.student_id),
    householdId: String(r.household_id || ""),
    seenAt: String(r.seen_at),
  };
}

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): HomeworkDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    postCount: metaRow.post_count as number,
    diaryCount: metaRow.diary_count as number,
    submissionCount: metaRow.submission_count as number,
    seenCount: metaRow.seen_count as number,
    lastPostAt: metaRow.last_post_at as string | null,
    updatedAt: String(metaRow.updated_at),
  };
}

export async function pushHomeworkDeskToDb(
  state: HomeworkState,
): Promise<{ ok: boolean; error?: string }> {
  if (!homeworkDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const posts = state.posts ?? [];
  const diary = state.diary ?? [];
  const submissions = state.submissions ?? [];
  const seen = state.seen ?? [];
  const settings = state.settings ?? { examModeFreeze: false };

  await Promise.all([
    deleteStale(sb, tenantId, "homework_desk_posts", new Set(posts.map((p) => p.id))),
    deleteStale(sb, tenantId, "homework_desk_diary", new Set(diary.map((d) => d.id))),
    deleteStale(
      sb,
      tenantId,
      "homework_desk_submissions",
      new Set(submissions.map((s) => s.id)),
    ),
    deleteStale(sb, tenantId, "homework_desk_seen", new Set(seen.map((s) => s.id))),
  ]);

  let r = await upsertChunks(
    sb,
    "homework_desk_posts",
    posts.map((p) => postToRow(tenantId, p)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "homework_desk_diary",
    diary.map((d) => diaryToRow(tenantId, d)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "homework_desk_submissions",
    submissions.map((s) => submissionToRow(tenantId, s)),
  );
  if (!r.ok) return r;

  r = await upsertChunks(
    sb,
    "homework_desk_seen",
    seen.map((s) => seenToRow(tenantId, s)),
  );
  if (!r.ok) return r;

  await sb.from("homework_desk_settings").upsert(
    {
      tenant_id: tenantId,
      exam_mode_freeze: !!settings.examModeFreeze,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  let lastPostAt: string | null = null;
  for (const p of posts) {
    const at = p.createdAt || p.date;
    if (at && (!lastPostAt || at > lastPostAt)) lastPostAt = at;
  }

  await sb.from("homework_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      post_count: posts.length,
      diary_count: diary.length,
      submission_count: submissions.length,
      seen_count: seen.length,
      last_post_at: lastPostAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchHomeworkDeskFromDb(): Promise<{
  bundle: HomeworkDeskBundle;
  meta: HomeworkDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: HomeworkDeskBundle = {
    posts: [],
    diary: [],
    submissions: [],
    seen: [],
    settings: { examModeFreeze: false },
  };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [
    { data: postRows },
    { data: diaryRows },
    { data: submissionRows },
    { data: seenRows },
    { data: settingsRow },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("homework_desk_posts").select("*").eq("tenant_id", tenantId),
    sb.from("homework_desk_diary").select("*").eq("tenant_id", tenantId),
    sb.from("homework_desk_submissions").select("*").eq("tenant_id", tenantId),
    sb.from("homework_desk_seen").select("*").eq("tenant_id", tenantId),
    sb
      .from("homework_desk_settings")
      .select("exam_mode_freeze")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb.from("homework_desk_sync_meta").select(META_SELECT).eq("tenant_id", tenantId).maybeSingle(),
  ]);

  return {
    bundle: {
      posts: (postRows ?? []).map((r) => rowToPost(r as Record<string, unknown>)),
      diary: (diaryRows ?? []).map((r) => rowToDiary(r as Record<string, unknown>)),
      submissions: (submissionRows ?? []).map((r) =>
        rowToSubmission(r as Record<string, unknown>),
      ),
      seen: (seenRows ?? []).map((r) => rowToSeen(r as Record<string, unknown>)),
      settings: {
        examModeFreeze: !!(settingsRow as { exam_mode_freeze?: boolean } | null)
          ?.exam_mode_freeze,
      },
    },
    meta: mapMetaRow(metaRow as Record<string, unknown> | null),
  };
}
