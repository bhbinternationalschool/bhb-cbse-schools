"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Pending staff leave, decided from the dashboard's "Leave queue" card
 * (director, 6 Oct 2026: "give option in dashboard to approve or reject when
 * click on leave request"). Reads and decides through the same server routes
 * as the staff app's approvals screen, so the approver check, "not your own
 * leave", the audit row and the push to the staff member all apply.
 */
type PendingLeave = {
  id: string;
  staffName: string;
  typeName: string;
  typeCode: string;
  fromDate: string;
  toDate: string;
  days: number;
  halfDay: boolean;
  reason: string;
  status: string;
  statusLabel: string;
  appliedAt: string;
};

function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function StaffLeaveDecideList() {
  const [rows, setRows] = useState<PendingLeave[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/staff/leave/approvals?status=pending", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; data?: { requests?: PendingLeave[] }; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message || "Could not load leave requests.");
        setRows([]);
        return;
      }
      setRows(body.data?.requests ?? []);
    } catch {
      setError("Could not load leave requests.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(r: PendingLeave, approve: boolean) {
    if (!approve && !note.trim()) {
      setError("Write a short reason for the staff member before rejecting.");
      return;
    }
    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch("/api/v1/staff/leave/decide", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, approve, note: approve ? "" : note.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message || "The decision was not saved. Try again.");
        return;
      }
      setDone(`${r.staffName}: leave ${approve ? "approved" : "rejected"}.`);
      setRejecting(null);
      setNote("");
      await load();
    } catch {
      setError("The decision was not saved. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null) {
    return <p className="py-6 text-center text-base text-[var(--muted)]">Loading leave requests…</p>;
  }

  return (
    <div className="space-y-3">
      {done ? (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-900">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)]/70 px-4 py-8 text-center text-base text-[var(--muted)]">
          No leave request is waiting for a decision.
        </p>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-lg font-bold text-[var(--brand-deep)]">{r.staffName}</p>
              <span className="text-sm font-semibold text-[var(--muted)]">{r.statusLabel}</span>
            </div>
            <p className="mt-1 text-base text-[var(--foreground)]">
              {r.typeName || r.typeCode} ·{" "}
              {r.fromDate === r.toDate
                ? dateLabel(r.fromDate)
                : `${dateLabel(r.fromDate)} – ${dateLabel(r.toDate)}`}{" "}
              · {r.halfDay ? "Half day (0.5)" : `${r.days} day${r.days === 1 ? "" : "s"}`}
            </p>
            {r.reason ? (
              <p className="mt-1 text-sm text-[var(--muted)]">“{r.reason}”</p>
            ) : null}
            {rejecting === r.id ? (
              <div className="mt-3 space-y-2">
                <label className="block text-sm font-semibold text-[var(--brand-deep)]" htmlFor={`rej-${r.id}`}>
                  Reason for rejecting (the staff member sees this)
                </label>
                <textarea
                  id={`rej-${r.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={300}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-base"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busyId === r.id}
                    onClick={() => void decide(r, false)}
                  >
                    <X className="h-4 w-4" />
                    Reject leave
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyId === r.id}
                    onClick={() => {
                      setRejecting(null);
                      setNote("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" disabled={busyId === r.id} onClick={() => void decide(r, true)}>
                  <Check className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId === r.id}
                  onClick={() => {
                    setRejecting(r.id);
                    setNote("");
                    setError(null);
                  }}
                >
                  <X className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
