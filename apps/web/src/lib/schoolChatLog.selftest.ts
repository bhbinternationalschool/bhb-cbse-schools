/**
 * School chat in the staff / household message logs (lib/schoolChatLog.server.ts).
 * npm run test:school-chat-log
 *
 * Against a fake PostgREST that keeps its 1,000-row cap (and reports the cut
 * as success, as the real one does): scope, visibility, newest-first, paging
 * of the conversation list, and that a failed read throws — never [].
 */
import assert from "node:assert/strict";
import {
  ChatLogReadError,
  schoolChatEntriesForHousehold,
  schoolChatEntriesForStaff,
  type ChatLogDb,
} from "./schoolChatLog.server";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

function fakeDb(tables: Record<string, Row[]>, opts: { failOn?: string } = {}) {
  const calls: { table: string; range?: [number, number] }[] = [];
  const db: ChatLogDb = {
    from(table) {
      return {
        select() {
          const filters: Filter[] = [];
          const orders: [string, boolean][] = [];
          let range: [number, number] | null = null;
          let lim = Infinity;
          const q = {
            eq(c: string, v: string) { filters.push((r) => r[c] === v); return q; },
            in(c: string, v: string[]) { const s = new Set(v); filters.push((r) => s.has(String(r[c]))); return q; },
            contains(c: string, v: string[]) { filters.push((r) => v.every((x) => (r[c] as string[]).includes(x))); return q; },
            order(c: string, o: { ascending: boolean }) { orders.push([c, o.ascending]); return q; },
            range(f: number, t: number) { range = [f, t]; return q; },
            limit(n: number) { lim = n; return q; },
            then(res: (v: { data: Row[] | null; error: { message: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
              calls.push({ table, range: range ?? undefined });
              if (opts.failOn === table) return Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout" } }).then(res, rej);
              let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
              rows = rows.sort((a, b) => {
                for (const [c, asc] of orders) {
                  const d = String(a[c]).localeCompare(String(b[c]));
                  if (d) return asc ? d : -d;
                }
                return 0;
              });
              if (range) rows = rows.slice(range[0], range[1] + 1);
              rows = rows.slice(0, Math.min(lim, 1000)); // PostgREST's cap, reported as success
              return Promise.resolve({ data: rows, error: null }).then(res, rej);
            },
          };
          return q as unknown as ReturnType<ReturnType<ChatLogDb["from"]>["select"]>;
        },
      };
    },
  };
  return { db, calls };
}

const T = "tenant-1";
const conv = (id: string, kind: string, staff_ids: string[], household_id = "", tenant_id = T) => ({ id, kind, staff_ids, household_id, tenant_id });
let seq = 0;
const msg = (conversation_id: string, sender_kind: string, sender_id: string, at: string, extra: Partial<Row> = {}) => ({
  id: `m${String(++seq).padStart(5, "0")}`,
  tenant_id: T,
  conversation_id,
  sender_kind,
  sender_id,
  household_id: "",
  sender_label: `${sender_id} label`,
  body: `body ${seq}`,
  status: "visible",
  created_at: at,
  ...extra,
});

async function main() {
  // ── Staff scope ──────────────────────────────────────────────────────
  {
    const tables = {
      school_chat_conversations: [
        conv("dms:s1:s2", "dm_staff", ["s1", "s2"]),
        conv("dmp:s1:hh1:st1", "dm_parent", ["s1"], "hh1"),
        conv("grp:abc", "group", ["s1", "s2", "s3"]),
        conv("cls:V:A", "class", []),
        conv("dms:s2:s3", "dm_staff", ["s2", "s3"]),
        conv("dms:s1:s9", "dm_staff", ["s1", "s9"], "", "tenant-2"),
      ],
      school_chat_messages: [
        msg("dms:s1:s2", "staff", "s2", "2026-10-29T08:00:00Z"), // in
        msg("dmp:s1:hh1:st1", "parent", "hh1", "2026-10-29T08:01:00Z", { household_id: "hh1", sender_label: "Parent of Aarav" }), // in
        msg("grp:abc", "staff", "s3", "2026-10-29T08:02:00Z"), // in
        msg("cls:V:A", "staff", "s1", "2026-10-29T08:03:00Z"), // own, in a class group: out
        msg("cls:V:A", "student", "st9", "2026-10-29T08:04:00Z"), // someone else's class chatter: not theirs
        msg("dms:s2:s3", "staff", "s2", "2026-10-29T08:05:00Z"), // not their chat
        msg("dms:s1:s2", "staff", "s2", "2026-10-29T08:06:00Z", { status: "held" }), // held: reached nobody
        msg("dms:s1:s2", "staff", "s2", "2026-10-29T08:07:00Z", { status: "removed" }),
        { ...msg("dms:s1:s9", "staff", "s9", "2026-10-29T08:08:00Z"), tenant_id: "tenant-2" },
      ],
    };
    const { db } = fakeDb(tables);
    const out = await schoolChatEntriesForStaff(db, T, "s1", 100);
    assert.deepEqual(
      out.map((e) => [e.at, e.direction, e.by]),
      [
        ["2026-10-29T08:03:00Z", "out", "You"],
        ["2026-10-29T08:02:00Z", "in", "s3 label"],
        ["2026-10-29T08:01:00Z", "in", "Parent of Aarav"],
        ["2026-10-29T08:00:00Z", "in", "s2 label"],
      ],
      "staff log: their chats + what they sent, visible only, newest first, this tenant only",
    );
    assert.ok(out.every((e) => e.channel === "app_chat" && e.status === "sent"));
    // limit: the newest N of the union
    assert.deepEqual((await schoolChatEntriesForStaff(db, T, "s1", 2)).map((e) => e.at), ["2026-10-29T08:03:00Z", "2026-10-29T08:02:00Z"]);
    assert.deepEqual(await schoolChatEntriesForStaff(db, T, "s404", 100), [], "a staff member with no chats has an empty log (a real answer)");
  }

  // ── Household scope ──────────────────────────────────────────────────
  {
    seq = 0;
    const tables = {
      school_chat_conversations: [
        conv("dmp:s1:hh1:st1", "dm_parent", ["s1"], "hh1"),
        conv("dmp:s4:hh1:st2", "dm_parent", ["s4"], "hh1"),
        conv("dmp:s1:hh2:st5", "dm_parent", ["s1"], "hh2"),
        conv("cls:V:A", "class", []),
      ],
      school_chat_messages: [
        msg("dmp:s1:hh1:st1", "staff", "s1", "2026-10-29T09:00:00Z", { sender_label: "Mrs Rao (teacher)" }), // out
        msg("dmp:s4:hh1:st2", "parent", "hh1", "2026-10-29T09:01:00Z", { household_id: "hh1" }), // in
        msg("cls:V:A", "student", "st1", "2026-10-29T09:02:00Z", { household_id: "hh1" }), // their child, class group
        msg("cls:V:A", "student", "st7", "2026-10-29T09:03:00Z", { household_id: "hh7" }), // another family
        msg("dmp:s1:hh2:st5", "staff", "s1", "2026-10-29T09:04:00Z"), // another family's chat
        msg("dmp:s1:hh1:st1", "parent", "hh1", "2026-10-29T09:05:00Z", { household_id: "hh1", status: "held" }),
      ],
    };
    const { db } = fakeDb(tables);
    const out = await schoolChatEntriesForHousehold(db, T, "hh1", 100);
    assert.deepEqual(
      out.map((e) => [e.at, e.direction]),
      [
        ["2026-10-29T09:02:00Z", "in"],
        ["2026-10-29T09:01:00Z", "in"],
        ["2026-10-29T09:00:00Z", "out"],
      ],
      "household log: its chats with staff + what it sent, visible only",
    );
    assert.equal(out[2]!.by, "Mrs Rao (teacher)");
  }

  // ── Paging: 2,500 conversations, the only message is in the 2,400th ──
  {
    seq = 0;
    const convs = Array.from({ length: 2500 }, (_, i) => conv(`dms:s1:x${String(i).padStart(4, "0")}`, "dm_staff", ["s1", `x${i}`]));
    const target = convs[2400]!.id;
    const { db, calls } = fakeDb({
      school_chat_conversations: convs,
      school_chat_messages: [msg(target, "staff", "x2400", "2026-10-29T10:00:00Z")],
    });
    const out = await schoolChatEntriesForStaff(db, T, "s1", 50);
    assert.equal(out.length, 1, "a conversation past the first 1,000 is still read");
    const pages = calls.filter((c) => c.table === "school_chat_conversations");
    assert.deepEqual(pages.map((c) => c.range), [[0, 999], [1000, 1999], [2000, 2999]], "conversation list read a page at a time");
    assert.equal(calls.filter((c) => c.table === "school_chat_messages").length, Math.ceil(2500 / 150) + 1, "messages read per chunk of ids, plus what they sent");
  }

  // ── A failed read throws; it never becomes an empty log ─────────────
  for (const failOn of ["school_chat_conversations", "school_chat_messages"]) {
    const { db } = fakeDb({ school_chat_conversations: [conv("dms:s1:s2", "dm_staff", ["s1", "s2"], "hh1")], school_chat_messages: [] }, { failOn });
    await assert.rejects(schoolChatEntriesForStaff(db, T, "s1", 100), ChatLogReadError, `staff: ${failOn} failure throws`);
    await assert.rejects(schoolChatEntriesForHousehold(db, T, "hh1", 100), ChatLogReadError, `household: ${failOn} failure throws`);
  }

  console.log("schoolChatLog selftest: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
