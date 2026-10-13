"use client";

import { useCallback, useEffect, useState } from "react";

type Field = { key: string; label: string; from: string; to: string };
type Req = {
  id: string;
  staffId: string;
  staffName: string;
  fields: Field[];
  status: string;
  createdAt: string;
  decidedAt: string;
  decidedBy: string;
  note: string;
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/**
 * Staff → Requests → Profile changes (director, 13 Oct 2026). A member of
 * staff changed an identity, bank or statutory detail in the staff app; it
 * changes on their record only when the office approves it here. Contact
 * details they change save at once and never come here.
 */
export function ProfileChangeRequestsCard() {
  const [pending, setPending] = useState<Req[] | null>(null);
  const [decided, setDecided] = useState<Req[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/staff/profile-requests", { cache: "no-store" });
      const body = (await res.json()) as { ok: boolean; error?: string; pending: Req[]; decided: Req[] };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPending(body.pending);
      setDecided(body.decided);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the requests");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(r: Req, decision: "approve" | "reject") {
    const note = (notes[r.id] || "").trim();
    if (decision === "reject" && !note) {
      setMsg({ ok: false, text: "Write why it is rejected — the staff member sees it." });
      return;
    }
    if (decision === "approve" && !window.confirm(`Change ${r.staffName}'s ${r.fields.map((f) => f.label).join(", ")} on their record?`)) return;
    setBusy(r.id);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/staff/profile-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, decision, note }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: decision === "approve" ? `${r.staffName}'s record is updated.` : `Rejected — ${r.staffName} sees your note in the app.` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Not saved — try again." });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="Staff profile change requests">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Profile changes to approve{pending?.length ? ` (${pending.length})` : ""}
        </h3>
        <p className="text-[11px] text-[var(--muted)]">From the staff app · identity, bank and PF/ESIC details</p>
      </div>
      {err ? <p className="mt-2 text-xs text-[var(--danger)]">{err}</p> : null}
      {msg ? <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{msg.text}</p> : null}
      {pending === null && !err ? <p className="mt-2 text-xs text-[var(--muted)]">Loading…</p> : null}
      {pending && pending.length === 0 ? <p className="mt-2 text-xs text-[var(--muted)]">Nothing waiting.</p> : null}
      {pending?.map((r) => (
        <div key={r.id} className="mt-3 rounded-lg border border-[var(--border)] p-3">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {r.staffName} <span className="text-[11px] font-normal text-[var(--muted)]">· {when(r.createdAt)}</span>
          </p>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="py-1 pr-2 font-medium">Field</th>
                <th className="py-1 pr-2 font-medium">Now</th>
                <th className="py-1 font-medium">Asked for</th>
              </tr>
            </thead>
            <tbody>
              {r.fields.map((f) => (
                <tr key={f.key} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-2">{f.label}</td>
                  <td className="py-1 pr-2 text-[var(--muted)]">{f.from || "—"}</td>
                  <td className="py-1 font-semibold text-[var(--brand-deep)]">{f.to || "(clear)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="field !py-1.5 text-xs"
              placeholder="Note (needed to reject)"
              value={notes[r.id] || ""}
              onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
            />
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => void decide(r, "approve")}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => void decide(r, "reject")}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--danger)] disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
      {decided.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">Recently decided ({decided.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {decided.map((r) => (
              <li key={r.id}>
                <strong>{r.staffName}</strong> · {r.fields.map((f) => f.label).join(", ")} · {r.status}
                {r.decidedBy ? ` by ${r.decidedBy}` : ""} {when(r.decidedAt)}
                {r.note ? ` — ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
