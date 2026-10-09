"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb } from "lucide-react";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import type { ModuleRequest, ModuleRequestStatus, StuckSignal } from "@/lib/moduleRequests";

const STATUS_LABEL: Record<ModuleRequestStatus, string> = {
  new: "New",
  approved: "Approved — to build",
  rejected: "Rejected",
  built: "Built",
};

const STATUS_TONE: Record<ModuleRequestStatus, string> = {
  new: "bg-[var(--warning-soft)] text-[var(--warning)]",
  approved: "bg-[var(--success-soft)] text-[var(--success)]",
  rejected: "bg-[var(--surface-sunken)] text-[var(--muted)]",
  built: "bg-[var(--surface-sunken)] text-[var(--brand-deep)]",
};

function when(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Settings → Modules → Requests: what staff asked the module guide to change,
 * and where they got stuck (director, 9 Oct 2026). Approve a request to have
 * it built exactly as the "Change" text says — edit that text first if it
 * should be built differently.
 */
export function ModuleRequestsWorkspace() {
  const [requests, setRequests] = useState<ModuleRequest[] | null>(null);
  const [stuck, setStuck] = useState<StuckSignal[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ModuleRequestStatus | "all">("new");
  const [view, setView] = useState<"requests" | "stuck">("requests");
  const [openId, setOpenId] = useState("");
  const [edits, setEdits] = useState<Record<string, { suggestion: string; directorNote: string; prUrl: string }>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/module-requests", { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean; requests?: ModuleRequest[]; stuck?: StuckSignal[]; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setRequests(body.requests ?? []);
      setStuck(body.stuck ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load requests");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, new: 0, approved: 0, rejected: 0, built: 0 };
    for (const r of requests ?? []) {
      c.all += 1;
      c[r.status] += 1;
    }
    return c;
  }, [requests]);
  const shown = (requests ?? []).filter((r) => filter === "all" || r.status === filter);

  function editOf(r: ModuleRequest) {
    return edits[r.id] ?? { suggestion: r.suggestion, directorNote: r.directorNote, prUrl: r.prUrl };
  }

  async function decide(r: ModuleRequest, status?: ModuleRequestStatus) {
    const e = editOf(r);
    setBusy(r.id);
    try {
      const res = await fetch("/api/v1/module-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, status, suggestion: e.suggestion, directorNote: e.directorNote, prUrl: e.prUrl }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) setError(body.error || `HTTP ${res.status}`);
      else await load();
    } finally {
      setBusy("");
    }
  }

  return (
    <ErpWorkspaceShell
      className="mx-auto max-w-4xl"
      title="Module requests"
      subtitle="What staff asked the module guide to change, and where they got stuck. Approve a request to have it built exactly as its “Change” text says — edit that text first if it should be built differently."
      icon={<Lightbulb className="size-6" aria-hidden />}
      error={error || null}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className={view === "requests" ? btn : btnOutline} onClick={() => setView("requests")}>
          Requests ({counts.all})
        </button>
        <button type="button" className={view === "stuck" ? btn : btnOutline} onClick={() => setView("stuck")}>
          Stuck points ({stuck.length})
        </button>
        {view === "requests" ? (
          <select className={`${field} !w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as ModuleRequestStatus | "all")}>
            <option value="new">New ({counts.new})</option>
            <option value="approved">Approved — to build ({counts.approved})</option>
            <option value="built">Built ({counts.built})</option>
            <option value="rejected">Rejected ({counts.rejected})</option>
            <option value="all">All ({counts.all})</option>
          </select>
        ) : null}
      </div>

      {requests === null && !error ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}

      {view === "requests" && requests ? (
        shown.length === 0 ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
            Nothing here. Staff send requests from the assistant on any screen (💡 Suggest a change).
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((r) => {
              const isOpen = openId === r.id;
              const e = editOf(r);
              return (
                <li key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                  <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpenId(isOpen ? "" : r.id)}>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--brand-deep)]">
                        {r.kind === "bug" ? "🐞" : r.kind === "stuck" ? "🛟" : "💡"} {r.title}
                      </span>
                      <span className="block text-xs text-[var(--muted)]">
                        {r.pageLabel || r.pathname}
                        {r.tab ? ` · ${r.tab}` : ""} · {r.byName}
                        {r.byRole ? ` (${r.byRole})` : ""} · {when(r.createdAt)}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </button>
                  {isOpen ? (
                    <div className="mt-3 space-y-2 text-sm">
                      {r.problem ? (
                        <p>
                          <span className="font-semibold">Problem: </span>
                          {r.problem}
                        </p>
                      ) : null}
                      {r.wanted ? (
                        <p>
                          <span className="font-semibold">Wanted: </span>
                          {r.wanted}
                        </p>
                      ) : null}
                      <label className="block">
                        <span className="text-xs font-semibold">Change to build (edit before approving if needed)</span>
                        <textarea
                          className={`${field} mt-1 min-h-[96px]`}
                          value={e.suggestion}
                          onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, suggestion: ev.target.value } })}
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold">Note (optional)</span>
                        <input className={`${field} mt-1`} value={e.directorNote} onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, directorNote: ev.target.value } })} />
                      </label>
                      {r.status === "approved" || r.status === "built" ? (
                        <label className="block">
                          <span className="text-xs font-semibold">Pull request link (once built)</span>
                          <input className={`${field} mt-1`} value={e.prUrl} onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, prUrl: ev.target.value } })} />
                        </label>
                      ) : null}
                      {r.transcript.length ? (
                        <details className="rounded-lg bg-[var(--surface-sunken)] p-2 text-xs">
                          <summary className="cursor-pointer font-semibold">Conversation</summary>
                          <div className="mt-1 space-y-1">
                            {r.transcript.map((t, i) => (
                              <p key={i}>
                                <span className="font-semibold">{t.role === "user" ? r.byName || "Staff" : "Guide"}: </span>
                                {t.text}
                              </p>
                            ))}
                          </div>
                        </details>
                      ) : null}
                      {r.decidedAt ? (
                        <p className="text-xs text-[var(--muted)]">
                          {STATUS_LABEL[r.status]} by {r.decidedBy} · {when(r.decidedAt)}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {r.status !== "approved" ? (
                          <button type="button" className={btn} disabled={busy === r.id} onClick={() => void decide(r, "approved")}>
                            Approve — build this
                          </button>
                        ) : null}
                        {r.status !== "rejected" ? (
                          <button type="button" className={btnOutline} disabled={busy === r.id} onClick={() => void decide(r, "rejected")}>
                            Reject
                          </button>
                        ) : null}
                        {r.status === "approved" ? (
                          <button type="button" className={btnOutline} disabled={busy === r.id} onClick={() => void decide(r, "built")}>
                            Mark built
                          </button>
                        ) : null}
                        <button type="button" className={btnOutline} disabled={busy === r.id} onClick={() => void decide(r)}>
                          Save edits
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {view === "stuck" ? (
        stuck.length === 0 ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
            No one has been stuck yet. The assistant counts an error here when someone hits it again, or twice within three minutes.
          </p>
        ) : (
          <ul className="space-y-2">
            {stuck.map((s) => (
              <li key={s.key} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
                <p className="font-semibold text-[var(--brand-deep)]">“{s.message}”</p>
                <p className="text-xs text-[var(--muted)]">
                  {s.pathname} · {s.count} time{s.count === 1 ? "" : "s"} · {s.users.length} person{s.users.length === 1 ? "" : "s"} ({s.users.slice(0, 4).join(", ")}
                  {s.users.length > 4 ? "…" : ""}) · last {when(s.lastAt)}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </ErpWorkspaceShell>
  );
}
