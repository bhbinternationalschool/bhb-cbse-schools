"use client";

/**
 * School chat's conversation pane — the list, one conversation, "New
 * message" and "New group". Used by the School chat page (/school-chat), the
 * header chat button of the staff ERP and the parent portal's chat button, so
 * there is one chat on the web, the same one the staff and parent apps read
 * (/api/v1/school-chat — rows in the database, nothing kept in a browser or
 * in one server's memory).
 *
 * `studentId` = a family acting for this child (the parent portal); staff
 * leave it out. `compact` = one column (a drawer), never side by side.
 */
import { useEffect, useMemo, useState } from "react";
import { QueryError } from "@/components/data/QueryError";
import { useErpQuery } from "@/lib/data/client/hooks";
import { chatPost, type ContactsView, type ConversationsView, type MessagesView } from "@/lib/schoolChatClient";

const POLL_MS = 5_000;

export function usePoll(refetch: () => unknown, enabled = true, ms = POLL_MS) {
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, ms);
    return () => clearInterval(t);
  }, [refetch, enabled, ms]);
}

export const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";

export const btn = "rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-deep)] hover:bg-[var(--muted-surface)] disabled:opacity-50 dark:text-[var(--ink)]";
export const btnPrimary = "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
export const card = "rounded-xl border border-[var(--border)] bg-[var(--panel)]";

const withStudent = (path: string, studentId?: string) =>
  studentId ? `${path}${path.includes("?") ? "&" : "?"}studentId=${encodeURIComponent(studentId)}` : path;

/** The caller's conversations, polled while shown (30 s by default). */
export function useConversations(studentId?: string, opts: { oversight?: boolean; pollMs?: number; enabled?: boolean } = {}) {
  const path = withStudent(`/api/v1/school-chat/conversations${opts.oversight ? "?oversight=1" : ""}`, studentId);
  const q = useErpQuery<ConversationsView>(["school-chat", "conversations", studentId ?? "", opts.oversight ? "all" : "mine"], path, { enabled: opts.enabled });
  usePoll(q.refetch, opts.enabled !== false, opts.pollMs ?? 30_000);
  return q;
}

/** Unread messages across the caller's own conversations (moderator oversight never counts). */
export function unreadTotal(view?: ConversationsView): number {
  return (view?.conversations ?? []).filter((c) => !c.oversight).reduce((n, c) => n + (c.unread || 0), 0);
}

const isGroupKind = (k: string) => k === "class" || k === "subject" || k === "group";

export function ChatsPanel({
  view,
  loading,
  reload,
  initial,
  studentId,
  compact = false,
}: {
  view?: ConversationsView;
  loading: boolean;
  reload: () => unknown;
  initial: string;
  studentId?: string;
  compact?: boolean;
}) {
  const [openId, setOpenId] = useState(initial);
  const [showOversight, setShowOversight] = useState(false);
  const [picking, setPicking] = useState<null | "message" | "group">(null);
  const list = useMemo(() => (view?.conversations ?? []).filter((c) => showOversight || !c.oversight), [view, showOversight]);
  const anyOversight = (view?.conversations ?? []).some((c) => c.oversight);
  const staff = view?.me.kind === "staff";

  if (loading) return <p className="text-sm text-[var(--muted)]">Loading chats…</p>;
  if (view?.blocked) return <p className="text-sm text-[var(--danger)]">The school has paused your chat.</p>;

  const side = !!(openId || picking);
  const listClass = side ? (compact ? "hidden" : "hidden md:block") : "";
  return (
    <div className={compact ? "flex min-h-0 flex-1 flex-col" : "grid gap-4 md:grid-cols-[320px_1fr]"}>
      <div className={`${card} ${listClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] p-3">
          <span className="text-sm font-semibold text-[var(--ink)]">Conversations</span>
          <span className="flex gap-2">
            {staff ? (
              <button type="button" className={btn} onClick={() => setPicking("group")} data-testid="school-chat-new-group">
                New group
              </button>
            ) : null}
            <button type="button" className={btnPrimary} onClick={() => setPicking("message")}>
              New message
            </button>
          </span>
        </div>
        {anyOversight ? (
          <label className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={showOversight} onChange={(e) => setShowOversight(e.target.checked)} />
            Show every group (moderator)
          </label>
        ) : null}
        {list.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">
            {staff
              ? "No chats yet. Make a group or start a message. Class groups appear for class teachers and co-ordinators, subject groups for the teachers of that subject (Staff → Duties or the published timetable)."
              : "No chats yet. Your child's class and subject groups appear here once their teachers are set."}
          </p>
        ) : (
          <ul className={`${compact ? "max-h-[calc(100dvh-10rem)]" : "max-h-[65vh]"} divide-y divide-[var(--border)] overflow-y-auto`} data-testid="school-chat-list">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicking(null);
                    setOpenId(c.id);
                  }}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-[var(--muted-surface)] ${openId === c.id ? "bg-[var(--muted-surface)]" : ""}`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--ink)]">{c.title}</span>
                    {c.unread > 0 ? (
                      <span className="rounded-full bg-[var(--danger)] px-2 text-xs font-bold text-white" data-testid="school-chat-unread">
                        {c.unread}
                      </span>
                    ) : null}
                  </span>
                  <span className="w-full truncate text-xs text-[var(--muted)]">
                    {c.oversight ? "Moderator view · " : ""}
                    {c.lastMessage ?? (isGroupKind(c.kind) ? "Group — no messages yet" : "No messages yet")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={compact ? (side ? "flex min-h-0 flex-1 flex-col" : "hidden") : side ? "" : "hidden md:block"}>
        {picking === "group" ? (
          <GroupMaker
            compact={compact}
            onClose={() => setPicking(null)}
            onMade={(id) => {
              setPicking(null);
              setOpenId(id);
              void reload();
            }}
          />
        ) : picking === "message" ? (
          <ContactPicker
            compact={compact}
            studentId={studentId}
            onClose={() => setPicking(null)}
            onOpened={(id) => {
              setPicking(null);
              setOpenId(id);
              void reload();
            }}
          />
        ) : openId ? (
          <Thread key={openId} id={openId} studentId={studentId} compact={compact} onBack={() => setOpenId("")} onSent={reload} />
        ) : (
          <div className={`${card} p-6 text-sm text-[var(--muted)]`}>Pick a conversation.</div>
        )}
      </div>
    </div>
  );
}

function Thread({ id, studentId, compact, onBack, onSent }: { id: string; studentId?: string; compact: boolean; onBack: () => void; onSent: () => unknown }) {
  const q = useErpQuery<MessagesView>(["school-chat", "messages", id, studentId ?? ""], withStudent(`/api/v1/school-chat/messages?conversationId=${encodeURIComponent(id)}`, studentId));
  usePoll(q.refetch);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Opening a conversation marks it read on the server: the list's badge follows.
  useEffect(() => {
    if (q.data) void onSent();
  }, [q.data?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isError) return <QueryError what="this conversation" error={q.error} retry={q.refetch} />;
  const v = q.data;
  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setNotice(null);
    const r = await chatPost<{ held: boolean; notice: string | null }>("/api/v1/school-chat/send", { conversationId: id, body, ...(studentId ? { studentId } : {}) });
    setBusy(false);
    if (!r.ok) {
      setNotice({ kind: "error", text: r.error });
      return;
    }
    setText("");
    if (r.data.held && r.data.notice) setNotice({ kind: "ok", text: r.data.notice });
    void q.refetch();
    void onSent();
  }
  async function restrict(subject: { kind: string; id: string }, label: string, mode: "mute" | "block") {
    const reason = window.prompt(`${mode === "mute" ? "Mute" : "Block"} ${label} school-wide — why? (kept in the log)`) || "";
    if (!reason.trim()) return;
    const r = await chatPost("/api/v1/school-chat/moderation/blocks", { op: "set", subjectKind: subject.kind, subjectId: subject.id, mode, reason });
    setNotice(r.ok ? { kind: "ok", text: `${label} ${mode === "mute" ? "muted" : "blocked"}. Lift it under Mute & block.` } : { kind: "error", text: r.error });
  }
  return (
    <div className={`${card} flex ${compact ? "min-h-0 flex-1" : "h-[70vh]"} flex-col`} data-testid="school-chat-thread">
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <button type="button" className={`${btn} ${compact ? "" : "md:hidden"}`} onClick={onBack}>
          Back
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--ink)]">{v?.conversation.title ?? "…"}</p>
          {v?.conversation.oversight ? <p className="text-xs text-[var(--warning)]">Moderator view — you are not a member, you can read but not post.</p> : null}
          {v?.conversation.readOnly ? <p className="text-xs text-[var(--muted)]">The staff who made this group post here. To reply, message a teacher.</p> : null}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {!v ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : v.messages.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No messages yet.</p>
        ) : (
          v.messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.status === "held"
                    ? "border border-dashed border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--ink)] dark:text-[var(--warning)]"
                    : m.status === "removed"
                      ? "bg-[var(--muted-surface)] italic text-[var(--muted)]"
                      : m.mine
                        ? "bg-[var(--brand-deep)] text-white"
                        : "bg-[var(--muted-surface)] text-[var(--ink)]"
                }`}
                data-status={m.status}
              >
                {!m.mine ? <p className="text-xs font-semibold text-[var(--brand-accent)]">{m.senderLabel}</p> : null}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                {m.notice ? <p className="mt-1 text-xs">{m.notice}</p> : null}
                {v.conversation.moderator && m.senderSubject ? (
                  <p className="mt-1 flex gap-2 text-[10px]">
                    <button type="button" className="underline" onClick={() => void restrict(m.senderSubject!, m.senderLabel, "mute")}>
                      Mute
                    </button>
                    <button type="button" className="underline" onClick={() => void restrict(m.senderSubject!, m.senderLabel, "block")}>
                      Block
                    </button>
                  </p>
                ) : null}
                <p className={`mt-0.5 text-[10px] ${m.mine && m.status === "visible" ? "text-white/70" : "text-[var(--muted)]"}`}>{fmt(m.createdAt)}</p>
              </div>
            </div>
          ))
        )}
      </div>
      {notice ? (
        <p className={`px-3 pb-1 text-xs ${notice.kind === "error" ? "text-[var(--danger)]" : "text-[var(--warning)]"}`} data-testid="school-chat-notice">
          {notice.text}
        </p>
      ) : null}
      {v && v.conversation.canSend ? (
        <div className="flex gap-2 border-t border-[var(--border)] p-3">
          <textarea
            aria-label="Message"
            className="min-h-[40px] flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]"
            rows={1}
            maxLength={2000}
            value={text}
            placeholder="Type a message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="button" className={btnPrimary} disabled={busy || !text.trim()} onClick={() => void send()}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      ) : v?.conversation.muted ? (
        <p className="border-t border-[var(--border)] p-3 text-xs text-[var(--danger)]">You are muted in this chat.</p>
      ) : null}
    </div>
  );
}

function ContactPicker({ studentId, compact, onClose, onOpened }: { studentId?: string; compact: boolean; onClose: () => void; onOpened: (id: string) => void }) {
  const q = useErpQuery<ContactsView>(["school-chat", "contacts", studentId ?? ""], withStudent("/api/v1/school-chat/contacts", studentId));
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const f = filter.trim().toLowerCase();
  async function open(withWho: { kind: "staff"; id: string } | { kind: "parent"; studentId: string }) {
    setError("");
    const r = await chatPost<{ id: string }>("/api/v1/school-chat/direct", { with: withWho, ...(studentId ? { studentId } : {}) });
    if (!r.ok) setError(r.error);
    else onOpened(r.data.id);
  }
  if (q.isError) return <QueryError what="your contacts" error={q.error} retry={q.refetch} />;
  const families = q.data?.families ?? [];
  return (
    <div className={`${card} flex ${compact ? "min-h-0 flex-1" : "h-[70vh]"} flex-col`}>
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <input
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
          placeholder={studentId ? "Search your child's teachers" : "Search staff or a child's name"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      </div>
      {error ? <p className="px-3 pt-2 text-xs text-[var(--danger)]">{error}</p> : null}
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">{studentId ? "Teachers" : "Staff"}</p>
        {(q.data?.staff ?? [])
          .filter((s) => !f || s.name.toLowerCase().includes(f))
          .slice(0, 50)
          .map((s) => (
            <button key={s.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-[var(--ink)] hover:bg-[var(--muted-surface)]" onClick={() => void open({ kind: "staff", id: s.id })}>
              {s.name}
              {s.role ? <span className="ml-1 text-xs text-[var(--muted)]">· {s.role}</span> : null}
            </button>
          ))}
        {!studentId ? (
          <>
            <p className="mb-1 mt-3 text-xs font-semibold uppercase text-[var(--muted)]">Families of children you teach</p>
            {families
              .filter((p) => !f || p.label.toLowerCase().includes(f))
              .slice(0, 80)
              .map((p) => (
                <button key={p.studentId} type="button" className="block w-full rounded px-2 py-1.5 text-left text-[var(--ink)] hover:bg-[var(--muted-surface)]" onClick={() => void open({ kind: "parent", studentId: p.studentId })}>
                  {p.label}
                </button>
              ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** "New group": a name, the staff to add and, optionally, one class section you teach (its families read it). */
function GroupMaker({ compact, onClose, onMade }: { compact: boolean; onClose: () => void; onMade: (id: string) => void }) {
  const q = useErpQuery<ContactsView>(["school-chat", "contacts", ""], "/api/v1/school-chat/contacts");
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [section, setSection] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (q.isError) return <QueryError what="the staff list" error={q.error} retry={q.refetch} />;
  const f = filter.trim().toLowerCase();
  const staff = q.data?.staff ?? [];
  const sections = q.data?.sections ?? [];
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  async function make() {
    setError("");
    const sec = sections.find((s) => `${s.classId}|${s.sectionId}` === section);
    setBusy(true);
    const r = await chatPost<{ id: string }>("/api/v1/school-chat/groups", {
      title,
      staffIds: picked,
      ...(sec ? { section: { classId: sec.classId, sectionId: sec.sectionId } } : {}),
    });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else onMade(r.data.id);
  }
  return (
    <div className={`${card} flex ${compact ? "min-h-0 flex-1" : "h-[70vh]"} flex-col`} data-testid="school-chat-group-maker">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] p-3">
        <span className="text-sm font-semibold text-[var(--ink)]">New group</span>
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-[var(--muted)]">Group name</span>
          <input
            aria-label="Group name"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Annual day committee"
          />
        </label>
        {sections.length ? (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--muted)]">Class section (optional — its families can read the group)</span>
            <select
              aria-label="Class section"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">Staff only</option>
              {sections.map((s) => (
                <option key={`${s.classId}|${s.sectionId}`} value={`${s.classId}|${s.sectionId}`}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase text-[var(--muted)]">
            Staff ({picked.length} picked — you are in it too)
          </span>
          <input
            className="mb-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
            placeholder="Search staff"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {q.isLoading ? <p className="text-[var(--muted)]">Loading staff…</p> : null}
          <ul className="space-y-0.5">
            {staff
              .filter((s) => !f || s.name.toLowerCase().includes(f) || picked.includes(s.id))
              .slice(0, 120)
              .map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 rounded px-2 py-1 text-[var(--ink)] hover:bg-[var(--muted-surface)]">
                    <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                    {s.name}
                  </label>
                </li>
              ))}
          </ul>
        </div>
      </div>
      {error ? <p className="px-3 pb-1 text-xs text-[var(--danger)]" role="alert">{error}</p> : null}
      <div className="border-t border-[var(--border)] p-3">
        <button type="button" className={`${btnPrimary} w-full`} disabled={busy || !title.trim() || picked.length === 0} onClick={() => void make()}>
          {busy ? "Making the group…" : "Make group"}
        </button>
      </div>
    </div>
  );
}
