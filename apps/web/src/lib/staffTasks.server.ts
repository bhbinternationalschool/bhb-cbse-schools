/**
 * Staff tasks on the server (30 Oct 2026).
 *
 * One task is one row of public.staff_tasks; its progress log is rows of
 * public.staff_task_updates (migration 20261030120000, applied to production
 * before this ships — every handler fails closed while the tables are
 * missing). The read:
 *   GET  /api/data/views/staff-tasks  → staffTasksViewGet
 *        any member of staff. A manager (Staff · edit) or reviewer
 *        (Staff · approve) — module grant OR the staff.tasks function grant —
 *        gets the whole board; anyone else only the tasks assigned to them.
 *   POST /api/staff/tasks             → staffTasksPost (op "assign")
 *        assigners only: Staff · edit module holders (director, principal)
 *        or an explicit staff.tasks · create grant — the director's
 *        30 Oct rule, no automatic office grant.
 *   PATCH /api/staff/tasks/<id>       → staffTasksPatch
 *        progress / submit — the assignee (or a manager); review — reviewers
 *        only; cancel — assigners only. Every write names the rev the screen
 *        loaded (the row's updated_at); a stale base is a 409 with the
 *        stored task, never a silent overwrite.
 *
 * Every write goes through the write kernel (desk_write_guarded via
 * writeRows), one upsert per call. The kernel writes one TABLE per call, so
 * a state move and its log entry cannot be atomic — the ordering is chosen
 * so a FALSE SUCCESS is impossible: the task row moves FIRST (a conflict
 * there refuses the whole change and nothing is logged), the append-only
 * log row second. If the log write fails after the task moved, the answer
 * says so (logFailed: true) — the screen shows "saved, but the note was
 * not logged, send it again" instead of pretending the entry exists. The
 * retry then lands ONLY what is missing: an already-submitted task is not
 * rewritten (no duplicate transition), landed evidence is not duplicated,
 * and the reviewer's notice uses a stable dedupe key so it is stored once.
 * Idempotency is PER SUBMISSION CYCLE — stamped by the task's last
 * reviewed_at — so a resubmission after a return is a new cycle: new
 * evidence row, new key, the reviewer is told again.
 *
 * Dependencies are injected (staffTasksDeps.server.ts has the real ones) so
 * the self-test drives the handlers without a database.
 */
import { NextResponse } from "next/server";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { RouteAuthResult } from "@/lib/apiRouteAuth.server";
import { asRevision, describeWriteFailure, isWriteOk, type WriteOp, type WriteResult } from "@/lib/data/types";
import type { NotifyEvent } from "@/lib/notify/notify";
import {
  attachmentsFrom,
  type StaffTaskPriority,
  type StaffTaskRow,
  type StaffTasksView,
  type StaffTaskUpdate,
} from "@/lib/staffTasksShared";

type Row = Record<string, unknown>;

export type StaffTasksDeps = {
  /** Any member of staff (requireStaffApi). */
  requireStaff: (req: Request) => Promise<RouteAuthResult>;
  /** Assigners: Staff · edit OR the staff.tasks · create grant. */
  assignAuth: (req: Request) => Promise<RouteAuthResult>;
  /** Reviewers: Staff · approve OR the staff.tasks · approve grant. */
  reviewAuth: (req: Request) => Promise<RouteAuthResult>;
  /** Every live task row for the tenant, newest first; null = read failed. */
  readTasks: () => Promise<StaffTaskRow[] | null>;
  /** The progress log for one task, oldest first; null = read failed. */
  readUpdates: (taskId: string) => Promise<StaffTaskUpdate[] | null>;
  /** writeRows("staff_tasks", ops). */
  writeTasks: (ops: WriteOp<Row>[]) => Promise<WriteResult<Row>>;
  /** writeRows("staff_task_updates", ops). */
  writeUpdates: (ops: WriteOp<Row>[]) => Promise<WriteResult<Row>>;
  /** May this login manage (assign/cancel)? featureAccess staff.tasks · create. */
  canManage: (ctx: ApiAuthContext) => boolean;
  /** May this login review? featureAccess staff.tasks · approve. */
  canReview: (ctx: ApiAuthContext) => boolean;
  /** The caller's staff record id, or null when the login has none. */
  selfStaffId: (ctx: ApiAuthContext) => string | null;
  /** Display name of a staff id from the session's masters ("" when unknown). */
  staffLabel: (ctx: ApiAuthContext, staffId: string) => string;
  now: () => Date;
  newId: (prefix: "st" | "stu") => string;
  /** Tell the people it concerns (lib/notify) — the assignee on assign, the assigner on submit, the assignee on review. Optional in tests. */
  notify?: (ev: NotifyEvent) => Promise<unknown>;
};

const NO_STORE = { "Cache-Control": "private, no-store" };
const TITLE_MAX = 200;
const DETAIL_MAX = 4000;
const NOTE_MAX = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: NO_STORE });
}

function ok(body: Record<string, unknown>): Response {
  return NextResponse.json({ ok: true, ...body }, { headers: NO_STORE });
}

async function refusal(r: { response: Response }): Promise<Response> {
  const status = r.response.status;
  const body = (await r.response.json().catch(() => null)) as { error?: unknown } | null;
  return fail(status, typeof body?.error === "string" ? body.error : "Forbidden");
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function writeFailure(status: number, r: WriteResult<Row>): Response {
  if (isWriteOk(r)) return fail(500, "The write answer was not understood");
  if (r.kind === "conflict") return fail(409, describeWriteFailure(r), { conflicts: r.conflicts ?? [] });
  return fail(status, describeWriteFailure(r));
}

/* ── The read ─────────────────────────────────────────────────────────── */

export async function staffTasksViewGet(req: Request, deps: StaffTasksDeps): Promise<Response> {
  const auth = await deps.requireStaff(req);
  if (!auth.ok) return refusal(auth);
  const ctx = auth.ctx;
  const canManage = auth.viaMirrorSecret || deps.canManage(ctx);
  const canReview = auth.viaMirrorSecret || deps.canReview(ctx);
  const selfId = auth.viaMirrorSecret ? null : deps.selfStaffId(ctx);
  const tasks = await deps.readTasks();
  if (!tasks) return fail(503, "Tasks could not be read");
  const visible = canManage || canReview ? tasks : tasks.filter((t) => t.assigneeStaffId === selfId);
  const view: StaffTasksView = { tasks: visible, canManage, canReview, selfStaffId: selfId };
  return NextResponse.json(view, { headers: NO_STORE });
}

/** One task with its progress log — the assignee, the assigner, a manager or a reviewer. */
export async function staffTasksGetOne(req: Request, deps: StaffTasksDeps, taskId: string): Promise<Response> {
  const auth = await deps.requireStaff(req);
  if (!auth.ok) return refusal(auth);
  const ctx = auth.ctx;
  const tasks = await deps.readTasks();
  if (!tasks) return fail(503, "Tasks could not be read");
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return fail(404, "That task was not found");
  const selfId = auth.viaMirrorSecret ? null : deps.selfStaffId(ctx);
  const allowed =
    auth.viaMirrorSecret ||
    deps.canManage(ctx) ||
    deps.canReview(ctx) ||
    (!!selfId && (task.assigneeStaffId === selfId || task.assignedBy === selfId));
  if (!allowed) return fail(403, "This task is not yours");
  const updates = await deps.readUpdates(task.id);
  if (!updates) return fail(503, "The progress log could not be read");
  return NextResponse.json({ task, updates }, { headers: NO_STORE });
}

/* ── Assign ───────────────────────────────────────────────────────────── */

export async function staffTasksPost(req: Request, deps: StaffTasksDeps): Promise<Response> {
  const auth = await deps.assignAuth(req);
  if (!auth.ok) return refusal(auth);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "The request was not understood");
  }
  if (body?.op !== "assign") return fail(400, "Unknown operation");

  const ctx = auth.ctx;
  const title = str(body.title, TITLE_MAX);
  const assigneeStaffId = str(body.assigneeStaffId, 120);
  if (!title) return fail(400, "Give the task a title");
  if (!assigneeStaffId) return fail(400, "Choose who the task is for");
  const assigneeLabel = deps.staffLabel(ctx, assigneeStaffId);
  if (!assigneeLabel) return fail(400, "That staff member was not found");
  const priority: StaffTaskPriority = body.priority === "urgent" ? "urgent" : "normal";
  const dueOn = typeof body.dueOn === "string" && DATE_RE.test(body.dueOn) ? body.dueOn : null;
  const detail = str(body.detail, DETAIL_MAX);
  const evidenceRequired = body.evidenceRequired !== false;

  const selfId = auth.viaMirrorSecret ? "" : deps.selfStaffId(ctx) ?? "";
  const byLabel = auth.viaMirrorSecret
    ? "Office"
    : deps.staffLabel(ctx, selfId) || str((ctx.session as { fullName?: unknown }).fullName, 120) || "Office";

  const id = deps.newId("st");
  const nowIso = deps.now().toISOString();
  const row: Row = {
    id,
    title,
    detail,
    assignee_staff_id: assigneeStaffId,
    assigned_by: selfId || "office",
    assigned_by_label: byLabel,
    priority,
    due_on: dueOn,
    status: "assigned",
    progress_pct: 0,
    evidence_required: evidenceRequired,
    reviewed_by: "",
    reviewed_at: null,
    review_note: "",
  };
  const wr = await deps.writeTasks([{ op: "upsert", id, base: null, row }]);
  if (!isWriteOk(wr)) return writeFailure(503, wr);

  if (deps.notify) {
    await deps
      .notify({
        kind: "staff_task.assigned",
        key: `staff_task:${id}:assigned`,
        audience: [{ staff: [assigneeStaffId] }],
        title: {
          en: `${priority === "urgent" ? "Urgent task" : "Task"} · ${byLabel}`,
          hi: `${priority === "urgent" ? "ज़रूरी काम" : "काम"} · ${byLabel}`,
        },
        body: {
          en: `${title}${dueOn ? ` · due ${dueOn}` : ""}`,
          hi: `${title}${dueOn ? ` · ${dueOn} तक` : ""}`,
        },
        link: "/notifications",
        webLink: "/staff?tab=tasks",
        data: { taskId: id },
        actor: byLabel,
        urgent: priority === "urgent",
      })
      .catch(() => undefined);
  }
  const created = (await deps.readTasks())?.find((t) => t.id === id) ?? null;
  return ok({ task: created ?? { ...row, createdAt: nowIso, updatedAt: nowIso, rev: nowIso } });
}

/* ── Progress / submit / review / cancel ──────────────────────────────── */

export async function staffTasksPatch(req: Request, deps: StaffTasksDeps, taskId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "The request was not understood");
  }
  const op = body?.op;
  if (op !== "progress" && op !== "submit" && op !== "review" && op !== "cancel") {
    return fail(400, "Unknown operation");
  }
  const base = typeof body.base === "string" && body.base ? body.base : null;
  if (!base) return fail(400, "The task version is missing — reload and try again");

  // Review and cancel are privileged doors; progress and submit need any
  // staff login first, then the assignee check below.
  const auth = op === "review" ? await deps.reviewAuth(req) : op === "cancel" ? await deps.assignAuth(req) : await deps.requireStaff(req);
  if (!auth.ok) return refusal(auth);
  const ctx = auth.ctx;

  const tasks = await deps.readTasks();
  if (!tasks) return fail(503, "Tasks could not be read");
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return fail(404, "That task was not found");

  const selfId = auth.viaMirrorSecret ? null : deps.selfStaffId(ctx);
  const manager = auth.viaMirrorSecret || deps.canManage(ctx);
  const reviewer = auth.viaMirrorSecret || deps.canReview(ctx);
  const isAssignee = !!selfId && task.assigneeStaffId === selfId;

  if ((op === "progress" || op === "submit") && !isAssignee && !manager) {
    return fail(403, "Only the person this task is for can update it");
  }
  if (task.status === "done" || task.status === "cancelled") {
    return fail(409, `This task is already ${task.status === "done" ? "complete" : "cancelled"}`, { task });
  }

  const nowIso = deps.now().toISOString();
  const logRow = (fields: { pct: number | null; note: string; attachments: unknown[] }): Row => ({
    id: deps.newId("stu"),
    task_id: task.id,
    author_staff_id: selfId || "office",
    pct: fields.pct,
    note: fields.note,
    attachments: fields.attachments,
  });

  if (op === "progress") {
    const pct = typeof body.pct === "number" ? Math.max(0, Math.min(100, Math.floor(body.pct))) : null;
    const note = str(body.note, NOTE_MAX);
    const attachments = attachmentsFrom(body.attachments);
    if (pct === null && !note && attachments.length === 0) return fail(400, "Write a note or a percent done");
    const wr2 = await deps.writeTasks([
      {
        op: "upsert",
        id: task.id,
        base: asRevision(base),
        row: { id: task.id, status: "in_progress", ...(pct !== null ? { progress_pct: pct } : {}) },
      },
    ]);
    if (!isWriteOk(wr2)) return writeFailure(503, wr2);
    const progressLog = logRow({ pct, note, attachments });
    const wr1 = await deps.writeUpdates([{ op: "upsert", id: progressLog.id as string, base: null, row: progressLog }]);
    const logFailed = !isWriteOk(wr1);
    return ok({
      task: { ...task, status: "in_progress", progressPct: pct ?? task.progressPct, rev: nowIso, updatedAt: nowIso },
      ...(logFailed ? { logFailed: true, warning: "Progress saved, but the note was not logged — send it again." } : {}),
    });
  }

  if (op === "submit") {
    const note = str(body.note, NOTE_MAX);
    const attachments = attachmentsFrom(body.attachments);
    // Idempotency is PER SUBMISSION CYCLE, not per task: a return sends the
    // task back for a NEW submission, and that new submission must notify
    // the reviewer again and carry its own evidence. The cycle is stamped
    // by the last review (reviewed_at; "0" before the first), so the cycle's
    // log-row id and the notify key are both deterministic from task state:
    //   - a retry of THIS submission (after a partial failure or a
    //     double-click) converges on the same log row and the same key —
    //     no duplicate transition, evidence row or reviewer notice, even
    //     for two requests in flight at once;
    //   - a resubmission after a return starts a new cycle: new log row,
    //     new key, the reviewer is told again, and the old cycle's evidence
    //     stays untouched in the history.
    // State first, evidence second (one kernel call per table, so the two
    // can never be atomic): a failed evidence write must never masquerade
    // as a completed submit. `base` is required, but on a retry it is only
    // the caller's freshness token, not a write base.
    const cycleTag = task.reviewedAt ? task.reviewedAt.replace(/\D/g, "") : "0";
    const cycleLogId = `stu_${task.id}_submit_${cycleTag}`;
    const prior = await deps.readUpdates(task.id);
    if (prior === null) return fail(503, "The task's history could not be read");
    const cycleLog = prior.find((u) => u.id === cycleLogId) ?? null;
    // The evidence rule is cycle-scoped too: evidence from BEFORE a return
    // does not satisfy the new submission; evidence already landed in THIS
    // cycle makes an empty resubmit a no-op confirmation, not a 400.
    const evidenceLogged = !!cycleLog && cycleLog.attachments.length > 0;
    if (task.evidenceRequired && attachments.length === 0 && !evidenceLogged) {
      return fail(400, "This task needs evidence — attach a photo, file or link before sending it for review");
    }
    let working = task;
    if (task.status !== "submitted") {
      const wr2 = await deps.writeTasks([
        { op: "upsert", id: task.id, base: asRevision(base), row: { id: task.id, status: "submitted", progress_pct: 100 } },
      ]);
      if (!isWriteOk(wr2)) return writeFailure(503, wr2);
      working = { ...task, status: "submitted", progressPct: 100, rev: nowIso, updatedAt: nowIso };
    }
    let logFailed = false;
    if (!cycleLog || note || attachments.length > 0) {
      const submitLog = { ...logRow({ pct: 100, note, attachments }), id: cycleLogId };
      const wr1 = await deps.writeUpdates([{ op: "upsert", id: cycleLogId, base: null, row: submitLog }]);
      logFailed = !isWriteOk(wr1);
    }
    if (deps.notify && task.assignedBy && !logFailed) {
      const byLabel = selfId ? deps.staffLabel(ctx, selfId) : "Staff";
      await deps
        .notify({
          kind: "staff_task.submitted",
          // Cycle-scoped stable key: erp_notify_deliver stores one row per
          // key, so a retry of this submission is free, while the next
          // cycle's resubmission notifies the reviewer again — a returned
          // task can never strand its re-review.
          key: `staff_task:${task.id}:submitted:${cycleTag}`,
          audience: [{ staff: [task.assignedBy] }],
          exclude: selfId ? [{ type: "staff", id: selfId }] : undefined,
          title: { en: `For review · ${byLabel}`, hi: `रिव्यू के लिए · ${byLabel}` },
          body: { en: task.title, hi: task.title },
          link: "/notifications",
          webLink: "/staff?tab=tasks",
          data: { taskId: task.id },
          actor: byLabel,
        })
        .catch(() => undefined);
    }
    return ok({
      task: working,
      ...(logFailed ? { logFailed: true, warning: "Sent for review, but the evidence was not logged — attach it again." } : {}),
    });
  }

  if (op === "review") {
    if (!reviewer) return fail(403, "You cannot review tasks");
    if (task.status !== "submitted") return fail(409, "Only a task sent for review can be reviewed", { task });
    const decision = body.decision === "accept" ? "accept" : body.decision === "return" ? "return" : null;
    if (!decision) return fail(400, "Say whether the task is accepted or returned");
    const note = str(body.note, NOTE_MAX);
    if (decision === "return" && !note) return fail(400, "Say what needs fixing when returning a task");
    const reviewerLabel = selfId ? deps.staffLabel(ctx, selfId) : "Office";
    const status = decision === "accept" ? "done" : "returned";
    const wr = await deps.writeTasks([
      {
        op: "upsert",
        id: task.id,
        base: asRevision(base),
        row: {
          id: task.id,
          status,
          reviewed_by: selfId || "office",
          reviewed_at: nowIso,
          review_note: note,
          ...(decision === "return" ? { progress_pct: Math.min(task.progressPct, 90) } : {}),
        },
      },
    ]);
    if (!isWriteOk(wr)) return writeFailure(503, wr);
    if (deps.notify) {
      await deps
        .notify({
          kind: "staff_task.reviewed",
          key: `staff_task:${task.id}:reviewed:${nowIso}`,
          audience: [{ staff: [task.assigneeStaffId] }],
          title: {
            en: decision === "accept" ? `Task accepted · ${reviewerLabel}` : `Task returned · ${reviewerLabel}`,
            hi: decision === "accept" ? `काम स्वीकार · ${reviewerLabel}` : `काम वापस · ${reviewerLabel}`,
          },
          body: { en: note || task.title, hi: note || task.title },
          link: "/notifications",
          webLink: "/staff?tab=tasks",
          data: { taskId: task.id },
          actor: reviewerLabel,
        })
        .catch(() => undefined);
    }
    return ok({ task: { ...task, status, reviewNote: note, reviewedBy: selfId || "office", reviewedAt: nowIso, rev: nowIso, updatedAt: nowIso } });
  }

  // cancel
  const wr = await deps.writeTasks([
    { op: "upsert", id: task.id, base: asRevision(base), row: { id: task.id, status: "cancelled" } },
  ]);
  if (!isWriteOk(wr)) return writeFailure(503, wr);
  return ok({ task: { ...task, status: "cancelled", rev: nowIso, updatedAt: nowIso } });
             }
