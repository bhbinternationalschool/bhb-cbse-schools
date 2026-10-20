/**
 * One person's notifications — the ERP bell and the apps' list screen.
 *
 *   GET  /api/data/views/notifications   (ERP: useErpQuery, desk "erp_notifications")
 *   GET  /api/v1/notifications           (the apps; same answer)
 *        → { ok, data: InboxView } — the caller's own rows only, newest
 *          first (a burst row moves up when it grows), the unread count,
 *          and their settings
 *   POST /api/v1/notifications
 *        { op: "read", ids }       mark these read
 *        { op: "read_all" }        mark every unread one read
 *        { op: "prefs", prefs, base }
 *                                  save settings (base = prefsRev the screen
 *                                  loaded; null when never saved)
 *
 * The recipient is the session's push key (lib/pushSubject.ts): a member of
 * staff's roster id (or a director login's email), a family's household id.
 * Nothing in a request can name another recipient: every query and every op
 * is built here from the session.
 *
 * Marking read is a kernel write (desk_write_guarded, base = the row's
 * updated_at as just read on the server): read_at is the only field it
 * sends, so a row that grew a moment ago (a burst) keeps its new count — the
 * stale base is refused, re-read once and marked again. Settings are a
 * stated change with the base the screen loaded; an older base is 409.
 *
 * Dependencies are injected (./inboxDeps.server.ts) for the self-test.
 */
import { NextResponse } from "next/server";
import type { DemoSession } from "@/lib/auth";
import { asRevision, type WriteOp, type WriteResult } from "@/lib/data/types";
import { pushSubjectForSession } from "@/lib/pushSubject";
import { DEFAULT_PREFS, isHhMm, isNotifyTopic, prefsFrom, prefsRowId, type NotifyPrefs, type Recipient } from "./kinds";
import { inboxItemFromRow, type InboxView } from "./inboxShared";

type Row = Record<string, unknown>;

export type InboxDeps = {
  /** Any signed-in staff member or family (resolveApiAuth); null session = refused. */
  auth: (req: Request) => Promise<{ ok: true; session: DemoSession } | { ok: false; status: number; error: string }>;
  /** The recipient's newest rows (by updated_at), at most `limit`. */
  list: (r: Recipient, limit: number) => Promise<Row[] | null>;
  unreadCount: (r: Recipient) => Promise<number | null>;
  /** id + updated_at of the recipient's UNREAD rows (all, or only `ids`), at most 500. */
  unread: (r: Recipient, ids: readonly string[] | null) => Promise<{ id: string; updated_at: string }[] | null>;
  /** The settings row, null = never saved; undefined = could not be read. */
  readPrefs: (r: Recipient) => Promise<Row | null | undefined>;
  write: (table: string, ops: WriteOp<Row>[]) => Promise<WriteResult<Row>>;
  now: () => Date;
};

const NO_STORE = { "Cache-Control": "private, no-store" };
const LIST_LIMIT = 60;
const MAX_IDS = 200;
const UNREADABLE = "Could not load notifications — please try again.";

function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: NO_STORE });
}

async function recipientOf(req: Request, deps: InboxDeps): Promise<{ ok: true; r: Recipient } | { ok: false; res: Response }> {
  const a = await deps.auth(req);
  if (!a.ok) return { ok: false, res: fail(a.status, a.error) };
  const subject = pushSubjectForSession(a.session);
  if (!subject || (subject.subjectType !== "staff" && subject.subjectType !== "parent")) {
    return { ok: false, res: fail(403, "This login has no notifications.") };
  }
  return { ok: true, r: { type: subject.subjectType, id: subject.subjectId } };
}

export async function inboxView(r: Recipient, deps: InboxDeps): Promise<InboxView | null> {
  const [rows, unread, prefsRow] = await Promise.all([deps.list(r, LIST_LIMIT), deps.unreadCount(r), deps.readPrefs(r)]);
  // Unknown is never empty (R6): any failed read is a failed answer.
  if (rows === null || unread === null || prefsRow === undefined) return null;
  return {
    recipient: r,
    items: rows.map(inboxItemFromRow).filter((x): x is NonNullable<typeof x> => !!x),
    unread,
    prefs: prefsRow ? prefsFrom(prefsRow) : { ...DEFAULT_PREFS },
    prefsRev: prefsRow && typeof prefsRow.updated_at === "string" ? prefsRow.updated_at : null,
  };
}

export async function inboxGet(req: Request, deps: InboxDeps): Promise<Response> {
  const who = await recipientOf(req, deps);
  if (!who.ok) return who.res;
  const view = await inboxView(who.r, deps);
  if (!view) return fail(503, UNREADABLE);
  return NextResponse.json({ ok: true, data: view, versions: null }, { headers: NO_STORE });
}

async function markRead(r: Recipient, ids: readonly string[] | null, deps: InboxDeps): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rows = await deps.unread(r, ids);
    if (rows === null) return fail(503, "Could not read your notifications — nothing was changed.");
    if (rows.length === 0) return NextResponse.json({ ok: true, marked: 0 }, { headers: NO_STORE });
    const at = deps.now().toISOString();
    const ops: WriteOp<Row>[] = rows.map((x) => ({ op: "upsert", id: x.id, base: asRevision(x.updated_at), row: { read_at: at } }));
    const w = await deps.write("erp_notifications", ops);
    if (w.ok) return NextResponse.json({ ok: true, marked: ops.length }, { headers: NO_STORE });
    // A row grew (a burst) between the read and the write: read again once.
    if (w.kind !== "conflict") return fail(w.kind === "auth" ? 403 : 503, `Not saved — ${w.message}`);
  }
  return fail(409, "Your notifications changed while saving — please try again.");
}

/** A posted settings object, checked field by field (unknown fields refused). */
export function prefsPatch(raw: unknown): { ok: true; prefs: NotifyPrefs } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Settings must be an object" };
  const o = raw as Record<string, unknown>;
  const allowed = new Set(["mutedTopics", "voice", "quietEnabled", "quietStart", "quietEnd"]);
  for (const k of Object.keys(o)) if (!allowed.has(k)) return { ok: false, error: `Unknown setting ${k}` };
  if (!Array.isArray(o.mutedTopics) || !o.mutedTopics.every(isNotifyTopic)) return { ok: false, error: "Unknown topic in mutedTopics" };
  if (typeof o.voice !== "boolean" || typeof o.quietEnabled !== "boolean") return { ok: false, error: "voice and quietEnabled are yes/no" };
  if (!isHhMm(o.quietStart) || !isHhMm(o.quietEnd)) return { ok: false, error: "Quiet hours are HH:MM" };
  return { ok: true, prefs: prefsFrom(o) };
}

async function savePrefs(r: Recipient, body: Row, deps: InboxDeps): Promise<Response> {
  const p = prefsPatch(body.prefs);
  if (!p.ok) return fail(400, p.error);
  const base = typeof body.base === "string" && body.base ? asRevision(body.base) : null;
  const w = await deps.write("erp_notification_prefs", [
    {
      op: "upsert",
      id: prefsRowId(r),
      base,
      row: {
        recipient_type: r.type,
        recipient_id: r.id,
        muted_topics: p.prefs.mutedTopics,
        voice: p.prefs.voice,
        quiet_enabled: p.prefs.quietEnabled,
        quiet_start: p.prefs.quietStart,
        quiet_end: p.prefs.quietEnd,
      },
    },
  ]);
  if (!w.ok) {
    if (w.kind === "conflict") {
      const c = w.conflicts.find((x) => x.status === "conflict");
      const stored = c && c.status === "conflict" ? c.stored : null;
      return fail(409, "Your settings were changed on another device — the screen now shows them. Nothing was saved.", {
        prefs: stored ? prefsFrom(stored) : null,
        prefsRev: stored && typeof stored.updated_at === "string" ? stored.updated_at : null,
      });
    }
    return fail(w.kind === "invalid" ? 400 : w.kind === "auth" ? 403 : 503, `Not saved — ${w.message}`);
  }
  const rev = String(w.results[0]?.revision ?? "");
  return NextResponse.json({ ok: true, prefs: p.prefs, prefsRev: rev || null }, { headers: NO_STORE });
}

export async function inboxPost(req: Request, deps: InboxDeps): Promise<Response> {
  const who = await recipientOf(req, deps);
  if (!who.ok) return who.res;
  let body: Row;
  try {
    body = (await req.json()) as Row;
  } catch {
    return fail(400, "Invalid JSON");
  }
  if (!body || typeof body !== "object") return fail(400, "Invalid body");
  if (body.op === "read") {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && !!x) : [];
    if (ids.length === 0) return fail(400, "Which notifications?");
    if (ids.length > MAX_IDS) return fail(400, `At most ${MAX_IDS} at a time`);
    return markRead(who.r, ids, deps);
  }
  if (body.op === "read_all") return markRead(who.r, null, deps);
  if (body.op === "prefs") return savePrefs(who.r, body, deps);
  return fail(400, "Unknown op — read, read_all or prefs");
}
