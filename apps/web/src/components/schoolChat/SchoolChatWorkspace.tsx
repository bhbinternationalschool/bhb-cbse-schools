"use client";

/**
 * School chat (web ERP) — the staff side of /api/v1/school-chat.
 *
 * Tabs: Chats (my class / subject groups and direct chats; a moderator can
 * also look into every group), and for moderators (Discipline · approve):
 * Review (held messages — approve / remove / warn), Mute & block, and
 * Behaviour (the weekly counts). Everything is read from the server through
 * the query kernel and polled while the page is open; the browser keeps no
 * copy (R1). Writes are one POST each and then a refetch.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { QueryError } from "@/components/data/QueryError";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { useErpQuery } from "@/lib/data/client/hooks";
import {
  chatPost,
  type BehaviourView,
  type BlocksView,
  type ContactsView,
  type ConversationsView,
  type MessagesView,
  type QueueView,
} from "@/lib/schoolChatClient";

const POLL_MS = 5_000;

function usePoll(refetch: () => unknown, enabled = true, ms = POLL_MS) {
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, ms);
    return () => clearInterval(t);
  }, [refetch, enabled, ms]);
}

const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";

const btn = "rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-deep)] hover:bg-[var(--muted-surface)] disabled:opacity-50 dark:text-[var(--ink)]";
const btnPrimary = "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
const card = "rounded-xl border border-[var(--border)] bg-[var(--panel)]";

export function SchoolChatWorkspace() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "chats");
  const convs = useErpQuery<ConversationsView>(["school-chat", "conversations"], "/api/v1/school-chat/conversations?oversight=1");
  usePoll(convs.refetch, tab === "chats", 10_000);
  const moderator = convs.data?.moderator ?? false;

  const items = [
    { id: "chats", label: "Chats" },
    ...(moderator
      ? [
          { id: "review", label: "Review", tone: "rose" as const },
          { id: "blocks", label: "Mute & block" },
          { id: "behaviour", label: "Behaviour" },
        ]
      : []),
  ];

  return (
    <ErpWorkspaceShell
      title="School chat"
      subtitle="Class and subject groups with their teachers, and direct chats with staff and families. Every child's and family's message is checked before others see it."
      icon={<MessagesSquare className="h-5 w-5" />}
    >
      {items.length > 1 ? <ModuleTabs items={items} value={tab} onChange={setTab} aria-label="School chat" /> : null}
      {convs.isError ? (
        <QueryError what="your chats" error={convs.error} retry={convs.refetch} />
      ) : tab === "review" && moderator ? (
        <ReviewQueue />
      ) : tab === "blocks" && moderator ? (
        <BlocksPanel />
      ) : tab === "behaviour" && moderator ? (
        <BehaviourPanel />
      ) : (
        <ChatsPanel view={convs.data} loading={convs.isLoading} reload={convs.refetch} initial={params.get("c") || ""} />
      )}
    </ErpWorkspaceShell>
  );
}

// ── Chats ────────────────────────────────────────────────────────────────

function ChatsPanel({ view, loading, reload, initial }: { view?: ConversationsView; loading: boolean; reload: () => unknown; initial: string }) {
  const [openId, setOpenId] = useState(initial);
  const [showOversight, setShowOversight] = useState(false);
  const [picking, setPicking] = useState(false);
  const list = useMemo(() => (view?.conversations ?? []).filter((c) => showOversight || !c.oversight), [view, showOversight]);
  const anyOversight = (view?.conversations ?? []).some((c) => c.oversight);

  if (loading) return <p className="text-sm text-[var(--muted)]">Loading chats…</p>;
  if (view?.blocked) return <p className="text-sm text-[var(--danger)]">The school has paused your chat.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr]">
      <div className={`${card} ${openId ? "hidden md:block" : ""}`}>
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] p-3">
          <span className="text-sm font-semibold text-[var(--ink)]">Conversations</span>
          <button type="button" className={btnPrimary} onClick={() => setPicking(true)}>
            New message
          </button>
        </div>
        {anyOversight ? (
          <label className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={showOversight} onChange={(e) => setShowOversight(e.target.checked)} />
            Show every group (moderator)
          </label>
        ) : null}
        {list.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">
            No chats yet. Class groups appear for class teachers and co-ordinators, subject groups for the teachers of that subject (Staff → Duties or the published timetable).
          </p>
        ) : (
          <ul className="max-h-[65vh] divide-y divide-[var(--border)] overflow-y-auto" data-testid="school-chat-list">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-[var(--muted-surface)] ${openId === c.id ? "bg-[var(--muted-surface)]" : ""}`}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--ink)]">{c.title}</span>
                    {c.unread > 0 ? <span className="rounded-full bg-[var(--danger)] px-2 text-xs font-bold text-white">{c.unread}</span> : null}
                  </span>
                  <span className="w-full truncate text-xs text-[var(--muted)]">
                    {c.oversight ? "Moderator view · " : ""}
                    {c.lastMessage ?? (c.kind === "class" || c.kind === "subject" ? "Group — no messages yet" : "No messages yet")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={openId ? "" : "hidden md:block"}>
        {picking ? (
          <ContactPicker
            onClose={() => setPicking(false)}
            onOpened={(id) => {
              setPicking(false);
              setOpenId(id);
              void reload();
            }}
          />
        ) : openId ? (
          <Thread id={openId} onBack={() => setOpenId("")} onSent={reload} />
        ) : (
          <div className={`${card} p-6 text-sm text-[var(--muted)]`}>Pick a conversation.</div>
        )}
      </div>
    </div>
  );
}

function Thread({ id, onBack, onSent }: { id: string; onBack: () => void; onSent: () => unknown }) {
  const q = useErpQuery<MessagesView>(["school-chat", "messages", id], `/api/v1/school-chat/messages?conversationId=${encodeURIComponent(id)}`);
  usePoll(q.refetch);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (q.isError) return <QueryError what="this conversation" error={q.error} retry={q.refetch} />;
  const v = q.data;
  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setNotice(null);
    const r = await chatPost<{ held: boolean; notice: string | null }>("/api/v1/school-chat/send", { conversationId: id, body });
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
    <div className={`${card} flex h-[70vh] flex-col`} data-testid="school-chat-thread">
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <button type="button" className={`${btn} md:hidden`} onClick={onBack}>
          Back
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--ink)]">{v?.conversation.title ?? "…"}</p>
          {v?.conversation.oversight ? <p className="text-xs text-[var(--warning)]">Moderator view — you are not a member, you can read but not post.</p> : null}
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

function ContactPicker({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const q = useErpQuery<ContactsView>(["school-chat", "contacts"], "/api/v1/school-chat/contacts");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const f = filter.trim().toLowerCase();
  async function open(withWho: { kind: "staff"; id: string } | { kind: "parent"; studentId: string }) {
    setError("");
    const r = await chatPost<{ id: string }>("/api/v1/school-chat/direct", { with: withWho });
    if (!r.ok) setError(r.error);
    else onOpened(r.data.id);
  }
  if (q.isError) return <QueryError what="your contacts" error={q.error} retry={q.refetch} />;
  return (
    <div className={`${card} flex h-[70vh] flex-col`}>
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <input
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
          placeholder="Search staff or a child's name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      </div>
      {error ? <p className="px-3 pt-2 text-xs text-[var(--danger)]">{error}</p> : null}
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Staff</p>
        {(q.data?.staff ?? [])
          .filter((s) => !f || s.name.toLowerCase().includes(f))
          .slice(0, 50)
          .map((s) => (
            <button key={s.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-[var(--ink)] hover:bg-[var(--muted-surface)]" onClick={() => void open({ kind: "staff", id: s.id })}>
              {s.name}
            </button>
          ))}
        <p className="mb-1 mt-3 text-xs font-semibold uppercase text-[var(--muted)]">Families of children you teach</p>
        {(q.data?.families ?? [])
          .filter((p) => !f || p.label.toLowerCase().includes(f))
          .slice(0, 80)
          .map((p) => (
            <button key={p.studentId} type="button" className="block w-full rounded px-2 py-1.5 text-left text-[var(--ink)] hover:bg-[var(--muted-surface)]" onClick={() => void open({ kind: "parent", studentId: p.studentId })}>
              {p.label}
            </button>
          ))}
      </div>
    </div>
  );
}

// ── Moderation ───────────────────────────────────────────────────────────

const CAT_LABEL: Record<string, string> = {
  abuse: "Abuse",
  bullying: "Bullying",
  sexual: "Sexual",
  threat: "Threat",
  self_harm: "Self-harm",
  personal_info: "Personal info",
  other: "Other",
};

function ReviewQueue() {
  const q = useErpQuery<QueueView>(["school-chat", "queue"], "/api/v1/school-chat/moderation/queue");
  usePoll(q.refetch, true, 10_000);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  if (q.isError) return <QueryError what="the review queue" error={q.error} retry={q.refetch} />;
  const items = q.data?.items ?? [];

  async function decide(id: string, decision: "approve" | "remove" | "warn") {
    setBusy(id);
    setNotice(null);
    const r = await chatPost("/api/v1/school-chat/moderation/decide", { messageId: id, decision, note: notes[id] || "" });
    setBusy("");
    setNotice(r.ok ? { kind: "ok", text: decision === "approve" ? "Approved — the group can see it now." : decision === "warn" ? "Removed and the sender warned." : "Removed." } : { kind: "error", text: r.error });
    void q.refetch();
  }
  async function mute(item: QueueView["items"][number], mode: "mute" | "block") {
    const reason = (notes[item.id] || "").trim();
    setBusy(item.id);
    const r = await chatPost("/api/v1/school-chat/moderation/blocks", { op: "set", subjectKind: item.subjectKind, subjectId: item.subjectId, mode, reason });
    setBusy("");
    setNotice(r.ok ? { kind: "ok", text: `${item.senderLabel} ${mode === "mute" ? "muted" : "blocked"} school-wide.` } : { kind: "error", text: r.error });
  }

  return (
    <div className="space-y-3" data-testid="school-chat-review">
      {notice ? <p className={`text-sm ${notice.kind === "error" ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{notice.text}</p> : null}
      {q.isLoading ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}
      {!q.isLoading && items.length === 0 ? <p className={`${card} p-4 text-sm text-[var(--muted)]`}>Nothing waiting for review.</p> : null}
      {items.map((it) => (
        <div key={it.id} className={`${card} space-y-2 p-4 ${it.urgent ? "border-[var(--danger)]" : ""}`} data-testid="school-chat-queue-item">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {it.urgent ? <span className="rounded bg-[var(--danger)] px-2 py-0.5 font-bold text-white">URGENT — may need help now</span> : null}
            {it.flaggedStaff ? <span className="rounded bg-[var(--warning-soft)] px-2 py-0.5 font-semibold text-[var(--warning)]">Staff message — posted, flagged</span> : null}
            {it.categories.map((c) => (
              <span key={c} className="rounded bg-[var(--danger-soft)] px-2 py-0.5 font-semibold text-[var(--danger)]">
                {CAT_LABEL[c] || c}
              </span>
            ))}
            {it.repeat ? <span className="rounded bg-[var(--danger)] px-2 py-0.5 font-semibold text-white">Repeat offender</span> : null}
            <span className="text-[var(--muted)]">
              {it.conversationTitle} · {fmt(it.createdAt)}
            </span>
          </div>
          <p className="text-sm font-semibold text-[var(--ink)]">{it.senderLabel}</p>
          <p className="whitespace-pre-wrap break-words rounded-lg bg-[var(--muted-surface)] p-3 text-sm text-[var(--ink)]">{it.body}</p>
          <p className="text-xs text-[var(--muted)]">
            Checked by {it.checkedBy === "rules" ? "the word rules" : it.checkedBy === "ai" ? "AI" : it.checkedBy === "ai_unavailable" ? "nobody — the AI check failed, so it was held" : it.checkedBy}
            {it.reason ? ` — ${it.reason}` : ""}. Last 30 days: {it.history.held} held, {it.history.removed} removed, {it.history.warned} warned.
          </p>
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
            placeholder="Note / reason (needed to remove, warn, mute or block)"
            value={notes[it.id] || ""}
            onChange={(e) => setNotes((n) => ({ ...n, [it.id]: e.target.value }))}
          />
          <div className="flex flex-wrap gap-2">
            {it.status === "held" ? (
              <button type="button" className={btnPrimary} disabled={busy === it.id} onClick={() => void decide(it.id, "approve")}>
                Approve
              </button>
            ) : null}
            <button type="button" className={btn} disabled={busy === it.id} onClick={() => void decide(it.id, "remove")}>
              Remove
            </button>
            {it.status === "held" ? (
              <button type="button" className={btn} disabled={busy === it.id} onClick={() => void decide(it.id, "warn")}>
                Remove &amp; warn
              </button>
            ) : null}
            <button type="button" className={btn} disabled={busy === it.id} onClick={() => void mute(it, "mute")}>
              Mute sender
            </button>
            <button type="button" className={btn} disabled={busy === it.id} onClick={() => void mute(it, "block")}>
              Block sender
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BlocksPanel() {
  const [all, setAll] = useState(false);
  const q = useErpQuery<BlocksView>(["school-chat", "blocks", all], `/api/v1/school-chat/moderation/blocks${all ? "?all=1" : ""}`);
  const [form, setForm] = useState({ subjectKind: "student", subjectId: "", mode: "mute", reason: "" });
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  if (q.isError) return <QueryError what="mutes and blocks" error={q.error} retry={q.refetch} />;
  async function add() {
    const r = await chatPost("/api/v1/school-chat/moderation/blocks", { op: "set", ...form });
    setNotice(r.ok ? { kind: "ok", text: "Saved." } : { kind: "error", text: r.error });
    if (r.ok) setForm((f) => ({ ...f, subjectId: "", reason: "" }));
    void q.refetch();
  }
  async function lift(id: string) {
    const reason = window.prompt("Why lift it? (kept in the log)") || "";
    const r = await chatPost("/api/v1/school-chat/moderation/blocks", { op: "lift", id, reason });
    setNotice(r.ok ? { kind: "ok", text: "Lifted." } : { kind: "error", text: r.error });
    void q.refetch();
  }
  const input = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]";
  return (
    <div className="space-y-4">
      <div className={`${card} space-y-2 p-4`}>
        <p className="text-sm font-semibold text-[var(--ink)]">Mute or block someone</p>
        <p className="text-xs text-[var(--muted)]">Mute: can read, cannot send. Block: cannot open chat at all. School-wide. Usually done from a message in Review, which fills this in.</p>
        <div className="flex flex-wrap gap-2">
          <select className={input} value={form.subjectKind} onChange={(e) => setForm({ ...form, subjectKind: e.target.value })} aria-label="Who">
            <option value="student">Child (student id)</option>
            <option value="household">Family (household id)</option>
            <option value="staff">Staff (staff id)</option>
          </select>
          <input className={input} placeholder="Id" value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} />
          <select className={input} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} aria-label="Mode">
            <option value="mute">Mute</option>
            <option value="block">Block</option>
          </select>
          <input className={`${input} min-w-[240px] flex-1`} placeholder="Reason (kept in the log)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <button type="button" className={btnPrimary} onClick={() => void add()}>
            Save
          </button>
        </div>
        {notice ? <p className={`text-xs ${notice.kind === "error" ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{notice.text}</p> : null}
      </div>
      <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show lifted ones too
      </label>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="p-2">Who</th>
              <th className="p-2">Mode</th>
              <th className="p-2">Where</th>
              <th className="p-2">Reason</th>
              <th className="p-2">By / when</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {(q.data?.blocks ?? []).map((b) => (
              <tr key={b.id} className="border-t border-[var(--border)] text-[var(--ink)]">
                <td className="p-2">
                  {b.subjectKind} {b.subjectId}
                </td>
                <td className="p-2">{b.mode}</td>
                <td className="p-2">{b.conversationId ? "one chat" : "school-wide"}</td>
                <td className="p-2">{b.reason}</td>
                <td className="p-2 text-xs">
                  {b.createdByName} · {fmt(b.createdAt)}
                </td>
                <td className="p-2">
                  {b.liftedAt ? (
                    <span className="text-xs text-[var(--muted)]">lifted {fmt(b.liftedAt)}</span>
                  ) : (
                    <button type="button" className={btn} onClick={() => void lift(b.id)}>
                      Lift
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(q.data?.blocks ?? []).length === 0 ? <p className="p-4 text-sm text-[var(--muted)]">No one is muted or blocked.</p> : null}
      </div>
    </div>
  );
}

function BehaviourPanel() {
  const [days, setDays] = useState(7);
  const q = useErpQuery<BehaviourView>(["school-chat", "behaviour", days], `/api/v1/school-chat/moderation/summary?days=${days}`);
  if (q.isError) return <QueryError what="the behaviour summary" error={q.error} retry={q.refetch} />;
  const v = q.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
        Last
        <select className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days">
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      {v ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(
            [
              ["Checked", v.totals.sent],
              ["Held", v.totals.held],
              ["Removed", v.totals.removed],
              ["Warnings", v.totals.warned],
              ["Staff flagged", v.totals.flagged],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className={`${card} p-3`}>
              <p className="text-xs text-[var(--muted)]">{label}</p>
              <p className="text-2xl font-bold text-[var(--ink)]">{n}</p>
            </div>
          ))}
        </div>
      ) : null}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="p-2">Who</th>
              <th className="p-2">Checked</th>
              <th className="p-2">Held</th>
              <th className="p-2">Removed</th>
              <th className="p-2">Warned</th>
              <th className="p-2">Mostly</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(v?.people ?? []).map((p) => (
              <tr key={`${p.kind}:${p.id}`} className="border-t border-[var(--border)] text-[var(--ink)]">
                <td className="p-2">
                  {p.label}
                  {p.repeat ? <span className="ml-2 rounded bg-[var(--danger)] px-1.5 text-xs font-semibold text-white">repeat</span> : null}
                </td>
                <td className="p-2">{p.sent}</td>
                <td className="p-2">{p.held}</td>
                <td className="p-2">{p.removed}</td>
                <td className="p-2">{p.warned}</td>
                <td className="p-2 text-xs">
                  {Object.entries(p.categories)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 2)
                    .map(([c]) => CAT_LABEL[c] || c)
                    .join(", ")}
                </td>
                <td className="p-2 text-xs">{p.activeBlock}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {v && v.people.length === 0 ? <p className="p-4 text-sm text-[var(--muted)]">Nobody was held, removed or warned in this period.</p> : null}
      </div>
    </div>
  );
}
