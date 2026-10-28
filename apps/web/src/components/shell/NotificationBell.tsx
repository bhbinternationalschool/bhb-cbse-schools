"use client";

/**
 * The bell — this person's own notifications from the server (20 Oct 2026).
 *
 * Reads GET /api/data/views/notifications through useErpQuery on desk
 * "erp_notifications": a new approval, document, message or payment that
 * concerns this person appears within one versions poll (~20 s), on every
 * device. Who receives what is decided on the server by roles
 * (lib/notify/audience.ts); this component only ever sees the caller's rows.
 * Read marks and settings are POST /api/v1/notifications (kernel writes).
 *
 * A family's web portal has no versions poll (it is staff-only), so there
 * the bell re-asks every 30 s while the tab is visible.
 *
 * Until this change the bell read a whole-desk copy of every notification in
 * the browser (lib/notifications.ts) and filtered it by persona on the
 * client; nothing an approval or a payment did ever reached it.
 */
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, Settings2 } from "lucide-react";
import { erpFetch } from "@/lib/data/erpFetch";
import { makeErpQueryClient, useErpQuery } from "@/lib/data/client/hooks";
import { NOTIFY_TOPICS, NOTIFY_TOPIC_LABELS, type NotifyPrefs, type NotifyTopic } from "@/lib/notify/kinds";
import { parseInboxView, type InboxItem, type InboxView } from "@/lib/notify/inboxShared";

type Persona = "staff" | "parent";

const VIEW = "/api/data/views/notifications";
const WRITE = "/api/v1/notifications";
const QUERY_KEY = "notifications";
const PARENT_POLL_MS = 30_000;

async function post(body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await erpFetch(WRITE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return { ok: res.ok && data.ok === true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e instanceof Error ? e.message : "Network error" } };
  }
}

function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function NotificationBell({ persona = "staff" }: { persona?: Persona; parentMobile?: string; parentName?: string }) {
  // The staff shell has an ErpQueryProvider; the family portal does not.
  const [client] = useState(() => (persona === "parent" ? makeErpQueryClient() : null));
  if (client) {
    return (
      <QueryClientProvider client={client}>
        <BellInner persona={persona} />
      </QueryClientProvider>
    );
  }
  return <BellInner persona={persona} />;
}

function BellInner({ persona }: { persona: Persona }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "settings">("list");
  const rootRef = useRef<HTMLDivElement>(null);
  const q = useErpQuery<InboxView>(QUERY_KEY, VIEW, { desk: "erp_notifications", parse: parseInboxView });
  const refresh = () => void qc.invalidateQueries({ queryKey: [QUERY_KEY] });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (persona !== "parent") return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    }, PARENT_POLL_MS);
    return () => window.clearInterval(t);
  }, [persona, qc]);

  const data = q.data;
  const unread = data?.unread ?? 0;

  async function openItem(n: InboxItem) {
    setOpen(false);
    if (!n.readAt) {
      await post({ op: "read", ids: [n.id] });
      refresh();
    }
    const href = persona === "parent" ? "/parent" : n.webLink || n.link;
    if (href && href.startsWith("/")) router.push(href);
  }

  async function markAll() {
    const r = await post({ op: "read_all" });
    if (r.ok) refresh();
  }

  return (
    <div ref={rootRef} className="relative" data-testid="notification-bell">
      <button
        type="button"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        onClick={() => {
          setOpen((o) => !o);
          setView("list");
        }}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
      >
        <Bell className="h-4 w-4" strokeWidth={2.25} />
        {unread > 0 ? (
          <span
            data-testid="notification-unread"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-bold text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-[23rem] overflow-hidden max-sm:fixed max-sm:inset-x-2 max-sm:top-14 max-sm:mt-0 max-sm:w-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[0_12px_40px_rgba(32,48,80,0.18)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
            <p className="text-xs font-bold text-[var(--brand-deep)]">{view === "list" ? "Notifications" : "Notification settings"}</p>
            <div className="flex items-center gap-3">
              {view === "list" && unread > 0 ? (
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--brand-deep)]"
                  onClick={() => void markAll()}
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                aria-label={view === "list" ? "Notification settings" : "Back to notifications"}
                className="flex items-center gap-1 text-[11px] font-semibold text-[var(--brand-deep)]"
                onClick={() => setView((v) => (v === "list" ? "settings" : "list"))}
              >
                {view === "list" ? <Settings2 className="h-3.5 w-3.5" /> : "Back"}
              </button>
            </div>
          </div>

          {q.isError && !data ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">
              <p>Could not load notifications.</p>
              <button type="button" className="mt-2 font-semibold text-[var(--brand-deep)] underline" onClick={() => void q.refetch()}>
                Retry
              </button>
            </div>
          ) : !data ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--muted)]">Loading…</p>
          ) : view === "settings" ? (
            <PrefsPanel prefs={data.prefs} prefsRev={data.prefsRev} onSaved={refresh} />
          ) : (
            <ul className="max-h-96 overflow-y-auto" data-testid="notification-list">
              {data.items.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-[var(--muted)]">No notifications yet</li>
              ) : (
                data.items.map((n) => <Item key={n.id} n={n} persona={persona} onOpen={() => void openItem(n)} />)
              )}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Item({ n, persona, onOpen }: { n: InboxItem; persona: Persona; onOpen: () => void }) {
  const [now] = useState(() => Date.now());
  const title = persona === "parent" && n.titleHi ? n.titleHi : n.title;
  const body = persona === "parent" && n.bodyHi ? n.bodyHi : n.body;
  return (
    <li className="border-b border-[var(--border)] last:border-0">
      <button
        type="button"
        onClick={onOpen}
        data-testid="notification-item"
        data-kind={n.kind}
        data-unread={n.readAt ? "0" : "1"}
        className={`block w-full px-3 py-2.5 text-left hover:bg-[var(--surface-sunken)] ${n.readAt ? "" : "bg-[var(--surface-sunken)]"}`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-deep)]">
            {n.readAt ? null : <span aria-label="unread" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--danger)]" />}
            <span>{title}</span>
            {n.groupCount > 1 ? (
              <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 text-[10px] font-bold text-[var(--muted)]">×{n.groupCount}</span>
            ) : null}
          </p>
          <span className="shrink-0 text-[10px] text-[var(--muted)]">{ago(n.groupCount > 1 ? n.rev : n.createdAt, now)}</span>
        </div>
        {body ? <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--muted)]">{body}</p> : null}
        <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">{NOTIFY_TOPIC_LABELS[n.topic]?.en ?? n.topic}</p>
      </button>
    </li>
  );
}

function PrefsPanel({ prefs, prefsRev, onSaved }: { prefs: NotifyPrefs; prefsRev: string | null; onSaved: () => void }) {
  const [draft, setDraft] = useState<NotifyPrefs>(prefs);
  const [base, setBase] = useState<string | null>(prefsRev);
  const [msg, setMsg] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const toggleTopic = (t: NotifyTopic) =>
    setDraft((d) => ({ ...d, mutedTopics: d.mutedTopics.includes(t) ? d.mutedTopics.filter((x) => x !== t) : [...d.mutedTopics, t] }));

  async function save() {
    setSaving(true);
    setMsg("");
    const r = await post({ op: "prefs", prefs: draft, base });
    setSaving(false);
    if (r.ok) {
      setBase(typeof r.data.prefsRev === "string" ? r.data.prefsRev : base);
      setMsg("Saved");
      onSaved();
      return;
    }
    if (r.status === 409 && r.data.prefs) {
      setDraft(r.data.prefs as NotifyPrefs);
      setBase(typeof r.data.prefsRev === "string" ? r.data.prefsRev : null);
    }
    setMsg(typeof r.data.error === "string" ? r.data.error : "Not saved — please try again.");
  }

  return (
    <div className="space-y-3 px-3 py-3 text-xs text-[var(--card-foreground)]" data-testid="notification-settings">
      <fieldset>
        <legend className="mb-1 font-semibold text-[var(--brand-deep)]">Ring my phone for</legend>
        <div className="grid grid-cols-2 gap-1">
          {NOTIFY_TOPICS.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="checkbox" checked={!draft.mutedTopics.includes(t)} onChange={() => toggleTopic(t)} />
              {NOTIFY_TOPIC_LABELS[t].en}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-[var(--muted)]">Unticked topics still appear here in the bell.</p>
      </fieldset>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={draft.voice} onChange={(e) => setDraft((d) => ({ ...d, voice: e.target.checked }))} />
        Spoken alert on the phone (off = normal sound)
      </label>
      <fieldset className="space-y-1">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.quietEnabled}
            onChange={(e) => setDraft((d) => ({ ...d, quietEnabled: e.target.checked }))}
          />
          Quiet hours (only urgent alerts ring)
        </label>
        <div className="flex items-center gap-2 pl-6">
          <input
            type="time"
            aria-label="Quiet from"
            value={draft.quietStart}
            disabled={!draft.quietEnabled}
            onChange={(e) => setDraft((d) => ({ ...d, quietStart: e.target.value }))}
            className="rounded border border-[var(--border)] bg-[var(--card)] px-1 py-0.5"
          />
          <span>to</span>
          <input
            type="time"
            aria-label="Quiet until"
            value={draft.quietEnd}
            disabled={!draft.quietEnabled}
            onChange={(e) => setDraft((d) => ({ ...d, quietEnd: e.target.value }))}
            className="rounded border border-[var(--border)] bg-[var(--card)] px-1 py-0.5"
          />
        </div>
      </fieldset>
      <div className="flex items-center justify-between">
        <span data-testid="notification-settings-msg" className="text-[11px] text-[var(--muted)]">
          {msg}
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-md bg-[var(--brand-deep)] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
