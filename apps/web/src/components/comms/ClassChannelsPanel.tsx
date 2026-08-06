"use client";

import { useCallback, useEffect, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { applyClassChannelDraftToErp } from "@/lib/waClassChannelApply";
import { loadMasters } from "@/lib/masters";
import { TENANT } from "@/lib/types";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type Channel = {
  id: string;
  academicYearCode: string;
  classId: string;
  sectionId: string;
  label: string;
  members: {
    role: string;
    name: string;
    mobile: string;
  }[];
};

type Draft = {
  id: string;
  channelId: string;
  kind: string;
  title: string;
  body: string;
  subjectId: string;
  subjectName: string;
  dueAt: string;
  eventDate: string;
  mediaNote: string;
  status: string;
  createdAt: string;
  createdByName: string;
  broadcastCount: number;
  erpTarget: "homework" | "notice" | "none";
};

type Thread = {
  id: string;
  channelId: string;
  staffName: string;
  mobile: string;
  pendingDraftId: string;
  updatedAt: string;
  messages: { role: string; text: string; at: string; by: string }[];
};

export function ClassChannelsPanel() {
  const session = useDemoSession();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [configured, setConfigured] = useState(false);
  const [help, setHelp] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [draftKind, setDraftKind] = useState("homework");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftSubjectId, setDraftSubjectId] = useState("");

  const subjects = loadMasters().subjects ?? [];

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wa/class-channel");
      if (!res.ok) return;
      const json = (await res.json()) as {
        outboundConfigured?: boolean;
        help?: string;
        channels?: Channel[];
        drafts?: Draft[];
        threads?: Thread[];
      };
      setConfigured(!!json.outboundConfigured);
      setHelp(json.help || "");
      const ch = Array.isArray(json.channels) ? json.channels : [];
      setChannels(ch);
      setDrafts(Array.isArray(json.drafts) ? json.drafts : []);
      setThreads(Array.isArray(json.threads) ? json.threads : []);
      if (!selectedChannelId && ch[0]) setSelectedChannelId(ch[0].id);

      // Auto-apply confirmed drafts into ERP modules
      for (const d of json.drafts || []) {
        if (d.status !== "confirmed") continue;
        const channel = ch.find((c) => c.id === d.channelId);
        if (!channel) continue;
        const applied = applyClassChannelDraftToErp(d, channel);
        if (applied.ok) {
          await fetch("/api/wa/class-channel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "mark_applied",
              draftId: d.id,
            }),
          });
        }
      }
    } catch {
      /* */
    }
  }, [selectedChannelId]);

  useEffect(() => {
    void (async () => {
      await refresh();
      if (channels.length === 0) {
        await syncMembers();
      }
    })();
    const t = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(t);
  }, [refresh, channels.length]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  async function syncMembers() {
    setBusy(true);
    try {
      const res = await fetch("/api/wa/class-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Sync failed");
        return;
      }
      await refresh();
      flash("Channels rebuilt from Staff duties + SIS roster");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDraft(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/wa/class-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          draftId: id,
          by: session.fullName,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        draft?: Draft;
        broadcast?: { sent: number; stub: number };
      };
      if (!res.ok) {
        setError(json.error || "Confirm failed");
        return;
      }
      if (json.draft) {
        const channel = channels.find((c) => c.id === json.draft!.channelId);
        if (channel) {
          const applied = applyClassChannelDraftToErp(json.draft, channel);
          if (applied.ok) {
            await fetch("/api/wa/class-channel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "mark_applied",
                draftId: json.draft.id,
              }),
            });
          }
        }
      }
      await refresh();
      const bc = json.broadcast;
      flash(
        `Published · WA ${bc?.sent ?? 0} sent${bc?.stub ? `, ${bc.stub} stub` : ""} · ERP updated`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelDraft(id: string) {
    setBusy(true);
    try {
      await fetch("/api/wa/class-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", draftId: id }),
      });
      await refresh();
      flash("Draft cancelled");
    } finally {
      setBusy(false);
    }
  }

  async function createOfficeDraft() {
    if (!selectedChannelId || !draftTitle.trim()) {
      setError("Pick a class channel and enter a title");
      return;
    }
    setBusy(true);
    try {
      const sub = subjects.find((s) => s.id === draftSubjectId);
      const res = await fetch("/api/wa/class-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_draft",
          channelId: selectedChannelId,
          kind: draftKind,
          title: draftTitle,
          body: draftBody || draftTitle,
          subjectId: draftSubjectId,
          subjectName: sub?.nameEn || "",
          by: session.fullName,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Could not create draft");
        return;
      }
      setDraftTitle("");
      setDraftBody("");
      await refresh();
      flash("Draft created — confirm to publish + WhatsApp");
    } finally {
      setBusy(false);
    }
  }

  const selected = channels.find((c) => c.id === selectedChannelId);
  const pending = drafts.filter((d) => d.status === "pending");

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4">
        <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
          Class WhatsApp channels
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          ERP-managed class rooms (not Meta groups). Class teachers and subject
          teachers are auto-added from Staff → Duties; parents from the SIS
          roster. Teachers WhatsApp the school number; after YES the message
          fills Homework / Notices and broadcasts to the class.
        </p>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          Outbound API:{" "}
          <span className={configured ? "text-[#15803d]" : "text-[#b42318]"}>
            {configured ? "configured" : "stub / not configured"}
          </span>
          {help ? ` · ${help}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={btnOutline}
            disabled={busy}
            onClick={() => void syncMembers()}
          >
            Rebuild membership
          </button>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-[rgba(32,48,80,0.05)] p-3 text-[11px] leading-relaxed text-[var(--brand-deep)]">
{`Teacher examples:
HW 8A Maths: Ex 4.1 Q1-10 Due: 2026-07-21
NOTICE 8A: Bring art kit tomorrow
HOLIDAY: 15 Aug Independence Day
EXAM 8A Maths on 2026-07-25
TIMING: Assembly 7:45 AM
Then reply: YES`}
        </pre>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(22,163,74,0.12)] px-3 py-2 text-sm text-[#15803d]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[rgba(180,35,24,0.1)] px-3 py-2 text-sm text-[#b42318]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Channels ({channels.length})
          </h3>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {channels.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No sections yet — add classes in Masters, then Rebuild.
              </p>
            ) : (
              channels.map((c) => {
                const parents = c.members.filter((m) => m.role === "parent")
                  .length;
                const teachers = c.members.filter((m) => m.role !== "parent")
                  .length;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedChannelId(c.id)}
                    className={`block w-full rounded-xl border px-3 py-2 text-left ${
                      selectedChannelId === c.id
                        ? "border-[var(--brand-deep)] bg-[rgba(32,48,80,0.06)]"
                        : "border-[rgba(32,48,80,0.1)] bg-white"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">
                      {c.label}
                    </p>
                    <p className="text-[11px] text-[var(--muted)]">
                      {teachers} teachers · {parents} parents
                    </p>
                  </button>
                );
              })
            )}
          </div>
          {selected ? (
            <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
              <p className="text-xs font-bold text-[var(--brand-deep)]">
                Members · {selected.label}
              </p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px]">
                {selected.members.map((m, i) => (
                  <li key={`${m.mobile}-${i}`} className="flex justify-between gap-2">
                    <span>
                      <span className="font-semibold uppercase text-[var(--muted)]">
                        {m.role.replace("_", " ")}
                      </span>{" "}
                      {m.name}
                    </span>
                    <span className="text-[var(--muted)]">{m.mobile}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
            Pending drafts ({pending.length})
          </h3>
          {pending.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No pending drafts. Teachers WhatsApp posts, or create one below.
            </p>
          ) : (
            pending.map((d) => {
              const ch = channels.find((c) => c.id === d.channelId);
              return (
                <article
                  key={d.id}
                  className="rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(197,160,40,0.08)] p-3"
                >
                  <p className="text-[10px] font-bold uppercase text-[#8a6d12]">
                    {d.kind} · {ch?.label || d.channelId}
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">
                    {d.title}
                  </h4>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">
                    {d.body}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">
                    By {d.createdByName}
                    {d.subjectName ? ` · ${d.subjectName}` : ""}
                    {d.dueAt ? ` · due ${d.dueAt}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btn}
                      disabled={busy}
                      onClick={() => void confirmDraft(d.id)}
                    >
                      Confirm · publish + WA
                    </button>
                    <button
                      type="button"
                      className={btnOutline}
                      disabled={busy}
                      onClick={() => void cancelDraft(d.id)}
                    >
                      Cancel
                    </button>
                  </div>
                </article>
              );
            })
          )}

          <div className="space-y-2 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
            <p className="text-xs font-bold text-[var(--brand-deep)]">
              Office draft (optional)
            </p>
            <select
              className={field}
              value={selectedChannelId}
              onChange={(e) => setSelectedChannelId(e.target.value)}
            >
              <option value="">Select class channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              className={field}
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value)}
            >
              <option value="homework">Homework</option>
              <option value="classwork">Classwork</option>
              <option value="notice">Notice</option>
              <option value="holiday">Holiday</option>
              <option value="exam">Exam</option>
              <option value="timing">Timing</option>
            </select>
            {(draftKind === "homework" || draftKind === "classwork") && (
              <select
                className={field}
                value={draftSubjectId}
                onChange={(e) => setDraftSubjectId(e.target.value)}
              >
                <option value="">Subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameEn}
                  </option>
                ))}
              </select>
            )}
            <input
              className={field}
              placeholder="Title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
            <textarea
              className={`${field} min-h-[72px]`}
              placeholder="Body"
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
            />
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => void createOfficeDraft()}
            >
              Create draft
            </button>
          </div>
        </section>
      </div>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
          Recent teacher threads
        </h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {threads.slice(0, 6).map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3"
            >
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                {t.staffName} · {t.mobile}
              </p>
              <p className="text-[10px] text-[var(--muted)]">
                {new Date(t.updatedAt).toLocaleString()}
              </p>
              <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[11px]">
                {t.messages.slice(-4).map((m, i) => (
                  <li key={`${t.id}-${i}`}>
                    <span className="font-semibold text-[var(--muted)]">
                      {m.role}:
                    </span>{" "}
                    {m.text.slice(0, 120)}
                    {m.text.length > 120 ? "…" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {threads.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No teacher WhatsApp traffic yet for {TENANT.nameDisplay}.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
