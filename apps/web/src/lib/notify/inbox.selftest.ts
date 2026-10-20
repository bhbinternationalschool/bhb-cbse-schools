/**
 * The notifications inbox — a person reads and marks only their OWN rows,
 * marking read sends read_at alone with the stored base, a burst that grew
 * mid-save is re-read, and settings are a stated change with a base.
 *
 *   npx tsx src/lib/notify/inbox.selftest.ts   (npm run test:notify)
 */
import assert from "node:assert/strict";
import type { DemoSession } from "@/lib/auth";
import type { WriteOp, WriteResult } from "@/lib/data/types";
import { asRevision } from "@/lib/data/types";
import type { Recipient } from "./kinds";
import { inboxGet, inboxPost, prefsPatch, type InboxDeps } from "./inbox";
import { parseInboxView } from "./inboxShared";

console.log("inbox.selftest.ts");

type Row = Record<string, unknown>;

const staffSession: DemoSession = {
  persona: "staff",
  fullName: "Asha",
  roleCode: "teacher",
  staffId: "s_ta",
  tenantSlug: "t",
  academicYearCode: "2026-27",
};
const parentSession: DemoSession = { persona: "parent", fullName: "Guardian", roleCode: "parent", householdId: "hh_1", tenantSlug: "t", academicYearCode: "2026-27" };

function deps(session: DemoSession | null, over: Partial<InboxDeps> = {}) {
  const asked: Recipient[] = [];
  const writes: { table: string; ops: WriteOp<Row>[] }[] = [];
  const d: InboxDeps = {
    auth: async () => (session ? { ok: true, session } : { ok: false, status: 401, error: "Unauthorized" }),
    list: async (r) => {
      asked.push(r);
      return [
        { id: "nf_1", kind: "staff_leave.decided", topic: "leave", title: "Leave approved", body: "CL", link: "/leave", web_link: "/staff?tab=leave", payload: {}, urgent: false, group_count: 1, actor: "", read_at: null, created_at: "2026-10-20T05:00:00Z", updated_at: "2026-10-20T05:00:00.000001Z" },
      ];
    },
    unreadCount: async (r) => {
      asked.push(r);
      return 1;
    },
    unread: async (r, ids) => {
      asked.push(r);
      return (ids ?? ["nf_1", "nf_2"]).map((id) => ({ id, updated_at: "2026-10-20T05:00:00.000001Z" }));
    },
    readPrefs: async () => null,
    write: async (table, ops) => {
      writes.push({ table, ops });
      return { ok: true, results: ops.map((o) => ({ id: o.id, status: "applied" as const, revision: asRevision("2026-10-20T06:00:00Z") })), versions: {} };
    },
    now: () => new Date("2026-10-20T06:00:00Z"),
    ...over,
  };
  return { d, asked, writes };
}

const get = () => new Request("http://x/api/data/views/notifications");
const post = (body: unknown) => new Request("http://x/api/v1/notifications", { method: "POST", body: JSON.stringify(body) });

void (async () => {
  // GET — the session's own key, and nothing a request says can change it.
  {
    const f = deps(staffSession);
    const res = await inboxGet(new Request("http://x/api/data/views/notifications?recipient=staff:s_prin"), f.d);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: unknown };
    const view = parseInboxView(body.data);
    assert.deepEqual(view.recipient, { type: "staff", id: "s_ta" });
    assert.ok(f.asked.every((r) => r.type === "staff" && r.id === "s_ta"), "every read is for the caller");
    assert.equal(view.items.length, 1);
    assert.equal(view.items[0]!.webLink, "/staff?tab=leave");
    assert.equal(view.unread, 1);
    assert.equal(view.prefs.quietStart, "21:00", "never saved = the defaults");
    assert.equal(view.prefsRev, null);
  }
  {
    const f = deps(parentSession);
    const res = await inboxGet(get(), f.d);
    const view = parseInboxView(((await res.json()) as { data: unknown }).data);
    assert.deepEqual(view.recipient, { type: "parent", id: "hh_1" }, "a family reads its household's rows");
  }
  assert.equal((await inboxGet(get(), deps(null).d)).status, 401);
  assert.equal(
    (await inboxGet(get(), deps({ ...parentSession, householdId: undefined }).d)).status,
    403,
    "a login with no push key has no notifications",
  );
  // Unknown is never empty.
  assert.equal((await inboxGet(get(), deps(staffSession, { list: async () => null }).d)).status, 503);
  assert.equal((await inboxGet(get(), deps(staffSession, { readPrefs: async () => undefined }).d)).status, 503);

  // POST read — read_at only, the base the server just read, own rows only.
  {
    const f = deps(staffSession);
    const res = await inboxPost(post({ op: "read", ids: ["nf_1"], recipient: { type: "staff", id: "s_prin" } }), f.d);
    assert.equal(res.status, 200);
    assert.ok(f.asked.every((r) => r.id === "s_ta"));
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0]!.table, "erp_notifications");
    const op = f.writes[0]!.ops[0]!;
    assert.equal(op.op, "upsert");
    assert.equal(op.base, "2026-10-20T05:00:00.000001Z");
    assert.deepEqual(op.op === "upsert" ? op.row : null, { read_at: "2026-10-20T06:00:00.000Z" }, "only read_at is sent");
  }
  {
    const f = deps(staffSession);
    await inboxPost(post({ op: "read_all" }), f.d);
    assert.equal(f.writes[0]!.ops.length, 2, "read_all marks every unread row");
  }
  {
    // A burst grew between the read and the write: re-read once.
    let n = 0;
    const f = deps(staffSession, {
      write: async (_t, ops): Promise<WriteResult<Row>> => {
        n += 1;
        if (n === 1) return { ok: false, kind: "conflict", message: "stale", conflicts: [{ id: ops[0]!.id, status: "conflict", revision: asRevision("x"), stored: {}, reason: "stale" }] };
        return { ok: true, results: [], versions: {} };
      },
    });
    const res = await inboxPost(post({ op: "read", ids: ["nf_1"] }), f.d);
    assert.equal(res.status, 200);
    assert.equal(n, 2);
  }
  assert.equal((await inboxPost(post({ op: "read", ids: [] }), deps(staffSession).d)).status, 400);
  assert.equal((await inboxPost(post({ op: "delete" }), deps(staffSession).d)).status, 400);

  // Settings.
  const good = { mutedTopics: ["fees"], voice: false, quietEnabled: true, quietStart: "22:00", quietEnd: "06:30" };
  assert.ok(prefsPatch(good).ok);
  assert.ok(!prefsPatch({ ...good, mutedTopics: ["everything"] }).ok, "unknown topic refused");
  assert.ok(!prefsPatch({ ...good, quietStart: "9pm" }).ok, "bad time refused");
  assert.ok(!prefsPatch({ ...good, recipientId: "x" }).ok, "unknown field refused");
  {
    const f = deps(staffSession);
    const res = await inboxPost(post({ op: "prefs", prefs: good, base: null }), f.d);
    assert.equal(res.status, 200);
    const w = f.writes[0]!;
    assert.equal(w.table, "erp_notification_prefs");
    const op = w.ops[0]!;
    assert.equal(op.id, "nfp_staff_s_ta", "the caller's own settings row");
    assert.equal(op.base, null);
    assert.deepEqual(op.op === "upsert" ? op.row.muted_topics : null, ["fees"]);
  }
  {
    const f = deps(staffSession, {
      write: async () => ({
        ok: false,
        kind: "conflict",
        message: "stale",
        conflicts: [{ id: "nfp_staff_s_ta", status: "conflict", revision: asRevision("r2"), stored: { muted_topics: ["leave"], voice: true, updated_at: "r2" }, reason: "stale" }],
      }),
    });
    const res = await inboxPost(post({ op: "prefs", prefs: good, base: "r1" }), f.d);
    assert.equal(res.status, 409);
    const body = (await res.json()) as { prefs: { mutedTopics: string[] }; prefsRev: string };
    assert.deepEqual(body.prefs.mutedTopics, ["leave"], "the 409 carries the stored settings");
    assert.equal(body.prefsRev, "r2");
  }

  console.log("inbox.selftest: all assertions passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
