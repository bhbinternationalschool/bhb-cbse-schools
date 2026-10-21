"use client";

/**
 * The parent portal's header: the running strip, the notification bell and
 * the chat with the class teacher — each read from the server for the
 * signed-in parent. The staff versions of these read the office's desks
 * (school comms, notifications, internal chat), which refuse a parent; on
 * /parent they showed only built-in sample notices, an empty bell and an empty
 * chat (found 15 Oct 2026).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, MessageCircle, X } from "lucide-react";
import {
  CommsRunningStrip,
  type StripItem,
} from "@/components/shell/CommsRunningStrip";
import {
  useCommsFeed,
  type CommsFeed,
} from "@/components/parent/ParentNoticesNews";
import {
  ChildPicker,
  ParentReadState,
  parentPost,
  useActiveChild,
  useParentProfile,
  useParentRead,
  useParentRefresh,
  type ParentChild,
} from "@/components/parent/parentData";

type Tab = "notices" | "news";

export function ParentRunningStrip({
  onNavigate,
}: {
  onNavigate: (tab: Tab) => void;
}) {
  const feed = useCommsFeed();
  const items = useMemo((): StripItem[] => {
    const f = feed.data;
    if (!f) return [];
    return [
      ...f.notices.slice(0, 8).map((n) => ({
        id: n.id,
        kind: "notice" as const,
        label: n.pinned ? "Pinned" : "Notice",
        title: n.title,
        pinned: n.pinned,
        href: "/parent",
      })),
      ...f.news.slice(0, 5).map((n) => ({
        id: n.id,
        kind: "news" as const,
        label: "News",
        title: n.title,
        href: "/parent",
      })),
    ];
  }, [feed.data]);
  // A failed read shows nothing here: the strip is an extra, and the Notices
  // tab itself says when the feed could not be read.
  return (
    <CommsRunningStrip
      audience="parents"
      compact
      items={items}
      onParentNavigate={onNavigate}
    />
  );
}

// ── Bell ───────────────────────────────────────────────────────────────────

const SEEN_KEY = "bhb_parent_seen_comms";

/** What this browser has opened — a per-viewer convenience, never shared state. */
function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeSeen(ids: Set<string>): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-300)));
  } catch {
    /* private mode / storage full: unread counts just stay */
  }
}

type BellItem = {
  id: string;
  kind: Tab;
  title: string;
  body: string;
  at: string;
};

function bellItems(f: CommsFeed): BellItem[] {
  return [
    ...f.notices.map((n) => ({
      id: n.id,
      kind: "notices" as const,
      title: n.title,
      body: n.body,
      at: n.publishedAt,
    })),
    ...f.news.map((n) => ({
      id: n.id,
      kind: "news" as const,
      title: n.title,
      body: n.summary || n.body,
      at: n.publishedAt,
    })),
  ]
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    .slice(0, 12);
}

/** Notices and news addressed to parents, newest first; unread = not opened in this browser. */
export function ParentNotificationBell({
  onNavigate,
}: {
  onNavigate: (tab: Tab) => void;
}) {
  const feed = useCommsFeed();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSeen(readSeen());
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const items = feed.data ? bellItems(feed.data) : [];
  const unread = items.filter((i) => !seen.has(i.id)).length;

  function mark(ids: string[]) {
    const next = new Set(seen);
    for (const id of ids) next.add(id);
    setSeen(next);
    writeSeen(next);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
      >
        <Bell className="h-4 w-4" strokeWidth={2.25} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[0_12px_40px_rgba(32,48,80,0.18)]"
          data-testid="parent-bell"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <p className="text-xs font-bold text-[var(--brand-deep)]">
              Notifications
            </p>
            {unread > 0 ? (
              <button
                type="button"
                className="text-[10px] font-semibold text-[var(--muted)] hover:text-[var(--brand-deep)]"
                onClick={() => mark(items.map((i) => i.id))}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {feed.data === undefined && !feed.isPending ? (
            <div className="px-3 py-5 text-center" role="alert">
              <p className="text-xs font-semibold text-[var(--brand-deep)]">
                Could not load notifications
              </p>
              <button
                type="button"
                className="mt-2 text-xs underline"
                onClick={() => void feed.refetch()}
              >
                Try again
              </button>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                  {feed.isPending ? "Loading…" : "No notifications yet"}
                </li>
              ) : (
                items.map((n) => (
                  <li
                    key={n.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <button
                      type="button"
                      className={`block w-full px-3 py-2.5 text-left hover:bg-[var(--surface-sunken)] ${
                        seen.has(n.id) ? "" : "bg-[rgba(197,160,40,0.08)]"
                      }`}
                      onClick={() => {
                        mark([n.id]);
                        setOpen(false);
                        onNavigate(n.kind);
                      }}
                    >
                      <div className="flex justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--brand-deep)]">
                          {n.title}
                        </p>
                        <span className="shrink-0 text-[9px] text-[var(--muted)]">
                          {n.at
                            ? new Date(n.at).toLocaleDateString("en-IN")
                            : ""}
                        </span>
                      </div>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted)]">
                          {n.body}
                        </p>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Chat with the class teacher ───────────────────────────────────────────

type Thread = {
  studentId: string;
  studentName: string;
  teacherName: string | null;
  messages: {
    id: string;
    senderPersona: "parent" | "staff";
    senderName: string;
    body: string;
    createdAt: string;
    mine: boolean;
  }[];
};

/**
 * The parent ↔ class-teacher conversation for each child — the same thread the
 * parent app shows (GET /api/v1/chat/thread, POST /api/v1/chat/send).
 */
export function ParentChatButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Chat"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-deep)] text-white"
      >
        <MessageCircle className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-[var(--surface)] shadow-xl"
            role="dialog"
            aria-label="Chat with the class teacher"
            data-testid="parent-chat"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <p className="text-sm font-bold text-[var(--brand-deep)]">
                Chat with the class teacher
              </p>
              <button
                type="button"
                aria-label="Close chat"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ChatBody />
          </div>
        </div>
      ) : null}
    </>
  );
}

function ChatBody() {
  const profile = useParentProfile();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <ParentReadState query={profile} what="your family's record">
        {(p) => <ChatForFamily list={p.children} />}
      </ParentReadState>
    </div>
  );
}

function ChatForFamily({ list }: { list: ParentChild[] }) {
  const { child, setActiveId } = useActiveChild(list);
  return (
    <>
      <ChildPicker list={list} child={child} onPick={setActiveId} />
      {child ? <ChatThread key={child.id} child={child} /> : null}
    </>
  );
}

function ChatThread({ child }: { child: ParentChild }) {
  const key = ["chat", child.id] as const;
  const thread = useParentRead<Thread>(
    key,
    `/api/v1/chat/thread?studentId=${encodeURIComponent(child.id)}`,
    (v) => Array.isArray(v.messages),
    "The conversation",
  );
  const refresh = useParentRefresh();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const r = await parentPost("/api/v1/chat/send", {
      studentId: child.id,
      body,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setText("");
    await refresh(key);
  }

  return (
    <ParentReadState query={thread} what="the conversation">
      {(t) => (
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">
            {t.teacherName
              ? `Class teacher: ${t.teacherName}`
              : "No class teacher is assigned yet — the office will see your message."}
          </p>
          <ul className="space-y-2" data-testid="parent-chat-messages">
            {t.messages.length === 0 ? (
              <li className="text-sm text-[var(--muted)]">No messages yet.</li>
            ) : (
              t.messages.map((m) => (
                <li
                  key={m.id}
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    m.mine
                      ? "ml-auto bg-[var(--brand-deep)] text-white"
                      : "bg-[var(--card)] text-[var(--brand-deep)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p
                    className={`mt-0.5 text-[10px] ${m.mine ? "text-white/70" : "text-[var(--muted)]"}`}
                  >
                    {m.senderName} ·{" "}
                    {new Date(m.createdAt).toLocaleString("en-IN")}
                  </p>
                </li>
              ))
            )}
          </ul>
          {error ? (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <textarea
              className="field min-h-[44px] flex-1"
              aria-label="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write to the class teacher"
            />
            <button
              type="button"
              className="rounded-xl bg-[var(--brand-deep)] px-3 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy || !text.trim()}
              onClick={() => void send()}
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </ParentReadState>
  );
}
