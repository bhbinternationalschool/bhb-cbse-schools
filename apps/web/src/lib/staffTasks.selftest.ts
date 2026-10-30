/**
 * Run: npx tsx src/lib/staffTasks.selftest.ts
 *
 * Staff tasks on the server (30 Oct 2026; lib/staffTasks.server.ts):
 *  - the view: a manager/reviewer (staff.tasks grant or the Staff module)
 *    gets the whole board, anyone else only their own tasks; a guard's 401
 *    passes through; a failed read is 503, never an empty list;
 *  - assign: assigners only (assignAuth), the server picks the id, the
 *    assigner (from the session, never the body) and "assigned"; no title /
 *    unknown assignee 400; ONE upsert with a null base; the assignee is
 *    told (bilingual notice);
 *  - progress: the assignee or a manager; an empty update 400; the task row
 *    moves FIRST (a conflict logs nothing) and the log row second — a
 *    failed log is answered with logFailed + a warning, never silence;
 *    the loaded rev goes to the kernel as the base;
 *  - one-task read: the assignee, the assigner, a manager or a reviewer;
 *    anyone else 403;
 *  - submit: evidence required → no attachment is a 400 in the person's
 *    words; with evidence the task is "submitted" and the assigner is told;
 *  - review: reviewers only; accept → done, return needs a note →
 *    "returned"; a task not sent for review is a 409;
 *  - cancel: assigners; a done task is a 409, never a silent overwrite.
 */
import assert from "node:assert/strict";
import { installServerOnlyStub } from "./fakePostgrest.testkit";

installServerOnlyStub();

async function main() {
  const { NextResponse } = await import("next/server");
  const { defaultMasters } = await import("./masters");
  const { defaultRbacState } = await import("./rbac");
  const srv = await import("./staffTasks.server");
  type Deps = import("./staffTasks.server").StaffTasksDeps;
  type Row = Record<string, unknown>;
  type Op = import("./data/types").WriteOp<Row>;
  type WR = import("./data/types").WriteResult<Row>;
  type Ctx = import("./api/v1/auth").ApiAuthContext;
  type TaskRow = import("./staffTasksShared").StaffTaskRow;

  let passed = 0;
  const ok = (name: string) => {
    passed++;
    console.log(`  ok  ${name}`);
  };

  const masters = defaultMasters();
  const staffRec = (id: string, name: string) =>
    ({ ...(masters.staff?.[0] ?? {}), id, empCode: id.toUpperCase(), fullName: name, status: "active", designationId: null, email: "", loginUsername: "" }) as never;
  masters.staff = [staffRec("st_teacher", "Asha Teacher"), staffRec("st_other", "Bina Other"), staffRec("st_principal", "Chandra Principal")];
  masters.designations = [];
  const rbac = defaultRbacState();
  const session = (staffId: string | undefined, roleCode: string, fullName: string) =>
    ({ persona: "staff" as const, fullName, roleCode, staffId, tenantSlug: "t", academicYearCode: "2026-27" }) as never;
  const ctxOf = (staffId: string | undefined, roleCode: string, fullName: string): Ctx =>
    ({ session: session(staffId, roleCode, fullName), masters, rbac, rbacKnown: true, authKind: "session" }) as Ctx;

  const taskRow = (over: Partial<TaskRow> = {}): TaskRow => ({
    id: "st_1",
    title: "Fix the gate board",
    detail: "",
    assigneeStaffId: "st_teacher",
    assignedBy: "st_principal",
    assignedByLabel: "Chandra Principal",
    priority: "normal",
    dueOn: null,
    status: "assigned",
    progressPct: 0,
    evidenceRequired: true,
    reviewedBy: "",
    reviewedAt: null,
    reviewNote: "",
    createdAt: "2026-10-30T03:00:00.000Z",
    updatedAt: "2026-10-30T03:00:00.000Z",
    rev: "2026-10-30T03:00:00.000Z",
    ...over,
  });

  const authed = (ctx: Ctx) => ({ ok: true as const, ctx, viaMirrorSecret: false });
  const refused = (status = 403) => ({
    ok: false as const,
    response: NextResponse.json({ ok: false, error: "Forbidden" }, { status }),
  });

  /** A deps stub; each test overrides what it checks. */
  const deps = (over: Partial<Deps> = {}): Deps & { ops: { tasks: Op[]; updates: Op[] }; notices: unknown[] } => {
    const store = { ops: { tasks: [] as Op[], updates: [] as Op[] }, notices: [] as unknown[] };
    const d: Deps = {
      requireStaff: async () => authed(ctxOf("st_teacher", "teacher", "Asha Teacher")),
      assignAuth: async () => authed(ctxOf("st_principal", "principal", "Chandra Principal")),
      reviewAuth: async () => authed(ctxOf("st_principal", "principal", "Chandra Principal")),
      readTasks: async () => [taskRow()],
      readUpdates: async () => [],
      writeTasks: async (ops) => {
        store.ops.tasks.push(...ops);
        return { ok: true, results: [], versions: {} } as WR;
      },
      writeUpdates: async (ops) => {
        store.ops.updates.push(...ops);
        return { ok: true, results: [], versions: {} } as WR;
      },
      canManage: () => false,
      canReview: () => false,
      selfStaffId: (ctx) => ctx.session.staffId ?? null,
      staffLabel: (_ctx, id) => masters.staff?.find((s) => s.id === id)?.fullName ?? "",
      now: () => new Date("2026-10-30T04:00:00.000Z"),
      newId: (p) => `${p}_test`,
      notify: async (ev) => {
        store.notices.push(ev);
        return null;
      },
      ...over,
    };
    return Object.assign(d, store) as Deps & typeof store;
  };

  const jsonReq = (body: unknown) =>
    new Request("https://test.local/api/staff/tasks", { method: "POST", body: JSON.stringify(body) });

  // ── the view ──
  {
    const d = deps();
    const res = await srv.staffTasksViewGet(new Request("https://test.local/api/data/views/staff-tasks"), d);
    assert.equal(res.status, 200);
    const view = await res.json();
    assert.equal(view.tasks.length, 1, "the assignee sees their own task");
    assert.equal(view.canManage, false);
    assert.equal(view.selfStaffId, "st_teacher");
    ok("view: assignee sees only their own");
  }
  {
    const d = deps({ canManage: () => true, readTasks: async () => [taskRow(), taskRow({ id: "st_2", assigneeStaffId: "st_other" })] });
    const res = await srv.staffTasksViewGet(new Request("https://test.local/api/data/views/staff-tasks"), d);
    const view = await res.json();
    assert.equal(view.tasks.length, 2, "a manager sees the whole board");
    assert.equal(view.canManage, true);
    ok("view: manager sees the board");
  }
  {
    const d = deps({ requireStaff: async () => refused(401) });
    const res = await srv.staffTasksViewGet(new Request("https://test.local/api/data/views/staff-tasks"), d);
    assert.equal(res.status, 401, "the guard's answer passes through");
    ok("view: 401 passes through");
  }
  {
    const d = deps({ readTasks: async () => null });
    const res = await srv.staffTasksViewGet(new Request("https://test.local/api/data/views/staff-tasks"), d);
    assert.equal(res.status, 503, "a failed read is 503, never an empty list");
    ok("view: failed read is 503");
  }

  // ── assign ──
  {
    const d = deps({ assignAuth: async () => refused(403) });
    const res = await srv.staffTasksPost(jsonReq({ op: "assign", title: "X", assigneeStaffId: "st_teacher" }), d);
    assert.equal(res.status, 403);
    assert.equal(d.ops.tasks.length, 0, "no write when refused");
    ok("assign: non-assigner refused, nothing written");
  }
  {
    const d = deps();
    const res = await srv.staffTasksPost(jsonReq({ op: "assign", title: "", assigneeStaffId: "st_teacher" }), d);
    assert.equal(res.status, 400, "no title is a 400");
    const res2 = await srv.staffTasksPost(jsonReq({ op: "assign", title: "X", assigneeStaffId: "st_ghost" }), d);
    assert.equal(res2.status, 400, "an unknown assignee is a 400");
    ok("assign: validation");
  }
  {
    const d = deps();
    const res = await srv.staffTasksPost(
      jsonReq({ op: "assign", title: "Fix the gate board", assigneeStaffId: "st_teacher", priority: "urgent", dueOn: "2026-11-02" }),
      d,
    );
    assert.equal(res.status, 200, (await res.clone().text()).slice(0, 200));
    assert.equal(d.ops.tasks.length, 1, "one write op");
    const op = d.ops.tasks[0];
    assert.equal(op.op, "upsert");
    assert.equal(op.base, null, "a new row has no base");
    const row = (op as { row: Row }).row;
    assert.equal(row.status, "assigned");
    assert.equal(row.assigned_by, "st_principal", "the assigner comes from the session, never the body");
    assert.equal(row.assigned_by_label, "Chandra Principal");
    assert.equal(row.priority, "urgent");
    assert.equal(row.due_on, "2026-11-02");
    assert.equal(row.evidence_required, true, "evidence is required by default");
    assert.equal(d.notices.length, 1, "the assignee is told");
    const ev = d.notices[0] as { kind: string; audience: { staff: string[] }[]; title: { en: string; hi?: string }; urgent?: boolean };
    assert.equal(ev.kind, "staff_task.assigned");
    assert.deepEqual(ev.audience, [{ staff: ["st_teacher"] }]);
    assert.ok(ev.title.hi, "the notice is bilingual");
    assert.equal(ev.urgent, true, "an urgent task is an urgent notice");
    ok("assign: one upsert, server-owned fields, bilingual notice");
  }

  // ── progress ──
  {
    const d = deps();
    const res = await srv.staffTasksPatch(jsonReq({ op: "progress", base: taskRow().rev, pct: 40, note: "half done" }), d, "st_1");
    assert.equal(res.status, 200, (await res.clone().text()).slice(0, 200));
    assert.equal(d.ops.updates.length, 1, "the log row is written");
    assert.equal(d.ops.tasks.length, 1);
    const u = (d.ops.updates[0] as { row: Row }).row;
    assert.equal(u.task_id, "st_1");
    assert.equal(u.pct, 40);
    assert.equal(u.author_staff_id, "st_teacher");
    const t = d.ops.tasks[0];
    assert.equal(t.op, "upsert");
    assert.equal(t.base, taskRow().rev, "the loaded rev is the write base");
    ok("progress: task row first, log row second, loaded base");
  }
  {
    const d = deps({ selfStaffId: () => "st_other" });
    const res = await srv.staffTasksPatch(jsonReq({ op: "progress", base: taskRow().rev, pct: 10 }), d, "st_1");
    assert.equal(res.status, 403, "someone else's task is not theirs to update");
    ok("progress: non-assignee refused");
  }
  {
    const d = deps();
    const res = await srv.staffTasksPatch(jsonReq({ op: "progress", base: taskRow().rev }), d, "st_1");
    assert.equal(res.status, 400, "an empty update is a 400");
    ok("progress: empty update refused");
  }

  // ── submit ──
  {
    const d = deps();
    const res = await srv.staffTasksPatch(jsonReq({ op: "submit", base: taskRow().rev }), d, "st_1");
    assert.equal(res.status, 400, "evidence required → no attachment is a 400");
    const body = await res.json();
    assert.match(body.error, /evidence/i);
    ok("submit: evidence required");
  }
  {
    const d = deps({ readTasks: async () => [taskRow({ status: "in_progress", progressPct: 40 })] });
    const res = await srv.staffTasksPatch(
      jsonReq({ op: "submit", base: taskRow().rev, note: "photo attached", attachments: [{ kind: "photo", name: "gate.jpg", path: "staff-tasks/st_1/gate.jpg" }] }),
      d,
      "st_1",
    );
    assert.equal(res.status, 200, (await res.clone().text()).slice(0, 200));
    const t = (d.ops.tasks[0] as { row: Row }).row;
    assert.equal(t.status, "submitted");
    assert.equal(t.progress_pct, 100);
    const ev = d.notices[0] as { kind: string; audience: { staff: string[] }[] };
    assert.equal(ev.kind, "staff_task.submitted");
    assert.deepEqual(ev.audience, [{ staff: ["st_principal"] }], "the assigner is asked to review");
    ok("submit: with evidence → submitted, assigner told");
  }

  // ── review ──
  {
    const d = deps({ canReview: () => true, readTasks: async () => [taskRow({ status: "submitted", progressPct: 100 })] });
    const res = await srv.staffTasksPatch(jsonReq({ op: "review", base: taskRow().rev, decision: "accept", note: "good" }), d, "st_1");
    assert.equal(res.status, 200, (await res.clone().text()).slice(0, 200));
    const t = (d.ops.tasks[0] as { row: Row }).row;
    assert.equal(t.status, "done");
    assert.equal(t.reviewed_by, "st_principal");
    assert.ok(t.reviewed_at);
    const ev = d.notices[0] as { kind: string; audience: { staff: string[] }[] };
    assert.equal(ev.kind, "staff_task.reviewed");
    assert.deepEqual(ev.audience, [{ staff: ["st_teacher"] }], "the assignee hears the verdict");
    ok("review: accept → done, assignee told");
  }
  {
    const d = deps({ canReview: () => true, readTasks: async () => [taskRow({ status: "submitted", progressPct: 100 })] });
    const res = await srv.staffTasksPatch(jsonReq({ op: "review", base: taskRow().rev, decision: "return" }), d, "st_1");
    assert.equal(res.status, 400, "a return without what-to-fix is a 400");
    ok("review: return needs a note");
  }
  {
    const d = deps({ canReview: () => true });
    const res = await srv.staffTasksPatch(jsonReq({ op: "review", base: taskRow().rev, decision: "accept" }), d, "st_1");
    assert.equal(res.status, 409, "only a submitted task can be reviewed");
    ok("review: not submitted → 409");
  }

  // ── cancel / done ──
  {
    const d = deps({ readTasks: async () => [taskRow({ status: "done" })] });
    const res = await srv.staffTasksPatch(jsonReq({ op: "cancel", base: taskRow().rev }), d, "st_1");
    assert.equal(res.status, 409, "a done task stays done");
    ok("cancel: done task is a 409");
  }
  {
    const d = deps();
    const res = await srv.staffTasksPatch(jsonReq({ op: "cancel", base: taskRow().rev }), d, "st_1");
    assert.equal(res.status, 200);
    assert.equal((d.ops.tasks[0] as { row: Row }).row.status, "cancelled");
    ok("cancel: assigner cancels");
  }

  // ── log failure after the task moved: answered, never silent ──
  {
    const d = deps({
      writeUpdates: async () => ({ ok: false, kind: "unavailable", message: "db down", conflicts: [] }) as unknown as WR,
    });
    const res = await srv.staffTasksPatch(jsonReq({ op: "progress", base: taskRow().rev, pct: 40, note: "half done" }), d, "st_1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.logFailed, true, "the caller hears the log did not land");
    assert.match(body.warning, /not logged/i);
    assert.equal(d.ops.tasks.length, 1, "the progress itself was saved");
    ok("partial failure: saved + logFailed warning");
  }
  {
    // submit with a failed evidence log: the assigner is NOT told (no
    // phantom review request), the caller gets the warning.
    const d = deps({
      readTasks: async () => [taskRow({ status: "in_progress", progressPct: 40 })],
      writeUpdates: async () => ({ ok: false, kind: "unavailable", message: "db down", conflicts: [] }) as unknown as WR,
    });
    const res = await srv.staffTasksPatch(
      jsonReq({ op: "submit", base: taskRow().rev, attachments: [{ kind: "photo", name: "g.jpg", path: "x/g.jpg" }] }),
      d,
      "st_1",
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.logFailed, true);
    assert.equal(d.notices.length, 0, "no review request without the evidence log");
    ok("partial failure: submit warns, assigner not told");
  }

  // ── submit retry (after a partial failure) ──
  {
    // The row already moved to "submitted" but the evidence log never
    // landed: the retry must NOT rewrite the task row (no duplicate
    // transition), must land the missing log, and must notify with the
    // stable dedupe key.
    const d = deps({
      readTasks: async () => [taskRow({ status: "submitted", progressPct: 100 })],
      readUpdates: async () => [], // the log never landed
    });
    const res = await srv.staffTasksPatch(
      jsonReq({ op: "submit", base: taskRow().rev, attachments: [{ kind: "photo", name: "g.jpg", path: "x/g.jpg" }] }),
      d,
      "st_1",
    );
    assert.equal(res.status, 200, (await res.clone().text()).slice(0, 200));
    assert.equal(d.ops.tasks.length, 0, "a retry never rewrites the task row");
    assert.equal(d.ops.updates.length, 1, "the missing evidence log lands");
    const ev = d.notices[0] as { key: string };
    assert.equal(ev.key, "staff_task:st_1:submitted:0", "stable cycle-scoped dedupe key, no timestamp");
    ok("submit retry: lands missing evidence, no duplicate transition");
  }
  {
    // The evidence DID land earlier (or a double-click): the retry adds no
    // second log row, still answers ok, and the notify key is the same one
    // erp_notify_deliver already stored — the reviewer is not told twice.
    const d = deps({
      readTasks: async () => [taskRow({ status: "submitted", progressPct: 100 })],
      readUpdates: async () => [{ id: "stu_st_1_submit_0", taskId: "st_1", authorStaffId: "st_teacher", pct: 100, note: "done", attachments: [{ kind: "photo" as const, name: "g.jpg", path: "x/g.jpg" }], createdAt: "2026-10-30T03:30:00.000Z" }],
    });
    const res = await srv.staffTasksPatch(jsonReq({ op: "submit", base: taskRow().rev }), d, "st_1");
    assert.equal(res.status, 200, (await res.clone().text()).slice(0, 200));
    assert.equal(d.ops.tasks.length, 0);
    assert.equal(d.ops.updates.length, 0, "no duplicate evidence row");
    const ev = d.notices[0] as { key: string } | undefined;
    assert.equal(ev?.key, "staff_task:st_1:submitted:0", "same key → stored once");
    ok("submit retry: landed evidence → no duplicate row, key dedupes");
  }
  {
    // A read failure on the log must not strand the review silently.
    const d = deps({
      readTasks: async () => [taskRow({ status: "submitted", progressPct: 100 })],
      readUpdates: async () => null,
    });
    const res = await srv.staffTasksPatch(jsonReq({ op: "submit", base: taskRow().rev }), d, "st_1");
    assert.equal(res.status, 503, "history unreadable → loud failure, not a silent skip");
    ok("submit retry: log unreadable → 503");
  }
  {
    // Two identical retries back to back (the double-click / racing pair):
    // one evidence row total, one key, one reviewer notice.
    const landed = { id: "stu_st_1_submit_0", taskId: "st_1", authorStaffId: "st_teacher", pct: 100, note: "", attachments: [{ kind: "photo" as const, name: "g.jpg", path: "x/g.jpg" }], createdAt: "2026-10-30T03:30:00.000Z" };
    const d = deps({
      readTasks: async () => [taskRow({ status: "submitted", progressPct: 100 })],
      readUpdates: async () => [landed],
    });
    const r1 = await srv.staffTasksPatch(jsonReq({ op: "submit", base: taskRow().rev }), d, "st_1");
    const r2 = await srv.staffTasksPatch(jsonReq({ op: "submit", base: taskRow().rev }), d, "st_1");
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(d.ops.updates.length, 0, "retries add no evidence rows");
    const keys = d.notices.map((n) => (n as { key: string }).key);
    assert.deepEqual(keys, ["staff_task:st_1:submitted:0", "staff_task:st_1:submitted:0"], "both retries use the one dedupe key");
    ok("submit retry: racing pair converges on one row, one key");
  }

  // ── return → resubmit: a NEW cycle ──
  {
    // After a return, resubmission must notify the reviewer AGAIN (a key
    // scoped to the task alone would be swallowed by the dedupe) and the
    // old cycle's evidence row stays untouched.
    const oldCycle = { id: "stu_st_1_submit_0", taskId: "st_1", authorStaffId: "st_teacher", pct: 100, note: "v1", attachments: [{ kind: "photo" as const, name: "old.jpg", path: "x/old.jpg" }], createdAt: "2026-10-30T03:30:00.000Z" };
    const d = deps({
      readTasks: async () => [taskRow({ status: "returned", progressPct: 90, reviewedAt: "2026-10-30T05:00:00.000Z", reviewedBy: "st_principal", reviewNote: "photo blurry" })],
      readUpdates: async () => [oldCycle],
    });
    const res = await srv.staffTasksPatch(
      jsonReq({ op: "submit", base: taskRow().rev, note: "new photo", attachments: [{ kind: "photo", name: "new.jpg", path: "x/new.jpg" }] }),
      d,
      "st_1",
    );
    assert.equal(res.status, 200, (await res.clone().text()).slice(0, 200));
    assert.equal(d.ops.tasks.length, 1, "a resubmission DOES move the state");
    const log = d.ops.updates[0] as { id: string };
    assert.equal(log.id, "stu_st_1_submit_20261030050000000", "new cycle → new log row, old evidence preserved");
    const ev = d.notices[0] as { key: string };
    assert.equal(ev.key, "staff_task:st_1:submitted:20261030050000000", "new cycle → the reviewer is told again");
    ok("resubmit after return: new cycle notifies again, history kept");
  }
  {
    // Cycle-1 evidence must NOT satisfy a cycle-2 submission.
    const oldCycle = { id: "stu_st_1_submit_0", taskId: "st_1", authorStaffId: "st_teacher", pct: 100, note: "v1", attachments: [{ kind: "photo" as const, name: "old.jpg", path: "x/old.jpg" }], createdAt: "2026-10-30T03:30:00.000Z" };
    const d = deps({
      readTasks: async () => [taskRow({ status: "returned", progressPct: 90, reviewedAt: "2026-10-30T05:00:00.000Z", reviewedBy: "st_principal" })],
      readUpdates: async () => [oldCycle],
    });
    const res = await srv.staffTasksPatch(jsonReq({ op: "submit", base: taskRow().rev }), d, "st_1");
    assert.equal(res.status, 400, "stale evidence from before the return is not enough");
    assert.equal(d.ops.tasks.length, 0);
    assert.equal(d.ops.updates.length, 0);
    ok("resubmit after return: old evidence does not count");
  }

  // ── one-task read ──
  {
    const d = deps();
    const res = await srv.staffTasksGetOne(new Request("https://test.local/api/staff/tasks/st_1"), d, "st_1");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.task.id, "st_1");
    assert.ok(Array.isArray(body.updates));
    ok("detail: assignee reads task + log");
  }
  {
    const d = deps({ selfStaffId: () => "st_other" });
    const res = await srv.staffTasksGetOne(new Request("https://test.local/api/staff/tasks/st_1"), d, "st_1");
    assert.equal(res.status, 403, "an uninvolved member of staff is refused");
    ok("detail: uninvolved staff 403");
  }
  {
    const d = deps({ selfStaffId: () => "st_principal" });
    const res = await srv.staffTasksGetOne(new Request("https://test.local/api/staff/tasks/st_1"), d, "st_1");
    assert.equal(res.status, 200, "the assigner follows their task");
    ok("detail: assigner reads");
  }

  // ── conflict from the kernel ──
  {
    const d = deps({
      writeTasks: async () => ({ ok: false, kind: "conflict", message: "Someone changed this task before you", conflicts: [taskRow()] }) as unknown as WR,
    });
    const res = await srv.staffTasksPatch(jsonReq({ op: "progress", base: taskRow().rev, pct: 5 }), d, "st_1");
    assert.equal(res.status, 409, "a stale base is a 409");
    assert.equal(d.ops.updates.length, 0, "a refused task write logs nothing — no phantom progress");
    ok("conflict: 409 with the stored task, no log row");
  }

  console.log(`staffTasks selftest: ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
