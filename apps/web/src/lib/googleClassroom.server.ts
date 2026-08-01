/**
 * Google Classroom API — pull coursework for ERP homework sync.
 */

import {
  refreshGoogleAccessToken,
} from "@/lib/googleOAuth.server";
import {
  getStaffConnection,
  type ClassroomCourseMapping,
  type ClassroomStaffConnection,
  upsertStaffConnection,
} from "@/lib/googleClassroom.store.server";

export type GoogleClassroomCourse = {
  id: string;
  name: string;
  section: string;
  courseState: string;
  alternateLink: string;
};

export type GoogleClassroomCourseWork = {
  id: string;
  courseId: string;
  title: string;
  description: string;
  state: string;
  alternateLink: string;
  creationTime: string;
  updateTime: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
  maxPoints?: number;
  workType: string;
  materials?: {
    link?: { url?: string; title?: string };
    driveFile?: {
      driveFile?: { alternateLink?: string; title?: string };
    };
  }[];
};

export type ClassroomHomeworkDraft = {
  googleCourseWorkId: string;
  googleCourseId: string;
  courseName: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  title: string;
  bodyEn: string;
  date: string;
  dueAt: string;
  requiresSubmit: boolean;
  attachments: { label: string; url: string }[];
};

async function ensureAccessToken(
  conn: ClassroomStaffConnection,
): Promise<
  | { ok: true; accessToken: string; connection: ClassroomStaffConnection }
  | { ok: false; error: string }
> {
  const expires = new Date(conn.expiresAt).getTime();
  if (expires > Date.now() + 60_000) {
    return { ok: true, accessToken: conn.accessToken, connection: conn };
  }
  if (!conn.refreshToken) {
    return { ok: false, error: "Google session expired — reconnect Classroom" };
  }
  const refreshed = await refreshGoogleAccessToken(conn.refreshToken);
  if (!refreshed.ok) {
    return { ok: false, error: refreshed.error };
  }
  const expiresAt = new Date(
    Date.now() + refreshed.expiresIn * 1000,
  ).toISOString();
  const next = await upsertStaffConnection({
    staffKey: conn.staffKey,
    email: conn.email,
    accessToken: refreshed.accessToken,
    refreshToken: conn.refreshToken,
    expiresAt,
    connectedAt: conn.connectedAt,
  });
  return { ok: true, accessToken: refreshed.accessToken, connection: next };
}

async function classroomFetch<T>(
  accessToken: string,
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as T & {
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message || `Classroom HTTP ${res.status}`,
      };
    }
    return { ok: true, data: json };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Classroom request failed",
    };
  }
}

export async function listClassroomCourses(
  staffKey: string,
): Promise<
  | { ok: true; courses: GoogleClassroomCourse[] }
  | { ok: false; error: string }
> {
  const conn = await getStaffConnection(staffKey);
  if (!conn) {
    return { ok: false, error: "Google Classroom not connected" };
  }
  const token = await ensureAccessToken(conn);
  if (!token.ok) return { ok: false, error: token.error };

  const courses: GoogleClassroomCourse[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      courseStates: "ACTIVE",
      pageSize: "100",
      teacherId: "me",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `https://classroom.googleapis.com/v1/courses?${params.toString()}`;
    const res = await classroomFetch<{
      courses?: GoogleClassroomCourse[];
      nextPageToken?: string;
    }>(token.accessToken, url);
    if (!res.ok) return { ok: false, error: res.error };
    for (const c of res.data.courses || []) {
      if (c.id && c.name) courses.push(c);
    }
    pageToken = res.data.nextPageToken || "";
    if (!pageToken) break;
  }
  return { ok: true, courses };
}

async function listCourseWork(
  accessToken: string,
  courseId: string,
): Promise<GoogleClassroomCourseWork[]> {
  const items: GoogleClassroomCourseWork[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      pageSize: "100",
      orderBy: "updateTime desc",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWork?${params.toString()}`;
    const res = await classroomFetch<{
      courseWork?: GoogleClassroomCourseWork[];
      nextPageToken?: string;
    }>(accessToken, url);
    if (!res.ok) break;
    for (const cw of res.data.courseWork || []) {
      items.push({ ...cw, courseId });
    }
    pageToken = res.data.nextPageToken || "";
    if (!pageToken) break;
  }
  return items;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dueIso(cw: GoogleClassroomCourseWork): string {
  if (!cw.dueDate) return "";
  const { year, month, day } = cw.dueDate;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromRfc3339(s: string): string {
  if (!s) return new Date().toISOString().slice(0, 10);
  return s.slice(0, 10);
}

function materialsToAttachments(
  cw: GoogleClassroomCourseWork,
): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  for (const m of cw.materials || []) {
    if (m.link?.url) {
      out.push({
        label: m.link.title || "Classroom link",
        url: m.link.url,
      });
    }
    const drive = m.driveFile?.driveFile?.alternateLink;
    if (drive) {
      out.push({
        label: m.driveFile?.driveFile?.title || "Drive file",
        url: drive,
      });
    }
  }
  if (cw.alternateLink) {
    out.push({ label: "Open in Google Classroom", url: cw.alternateLink });
  }
  return out;
}

function courseWorkToDraft(
  cw: GoogleClassroomCourseWork,
  mapping: ClassroomCourseMapping,
): ClassroomHomeworkDraft {
  const body = stripHtml(cw.description || "");
  return {
    googleCourseWorkId: cw.id,
    googleCourseId: mapping.courseId,
    courseName: mapping.courseName,
    classId: mapping.classId,
    sectionId: mapping.sectionId,
    subjectId: mapping.subjectId,
    title: (cw.title || "Classroom assignment").trim(),
    bodyEn: body || `Imported from Google Classroom — ${mapping.courseName}`,
    date: dateFromRfc3339(cw.creationTime),
    dueAt: dueIso(cw) || dateFromRfc3339(cw.creationTime),
    requiresSubmit: cw.workType === "ASSIGNMENT",
    attachments: materialsToAttachments(cw),
  };
}

export async function pullClassroomHomework(opts: {
  staffKey: string;
  mappings: ClassroomCourseMapping[];
  sinceDays?: number;
  existingCourseWorkIds?: string[];
}): Promise<
  | {
      ok: true;
      drafts: ClassroomHomeworkDraft[];
      scanned: number;
      skippedExisting: number;
      skippedUnmapped: number;
    }
  | { ok: false; error: string }
> {
  const conn = await getStaffConnection(opts.staffKey);
  if (!conn) {
    return { ok: false, error: "Google Classroom not connected" };
  }
  const token = await ensureAccessToken(conn);
  if (!token.ok) return { ok: false, error: token.error };

  const enabled = opts.mappings.filter(
    (m) => m.enabled && m.classId && m.sectionId && m.subjectId,
  );
  if (!enabled.length) {
    return {
      ok: false,
      error: "No course mappings — map at least one Classroom course to class & subject",
    };
  }

  const sinceMs =
    Date.now() - (opts.sinceDays ?? 30) * 24 * 60 * 60 * 1000;
  const existing = new Set(opts.existingCourseWorkIds || []);
  const drafts: ClassroomHomeworkDraft[] = [];
  let scanned = 0;
  let skippedExisting = 0;

  for (const mapping of enabled) {
    const works = await listCourseWork(token.accessToken, mapping.courseId);
    for (const cw of works) {
      if (cw.state && cw.state !== "PUBLISHED") continue;
      scanned += 1;
      if (existing.has(cw.id)) {
        skippedExisting += 1;
        continue;
      }
      const updated = new Date(cw.updateTime || cw.creationTime).getTime();
      if (updated < sinceMs) continue;
      drafts.push(courseWorkToDraft(cw, mapping));
    }
  }

  return {
    ok: true,
    drafts,
    scanned,
    skippedExisting,
    skippedUnmapped: 0,
  };
}
