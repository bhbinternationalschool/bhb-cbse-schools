/**
 * School chat in the message logs (staff timeline, household timeline).
 *
 * Both logs used to read the old header chat's blob (erp_chat_state). Since
 * PR #737 the header chat is school chat and nothing writes that blob, so
 * the logs read the school_chat_* rows instead — scoped in SQL, never the
 * whole table:
 *
 *  - staff:     the conversations whose staff_ids hold them (direct chats
 *               with staff and with families, groups made by staff), plus
 *               every message they sent anywhere (class / subject groups
 *               included);
 *  - household: the family's direct chats with staff (household_id), plus
 *               every message the family sent (its children's and its own).
 *
 * Only visible messages: a held one has not reached anybody, and a removed
 * one is shown to moderators in the moderation queue, not here.
 *
 * A failed read throws ChatLogReadError — the routes answer 503 and the
 * panel says so. It never becomes an empty log.
 *
 * Paging: the conversation list is read a page at a time
 * (lib/supabase/pageAll.ts). Messages are the newest `limit` (at most 500,
 * under PostgREST's 1,000-row cap) of each scoped query — per chunk of
 * conversation ids — merged and cut to `limit`, which is exactly the newest
 * `limit` of the union.
 */
import { fetchAllPages } from "@/lib/supabase/pageAll";
import type { HouseholdLogEntry } from "@/lib/householdMessageLog.server";

export class ChatLogReadError extends Error {}

export const CHAT_LOG_MAX = 500;
const ID_CHUNK = 150;

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
// The slice of the PostgREST builder used here (lets the selftest fake it).
type Q<T> = QueryResult<T> & {
  eq(col: string, v: string): Q<T>;
  in(col: string, v: string[]): Q<T>;
  contains(col: string, v: string[]): Q<T>;
  order(col: string, o: { ascending: boolean }): Q<T>;
  range(from: number, to: number): Q<T>;
  limit(n: number): Q<T>;
};
export type ChatLogDb = { from(table: string): { select(cols: string): Q<unknown> } };

export type ChatLogMsgRow = {
  id: string;
  conversation_id: string;
  sender_kind: "staff" | "student" | "parent";
  sender_id: string;
  household_id: string;
  sender_label: string;
  body: string;
  created_at: string;
};

const MSG_COLS = "id, conversation_id, sender_kind, sender_id, household_id, sender_label, body, created_at";

function fail(where: string, message: string): never {
  console.error(`[chat-log] ${where}: ${message}`);
  throw new ChatLogReadError("Could not read the school chat messages — please try again.");
}

async function conversationIds(
  db: ChatLogDb,
  tenantId: string,
  scope: (q: Q<{ id: string }>) => Q<{ id: string }>,
): Promise<string[]> {
  const res = await fetchAllPages<{ id: string }>((from, to) =>
    scope((db.from("school_chat_conversations").select("id") as Q<{ id: string }>).eq("tenant_id", tenantId))
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (res.error) fail("conversations", res.error);
  if (res.truncated) fail("conversations", "more conversations than one read may hold");
  return res.rows.map((r) => r.id);
}

function newest(db: ChatLogDb, tenantId: string, limit: number): Q<ChatLogMsgRow> {
  return (db.from("school_chat_messages").select(MSG_COLS) as Q<ChatLogMsgRow>)
    .eq("tenant_id", tenantId)
    .eq("status", "visible")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
}

async function messages(
  db: ChatLogDb,
  tenantId: string,
  limit: number,
  convIds: string[],
  extra: (q: Q<ChatLogMsgRow>) => Q<ChatLogMsgRow>,
): Promise<ChatLogMsgRow[]> {
  const n = Math.max(1, Math.min(CHAT_LOG_MAX, Math.floor(limit)));
  const reads: Promise<{ data: ChatLogMsgRow[] | null; error: { message: string } | null }>[] = [];
  for (let i = 0; i < convIds.length; i += ID_CHUNK) {
    const chunk = convIds.slice(i, i + ID_CHUNK);
    reads.push(Promise.resolve(newest(db, tenantId, n).in("conversation_id", chunk)));
  }
  reads.push(Promise.resolve(extra(newest(db, tenantId, n))));
  const byId = new Map<string, ChatLogMsgRow>();
  for (const { data, error } of await Promise.all(reads)) {
    if (error) fail("messages", error.message);
    for (const m of data ?? []) byId.set(m.id, m);
  }
  return [...byId.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, n);
}

function entry(m: ChatLogMsgRow, out: boolean, by: string): HouseholdLogEntry {
  return {
    id: m.id,
    channel: "app_chat",
    direction: out ? "out" : "in",
    purpose: "app_chat",
    via: "app",
    templateName: "",
    preview: m.body.slice(0, 400),
    status: "sent",
    error: null,
    by,
    at: m.created_at,
  };
}

/** One staff member's school chat: their conversations and everything they sent. */
export async function schoolChatEntriesForStaff(
  db: ChatLogDb,
  tenantId: string,
  staffId: string,
  limit: number,
): Promise<HouseholdLogEntry[]> {
  const ids = await conversationIds(db, tenantId, (q) => q.contains("staff_ids", [staffId]));
  const rows = await messages(db, tenantId, limit, ids, (q) => q.eq("sender_kind", "staff").eq("sender_id", staffId));
  return rows.map((m) => {
    const mine = m.sender_kind === "staff" && m.sender_id === staffId;
    return entry(m, mine, mine ? "You" : m.sender_label || (m.sender_kind === "staff" ? "Staff" : "Parent"));
  });
}

/** One family's school chat: its direct chats with staff and everything it sent. */
export async function schoolChatEntriesForHousehold(
  db: ChatLogDb,
  tenantId: string,
  householdId: string,
  limit: number,
): Promise<HouseholdLogEntry[]> {
  const ids = await conversationIds(db, tenantId, (q) => q.eq("kind", "dm_parent").eq("household_id", householdId));
  const rows = await messages(db, tenantId, limit, ids, (q) => q.eq("household_id", householdId));
  return rows.map((m) => {
    const staff = m.sender_kind === "staff";
    return entry(m, staff, m.sender_label || (staff ? "Staff" : "Parent"));
  });
}
