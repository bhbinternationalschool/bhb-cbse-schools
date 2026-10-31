/**
 * Staff tasks: what the browser and the server agree on (30 Oct 2026).
 *
 * One task is one row of public.staff_tasks; its progress log is rows of
 * public.staff_task_updates (migration 20261030120000). The browser holds no
 * copy: the board / "my tasks" read through GET /api/data/views/staff-tasks,
 * and every change is one POST /api/staff/tasks (assign) or one PATCH
 * /api/staff/tasks/<id> (progress, submit, review, cancel) through the write
 * kernel (desk_write_guarded, base = the row's updated_at).
 *
 * Permission rule (director, 30 Oct 2026 — "mere paas, principal ke paas ya
 * RBAC ke dvara"): the board, assigning and reviewing need the Staff module's
 * edit/approve (owner, principal) or the staff.tasks FUNCTION grant in the
 * RBAC editor. A member of staff sees and updates only their own tasks.
 */
export type StaffTaskStatus = "assigned" | "in_progress" | "submitted" | "returned" | "done" | "cancelled";
export type StaffTaskPriority = "normal" | "urgent";

export const STAFF_TASK_STATUSES: readonly StaffTaskStatus[] = [
  "assigned",
  "in_progress",
  "submitted",
  "returned",
  "done",
  "cancelled",
];

export const STAFF_TASK_STATUS_LABELS: Record<StaffTaskStatus, { en: string; hi: string }> = {
  assigned: { en: "Assigned", hi: "सौंपा गया" },
  in_progress: { en: "In progress", hi: "चल रहा" },
  submitted: { en: "Sent for review", hi: "रिव्यू के लिए भेजा" },
  returned: { en: "Returned", hi: "वापस आया" },
  done: { en: "Done", hi: "पूरा" },
  cancelled: { en: "Cancelled", hi: "रद्द" },
};

export type StaffTaskAttachment = { kind: "photo" | "file" | "link"; name: string; path: string };

export type StaffTask = {
  id: string;
  title: string;
  detail: string;
  assigneeStaffId: string;
  assignedBy: string;
  assignedByLabel: string;
  priority: StaffTaskPriority;
  dueOn: string | null;
  status: StaffTaskStatus;
  progressPct: number;
  evidenceRequired: boolean;
  reviewedBy: string;
  reviewedAt: string | null;
  reviewNote: string;
  createdAt: string;
  updatedAt: string;
};

export type StaffTaskUpdate = {
  id: string;
  taskId: string;
  authorStaffId: string;
  pct: number | null;
  note: string;
  attachments: StaffTaskAttachment[];
  createdAt: string;
};

/** A task row as the view serves it; `rev` is the write base (updated_at). */
export type StaffTaskRow = StaffTask & { rev: string };

export type StaffTasksView = {
  /** The board (every task) when `canManage`, else only the caller's own. */
  tasks: StaffTaskRow[];
  /** May assign and cancel (Staff · edit, or the staff.tasks grant). */
  canManage: boolean;
  /** May review — accept or return a submitted task (Staff · approve, or the grant). */
  canReview: boolean;
  /** The caller's staff record, or null when the login has none. */
  selfStaffId: string | null;
};

/** POST /api/staff/tasks bodies. */
export type StaffTaskPost = {
  op: "assign";
  title: string;
  detail?: string;
  assigneeStaffId: string;
  priority?: StaffTaskPriority;
  dueOn?: string | null;
  evidenceRequired?: boolean;
};

/** PATCH /api/staff/tasks/<id> bodies. Every one names the rev it loaded. */
export type StaffTaskPatch =
  | { op: "progress"; base: string; pct?: number; note?: string; attachments?: StaffTaskAttachment[] }
  | { op: "submit"; base: string; note?: string; attachments?: StaffTaskAttachment[] }
  | { op: "review"; base: string; decision: "accept" | "return"; note?: string }
  | { op: "cancel"; base: string };

export const STAFF_TASKS_VIEW_PATH = "/api/data/views/staff-tasks";
export const STAFF_TASKS_WRITE_PATH = "/api/staff/tasks";
/** The erp_versions key whose move means "tasks may have changed". */
export const STAFF_TASKS_DESK = "staff_tasks";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function attachmentsFrom(raw: unknown): StaffTaskAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffTaskAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const kind = o.kind === "photo" || o.kind === "file" || o.kind === "link" ? o.kind : null;
    const path = str(o.path, 500);
    if (!kind || !path) continue;
    out.push({ kind, name: str(o.name, 200) || path, path });
  }
  return out.slice(0, 10);
}

/** A database row as a task; null for anything that is not one. */
export function staffTaskFromRow(raw: unknown): StaffTaskRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.title !== "string" || !o.title) return null;
  if (typeof o.assignee_staff_id !== "string" || !o.assignee_staff_id) return null;
  const status = STAFF_TASK_STATUSES.includes(o.status as StaffTaskStatus) ? (o.status as StaffTaskStatus) : "assigned";
  const updatedAt = str(o.updated_at, 40);
  if (!updatedAt) return null;
  return {
    id: o.id,
    title: str(o.title, 200),
    detail: str(o.detail, 4000),
    assigneeStaffId: o.assignee_staff_id as string,
    assignedBy: str(o.assigned_by, 120),
    assignedByLabel: str(o.assigned_by_label, 120),
    priority: o.priority === "urgent" ? "urgent" : "normal",
    dueOn: typeof o.due_on === "string" && DATE_RE.test(o.due_on) ? o.due_on : null,
    status,
    progressPct: typeof o.progress_pct === "number" ? Math.max(0, Math.min(100, Math.floor(o.progress_pct))) : 0,
    evidenceRequired: o.evidence_required !== false,
    reviewedBy: str(o.reviewed_by, 120),
    reviewedAt: typeof o.reviewed_at === "string" ? o.reviewed_at : null,
    reviewNote: str(o.review_note, 2000),
    createdAt: str(o.created_at, 40),
    updatedAt,
    rev: updatedAt,
  };
}

export function staffTaskUpdateFromRow(raw: unknown): StaffTaskUpdate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id || typeof o.task_id !== "string" || !o.task_id) return null;
  return {
    id: o.id,
    taskId: o.task_id,
    authorStaffId: str(o.author_staff_id, 120),
    pct: typeof o.pct === "number" ? Math.max(0, Math.min(100, Math.floor(o.pct))) : null,
    note: str(o.note, 2000),
    attachments: attachmentsFrom(o.attachments),
    createdAt: str(o.created_at, 40),
  };
}

/** The view's answer, checked: a malformed body is a failed read, never an empty list (R6). */
export function parseStaffTasksView(data: unknown): StaffTasksView {
  const d = data as Partial<StaffTasksView> | null;
  if (!d || !Array.isArray(d.tasks) || typeof d.canManage !== "boolean" || typeof d.canReview !== "boolean") {
    throw new Error("The tasks answer was not understood");
  }
  return {
    tasks: d.tasks.map(staffTaskFromRow).filter((r): r is StaffTaskRow => !!r),
    canManage: d.canManage,
    canReview: d.canReview,
    selfStaffId: typeof d.selfStaffId === "string" && d.selfStaffId ? d.selfStaffId : null,
  };
}
