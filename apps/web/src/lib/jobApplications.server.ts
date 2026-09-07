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
