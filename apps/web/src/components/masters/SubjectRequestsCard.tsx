"use client";

import { useCallback, useEffect, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";
import type { Subject } from "@/lib/foundationMasters";
import { suggestSubjectCode, type SubjectRequest } from "@/lib/subjectRequests";

/**
 * Masters → Subjects: what teachers have asked to change from the staff app
 * (lib/subjectRequests). Approve applies it to Masters on the server, then
 * this screen re-reads Masters so the next save starts from the new
 * version. Shown only when something is waiting or was decided recently.
 */

const ACTION_LABEL: Record<SubjectRequest["action"], string> = {
  add: "Add to class",
  remove: "Remove from class",
  new: "New subject",
};

const istDateTime = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

export function SubjectRequestsCard({
  subjects,
  canEdit,
  onMastersChanged,
}: {
  subjects: Subject[];
  canEdit: boolean;
  onMastersChanged: () => void;
}) {
  const [pending, setPending] = useState<SubjectRequest[]>([]);
  const [recent, setRecent] = useState<SubjectRequest[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/masters/subject-requests", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; pending?: SubjectRequest[]; recent?: SubjectRequest[]; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `Could not load (${res.status})`);
      setPending(j.pending ?? []);
      setRecent(j.recent ?? []);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load teachers' requests" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(r: SubjectRequest, decision: "approve" | "reject") {
    setBusy(r.id);
    setMsg(null);
    try {
      const res = await fetch("/api/masters/subject-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, decision, newCode: codes[r.id] ?? suggestSubjectCode(subjects, r.subjectName) }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; summary?: string; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || `Failed (${res.status})`);
      setMsg({ ok: true, text: j.summary || "Done" });
      if (decision === "approve") {
        // Masters changed on the server: re-read it before anything else is
        // saved from this screen, or the next save would be refused as stale.
        const [{ resetDeskHydrated }, { ensureMastersHydrated }] = await Promise.all([
          import("@/lib/deskHydrateGuard"),
          import("@/lib/mastersPersistence"),
        ]);
        resetDeskHydrated("masters");
        await ensureMastersHydrated();
        onMastersChanged();
      }
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy("");
    }
  }

  if (!pending.length && !recent.length && !msg) return null;

  return (
    <section className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3" aria-label="Teachers' subject requests">
      <div>
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Requests from teachers {pending.length ? <span className="text-[var(--tone-amber)]">({pending.length} waiting)</span> : null}
        </h3>
        <p className="text-[11px] text-[var(--muted)]">
          Teachers ask from the staff app to change what their class studies. Nothing changes until you approve; approving updates the class&apos;s subjects here.
        </p>
      </div>
      {msg ? <p className={`text-xs ${msg.ok ? "text-[var(--tone-teal)]" : "text-[var(--danger)]"}`}>{msg.text}</p> : null}
      {pending.length ? (
        <ul className="space-y-2">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[12px]">
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-[var(--ink)]">
                  {ACTION_LABEL[r.action]}: {r.subjectName} · {r.className}
                </p>
                <p className="text-[11px] text-[var(--muted)]">
                  {r.staffName} · {istDateTime(r.createdAt)}
                </p>
                {r.reason ? <p className="text-[11px] text-[var(--ink)]">&ldquo;{r.reason}&rdquo;</p> : null}
                {r.action === "new" && canEdit ? (
                  <label className="mt-1 flex items-center gap-1.5 text-[11px]">
                    <span className="text-[var(--muted)]">Code</span>
                    <input
                      className={`${field} h-7 w-44 py-0 text-[11px]`}
                      value={codes[r.id] ?? suggestSubjectCode(subjects, r.subjectName)}
                      onChange={(e) => setCodes((c) => ({ ...c, [r.id]: e.target.value }))}
                      aria-label="Code for the new subject"
                    />
                  </label>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex gap-1.5">
                  <button type="button" className={btn} disabled={busy === r.id} onClick={() => void decide(r, "approve")}>
                    {busy === r.id ? "Saving…" : "Approve"}
                  </button>
                  <button type="button" className={btnOutline} disabled={busy === r.id} onClick={() => void decide(r, "reject")}>
                    Decline
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {recent.length ? (
        <details className="text-[11px]">
          <summary className="cursor-pointer font-semibold text-[var(--muted)]">Decided recently ({recent.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {recent.map((r) => (
              <li key={r.id} className="text-[var(--muted)]">
                {r.status === "approved" ? "✅" : r.status === "rejected" ? "✖" : "↩"} {ACTION_LABEL[r.action]}: {r.subjectName} · {r.className} — {r.staffName}
                {r.decidedBy && r.status !== "withdrawn" ? ` · ${r.status} by ${r.decidedBy}` : r.status === "withdrawn" ? " · withdrawn" : ""} {istDateTime(r.decidedAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
