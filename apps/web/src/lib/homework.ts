/**
 * Homework & class diary (§19a) — posts, diary, submissions, parent seen.
 * Demo store: localStorage `bhb_homework_v1`.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import {
  householdWhatsApp,
  loadSis,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { TENANT } from "@/lib/types";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";

const STORAGE_KEY = "bhb_homework_v1";

export type HomeworkPostStatus = "published" | "withdrawn";

export type HomeworkAttachment = {
  id: string;
  label: string;
  /** https URL, data URL, or plain text link */
  url: string;
};

export type HomeworkPost = {
  id: string;
  academicYearCode: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherStaffId: string;
  teacherName: string;
  date: string;
  title: string;
  bodyEn: string;
  bodyHi: string;
  attachments: HomeworkAttachment[];
  dueAt: string;
  requiresSubmit: boolean;
  aiTutorHint: string;
  status: HomeworkPostStatus;
  createdAt: string;
  /** When parents were last WhatsApp-notified for this post */
  whatsappNotifiedAt: string;
  whatsappNotifiedCount: number;
  /** Set when imported from Google Classroom */
  source?: "erp" | "google_classroom";
  googleCourseWorkId?: string;
  googleCourseId?: string;
};

export type DiaryEntry = {
  id: string;
  academicYearCode: string;
  classId: string;
  sectionId: string;
  teacherStaffId: string;
  teacherName: string;
  date: string;
  title: string;
  bodyEn: string;
  bodyHi: string;
  createdAt: string;
};

export type HomeworkSubmission = {
  id: string;
  postId: string;
  studentId: string;
  note: string;
  photoUrl: string;
  submittedAt: string;
  teacherAckAt: string;
  teacherAckBy: string;
};

export type HomeworkSeen = {
  id: string;
  kind: "post" | "diary";
  refId: string;
  studentId: string;
  householdId: string;
  seenAt: string;
};

export type HomeworkSettings = {
  /** When true, teachers cannot publish new HW (Principal exam freeze). */
  examModeFreeze: boolean;
};

export type HomeworkState = {
  version: 1;
  posts: HomeworkPost[];
  diary: DiaryEntry[];
  submissions: HomeworkSubmission[];
  seen: HomeworkSeen[];
  settings: HomeworkSettings;
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

export function emptyHomeworkState(): HomeworkState {
  return {
    version: 1,
    posts: [],
    diary: [],
    submissions: [],
    seen: [],
    settings: { examModeFreeze: false },
  };
}

function normalizeState(raw: Partial<HomeworkState> | null): HomeworkState {
  const base = emptyHomeworkState();
  if (!raw || typeof raw !== "object") return base;
  return {
    version: 1,
    posts: Array.isArray(raw.posts) ? raw.posts.map(normalizePost) : [],
    diary: Array.isArray(raw.diary) ? raw.diary.map(normalizeDiary) : [],
    submissions: Array.isArray(raw.submissions)
      ? raw.submissions.map(normalizeSubmission)
      : [],
    seen: Array.isArray(raw.seen) ? raw.seen.map(normalizeSeen) : [],
    settings: {
      examModeFreeze: !!raw.settings?.examModeFreeze,
    },
  };
}

function normalizePost(p: Partial<HomeworkPost>): HomeworkPost {
  return {
    id: p.id || nid("hw"),
    academicYearCode: p.academicYearCode || DEFAULT_AY,
    classId: p.classId || "",
    sectionId: p.sectionId || "",
    subjectId: p.subjectId || "",
    teacherStaffId: p.teacherStaffId || "",
    teacherName: p.teacherName || "",
    date: p.date || todayIso(),
    title: (p.title || "").trim() || "Homework",
    bodyEn: p.bodyEn || "",
    bodyHi: p.bodyHi || "",
    attachments: Array.isArray(p.attachments)
      ? p.attachments.map((a) => ({
          id: a.id || nid("att"),
          label: a.label || "Attachment",
          url: a.url || "",
        }))
      : [],
    dueAt: p.dueAt || "",
    requiresSubmit: !!p.requiresSubmit,
    aiTutorHint: p.aiTutorHint || "",
    status: p.status === "withdrawn" ? "withdrawn" : "published",
    createdAt: p.createdAt || nowIso(),
    whatsappNotifiedAt: p.whatsappNotifiedAt || "",
    whatsappNotifiedCount:
      typeof p.whatsappNotifiedCount === "number" ? p.whatsappNotifiedCount : 0,
    source: p.source === "google_classroom" ? "google_classroom" : "erp",
    googleCourseWorkId: p.googleCourseWorkId || "",
    googleCourseId: p.googleCourseId || "",
  };
}

function normalizeDiary(d: Partial<DiaryEntry>): DiaryEntry {
  return {
    id: d.id || nid("dy"),
    academicYearCode: d.academicYearCode || DEFAULT_AY,
    classId: d.classId || "",
    sectionId: d.sectionId || "",
    teacherStaffId: d.teacherStaffId || "",
    teacherName: d.teacherName || "",
    date: d.date || todayIso(),
    title: (d.title || "").trim() || "Class diary",
    bodyEn: d.bodyEn || "",
    bodyHi: d.bodyHi || "",
    createdAt: d.createdAt || nowIso(),
  };
}

function normalizeSubmission(s: Partial<HomeworkSubmission>): HomeworkSubmission {
  return {
    id: s.id || nid("sub"),
    postId: s.postId || "",
    studentId: s.studentId || "",
    note: s.note || "",
    photoUrl: s.photoUrl || "",
    submittedAt: s.submittedAt || nowIso(),
    teacherAckAt: s.teacherAckAt || "",
    teacherAckBy: s.teacherAckBy || "",
  };
}

function normalizeSeen(s: Partial<HomeworkSeen>): HomeworkSeen {
  return {
    id: s.id || nid("seen"),
    kind: s.kind === "diary" ? "diary" : "post",
    refId: s.refId || "",
    studentId: s.studentId || "",
    householdId: s.householdId || "",
    seenAt: s.seenAt || nowIso(),
  };
}

export function loadHomework(): HomeworkState {
  if (typeof window === "undefined") return emptyHomeworkState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyHomeworkState();
    return normalizeState(JSON.parse(raw) as Partial<HomeworkState>);
  } catch {
    return emptyHomeworkState();
  }
}

export function saveHomework(state: HomeworkState): void {
  if (!assertModulePermission("homework", "edit", "saveHomework")) return;

  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/homeworkPersistence").then(({ scheduleHomeworkSync }) => {
    scheduleHomeworkSync(state);
  });

}

export function writeHomeworkLocalRaw(state: HomeworkState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function homeworkStateIsEmpty(state: HomeworkState): boolean {
  return (state.posts?.length ?? 0) === 0 && (state.diary?.length ?? 0) === 0;
}


/** Seed one sample post + diary when empty (demo). */
export function seedHomeworkIfEmpty(ay?: string): HomeworkState {
  const existing = loadHomework();
  if (existing.posts.length > 0 || existing.diary.length > 0) return existing;
  const masters = loadMasters();
  const section = masters.sections.find((s) => s.isActive !== false);
  const subject = (masters.subjects ?? []).find(
    (s) => s.isActive !== false && !s.parentId,
  );
  if (!section || !subject) return existing;
  const staff = (masters.staff ?? []).find((s) => s.status === "active");
  const date = todayIso();
  const teacherName = staff?.fullName || "Class teacher";
  const teacherStaffId = staff?.id || "";
  const next: HomeworkState = {
    ...existing,
    posts: [
      {
        id: nid("hw"),
        academicYearCode: ay || DEFAULT_AY,
        classId: section.classId,
        sectionId: section.id,
        subjectId: subject.id,
        teacherStaffId,
        teacherName,
        date,
        title: `${subject.nameEn} — practice`,
        bodyEn: "Complete exercises 1–5 from today's lesson. Show working.",
        bodyHi: "आज के पाठ से अभ्यास 1–5 पूरा करें। कार्य दिखाएँ।",
        attachments: [],
        dueAt: date,
        requiresSubmit: true,
        aiTutorHint: subject.code,
        status: "published",
        createdAt: nowIso(),
        whatsappNotifiedAt: "",
        whatsappNotifiedCount: 0,
      },
    ],
    diary: [
      {
        id: nid("dy"),
        academicYearCode: ay || DEFAULT_AY,
        classId: section.classId,
        sectionId: section.id,
        teacherStaffId,
        teacherName,
        date,
        title: "Assembly reminder",
        bodyEn: "Bring notebook for assembly songs tomorrow.",
        bodyHi: "कल असेंबली के गीतों के लिए कॉपी लाएँ।",
        createdAt: nowIso(),
      },
    ],
  };
  saveHomework(next);
  return next;
}

export type CreatePostInput = {
  academicYearCode: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherStaffId: string;
  teacherName: string;
  date: string;
  title: string;
  bodyEn: string;
  bodyHi?: string;
  dueAt?: string;
  requiresSubmit?: boolean;
  aiTutorHint?: string;
  attachments?: HomeworkAttachment[];
};

export function createHomeworkPost(
  input: CreatePostInput,
): { ok: true; post: HomeworkPost } | { ok: false; error: string } {
  const state = loadHomework();
  if (state.settings.examModeFreeze) {
    return {
      ok: false,
      error: "Exam mode is on — new homework is frozen. Ask Principal to reopen.",
    };
  }
  if (!input.classId || !input.sectionId) {
    return { ok: false, error: "Class and section are required" };
  }
  if (!input.subjectId) return { ok: false, error: "Subject is required" };
  if (!input.title.trim()) return { ok: false, error: "Title is required" };
  if (!input.bodyEn.trim() && !(input.bodyHi || "").trim()) {
    return { ok: false, error: "Add homework text (English or Hindi)" };
  }
  const post = normalizePost({
    ...input,
    id: nid("hw"),
    status: "published",
    createdAt: nowIso(),
    attachments: input.attachments || [],
  });
  const next = { ...state, posts: [post, ...state.posts] };
  saveHomework(next);
  return { ok: true, post };
}

export type ClassroomImportInput = {
  academicYearCode: string;
  teacherStaffId: string;
  teacherName: string;
  googleCourseWorkId: string;
  googleCourseId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  title: string;
  bodyEn: string;
  date: string;
  dueAt?: string;
  requiresSubmit?: boolean;
  attachments?: HomeworkAttachment[];
};

/** Import Google Classroom coursework into ERP homework (skips duplicates). */
export function importClassroomHomeworkPosts(
  items: ClassroomImportInput[],
): {
  ok: true;
  imported: HomeworkPost[];
  skipped: number;
} {
  const state = loadHomework();
  if (state.settings.examModeFreeze) {
    return { ok: true, imported: [], skipped: items.length };
  }

  const existing = new Set(
    state.posts
      .map((p) => p.googleCourseWorkId)
      .filter((id) => !!id),
  );

  const imported: HomeworkPost[] = [];
  let skipped = 0;

  for (const item of items) {
    if (!item.googleCourseWorkId || existing.has(item.googleCourseWorkId)) {
      skipped += 1;
      continue;
    }
    if (!item.classId || !item.sectionId || !item.subjectId) {
      skipped += 1;
      continue;
    }
    const post = normalizePost({
      ...item,
      id: nid("hw"),
      bodyHi: "",
      status: "published",
      source: "google_classroom",
      createdAt: nowIso(),
      attachments: item.attachments || [],
      aiTutorHint: "",
    });
    imported.push(post);
    existing.add(item.googleCourseWorkId);
  }

  if (imported.length) {
    saveHomework({ ...state, posts: [...imported, ...state.posts] });
  }

  return { ok: true, imported, skipped };
}

export function listImportedClassroomCourseWorkIds(): string[] {
  return loadHomework()
    .posts.map((p) => p.googleCourseWorkId)
    .filter((id): id is string => !!id);
}

export function withdrawHomeworkPost(
  postId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadHomework();
  const i = state.posts.findIndex((p) => p.id === postId);
  if (i < 0) return { ok: false, error: "Post not found" };
  const posts = [...state.posts];
  posts[i] = { ...posts[i], status: "withdrawn" };
  saveHomework({ ...state, posts });
  return { ok: true };
}

export type CreateDiaryInput = {
  academicYearCode: string;
  classId: string;
  sectionId: string;
  teacherStaffId: string;
  teacherName: string;
  date: string;
  title: string;
  bodyEn: string;
  bodyHi?: string;
};

export function createDiaryEntry(
  input: CreateDiaryInput,
): { ok: true; entry: DiaryEntry } | { ok: false; error: string } {
  if (!input.classId || !input.sectionId) {
    return { ok: false, error: "Class and section are required" };
  }
  if (!input.title.trim()) return { ok: false, error: "Title is required" };
  if (!input.bodyEn.trim() && !(input.bodyHi || "").trim()) {
    return { ok: false, error: "Add diary text" };
  }
  const state = loadHomework();
  const entry = normalizeDiary({
    ...input,
    id: nid("dy"),
    createdAt: nowIso(),
  });
  saveHomework({ ...state, diary: [entry, ...state.diary] });
  return { ok: true, entry };
}

/* ─── Teacher defaults (subject / class-teacher mapping) ───── */

export type TeacherHomeworkDefaults = {
  classId: string;
  sectionId: string;
  subjectId: string;
  /** When non-empty, compose should prefer these subject ids */
  subjectIds: string[];
  source: "teaching" | "class_teacher" | "none";
};

export function resolveTeacherHomeworkDefaults(
  staffId: string | undefined,
  ay: string,
  masters: MastersState,
): TeacherHomeworkDefaults {
  const empty: TeacherHomeworkDefaults = {
    classId: "",
    sectionId: "",
    subjectId: "",
    subjectIds: [],
    source: "none",
  };
  if (!staffId) return empty;
  const staff = (masters.staff ?? []).find((s) => s.id === staffId);
  if (!staff) return empty;

  const matchAy = (code: string) => !code || code === ay;

  const teaching = (staff.subjectTeachingLinks || []).filter((l) =>
    matchAy(l.academicYearCode),
  );
  if (teaching.length > 0) {
    const t = teaching[0];
    let sectionId = t.sectionId || "";
    if (!sectionId) {
      sectionId =
        masters.sections.find(
          (s) => s.classId === t.classId && s.isActive !== false,
        )?.id || "";
    }
    return {
      classId: t.classId,
      sectionId,
      subjectId: t.subjectId,
      subjectIds: [...new Set(teaching.map((x) => x.subjectId))],
      source: "teaching",
    };
  }

  const ctLinks = (staff.classTeacherLinks || []).filter((l) =>
    matchAy(l.academicYearCode),
  );
  const ct =
    ctLinks.find((l) => l.isPrimary) || ctLinks[0] || undefined;
  if (ct) {
    return {
      classId: ct.classId,
      sectionId: ct.sectionId,
      subjectId: "",
      subjectIds: [],
      source: "class_teacher",
    };
  }
  return empty;
}

/* ─── WhatsApp notify parents ─────────────────────────────── */

export type HomeworkParentContact = {
  householdId: string;
  guardianName: string;
  mobile: string;
  childNames: string[];
};

export function listSectionParentContacts(
  sectionId: string,
  ay: string,
  sis?: SisState,
): HomeworkParentContact[] {
  const state = sis ?? loadSis();
  const roster = rosterForSection(state, sectionId, ay);
  const byHh = new Map<string, HomeworkParentContact>();
  for (const stu of roster) {
    const hh = state.households.find((h) => h.id === stu.householdId);
    const mobile = householdWhatsApp(hh);
    if (!mobile) continue;
    const key = hh?.id || mobile;
    const existing = byHh.get(key);
    if (existing) {
      if (!existing.childNames.includes(stu.fullName)) {
        existing.childNames.push(stu.fullName);
      }
      continue;
    }
    byHh.set(key, {
      householdId: hh?.id || "",
      guardianName: hh?.guardianName || "Parent",
      mobile,
      childNames: [stu.fullName],
    });
  }
  return [...byHh.values()].sort((a, b) =>
    a.guardianName.localeCompare(b.guardianName),
  );
}

export function composeWhatsAppHomeworkNotify(input: {
  schoolName?: string;
  childName: string;
  classLabel: string;
  subjectLabel?: string;
  date: string;
  title: string;
  bodyPreview: string;
  kind: "homework" | "diary";
  teacherName: string;
}): string {
  const school = input.schoolName || TENANT.nameDisplay || TENANT.shortName;
  const kindLabel = input.kind === "diary" ? "Class diary" : "Homework";
  const body = input.bodyPreview.trim().slice(0, 280);
  const lines = [
    `*${school}*`,
    `${kindLabel} · ${input.date}`,
    "",
    `${input.childName}${input.classLabel ? ` (${input.classLabel})` : ""}`,
  ];
  if (input.subjectLabel) lines.push(`Subject: ${input.subjectLabel}`);
  lines.push(`*${input.title}*`, "");
  if (body) lines.push(body, "");
  lines.push(`— ${input.teacherName}`, "Open Parent portal → Homework to mark seen.");
  return lines.join("\n");
}

export { waMeUrl as homeworkWhatsAppUrl } from "@/lib/waMe";

export function markHomeworkWhatsAppNotified(
  postId: string,
  count: number,
): void {
  const state = loadHomework();
  const posts = state.posts.map((p) =>
    p.id === postId
      ? {
          ...p,
          whatsappNotifiedAt: nowIso(),
          whatsappNotifiedCount: count,
        }
      : p,
  );
  saveHomework({ ...state, posts });
}

/** Read image file as data URL (max ~1.5 MB). */
export function readImageAsDataUrl(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      resolve({ ok: false, error: "Choose an image or PDF" });
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      resolve({ ok: false, error: "File too large (max 1.5 MB)" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (!url) {
        resolve({ ok: false, error: "Could not read file" });
        return;
      }
      resolve({ ok: true, url });
    };
    reader.onerror = () => resolve({ ok: false, error: "Could not read file" });
    reader.readAsDataURL(file);
  });
}

export function setHomeworkExamFreeze(freeze: boolean): HomeworkState {
  const state = loadHomework();
  const next = {
    ...state,
    settings: { ...state.settings, examModeFreeze: freeze },
  };
  saveHomework(next);
  return next;
}

export function submitHomework(input: {
  postId: string;
  studentId: string;
  note?: string;
  photoUrl?: string;
}): { ok: true; submission: HomeworkSubmission } | { ok: false; error: string } {
  const state = loadHomework();
  const post = state.posts.find((p) => p.id === input.postId);
  if (!post || post.status !== "published") {
    return { ok: false, error: "Homework not found" };
  }
  if (!post.requiresSubmit) {
    return { ok: false, error: "This homework does not require a submission" };
  }
  if (!input.studentId) return { ok: false, error: "Student required" };
  const existing = state.submissions.find(
    (s) => s.postId === input.postId && s.studentId === input.studentId,
  );
  const submission = normalizeSubmission({
    id: existing?.id || nid("sub"),
    postId: input.postId,
    studentId: input.studentId,
    note: input.note || "",
    photoUrl: input.photoUrl || "",
    submittedAt: nowIso(),
    teacherAckAt: "",
    teacherAckBy: "",
  });
  const submissions = existing
    ? state.submissions.map((s) => (s.id === existing.id ? submission : s))
    : [submission, ...state.submissions];
  saveHomework({ ...state, submissions });
  return { ok: true, submission };
}

export function acknowledgeSubmission(
  submissionId: string,
  by: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadHomework();
  const i = state.submissions.findIndex((s) => s.id === submissionId);
  if (i < 0) return { ok: false, error: "Submission not found" };
  const submissions = [...state.submissions];
  submissions[i] = {
    ...submissions[i],
    teacherAckAt: nowIso(),
    teacherAckBy: by,
  };
  saveHomework({ ...state, submissions });
  return { ok: true };
}

export function markHomeworkSeen(input: {
  kind: "post" | "diary";
  refId: string;
  studentId: string;
  householdId: string;
}): HomeworkSeen {
  const state = loadHomework();
  const hit = state.seen.find(
    (s) =>
      s.kind === input.kind &&
      s.refId === input.refId &&
      s.studentId === input.studentId,
  );
  if (hit) return hit;
  const row = normalizeSeen({
    id: nid("seen"),
    ...input,
    seenAt: nowIso(),
  });
  saveHomework({ ...state, seen: [row, ...state.seen] });
  return row;
}

export function listPostsForDay(
  state: HomeworkState,
  opts: {
    academicYearCode: string;
    date: string;
    classId?: string;
    sectionId?: string;
    includeWithdrawn?: boolean;
  },
): HomeworkPost[] {
  return state.posts
    .filter((p) => {
      if (p.academicYearCode !== opts.academicYearCode) return false;
      if (p.date !== opts.date) return false;
      if (!opts.includeWithdrawn && p.status !== "published") return false;
      if (opts.classId && p.classId !== opts.classId) return false;
      if (opts.sectionId && p.sectionId !== opts.sectionId) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listDiaryForDay(
  state: HomeworkState,
  opts: {
    academicYearCode: string;
    date: string;
    classId?: string;
    sectionId?: string;
  },
): DiaryEntry[] {
  return state.diary
    .filter((d) => {
      if (d.academicYearCode !== opts.academicYearCode) return false;
      if (d.date !== opts.date) return false;
      if (opts.classId && d.classId !== opts.classId) return false;
      if (opts.sectionId && d.sectionId !== opts.sectionId) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listFeedForStudent(
  state: HomeworkState,
  student: SisStudent,
  opts?: { fromDate?: string; toDate?: string },
): { posts: HomeworkPost[]; diary: DiaryEntry[] } {
  const from = opts?.fromDate || "";
  const to = opts?.toDate || "";
  const posts = state.posts
    .filter((p) => {
      if (p.status !== "published") return false;
      if (p.academicYearCode !== student.academicYearCode) return false;
      if (p.sectionId !== student.sectionId) return false;
      if (from && p.date < from) return false;
      if (to && p.date > to) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const diary = state.diary
    .filter((d) => {
      if (d.academicYearCode !== student.academicYearCode) return false;
      if (d.sectionId !== student.sectionId) return false;
      if (from && d.date < from) return false;
      if (to && d.date > to) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return { posts, diary };
}

export function isSeen(
  state: HomeworkState,
  kind: "post" | "diary",
  refId: string,
  studentId: string,
): boolean {
  return state.seen.some(
    (s) => s.kind === kind && s.refId === refId && s.studentId === studentId,
  );
}

export function submissionForStudent(
  state: HomeworkState,
  postId: string,
  studentId: string,
): HomeworkSubmission | undefined {
  return state.submissions.find(
    (s) => s.postId === postId && s.studentId === studentId,
  );
}

export function rosterForSection(
  sis: SisState,
  sectionId: string,
  ay: string,
): SisStudent[] {
  return sis.students.filter(
    (s) =>
      s.sectionId === sectionId &&
      s.academicYearCode === ay &&
      s.status === "active",
  );
}

export function seenPctForPost(
  state: HomeworkState,
  post: HomeworkPost,
  roster: SisStudent[],
): { seen: number; total: number; pct: number } {
  const total = roster.length;
  if (!total) return { seen: 0, total: 0, pct: 0 };
  const seen = roster.filter((s) =>
    isSeen(state, "post", post.id, s.id),
  ).length;
  return { seen, total, pct: Math.round((seen / total) * 100) };
}

export function classLabel(
  masters: MastersState,
  classId: string,
  sectionId: string,
): string {
  const c = masters.classes.find((x) => x.id === classId);
  const s = masters.sections.find((x) => x.id === sectionId);
  return [c?.name || classId, s?.name || ""].filter(Boolean).join(" · ");
}

export function subjectLabel(masters: MastersState, subjectId: string): string {
  const s = (masters.subjects ?? []).find((x) => x.id === subjectId);
  return s?.nameEn || subjectId;
}

/* ─── Reports ───────────────────────────────────────────────── */

export type HomeworkReportId =
  | "posts_per_teacher"
  | "parent_seen_pct"
  | "missing_hw_days"
  | "submissions_status";

export type HomeworkReportDef = {
  id: HomeworkReportId;
  label: string;
  hint?: string;
};

export const HOMEWORK_REPORTS: HomeworkReportDef[] = [
  {
    id: "posts_per_teacher",
    label: "Posts per teacher (week)",
    hint: "Accountability — HW + diary counts",
  },
  {
    id: "parent_seen_pct",
    label: "Parent seen % by post",
    hint: "Engagement for selected date range",
  },
  {
    id: "missing_hw_days",
    label: "Missing homework days by class",
    hint: "School days in range with zero published posts",
  },
  {
    id: "submissions_status",
    label: "Submissions status",
    hint: "Submitted vs pending for requires-submit posts",
  },
];

export type HomeworkReportFormat = "excel" | "pdf";

export function runHomeworkReport(
  id: HomeworkReportId,
  filters: {
    academicYearCode: string;
    fromDate: string;
    toDate: string;
    format: HomeworkReportFormat;
    homework?: HomeworkState;
    masters?: MastersState;
    sis?: SisState;
  },
): { ok: true; message: string } | { ok: false; error: string } {
  const hw = filters.homework ?? loadHomework();
  const masters = filters.masters ?? loadMasters();
  const sis = filters.sis ?? loadSis();
  const note = describeFilters([
    `AY ${filters.academicYearCode}`,
    `${filters.fromDate} → ${filters.toDate}`,
  ]);
  const from = filters.fromDate;
  const to = filters.toDate;

  switch (id) {
    case "posts_per_teacher": {
      const map = new Map<
        string,
        { teacher: string; posts: number; diary: number }
      >();
      for (const p of hw.posts) {
        if (p.academicYearCode !== filters.academicYearCode) continue;
        if (p.date < from || p.date > to) continue;
        if (p.status !== "published") continue;
        const key = p.teacherStaffId || p.teacherName;
        const row = map.get(key) || {
          teacher: p.teacherName || key,
          posts: 0,
          diary: 0,
        };
        row.posts += 1;
        map.set(key, row);
      }
      for (const d of hw.diary) {
        if (d.academicYearCode !== filters.academicYearCode) continue;
        if (d.date < from || d.date > to) continue;
        const key = d.teacherStaffId || d.teacherName;
        const row = map.get(key) || {
          teacher: d.teacherName || key,
          posts: 0,
          diary: 0,
        };
        row.diary += 1;
        map.set(key, row);
      }
      const rows = [...map.values()].map((r) => ({
        teacher: r.teacher,
        posts: r.posts,
        diary: r.diary,
        total: r.posts + r.diary,
      }));
      const cols: ReportColumn[] = [
        { key: "teacher", header: "Teacher" },
        { key: "posts", header: "HW posts", align: "right" },
        { key: "diary", header: "Diary", align: "right" },
        { key: "total", header: "Total", align: "right" },
      ];
      return finish("Posts per teacher", note, cols, rows, filters.format);
    }
    case "parent_seen_pct": {
      const posts = hw.posts.filter(
        (p) =>
          p.academicYearCode === filters.academicYearCode &&
          p.status === "published" &&
          p.date >= from &&
          p.date <= to,
      );
      const rows = posts.map((p) => {
        const roster = rosterForSection(sis, p.sectionId, p.academicYearCode);
        const stats = seenPctForPost(hw, p, roster);
        return {
          date: p.date,
          class: classLabel(masters, p.classId, p.sectionId),
          subject: subjectLabel(masters, p.subjectId),
          title: p.title,
          teacher: p.teacherName,
          seen: `${stats.seen}/${stats.total}`,
          pct: `${stats.pct}%`,
        };
      });
      const cols: ReportColumn[] = [
        { key: "date", header: "Date" },
        { key: "class", header: "Class" },
        { key: "subject", header: "Subject" },
        { key: "title", header: "Title" },
        { key: "teacher", header: "Teacher" },
        { key: "seen", header: "Seen" },
        { key: "pct", header: "%", align: "right" },
      ];
      return finish("Parent seen %", note, cols, rows, filters.format);
    }
    case "missing_hw_days": {
      const sections = masters.sections.filter((s) => s.isActive !== false);
      const rows: Record<string, string | number>[] = [];
      const start = new Date(from + "T00:00:00");
      const end = new Date(to + "T00:00:00");
      for (const sec of sections) {
        let missing = 0;
        const days: string[] = [];
        for (
          let d = new Date(start);
          d <= end;
          d.setDate(d.getDate() + 1)
        ) {
          const dow = d.getDay();
          if (dow === 0) continue; // skip Sunday
          const ymd = d.toISOString().slice(0, 10);
          const has = hw.posts.some(
            (p) =>
              p.sectionId === sec.id &&
              p.date === ymd &&
              p.status === "published" &&
              p.academicYearCode === filters.academicYearCode,
          );
          if (!has) {
            missing += 1;
            if (days.length < 8) days.push(ymd);
          }
        }
        if (missing === 0) continue;
        rows.push({
          class: classLabel(masters, sec.classId, sec.id),
          missing,
          sample: days.join(", "),
        });
      }
      const cols: ReportColumn[] = [
        { key: "class", header: "Class · section" },
        { key: "missing", header: "Days without HW", align: "right" },
        { key: "sample", header: "Sample dates" },
      ];
      return finish("Missing homework days", note, cols, rows, filters.format);
    }
    case "submissions_status": {
      const posts = hw.posts.filter(
        (p) =>
          p.requiresSubmit &&
          p.status === "published" &&
          p.academicYearCode === filters.academicYearCode &&
          p.date >= from &&
          p.date <= to,
      );
      const rows: Record<string, string | number>[] = [];
      for (const p of posts) {
        const roster = rosterForSection(sis, p.sectionId, p.academicYearCode);
        const submitted = roster.filter((s) =>
          hw.submissions.some(
            (x) => x.postId === p.id && x.studentId === s.id,
          ),
        ).length;
        rows.push({
          date: p.date,
          class: classLabel(masters, p.classId, p.sectionId),
          subject: subjectLabel(masters, p.subjectId),
          title: p.title,
          submitted: `${submitted}/${roster.length}`,
          pending: roster.length - submitted,
        });
      }
      const cols: ReportColumn[] = [
        { key: "date", header: "Date" },
        { key: "class", header: "Class" },
        { key: "subject", header: "Subject" },
        { key: "title", header: "Title" },
        { key: "submitted", header: "Submitted" },
        { key: "pending", header: "Pending", align: "right" },
      ];
      return finish("Submissions status", note, cols, rows, filters.format);
    }
    default:
      return { ok: false, error: "Unknown report" };
  }
}

function finish(
  title: string,
  filterNote: string,
  columns: ReportColumn[],
  rows: Record<string, string | number>[],
  format: HomeworkReportFormat,
): { ok: true; message: string } | { ok: false; error: string } {
  const r = exportFilterReport(
    {
      title,
      subtitle: TENANT.shortName,
      filterNote,
      columns,
      rows,
      fileBaseName: `homework_${title.replace(/\W+/g, "_").toLowerCase()}`,
    },
    format,
  );
  if (!r.ok) return r;
  return { ok: true, message: `${title}: ${rows.length} row(s) exported` };
}
