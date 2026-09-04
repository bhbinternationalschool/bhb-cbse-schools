"use client";

import { useCallback, useEffect, useState } from "react";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type Req = {
  id: string;
  studentName: string;
  classLabel: string;
  contactName: string;
  contactMobile: string;
  pickupAddress: string;
  locality: string;
  landmark: string;
  preferredStop: string;
  note: string;
  status: "open" | "contacted" | "assigned" | "declined";
  handlingNote: string;
  handledBy: string;
  createdAt: string;
};

const STATUS_LABEL: Record<Req["status"], string> = {
  open: "New",
  contacted: "Contacted",
  assigned: "Assigned",
  declined: "Declined",
};

/**
 * Transport requests from the parent app. Read from the server, not the
 * desk slice — the same rows the staff app shows — so the office and the
 * in-charge on the road see one queue. Moving a request to "assigned" is
 * the bookkeeping; the rider itself is still created on the Riders tab.
 */
export function TransportRequestsPanel({ onFlash }: { onFlash?: (msg: string) => void }) {
  const [filter, setFilter] = useState<"active" | "assigned" | "declined">("active");
  const [rows, setRows] = useState<Req[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/transport/requests?status=${filter}`);
      const json = (await res.json()) as { ok: boolean; data?: { requests: Req[] }; error?: { message?: string } };
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Could not load requests");
      setRows(json.data?.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load requests");
      setRows(null);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(id: string, status: Req["status"]) {
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/transport/requests/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: notes[id] || "" }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Could not update");
      onFlash?.(`Marked ${STATUS_LABEL[status].toLowerCase()}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Transport requests from parents</h3>
        <div className="ml-auto flex gap-1 rounded-lg bg-[rgba(32,48,80,0.06)] p-1">
          {(["active", "assigned", "declined"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-2 py-1 text-[11px] font-bold ${filter === f ? "bg-white text-[var(--brand-deep)] shadow-sm" : "text-[var(--muted)]"}`}
            >
              {f === "active" ? "New & contacted" : STATUS_LABEL[f]}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {rows === null && !error ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}
      {rows && rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing here. A parent&apos;s request from the app appears the moment it is sent.</p>
      ) : null}
      {rows?.map((r) => (
        <div key={r.id} className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-[var(--brand-deep)]">{r.studentName}</span>
            <span className="text-xs text-[var(--muted)]">{r.classLabel}</span>
            <span className="text-xs text-[var(--muted)]">{new Date(r.createdAt).toLocaleString("en-IN")}</span>
            <span className="ml-auto rounded-full bg-[rgba(32,48,80,0.08)] px-2 py-0.5 text-[11px] font-bold">{STATUS_LABEL[r.status]}</span>
          </div>
          <p className="mt-1 text-sm">
            <span className="text-[var(--muted)]">Pickup: </span>
            {[r.pickupAddress, r.locality, r.landmark].filter(Boolean).join(", ")}
            {r.preferredStop ? <span className="text-[var(--muted)]"> · prefers stop {r.preferredStop}</span> : null}
          </p>
          <p className="text-sm">
            <span className="text-[var(--muted)]">Contact: </span>
            {r.contactName}
            {r.contactMobile ? (
              <>
                {" · "}
                <a className="text-blue-700 underline" href={`tel:${r.contactMobile}`}>{r.contactMobile}</a>
                {" · "}
                <a className="text-blue-700 underline" href={`https://wa.me/91${r.contactMobile.replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noreferrer">WhatsApp</a>
              </>
            ) : null}
          </p>
          {r.note ? <p className="mt-1 text-sm italic text-[var(--muted)]">“{r.note}”</p> : null}
          {r.handlingNote ? <p className="mt-1 text-xs text-[var(--muted)]">Office: {r.handlingNote} — {r.handledBy}</p> : null}
          {r.status === "open" || r.status === "contacted" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className={`${field} max-w-xs`}
                placeholder="Note for the family / the file"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              />
              {r.status === "open" ? (
                <button type="button" className={btnOutline} disabled={busy === r.id} onClick={() => move(r.id, "contacted")}>Contacted</button>
              ) : null}
              <button type="button" className={btn} disabled={busy === r.id} onClick={() => move(r.id, "assigned")}>Assigned</button>
              <button type="button" className={btnOutline} disabled={busy === r.id} onClick={() => move(r.id, "declined")}>Decline</button>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
