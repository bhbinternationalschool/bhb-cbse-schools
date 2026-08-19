"use client";

/**
 * Admissions → Knowledge base — the approved facts the admissions bot and
 * chat widget may tell a prospective parent. Entries are typed (or copied
 * verbatim from the published fee masters), marked public-safe, synced to
 * the AI index on demand, and tested here with "Ask as a parent". The
 * "Unanswered" list is what parents asked that the KB could not answer.
 */

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  ADMISSIONS_KB_KINDS,
  ADMISSIONS_KB_MAX_BODY,
  kbEntriesFromFeeMasters,
  kbEntryIsLive,
  kbKindLabel,
  loadAdmissionsKb,
  mergeFeeEntries,
  removeKbEntry,
  saveAdmissionsKb,
  upsertKbEntry,
  type AdmissionsKbKind,
  type AdmissionsKbState,
} from "@/lib/admissionsKb";
import { currentAcademicYearCode, type MastersState } from "@/lib/masters";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";

const inp = "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm";

type Gap = { id: string; question: string; channel: string; at: string; count: number };

type Draft = {
  id: string;
  kind: AdmissionsKbKind;
  title: string;
  body: string;
  classScope: string;
  validTill: string;
  publicSafe: boolean;
};

const blank = (): Draft => ({ id: "", kind: "faq", title: "", body: "", classScope: "", validTill: "", publicSafe: true });

export function AdmissionsKbPanel({ masters, canEdit, by }: { masters: MastersState | null; canEdit: boolean; by: string }) {
  const [state, setState] = useState<AdmissionsKbState>(() => loadAdmissionsKb());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState<AdmissionsKbKind | "">("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sync" | "ask" | null>(null);
  const [server, setServer] = useState<{ indexed: number; gaps: Gap[]; configured: boolean } | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ grounded: boolean; reply: string; sources: { title: string }[]; matches: number } | null>(null);

  useModuleStateHydration("admissions_kb", () => setState(loadAdmissionsKb()));
  useEffect(() => {
    const t = notice ? window.setTimeout(() => setNotice(null), 3000) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [notice]);

  async function refreshServer() {
    try {
      const res = await fetch("/api/ai/admissions-answer");
      const j = (await res.json()) as { ok?: boolean; indexed?: number; gaps?: Gap[]; configured?: boolean };
      if (res.ok && j.ok) setServer({ indexed: j.indexed ?? 0, gaps: j.gaps ?? [], configured: !!j.configured });
    } catch {
      /* offline */
    }
  }
  useEffect(() => {
    void refreshServer();
  }, []);

  const live = useMemo(() => state.entries.filter((e) => kbEntryIsLive(e)).length, [state.entries]);
  const rows = useMemo(
    () =>
      state.entries
        .filter((e) => !filter || e.kind === filter)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)),
    [state.entries, filter],
  );

  function persist(next: AdmissionsKbState, msg: string) {
    const saved = saveAdmissionsKb(next);
    setState(saved);
    setNotice(msg);
  }

  function saveDraft() {
    if (!draft) return;
    const r = upsertKbEntry(state, { ...draft, id: draft.id || undefined, by });
    if (!r.ok) return setError(r.error);
    setError(null);
    persist(r.state, draft.id ? "Entry updated — Sync to AI to publish the change" : "Entry added — Sync to AI to publish");
    setDraft(null);
  }

  function importFees() {
    if (!masters) return;
    const ay = currentAcademicYearCode(masters);
    const fees = kbEntriesFromFeeMasters(masters, ay, by);
    if (fees.length === 0) {
      setError(`No published NEW-admission fee structure for ${ay} — publish it under Fees first; nothing was invented.`);
      return;
    }
    setError(null);
    persist(mergeFeeEntries(state, fees), `${fees.length} fee entr${fees.length === 1 ? "y" : "ies"} copied from fee masters (${ay})`);
  }

  async function sync() {
    if (busy) return;
    setBusy("sync");
    setError(null);
    try {
      // The index is built from the server copy — push what we see first so
      // a save a moment ago is what gets indexed (same endpoint the
      // background sync uses; harmless if it already ran).
      const cur = loadAdmissionsKb();
      const pushed = await fetch("/api/school-data/module-state/admissions_kb", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: cur }),
      });
      if (!pushed.ok) {
        setError(`Could not save to server before indexing (HTTP ${pushed.status})`);
        return;
      }
      const res = await fetch("/api/ai/kb-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "admissions_kb" }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; indexed?: number; skipped?: number; removed?: number };
      if (!res.ok || !j.ok) {
        setError(j.error || "Sync failed");
        return;
      }
      setState((s) => saveAdmissionsKb({ ...s, lastSyncedAt: new Date().toISOString() }));
      setNotice(`Synced: ${j.indexed} indexed · ${j.skipped} skipped · ${j.removed} removed`);
      void refreshServer();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function ask() {
    if (busy || question.trim().length < 3) return;
    setBusy("ask");
    setAnswer(null);
    try {
      const res = await fetch("/api/ai/admissions-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, staffTest: true }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; grounded?: boolean; reply?: string; sources?: { title: string }[]; matches?: number };
      if (!res.ok || !j.ok) return setError(j.error || "Could not ask");
      setAnswer({ grounded: !!j.grounded, reply: j.reply || "", sources: j.sources ?? [], matches: j.matches ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not ask");
    } finally {
      setBusy(null);
    }
  }

  async function dismissGap(id: string) {
    await fetch(`/api/ai/admissions-answer?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setServer((s) => (s ? { ...s, gaps: s.gaps.filter((g) => g.id !== id) } : s));
  }

  function answerGap(g: Gap) {
    setDraft({ ...blank(), kind: "faq", title: g.question.slice(0, 160) });
    void dismissGap(g.id);
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
        <div>
          <p className="font-semibold">Admissions knowledge base</p>
          <p className="text-xs text-[var(--muted)]">
            {state.entries.length} entries · {live} live for parents · {server ? `${server.indexed} in the AI index` : "index: —"}
            {state.lastSyncedAt ? ` · last synced ${new Date(state.lastSyncedAt).toLocaleString("en-IN")}` : " · never synced"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit ? (
            <>
              <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={() => setDraft(blank())}>
                + Entry
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                onClick={importFees}
                title="Copies the published NEW-admission fee lines per class, verbatim. Replaces earlier fee-master entries only."
              >
                Import fees from masters
              </button>
              <button
                type="button"
                disabled={busy === "sync"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                onClick={() => void sync()}
                title="Embeds every live entry so the WhatsApp bot and chat widget can answer from it"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {busy === "sync" ? "Syncing…" : "Sync to AI"}
              </button>
            </>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Only what is written here reaches a prospective parent. The bot never uses general knowledge: a question the entries do not
        answer gets the fixed “reply HUMAN” handoff and appears below under Unanswered. Expired (valid-till past) and non-public
        entries are kept but not indexed.
      </p>
      {notice ? <p className="rounded-lg bg-[var(--success-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-[var(--danger)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

      {draft ? (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs text-[var(--muted)]">
              Kind
              <select className={`${inp} mt-0.5`} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AdmissionsKbKind })}>
                {ADMISSIONS_KB_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)] sm:col-span-2">
              Title
              <input className={`${inp} mt-0.5`} maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Documents for Class 1 admission" />
            </label>
          </div>
          <p className="text-[11px] text-[var(--muted)]">{ADMISSIONS_KB_KINDS.find((k) => k.id === draft.kind)?.hint}</p>
          <label className="block text-xs text-[var(--muted)]">
            Approved text ({draft.body.length}/{ADMISSIONS_KB_MAX_BODY})
            <textarea className={`${inp} mt-0.5 min-h-[7rem]`} maxLength={ADMISSIONS_KB_MAX_BODY} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs text-[var(--muted)]">
              Applies to (classes)
              <input className={`${inp} mt-0.5`} maxLength={80} value={draft.classScope} onChange={(e) => setDraft({ ...draft, classScope: e.target.value })} placeholder="blank = all" />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Valid till
              <input type="date" className={`${inp} mt-0.5`} value={draft.validTill} onChange={(e) => setDraft({ ...draft, validTill: e.target.value })} />
            </label>
            <label className="mt-5 inline-flex items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.publicSafe} onChange={(e) => setDraft({ ...draft, publicSafe: e.target.checked })} />
              Safe to tell any parent
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]" onClick={saveDraft}>
              Save entry
            </button>
            <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--muted)]">Show:</span>
        <button type="button" className={`rounded-full border px-2 py-0.5 ${!filter ? "border-[var(--brand-deep)] font-semibold" : "border-[var(--border)]"}`} onClick={() => setFilter("")}>
          All
        </button>
        {ADMISSIONS_KB_KINDS.map((k) => {
          const n = state.entries.filter((e) => e.kind === k.id).length;
          if (!n) return null;
          return (
            <button key={k.id} type="button" className={`rounded-full border px-2 py-0.5 ${filter === k.id ? "border-[var(--brand-deep)] font-semibold" : "border-[var(--border)]"}`} onClick={() => setFilter(k.id)}>
              {k.label} · {n}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          No entries yet. Start with “Import fees from masters”, then add the admission process, documents and dates.
        </p>
      ) : (
        <ErpTableShell>
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-2 py-2 text-left">Title</th>
                <th className="px-2 py-2 text-left">Text</th>
                <th className="px-2 py-2 text-left">Classes</th>
                <th className="px-2 py-2 text-left">Valid till</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {rows.map((e) => {
                const isLive = kbEntryIsLive(e);
                return (
                  <tr key={e.id} className="align-top text-xs">
                    <td className="px-3 py-2 whitespace-nowrap">{kbKindLabel(e.kind)}</td>
                    <td className="px-2 py-2 font-semibold">{e.title}</td>
                    <td className="max-w-md px-2 py-2 whitespace-pre-wrap text-[var(--muted)]">{e.body.length > 220 ? `${e.body.slice(0, 220)}…` : e.body}</td>
                    <td className="px-2 py-2">{e.classScope || "all"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{e.validTill || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {isLive ? (
                        <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 font-semibold text-[var(--success)]">live</span>
                      ) : !e.publicSafe ? (
                        <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 font-semibold text-[var(--warning)]">staff only</span>
                      ) : (
                        <span className="rounded-full bg-[var(--danger)]/10 px-2 py-0.5 font-semibold text-[var(--danger)]">expired</span>
                      )}
                      {e.source === "fee_masters" ? <span className="ml-1 text-[10px] text-[var(--muted)]">from masters</span> : null}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {canEdit ? (
                        <>
                          <button type="button" className="text-[var(--brand-deep)] underline" onClick={() => setDraft({ id: e.id, kind: e.kind, title: e.title, body: e.body, classScope: e.classScope, validTill: e.validTill, publicSafe: e.publicSafe })}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ml-2 text-[var(--danger)] underline"
                            onClick={() => {
                              if (window.confirm("Remove this entry? Sync to AI afterwards to drop it from the index.")) persist(removeKbEntry(state, e.id), "Entry removed — Sync to AI to publish");
                            }}
                          >
                            Remove
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
          <p className="text-sm font-semibold">Ask as a parent</p>
          <p className="text-[11px] text-[var(--muted)]">Exactly what the bot would reply from the current AI index. Test questions are not logged as gaps.</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <input className={inp} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What documents are needed for Class 1?" />
            <button type="submit" disabled={busy === "ask"} className="shrink-0 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
              {busy === "ask" ? "…" : "Ask"}
            </button>
          </form>
          {answer ? (
            <div className={`rounded-lg border px-3 py-2 text-xs ${answer.grounded ? "border-[var(--success)]" : "border-[var(--warning)]"}`}>
              <p className="mb-1 font-semibold">
                {answer.grounded ? `Grounded · ${answer.sources.length} source${answer.sources.length === 1 ? "" : "s"}` : `Not answerable from KB · ${answer.matches} near match${answer.matches === 1 ? "" : "es"}`}
              </p>
              <p className="whitespace-pre-wrap">{answer.reply}</p>
              {answer.sources.length ? <p className="mt-1 text-[10px] text-[var(--muted)]">{answer.sources.map((s) => s.title).join(" · ")}</p> : null}
            </div>
          ) : null}
          {server && !server.configured ? <p className="text-[11px] text-[var(--danger)]">AI engine not configured on the server.</p> : null}
        </div>
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
          <p className="text-sm font-semibold">Unanswered questions {server ? `(${server.gaps.length})` : ""}</p>
          <p className="text-[11px] text-[var(--muted)]">Parents asked these on WhatsApp / chat and the KB had no answer. Turn each into an entry, or dismiss.</p>
          {!server || server.gaps.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">Nothing pending.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
              {server.gaps.map((g) => (
                <li key={g.id} className="flex items-start gap-2 rounded-lg border border-[var(--border)] px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{g.question}</p>
                    <p className="text-[10px] text-[var(--muted)]">
                      {g.channel} · ×{g.count} · {g.at ? new Date(g.at).toLocaleString("en-IN") : ""}
                    </p>
                  </div>
                  {canEdit ? (
                    <>
                      <button type="button" className="shrink-0 text-[var(--brand-deep)] underline" onClick={() => answerGap(g)}>
                        Answer
                      </button>
                      <button type="button" className="shrink-0 text-[var(--muted)] underline" onClick={() => void dismissGap(g.id)}>
                        Dismiss
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
