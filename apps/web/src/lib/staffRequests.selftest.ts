/**
 * Run: npx tsx src/lib/staffRequests.selftest.ts
 *
 * Staff → Requests on the server (15 Oct 2026; lib/staffRequests.server.ts):
 *  - the view: a manager (canManageStaffLeave with the SERVER's roles) gets
 *    every request, anyone else only their own, newest first; a guard's 401
 *    passes through, the mirror secret is 403, a failed read is 503 with no
 *    data (never an empty list); `versions` = what the copy was built from,
 *    null for a stale copy;
 *  - raise: any member of staff, for themselves — the server picks the id,
 *    the staff id (from the session, never the body), the dates and "open";
 *    a login with no staff record 403; no subject / unknown type 400; ONE
 *    write op with a null base (a new element); a refused write is an error
 *    status, never ok; the cache is dropped only after a write;
 *  - update: managers only; the base the screen loaded goes to the RPC as
 *    the base; a stale base is a 409 carrying the stored request; an
 *    assignee off the roster 400; resolvedAt as the old screen kept it;
 *  - the slice reader: missing = none, not-a-list = a failed build;
 *    `_rev` → `rev`;
 *  - the desk's row count includes the kernel-only slice (so a whole-desk push
 *    after a request is not judged a shrink).
 */
import assert from "node:assert/strict";
import { installServerOnlyStub } from "./fakePostgrest.testkit";

installServerOnlyStub();

async function main() {
  const { NextResponse } = await import("next/server");
  const { defaultMasters } = await import("./masters");
  const { defaultRbacState } = await import("./rbac");
  const { asRevision } = await import("./data/types");
  const srv = await import("./staffRequests.server");
  const { parseStaffRequestsView } = await import("./staffRequestsShared");
  const { countDeskSliceStateRows } = await import("./deskSliceNormalized.server");
  type Deps = import("./staffRequests.server").StaffRequestsDeps;
  type Row = import("./staffRequestsShared").StaffRequestRow;
  type Op = import("./data/types").WriteOp<Record<string, unknown>>;
  type WR = import("./data/types").WriteResult<Record<string, unknown>>;

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
  const session = (staffId: string | undefined, roleCode: string, fullName: string) => ({
    persona: "staff" as const,
    fullName,
    roleCode,
    staffId,
    tenantSlug: "t",
    academicYearCode: "2026-27",
  });
  const ctxFor = (s: ReturnType<typeof session>) => ({ session: s, masters, rbac, rbacKnown: true, authKind: "session" as const });
  const SESSIONS = {
    teacher: session("st_teacher", "teacher", "Asha Teacher"),
    principal: session("st_principal", "principal", "Chandra Principal"),
    nostaff: session(undefined, "teacher", "Nobody Linked"),
  };
  type WhoKey = keyof typeof SESSIONS | "anon";

  const ticket = (id: string, staffId: string, createdAt: string, extra: Partial<Row> = {}): Row => ({
    id,
    staffId,
    raisedByName: staffId,
    type: "supplies",
    subject: `subject ${id}`,
    description: "",
    date: createdAt.slice(0, 10),
    assignedToStaffId: "",
    status: "open",
    resolutionNote: "",
    resolvedAt: null,
    createdAt,
    updatedAt: createdAt,
    rev: 1,
    ...extra,
  });
  const STORED: Row[] = [
    ticket("req_a", "st_teacher", "2026-10-15T08:00:00.000Z"),
    ticket("req_b", "st_other", "2026-10-15T09:00:00.000Z"),
    ticket("req_c", "st_teacher", "2026-10-15T10:00:00.000Z", { rev: 3 }),
  ];
  const BUILT = { staff_hr: { updated_at: "2026-10-15T10:00:00.000+00:00", count: 165 } };

  type World = {
    who: WhoKey;
    mirror?: boolean;
    read?: "ok" | "stale" | "fail";
    writeResult?: (op: Op) => WR;
    writes: Op[];
    invalidations: number;
  };
  const world = (who: WhoKey, extra: Partial<World> = {}): World => ({ who, writes: [], invalidations: 0, ...extra });
  const depsFor = (w: World): Deps => ({
    requireStaff: async () =>
      w.who === "anon"
        ? { ok: false, response: NextResponse.json({ error: "Sign in" }, { status: 401 }) }
        : { ok: true, viaMirrorSecret: false, ctx: ctxFor(SESSIONS[w.who]) as never },
    mirrorSecret: () => !!w.mirror,
    readRequests: async () =>
      w.read === "fail"
        ? { ok: false, error: "boom" }
        : { ok: true, value: STORED.map((r) => ({ ...r })), stale: w.read === "stale", from: w.read === "stale" ? "previous" : "cache", builtFrom: w.read === "stale" ? null : BUILT },
    write: async (op) => {
      w.writes.push(op);
      return (
        w.writeResult?.(op) ?? {
          ok: true,
          results: [{ id: op.id, status: "applied", revision: asRevision(op.base == null ? "1" : String(Number(op.base) + 1)) }],
          versions: {},
          revision: asRevision("2026-10-15T11:00:00.000Z"),
        }
      );
    },
    invalidate: () => {
      w.invalidations++;
    },
    now: () => new Date("2026-10-15T11:00:00.000Z"),
    newId: () => "req_new",
  });
  const get = async (w: World) => {
    const res = await srv.staffRequestsViewGet(new Request("http://x/api/data/views/staff-requests"), depsFor(w));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const post = async (w: World, body: unknown) => {
    const res = await srv.staffRequestsPost(
      new Request("http://x/api/staff/requests", { method: "POST", body: JSON.stringify(body) }),
      depsFor(w),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  // ── the view ──
  {
    const t = await get(world("teacher"));
    assert.equal(t.status, 200);
    const v = parseStaffRequestsView(t.body.data);
    assert.deepEqual(v.requests.map((r) => r.id), ["req_c", "req_a"], "a teacher sees only their own, newest first");
    assert.equal(v.canManage, false);
    assert.equal(v.selfStaffId, "st_teacher");
    assert.equal(v.requests[0]!.rev, 3, "each request carries its revision");
    assert.deepEqual(t.body.versions, BUILT, "versions = what the copy was built from");
    ok("view: a member of staff sees only their own requests, with revisions and built-from versions");

    const p = await get(world("principal"));
    const pv = parseStaffRequestsView(p.body.data);
    assert.deepEqual(pv.requests.map((r) => r.id), ["req_c", "req_b", "req_a"], "a manager sees every request");
    assert.equal(pv.canManage, true);
    ok("view: a manager (canManageStaffLeave on the server's roles) sees every request");

    const n = await get(world("nostaff"));
    assert.deepEqual(parseStaffRequestsView(n.body.data).requests, [], "a login without a staff record sees none");
    ok("view: a login with no staff record sees nothing");

    assert.equal((await get(world("anon"))).status, 401);
    assert.equal((await get(world("teacher", { mirror: true }))).status, 403);
    const f = await get(world("principal", { read: "fail" }));
    assert.equal(f.status, 503);
    assert.equal(f.body.ok, false);
    assert.equal(f.body.data, undefined, "a failed read sends no data — never an empty list");
    const s = await get(world("principal", { read: "stale" }));
    assert.equal(s.status, 200);
    assert.equal(s.body.versions, null, "a stale copy sends no versions");
    assert.equal(s.body.stale, true);
    ok("view: 401 / mirror 403 / failed read 503 with no data / stale copy without versions");
    assert.throws(() => parseStaffRequestsView({ requests: "nope", canManage: true }));
    assert.throws(() => parseStaffRequestsView(null));
    ok("client parse: a malformed answer is a failed read, not an empty list");
  }

  // ── raise ──
  {
    const w = world("teacher");
    const r = await post(w, { op: "raise", type: "maintenance", subject: "  Fan broken in 5A ", description: " x ", staffId: "st_other" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(w.writes.length, 1, "one element write");
    const op = w.writes[0]!;
    assert.equal(op.op, "upsert");
    assert.equal(op.id, "req_new");
    assert.equal(op.base, null, "a new element is written with a null base");
    const row = (op as { row?: unknown }).row as Record<string, unknown>;
    assert.equal(row.staffId, "st_teacher", "the staff id comes from the session, never the body");
    assert.equal(row.raisedByName, "Asha Teacher");
    assert.equal(row.subject, "Fan broken in 5A");
    assert.equal(row.status, "open");
    assert.equal(row.type, "maintenance");
    assert.equal(row.createdAt, "2026-10-15T11:00:00.000Z");
    assert.equal(w.invalidations, 1, "the cached copy is dropped after the write");
    assert.equal((r.body.request as Row).rev, 1);
    ok("raise: the server builds the request for the caller and writes one new element");

    const none = world("nostaff");
    assert.equal((await post(none, { op: "raise", type: "supplies", subject: "x", description: "" })).status, 403);
    assert.equal(none.writes.length, 0);
    const blank = world("teacher");
    assert.equal((await post(blank, { op: "raise", type: "supplies", subject: "  ", description: "" })).status, 400);
    assert.equal((await post(blank, { op: "raise", type: "bribe", subject: "x", description: "" })).status, 400);
    assert.equal(blank.writes.length, 0);
    assert.equal((await post(world("teacher", { mirror: true }), { op: "raise", type: "supplies", subject: "x", description: "" })).status, 403);
    ok("raise: no staff record 403, no subject / unknown type 400, mirror secret 403 — nothing written");

    const down = world("teacher", { writeResult: () => ({ ok: false, kind: "unavailable", message: "kernel not installed", conflicts: [] }) });
    const d = await post(down, { op: "raise", type: "supplies", subject: "x", description: "" });
    assert.equal(d.status, 503);
    assert.equal(d.body.ok, false);
    assert.match(String(d.body.error), /Not saved/);
    assert.equal(down.invalidations, 0);
    ok("raise: a refused write is 503 'Not saved', never ok");
  }

  // ── update ──
  {
    const t = world("teacher");
    assert.equal((await post(t, { op: "update", id: "req_a", base: 1, patch: { status: "resolved" } })).status, 403);
    assert.equal(t.writes.length, 0);
    ok("update: someone who does not manage requests is refused (403)");

    const p = world("principal");
    const u = await post(p, { op: "update", id: "req_c", base: 3, patch: { status: "resolved", resolutionNote: " done " } });
    assert.equal(u.status, 200);
    const op = p.writes[0]!;
    assert.equal(String(op.base), "3", "the base the screen loaded is the RPC's base");
    const row = (op as { row?: unknown }).row as Record<string, unknown>;
    assert.equal(row.status, "resolved");
    assert.equal(row.resolutionNote, "done");
    assert.equal(row.resolvedAt, "2026-10-15T11:00:00.000Z");
    assert.equal(row.staffId, undefined, "a triage patches only what it changes");
    assert.equal((u.body.request as Row).rev, 4);
    ok("update: a manager's change goes as a patch with the loaded revision as its base");

    const p2 = world("principal");
    assert.equal((await post(p2, { op: "update", id: "req_c", patch: { status: "closed" } })).status, 400, "no base = refused");
    assert.equal((await post(p2, { op: "update", id: "req_zzz", base: 1, patch: { status: "closed" } })).status, 404);
    assert.equal((await post(p2, { op: "update", id: "req_c", base: 3, patch: { assignedToStaffId: "st_ghost" } })).status, 400);
    assert.equal((await post(p2, { op: "update", id: "req_c", base: 3, patch: {} })).status, 400);
    assert.equal(p2.writes.length, 0);
    ok("update: no base 400, unknown request 404, assignee off the roster 400, empty patch 400 — nothing written");

    const stale = world("principal", {
      writeResult: (op) => ({
        ok: false,
        kind: "conflict",
        message: "Changed on another device since you loaded it",
        conflicts: [{ id: op.id, status: "conflict", reason: "stale", revision: asRevision("5"), stored: { ...STORED[2], status: "closed", _rev: 5 } as never }],
      }),
    });
    const c = await post(stale, { op: "update", id: "req_c", base: 3, patch: { status: "in_progress" } });
    assert.equal(c.status, 409);
    assert.equal(c.body.ok, false);
    assert.equal((c.body.stored as Row).status, "closed");
    assert.equal((c.body.stored as Row).rev, 5);
    assert.equal(stale.invalidations, 1, "a conflict drops the copy so the next read is the server's");
    ok("update: a stale base is a 409 with the stored request; nothing saved");

    const unchangedTs = srv.triagePatch(STORED[0]!, { status: "in_progress" }, new Date("2026-10-15T12:00:00.000Z"));
    assert.ok(unchangedTs.ok && unchangedTs.row.resolvedAt === null);
    const reopened = srv.triagePatch({ ...STORED[0]!, status: "resolved", resolvedAt: "2026-10-01T00:00:00.000Z" }, { status: "open" }, new Date());
    assert.ok(reopened.ok && reopened.row.resolvedAt === null, "reopening clears resolvedAt");
    const keep = srv.triagePatch({ ...STORED[0]!, status: "resolved", resolvedAt: "2026-10-01T00:00:00.000Z" }, { status: "closed" }, new Date());
    assert.ok(keep.ok && keep.row.resolvedAt === "2026-10-01T00:00:00.000Z", "resolved → closed keeps the first resolvedAt");
    ok("triagePatch: resolvedAt as the old screen kept it");
  }

  // ── the slice reader ──
  {
    assert.deepEqual(srv.staffRequestsOfSlice(null), []);
    assert.throws(() => srv.staffRequestsOfSlice({ not: "a list" }));
    const rows = srv.staffRequestsOfSlice([
      { id: "req_1", staffId: "s", subject: "x", status: "open", _rev: 2, createdAt: "2026-10-15T00:00:00Z" },
      { staffId: "s", subject: "no id" },
      "junk",
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.rev, 2);
    ok("slice reader: missing = none, not a list = failed build, `_rev` → rev, junk dropped");
  }

  // ── the desk's row count ──
  {
    const base = { leaveTypes: [{ code: "CL" }], leaveRequests: [{ id: "l1" }] };
    const without = countDeskSliceStateRows("staff_hr", base);
    const withReq = countDeskSliceStateRows("staff_hr", { ...base, staffRequests: [{ id: "r1" }, { id: "r2" }, { id: "r3" }] });
    assert.equal(withReq - without, 3, "kernel-only slices count toward row_count, as the RPC's meta bump counts them");
    ok("row_count: the stored requests are counted, so a whole-desk push is not judged a shrink");
  }

  console.log(`staffRequests.selftest: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
