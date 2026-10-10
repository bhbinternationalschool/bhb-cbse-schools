"use client";

import { useCallback, useEffect, useState } from "react";
import { btn, btnOutline } from "@/components/ui/erp-ui";
import type { LinkedMobile, LinkRequest } from "@/lib/parentNumberLink";

type Req = LinkRequest & { family: string };
type Linked = LinkedMobile & { family: string };

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

/**
 * Comms → WhatsApp → Class groups: parents linking a new phone number from
 * the app (lib/parentNumberLink). Most link themselves with the code sent to
 * the family's registered phone; those without that phone ask here, and the
 * office approves with one tap — the matched family is shown.
 */
export function ParentLinksCard() {
  const [requests, setRequests] = useState<Req[] | null>(null);
  const [linked, setLinked] = useState<Linked[]>([]);
  const [err, setErr] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/comms/parent-links", { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean; requests?: Req[]; linked?: Linked[]; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setRequests(body.requests ?? []);
      setLinked(body.linked ?? []);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/v1/comms/parent-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) setErr(body.error || `HTTP ${res.status}`);
    else void load();
  }

  const open = (requests ?? []).filter((r) => r.status === "pending");
  const shown = showAll ? requests ?? [] : open;

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="Parent numbers linked from the app">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Parents linking a new number{" "}
          <span className={open.length ? "text-[var(--danger)]" : "text-[var(--success)]"}>({open.length} waiting for you)</span>
        </h3>
        <label className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show decided
        </label>
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        A parent on a phone the school doesn&apos;t have names their child (admission number or name) and date of birth in the app. With the
        family&apos;s registered phone they link it themselves by code; without it, they ask here. Approve only when the matched family is right —
        call them if unsure.
      </p>
      {err ? <p className="text-xs text-[var(--danger)]">{err}</p> : null}
      {requests === null && !err ? <p className="text-xs text-[var(--muted)]">Loading…</p> : null}
      {requests && shown.length === 0 ? <p className="text-xs text-[var(--success)]">No requests waiting.</p> : null}
      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--border)] p-3 text-sm">
            <div className="min-w-0 text-xs">
              <p className="text-sm font-semibold tabular-nums text-[var(--brand-deep)]">{r.mobile10}</p>
              <p>
                Typed: {r.childName || "—"}
                {r.admissionNo ? ` · adm ${r.admissionNo}` : ""} · born {r.dob || "—"}
                {r.className ? ` · ${r.className}` : ""}
              </p>
              {r.note ? <p className="text-[var(--muted)]">“{r.note}”</p> : null}
              <p className={r.householdId ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                {r.householdId ? `Matches: ${r.family}` : "No family matches these details — call before linking"}
              </p>
              <p className="text-[var(--muted)]">
                {when(r.createdAt)}
                {r.status !== "pending" ? ` · ${r.status} by ${r.decidedBy}` : ""}
              </p>
            </div>
            {r.status === "pending" ? (
              <div className="flex gap-2">
                <button type="button" className={btnOutline} onClick={() => (window.location.href = `tel:+91${r.mobile10}`)}>
                  Call
                </button>
                {r.householdId ? (
                  <button type="button" className={btn} onClick={() => void post({ action: "decide", id: r.id, approve: true })}>
                    Approve
                  </button>
                ) : null}
                <button type="button" className={btnOutline} onClick={() => void post({ action: "decide", id: r.id, approve: false })}>
                  Refuse
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {linked.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-[var(--brand-deep)]">Numbers linked from the app ({linked.length})</summary>
          <ul className="mt-2 space-y-1">
            {linked.map((l) => (
              <li key={l.mobile10} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1">
                <span>
                  <span className="font-semibold tabular-nums">{l.mobile10}</span> → {l.family || l.householdId} ·{" "}
                  {l.via === "office" ? `approved by ${l.by}` : l.by} · {when(l.linkedAt)}
                </span>
                <button
                  type="button"
                  className="text-[var(--danger)]"
                  onClick={() => window.confirm(`Unlink ${l.mobile10}? That phone can no longer log in.`) && void post({ action: "unlink", mobile10: l.mobile10 })}
                >
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
