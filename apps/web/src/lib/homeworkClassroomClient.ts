/**
 * Client — Google Classroom pull sync for homework module.
 */

export type ClassroomStatus = {
  oauthConfigured: boolean;
  connected: boolean;
  email: string | null;
  mappingsCount: number;
  lastSyncAt: string | null;
  redirectUri?: string;
};

export type ClassroomCourseRow = {
  id: string;
  name: string;
  section: string;
  alternateLink: string;
  mapping: {
    courseId: string;
    courseName: string;
    classId: string;
    sectionId: string;
    subjectId: string;
    enabled: boolean;
  } | null;
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

export async function fetchClassroomStatus(): Promise<ClassroomStatus> {
  const res = await fetch("/api/integrations/google/classroom");
  const json = (await res.json().catch(() => ({}))) as ClassroomStatus & {
    error?: string;
  };
  if (!res.ok) {
    return {
      oauthConfigured: false,
      connected: false,
      email: null,
      mappingsCount: 0,
      lastSyncAt: null,
    };
  }
  return json;
}

export async function fetchClassroomCourses(): Promise<{
  ok: boolean;
  courses?: ClassroomCourseRow[];
  error?: string;
}> {
  const res = await fetch("/api/integrations/google/classroom/courses");
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    courses?: ClassroomCourseRow[];
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: json.error || "Could not load courses" };
  }
  return { ok: true, courses: json.courses || [] };
}

export async function saveClassroomMapping(input: {
  courseId: string;
  courseName: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  enabled?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/integrations/google/classroom/mappings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { ok: false, error: json.error || "Save failed" };
  return { ok: true };
}

export async function disconnectClassroom(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/integrations/google/classroom", {
    method: "DELETE",
  });
  return { ok: res.ok };
}

export async function pullClassroomHomework(opts: {
  sinceDays?: number;
  existingCourseWorkIds: string[];
}): Promise<{
  ok: boolean;
  drafts?: ClassroomHomeworkDraft[];
  importedCount?: number;
  scanned?: number;
  skippedExisting?: number;
  error?: string;
}> {
  const res = await fetch("/api/integrations/google/classroom/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    drafts?: ClassroomHomeworkDraft[];
    importedCount?: number;
    scanned?: number;
    skippedExisting?: number;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: json.error || "Sync failed" };
  }
  return {
    ok: true,
    drafts: json.drafts,
    importedCount: json.importedCount,
    scanned: json.scanned,
    skippedExisting: json.skippedExisting,
  };
}
