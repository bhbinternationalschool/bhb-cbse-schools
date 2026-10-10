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
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";

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
    reference_answer: p.referenceAnswer || "",
    status: p.status === "withdrawn" ? "withdrawn" : "published",
    created_at: p.createdAt || now,
    whatsapp_notified_at: p.whatsappNotifiedAt || "",
    whatsapp_notified_count: p.whatsappNotifiedCount ?? 0,
    source: p.source === "google_classroom" ? "google_classroom" : "erp",
    google_course_work_id: p.googleCourseWorkId || "",
    google_course_id: p.googleCourseId || "",
    // The post's own time — see writeHomeworkLists. "" = an older copy.
    updated_at: p.updatedAt || "",
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
    referenceAnswer: String(r.reference_answer || ""),
    status: r.status === "withdrawn" ? "withdrawn" : "published",
    createdAt: String(r.created_at),
    whatsappNotifiedAt: String(r.whatsapp_notified_at || ""),
    whatsappNotifiedCount: Number(r.whatsapp_notified_count || 0),
    source: r.source === "google_classroom" ? "google_classroom" : "erp",
    googleCourseWorkId: String(r.google_course_work_id || ""),
    googleCourseId: String(r.google_course_id || ""),
    updatedAt: String(r.updated_at || ""),
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
    updated_at: d.updatedAt || "",
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
    updatedAt: String(r.updated_at || ""),
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
    // Carried explicitly. An upsert writes the whole row, so anything left
    // out here is reset to its column default on the next desk save.
    channel: s.channel === "whatsapp" ? "whatsapp" : "app",
    reply_code: s.replyCode || "",
    teacher_remark: s.teacherRemark || "",
    remark_at: s.remarkAt || "",
    drive_note: s.driveNote || "",
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
    channel: r.channel === "whatsapp" ? "whatsapp" : "app",
    replyCode: String(r.reply_code || ""),
    teacherRemark: String(r.teacher_remark || ""),
    remarkAt: String(r.remark_at || ""),
    driveNote: String(r.drive_note || ""),
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

/**
 * A teacher's save (2026-09-30). The office's save is the whole desk and
 * prunes what it does not carry; a teacher's phone holds a copy that can be
 * hours old, so the same prune erased homework other teachers had posted
 * since. A teacher's save therefore writes only what they own — posts and
 * diary entries they authored, in their own sections, and submissions on
 * their own posts — and deletes nothing except their own diary entries
 * (the one thing the desk lets a teacher delete).
 */
export type HomeworkTeacherSave = {
  staffId: string;
  allows: (classId: string, sectionId: string) => boolean;
};

export async function pushHomeworkDeskToDb(
  state: HomeworkState,
  teacher?: HomeworkTeacherSave,
  opts?: { deleteDiaryIds?: string[] },
): Promise<{ ok: boolean; error?: string }> {
  if (!homeworkDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  if (teacher) return pushTeacherHomework(sb, tenantId, now, state, teacher, opts?.deleteDiaryIds ?? []);

  const posts = state.posts ?? [];
  const diary = state.diary ?? [];
  const submissions = state.submissions ?? [];
  const seen = state.seen ?? [];
  const settings = state.settings ?? { examModeFreeze: false };

  // Nothing is deleted for being absent from this copy (9 Oct 2026). The
  // office's save used to prune every post it did not hold, and a browser
  // that had not re-read since a teacher posted from the staff app erased
  // that homework seconds later — three posts on 9 Oct alone. Posts are
  // never deleted by the desk (withdrawn is a status), nor are submissions
  // or "seen" marks; the one real delete — a diary entry — is named.
  const deleteDiaryIds = (opts?.deleteDiaryIds ?? []).filter((id) => typeof id === "string" && id);
  if (deleteDiaryIds.length) {
    const { error: delErr } = await sb
      .from("homework_desk_diary")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", deleteDiaryIds);
    if (delErr) return { ok: false, error: `Diary delete failed: ${delErr.message}` };
  }

  const w = await writeHomeworkLists(sb, tenantId, { posts, diary, submissions, seen });
  if (!w.ok) return w;

  await sb.from("homework_desk_settings").upsert(
    {
      tenant_id: tenantId,
      exam_mode_freeze: !!settings.examModeFreeze,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  await touchHomeworkMeta(sb, tenantId, now).catch(() => undefined);
  return { ok: true };
}

/**
 * Write the four homework lists without putting an older copy back
 * (2026-10-10). Every save upserted every row it held — the office desk,
 * a teacher's phone, and a staff-app post (which pushes the server's whole
 * cached desk) — so an older copy undid edits and withdrawals, blanked the
 * remark a teacher sent on WhatsApp, and reset "WhatsApp sent" (a later
 * re-publish could message the families again).
 *  - Posts and diary entries carry their own `updatedAt`: one the database
 *    holds at a later time is skipped; a copy without one (older builds,
 *    samples) only ever adds. "WhatsApp sent" never goes backwards.
 *  - Submissions are made once; afterwards only the teacher's fields move,
 *    and only forward: an acknowledgement or remark is written when it is
 *    newer than the stored one, a filing note only where there is none.
 *  - "Seen" marks are only ever added.
 * A failed read writes nothing.
 */
export async function writeHomeworkLists(
  sb: SupabaseClient,
  tenantId: string,
  lists: { posts: HomeworkPost[]; diary: DiaryEntry[]; submissions: HomeworkSubmission[]; seen: HomeworkSeen[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const at = (v: unknown) => {
    const t = Date.parse(String(v ?? ""));
    return Number.isFinite(t) ? t : -Infinity;
  };
  const readStored = <T extends Record<string, unknown>>(table: string, cols: string, ids: string[]) =>
    fetchByIds<T>(ids, (chunk, from, to) =>
      sb.from(table).select(cols).eq("tenant_id", tenantId).in("id", chunk).order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{
        data: T[] | null;
        error: { message: string } | null;
      }>,
    );

  // Posts and diary: newer wins.
  for (const [table, rows, cols] of [
    ["homework_desk_posts", lists.posts.map((p) => postToRow(tenantId, p)), "id, updated_at, whatsapp_notified_at, whatsapp_notified_count"],
    ["homework_desk_diary", lists.diary.map((d) => diaryToRow(tenantId, d)), "id, updated_at"],
  ] as const) {
    if (!rows.length) continue;
    const stored = await readStored<Record<string, unknown>>(table, cols, rows.map((r) => String(r.id)));
    if (stored.error) return { ok: false, error: `Could not read the stored homework: ${stored.error}` };
    const byId = new Map(stored.rows.map((r) => [String(r.id), r]));
    let kept = 0;
    const write = rows.flatMap((r) => {
      const cur = byId.get(String(r.id));
      if (!cur) return [{ ...r, updated_at: r.updated_at || now }];
      if (!(at(r.updated_at) >= at(cur.updated_at))) {
        kept += 1;
        return [];
      }
      if (table !== "homework_desk_posts") return [r];
      // "WhatsApp sent" only moves forward.
      return at(cur.whatsapp_notified_at) > at(r.whatsapp_notified_at)
        ? [{ ...r, whatsapp_notified_at: cur.whatsapp_notified_at, whatsapp_notified_count: cur.whatsapp_notified_count }]
        : [r];
    });
    if (kept) console.warn(`[homework-db] ${table}: kept ${kept} newer row(s) over a stale copy`);
    const up = await upsertChunks(sb, table, write);
    if (!up.ok) return { ok: false, error: up.error || "write failed" };
  }

  // Submissions: made once; the teacher's fields only move forward.
  if (lists.submissions.length) {
    const T = "homework_desk_submissions";
    const stored = await readStored<Record<string, unknown>>(
      T,
      "id, teacher_ack_at, teacher_remark, remark_at, drive_note",
      lists.submissions.map((x) => x.id),
    );
    if (stored.error) return { ok: false, error: `Could not read the stored submissions: ${stored.error}` };
    const byId = new Map(stored.rows.map((r) => [String(r.id), r]));
    const fresh = lists.submissions.filter((x) => !byId.has(x.id)).map((x) => submissionToRow(tenantId, x));
    for (let i = 0; i < fresh.length; i += 200) {
      const { error } = await sb.from(T).upsert(fresh.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: true });
      if (error) return { ok: false, error: error.message };
    }
    for (const x of lists.submissions) {
      const cur = byId.get(x.id);
      if (!cur) continue;
      const patch: Record<string, unknown> = {};
      if (x.teacherAckAt && at(x.teacherAckAt) > at(cur.teacher_ack_at)) {
        patch.teacher_ack_at = x.teacherAckAt;
        patch.teacher_ack_by = x.teacherAckBy || "";
      }
      if (x.remarkAt && x.teacherRemark && at(x.remarkAt) > at(cur.remark_at)) {
        patch.teacher_remark = x.teacherRemark;
        patch.remark_at = x.remarkAt;
      }
      if (x.driveNote && !cur.drive_note) patch.drive_note = x.driveNote;
      if (!Object.keys(patch).length) continue;
      const { error } = await sb.from(T).update(patch).eq("tenant_id", tenantId).eq("id", x.id);
      if (error) return { ok: false, error: error.message };
    }
  }

  // Seen marks: only ever added.
  const seenRows = lists.seen.map((x) => seenToRow(tenantId, x));
  for (let i = 0; i < seenRows.length; i += 500) {
    const { error } = await sb
      .from("homework_desk_seen")
      .upsert(seenRows.slice(i, i + 500), { onConflict: "id", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Recount the desk meta from the tables (a copy may be partial or old). */
async function touchHomeworkMeta(sb: SupabaseClient, tenantId: string, now: string): Promise<void> {
  const count = (table: string) =>
    sb.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [p, d, x, s, latest] = await Promise.all([
    count("homework_desk_posts"),
    count("homework_desk_diary"),
    count("homework_desk_submissions"),
    count("homework_desk_seen"),
    sb
      .from("homework_desk_posts")
      .select("created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  const ok = (r: { error: unknown; count: number | null }) => !r.error && typeof r.count === "number";
  if (ok(p)) row.post_count = p.count;
  if (ok(d)) row.diary_count = d.count;
  if (ok(x)) row.submission_count = x.count;
  if (ok(s)) row.seen_count = s.count;
  if (!latest.error) row.last_post_at = (latest.data as { created_at?: string } | null)?.created_at ?? null;
  await sb.from("homework_desk_sync_meta").upsert(row, { onConflict: "tenant_id" });
}

async function pushTeacherHomework(
  sb: SupabaseClient,
  tenantId: string,
  now: string,
  state: HomeworkState,
  teacher: HomeworkTeacherSave,
  deleteDiaryIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!teacher.staffId) return { ok: false, error: "Your login is not linked to a staff record" };
  const mine = <T extends { teacherStaffId: string; classId: string; sectionId: string }>(r: T) =>
    r.teacherStaffId === teacher.staffId && teacher.allows(r.classId, r.sectionId);
  const posts = (state.posts ?? []).filter(mine);
  const diary = (state.diary ?? []).filter(mine);
  const myPostIds = new Set(posts.map((p) => p.id));
  const submissions = (state.submissions ?? []).filter((x) => myPostIds.has(x.postId));

  const w = await writeHomeworkLists(sb, tenantId, { posts, diary, submissions, seen: [] });
  if (!w.ok) return w;

  // Their own diary entries they deleted — named, never inferred from what
  // an hours-old phone copy happens not to hold.
  if (deleteDiaryIds.length) {
    const { data: theirs, error: readErr } = await sb
      .from("homework_desk_diary")
      .select("id, class_id, section_id")
      .eq("tenant_id", tenantId)
      .eq("teacher_staff_id", teacher.staffId)
      .in("id", deleteDiaryIds);
    if (readErr) return { ok: false, error: readErr.message };
    const gone = (theirs ?? [])
      .filter((d) => teacher.allows(String(d.class_id), String(d.section_id)))
      .map((d) => String(d.id));
    if (gone.length) {
      await sb.from("homework_desk_diary").delete().eq("tenant_id", tenantId).in("id", gone);
    }
  }

  // Counts are the office save's job; the stamp tells other browsers to re-read.
  await sb
    .from("homework_desk_sync_meta")
    .upsert({ tenant_id: tenantId, updated_at: now }, { onConflict: "tenant_id" });
  return { ok: true };
}

export async function fetchHomeworkDeskFromDb(): Promise<{
  bundle: HomeworkDeskBundle;
  meta: HomeworkDeskSyncMeta | null;
  /**
   * false = a table could not be read; the bundle is NOT a confirmed empty
   * desk. A save that merges onto this copy (a function holder's, see
   * school-data/homework-desk) must write nothing then.
   */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: HomeworkDeskBundle = {
    posts: [],
    diary: [],
    submissions: [],
    seen: [],
    settings: { examModeFreeze: false },
  };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  // Paged: PostgREST stops at 1,000 rows, and "seen" passes that early
  // (one row per child per post). A short copy pushed back whole would
  // prune every row past the first page.
  const all = (table: string) =>
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb.from(table).select("*").eq("tenant_id", tenantId).order("id", { ascending: true }).range(from, to),
    );
  const [postRes, diaryRes, submissionRes, seenRes, settingsRes, { data: metaRow }] =
    await Promise.all([
      all("homework_desk_posts"),
      all("homework_desk_diary"),
      all("homework_desk_submissions"),
      all("homework_desk_seen"),
      sb
        .from("homework_desk_settings")
        .select("exam_mode_freeze")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      sb.from("homework_desk_sync_meta").select(META_SELECT).eq("tenant_id", tenantId).maybeSingle(),
    ]);
  const ok = ![postRes, diaryRes, submissionRes, seenRes].some((r) => r.error) && !settingsRes.error;
  const settingsRow = settingsRes.data;

  return {
    ok,
    bundle: {
      posts: postRes.rows.map((r) => rowToPost(r)),
      diary: diaryRes.rows.map((r) => rowToDiary(r)),
      submissions: submissionRes.rows.map((r) => rowToSubmission(r)),
      seen: seenRes.rows.map((r) => rowToSeen(r)),
      settings: {
        examModeFreeze: !!(settingsRow as { exam_mode_freeze?: boolean } | null)
          ?.exam_mode_freeze,
      },
    },
    meta: mapMetaRow(metaRow as Record<string, unknown> | null),
  };
}
