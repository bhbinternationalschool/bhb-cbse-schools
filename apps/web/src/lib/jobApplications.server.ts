import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { isOfficeLike } from "@/lib/erpChatAccess";
import {
  jobApplicationSummary,
  matchClassWords,
  matchSubjectWords,
  type JobApplication,
  type JobApplicationOcrStatus,
  type JobApplicationSource,
} from "@/lib/jobApplications";

const TABLE = "job_applications";

type Row = {
  id: string;
  source: string;
  applicant_name: string;
  mobile: string;
  email: string;
  cv_path: string;
  cv_mime: string;
  subject_words: string[] | null;
  class_words: string[] | null;
  subject_ids: string[] | null;
  class_ids: string[] | null;
  qualification: string;
  experience_years: string;
  current_employer: string;
  ocr_status: string;
  ocr_notes: string;
  status: string;
  created_at: string;
  reviewed_by: string;
  reviewed_at: string | null;
};

function fromRow(r: Row): JobApplication {
  return {
    id: r.id,
    source: (r.source as JobApplicationSource) || "careers_page",
    applicantName: r.applicant_name || "",
    mobile: r.mobile || "",
    email: r.email || "",
    cvPath: r.cv_path || "",
    cvMime: r.cv_mime || "",
    subjectWords: r.subject_words ?? [],
    classWords: r.class_words ?? [],
    subjectIds: r.subject_ids ?? [],
    classIds: r.class_ids ?? [],
    qualification: r.qualification || "",
    experienceYears: r.experience_years || "",
    currentEmployer: r.current_employer || "",
    ocrStatus: (r.ocr_status as JobApplicationOcrStatus) || "pending",
    ocrNotes: r.ocr_notes || "",
    status: (r.status as JobApplication["status"]) || "new",
    createdAt: r.created_at,
    reviewedBy: r.reviewed_by || "",
    reviewedAt: r.reviewed_at || "",
  };
}

function nid(): string {
  return `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Has this mobile already applied recently?
 *
 * The careers page is open to the internet. Without this, one person
 * refreshing the form — or one script — fills the principal's inbox and
 * every duplicate spends a vision call. A day is long enough to stop that
 * and short enough that somebody genuinely re-applying next term is not
 * silently ignored.
 */
export async function recentApplicationFor(
  mobile: string,
  withinHours = 24,
): Promise<JobApplication | null> {
  const ctx = await getServerTenantContext();
  if (!ctx || !mobile) return null;
  const since = new Date(Date.now() - withinHours * 3_600_000).toISOString();
  const { data } = await ctx.sb
    .from(TABLE)
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("mobile", mobile)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as Row | undefined;
  return row ? fromRow(row) : null;
}

export async function createJobApplication(input: {
  source: JobApplicationSource;
  applicantName: string;
  mobile: string;
  email?: string;
  cvPath?: string;
  cvMime?: string;
  subjectWords?: string[];
  classWords?: string[];
  qualification?: string;
  experienceYears?: string;
  currentEmployer?: string;
  ocrStatus: JobApplicationOcrStatus;
  ocrNotes?: string;
}): Promise<{ ok: true; application: JobApplication } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable" };

  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  // The words become ids HERE, against the school's own masters, never in
  // the model call — an invented subject id files a teacher under
  // something the school does not teach and looks complete while doing it.
  const subjects = matchSubjectWords(input.subjectWords ?? [], masters.subjects);
  const classes = matchClassWords(input.classWords ?? [], masters.classes);

  const id = nid();
  const { data, error } = await ctx.sb
    .from(TABLE)
    .insert({
      id,
      tenant_id: ctx.tenantId,
      source: input.source,
      applicant_name: input.applicantName,
      mobile: input.mobile,
      email: input.email || "",
      cv_path: input.cvPath || "",
      cv_mime: input.cvMime || "",
      subject_words: input.subjectWords ?? [],
      class_words: input.classWords ?? [],
      subject_ids: subjects.ids,
      class_ids: classes.ids,
      qualification: input.qualification || "",
      experience_years: input.experienceYears || "",
      current_employer: input.currentEmployer || "",
      ocr_status: input.ocrStatus,
      ocr_notes: input.ocrNotes || "",
      status: "new",
    })
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message || "Could not save the application" };
  }
  return { ok: true, application: fromRow(data as Row) };
}

export async function listJobApplications(
  limit = 100,
): Promise<{ ok: true; rows: JobApplication[] } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable" };
  const { data, error } = await ctx.sb
    .from(TABLE)
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as Row[]).map(fromRow) };
}

export async function getJobApplication(id: string): Promise<JobApplication | null> {
  const ctx = await getServerTenantContext();
  if (!ctx || !id) return null;
  const { data } = await ctx.sb.from(TABLE).select("*").eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle();
  return data ? fromRow(data as Row) : null;
}

/**
 * Add what the applicant told us afterwards — the subject, classes or
 * qualification the CV did not say — or a CV sent after the details.
 *
 * Words are merged, never replaced: "Maths" from the CV and "Science"
 * typed later are both kept. Ids are re-resolved from the merged words
 * against the school's masters, as on create.
 */
export async function updateJobApplicationDetails(
  id: string,
  add: {
    subjectWords?: string[];
    classWords?: string[];
    qualification?: string;
    experienceYears?: string;
    applicantName?: string;
    email?: string;
    cvPath?: string;
    cvMime?: string;
    ocrStatus?: JobApplicationOcrStatus;
    ocrNotes?: string;
    currentEmployer?: string;
  },
): Promise<{ ok: true; application: JobApplication } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable" };
  const cur = await getJobApplication(id);
  if (!cur) return { ok: false, error: "Application not found" };
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const merge = (a: string[], b: string[] | undefined) => {
    const out = [...a];
    for (const w of b ?? []) if (w && !out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w);
    return out;
  };
  const subjectWords = merge(cur.subjectWords, add.subjectWords);
  const classWords = merge(cur.classWords, add.classWords);
  const patch: Record<string, unknown> = {
    subject_words: subjectWords,
    class_words: classWords,
    subject_ids: matchSubjectWords(subjectWords, masters.subjects).ids,
    class_ids: matchClassWords(classWords, masters.classes).ids,
  };
  if (!cur.qualification && add.qualification) patch.qualification = add.qualification.slice(0, 200);
  if (!cur.experienceYears && add.experienceYears) patch.experience_years = add.experienceYears;
  if (!cur.currentEmployer && add.currentEmployer) patch.current_employer = add.currentEmployer.slice(0, 120);
  if (!cur.email && add.email) patch.email = add.email.slice(0, 120);
  if (add.applicantName && (!cur.applicantName || cur.applicantName === "Guest")) patch.applicant_name = add.applicantName.slice(0, 80);
  if (!cur.cvPath && add.cvPath) {
    patch.cv_path = add.cvPath;
    patch.cv_mime = add.cvMime || "";
    if (add.ocrStatus) patch.ocr_status = add.ocrStatus;
    if (add.ocrNotes) patch.ocr_notes = add.ocrNotes.slice(0, 300);
  }
  const { data, error } = await ctx.sb
    .from(TABLE)
    .update(patch)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message || "Could not update the application" };
  return { ok: true, application: fromRow(data as Row) };
}

/**
 * Copy a CV into the school's Google Drive, one folder per job seeker.
 * An archive, not the serving copy: failing here never fails the
 * application — the drive_archive row records the error for a retry.
 */
export async function archiveJobCv(
  app: JobApplication,
  data: Buffer,
): Promise<{ ok: boolean; driveUrl?: string; error?: string }> {
  if (!app.cvPath) return { ok: false, error: "no CV" };
  try {
    const { archiveToDrive } = await import("@/lib/driveArchive.server");
    const { jobCvArchiveFileName, jobCvArchiveFolder } = await import("@/lib/jobDesk");
    const at = new Date(app.createdAt || Date.now());
    const r = await archiveToDrive({
      kind: "job_cv",
      ref: app.id,
      folderPath: jobCvArchiveFolder(app.applicantName, app.mobile, at),
      fileName: jobCvArchiveFileName(app.applicantName, app.cvMime, at),
      mimeType: app.cvMime || "application/octet-stream",
      data,
    });
    return r.ok ? { ok: true, driveUrl: r.driveUrl } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The CV file itself, from private storage — for sending it to the school's own staff. */
export async function jobCvBytes(app: JobApplication): Promise<Buffer | null> {
  const ctx = await getServerTenantContext();
  if (!ctx || !app.cvPath) return null;
  const { data, error } = await ctx.sb.storage.from("school-files").download(app.cvPath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Drive links for these applications' CVs, where they have been archived. */
export async function jobCvDriveUrls(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ctx = await getServerTenantContext();
  if (!ctx || !ids.length) return out;
  const { data } = await ctx.sb
    .from("drive_archive")
    .select("ref, drive_file_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", "job_cv")
    .in("ref", ids.slice(0, 200));
  const { driveViewUrl } = await import("@/lib/driveArchive");
  for (const r of (data ?? []) as { ref: string; drive_file_id: string }[]) {
    if (r.drive_file_id) out.set(r.ref, driveViewUrl(r.drive_file_id));
  }
  return out;
}

export async function setJobApplicationStatus(input: {
  id: string;
  status: JobApplication["status"];
  by: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Database unavailable" };
  const { error } = await ctx.sb
    .from(TABLE)
    .update({
      status: input.status,
      reviewed_by: input.by.slice(0, 120),
      reviewed_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Who hears about a new application.
 *
 * The principal and the office — the people who decide whether to call
 * somebody — and nobody else. A teaching vacancy is not staffroom news,
 * and a CV is a stranger's personal document; broadcasting it to all 35
 * staff would be both noise and a disclosure nobody agreed to.
 */
export async function leadershipStaffIds(): Promise<string[]> {
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const { loadServerRbac } = await import("@/lib/api/v1/auth");
  const { resolveSessionRoles } = await import("@/lib/rbac");
  const { staffSessionFor } = await import("@/lib/erpCommands.server");
  const rbac = await loadServerRbac();
  const out: string[] = [];
  for (const staff of masters.staff ?? []) {
    if (staff.status !== "active") continue;
    const session = staffSessionFor(staff, masters);
    const roles = resolveSessionRoles(rbac, session, masters).map((r) => r.code);
    if (
      roles.includes("owner") ||
      roles.includes("principal") ||
      roles.includes("admin") ||
      isOfficeLike(roles)
    ) {
      out.push(staff.id);
    }
  }
  return [...new Set(out)];
}

/**
 * Tell the principal and the office, on their phones and in the ERP.
 *
 * Failures here are logged and swallowed on purpose: the application is
 * already saved, and losing it because a push subscription expired would
 * be the worse outcome by far. An alert that did not arrive is visible in
 * the inbox; an application that was never stored is not.
 */
export async function alertLeadershipOfJobApplication(
  app: JobApplication,
): Promise<{ pushed: number; notified: boolean }> {
  const masters = loadMasters();
  const summary = jobApplicationSummary(app, masters);
  let pushed = 0;
  let notified = false;

  try {
    const ids = await leadershipStaffIds();
    if (ids.length) {
      const { sendPushToSubjects } = await import("@/lib/webPush.server");
      const res = await sendPushToSubjects("staff", ids, {
        title: "New job application",
        body: summary,
        url: "/staff/job-applications",
        data: { kind: "job_application", id: app.id },
      });
      pushed = res.sent;
    }
  } catch (e) {
    console.warn("[jobApplications] push failed", e);
  }

  try {
    // Read-append-write, never a blind push. `pushNotificationsDeskToDb`
    // deletes every row not in the state it is handed, so writing a
    // single-item state would wipe the school's whole notification list.
    const { fetchNotificationsDeskFromDb, pushNotificationsDeskToDb } =
      await import("@/lib/notificationsNormalized.server");
    const read = await fetchNotificationsDeskFromDb();
    if (read.ok) {
      const already = read.bundle.items.some((n) => n.sourceId === app.id);
      if (!already) {
        const item = {
          id: `nf_job_${app.id}`,
          title: "New job application",
          body: summary.slice(0, 280),
          kind: "system" as const,
          href: "/staff/job-applications",
          audience: "staff" as const,
          sourceId: app.id,
          createdAt: new Date().toISOString(),
          readBy: [] as string[],
        };
        const next = {
          version: 1 as const,
          items: [item, ...read.bundle.items].slice(0, 300),
        };
        const w = await pushNotificationsDeskToDb(next);
        notified = w.ok;
      } else {
        notified = true;
      }
    }
  } catch (e) {
    console.warn("[jobApplications] notification failed", e);
  }

  return { pushed, notified };
}
