"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { field } from "@/components/ui/erp-ui";
import { VoiceDictateButton } from "@/components/teaching/VoiceDictateButton";

/**
 * Complaints for a teacher (2026-09-29).
 *
 * The office desk reads and rewrites the whole complaints book in the
 * browser, which let any teacher see every family's complaints and — by
 * saving — overwrite the office's triage. A teacher's list and every change
 * now go through the server: GET /api/v1/staff/complaints (tickets about
 * their classes or assigned to them) and POST /api/v1/staff/complaints/update
 * (take up, in progress, resolve with a note). Closing, deleting and
 * assigning to someone else stay with the office; the server refuses them.
 */

type Which = "open" | "resolved";

type Row = {
  id: string;
  studentName: string;
  classLabel: string;
  raisedByName: string;
  raisedByMobile: string;
  categoryLabel: string;
  subject: string;
  description: string;
  date: string;
  status: string;
  statusLabel: string;
  sourceLabel: string;
  assignedToStaffId: string | null;
  assignedToName: string;
  assignedToMe: boolean;
  resolutionNote: string;
};

const TABS: ModuleTabItem[] = [
  { id: "open", label: "Open", tone: "amber" },
  { id: "resolved", label: "Resolved", tone: "violet" },
];

function errorText(body: unknown, status: number): string {
  const e = (body as { error?: unknown } | null)?.error;
  if (typeof e === "string" && e) return e;
  const m = (e as { message?: unknown } | undefined)?.message;
  if (typeof m === "string" && m) return m;
  return `The server said no (HTTP ${status}).`;
}

function TeacherTicket({
  row,
  busy,
  readOnly,
  onAct,
}: {
  row: Row;
  busy: boolean;
  readOnly: boolean;
  onAct: (id: string, body: { status?: string; resolutionNote?: string; takeUp?: boolean }) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const open = row.status === "open" || row.status === "assigned" || row.status === "in_progress";
  const disabled = busy || readOnly;

  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{row.subject}</span>
          <span className="ml-2 text-xs text-[var(--muted)]">
            {row.categoryLabel} · {row.date} · {row.sourceLabel}
            {row.studentName ? ` · re. ${row.studentName}` : ""}
            {row.classLabel ? ` (${row.classLabel})` : ""}
          </span>
        </div>
        <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-bold text-[var(--muted)]">
          {row.statusLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {row.raisedByName}
        {row.raisedByMobile ? ` · ${row.raisedByMobile}` : ""}
        {row.assignedToMe ? " · assigned to you" : row.assignedToName ? ` · with ${row.assignedToName}` : " · unassigned"}
      </p>
      <p className="mt-1 text-sm">{row.description}</p>

      {open ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Only an unassigned ticket can be taken up here: taking one
                that sits with a colleague is the office's call. */}
            {!row.assignedToStaffId ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                disabled={disabled}
                onClick={() => void onAct(row.id, { takeUp: true })}
              >
                Take it up
              </button>
            ) : null}
            {row.status !== "in_progress" ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                disabled={disabled}
                onClick={() => void onAct(row.id, { status: "in_progress" })}
              >
                Mark in progress
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className={`${field} !w-auto flex-1 !py-1.5 text-xs`}
              placeholder="What was done — the parent will read this"
              value={note}
              disabled={disabled}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Resolution note"
            />
            {/* 2026-09-30: teachers answer complaints from the phone, mostly in Hindi. */}
            <VoiceDictateButton title="Dictate the resolution" value={note} onChange={setNote} disabled={disabled} />
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
              disabled={disabled || !note.trim()}
              onClick={() =>
                void onAct(row.id, { status: "resolved", resolutionNote: note }).then((ok) => {
                  if (ok) setNote("");
                })
              }
            >
              Mark resolved
            </button>
          </div>
        </>
      ) : row.resolutionNote ? (
        <p className="mt-2 text-xs text-[var(--muted)]">Resolution: {row.resolutionNote}</p>
      ) : null}
    </li>
  );
}

export function TeacherComplaintsPanel({
  readOnly,
  onNotice,
  onError,
}: {
  readOnly: boolean;
  onNotice: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [which, setWhich] = useState<Which>("open");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (w: Which) => {
    try {
      const res = await fetch(`/api/v1/staff/complaints?status=${w}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: { tickets?: Row[] } } | null;
      if (!res.ok || !body?.ok || !Array.isArray(body.data?.tickets)) {
        // Unknown is not "no complaints": keep the list blank and say so.
        setRows(null);
        setLoadError(errorText(body, res.status));
        return;
      }
      setRows(body.data.tickets);
      setLoadError(null);
    } catch (e) {
      setRows(null);
      setLoadError(e instanceof Error ? e.message : "Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    setRows(null);
    void load(which);
  }, [which, load]);

  async function onAct(
    id: string,
    body: { status?: string; resolutionNote?: string; takeUp?: boolean },
  ): Promise<boolean> {
    setBusyId(id);
    onError(null);
    try {
      const res = await fetch("/api/v1/staff/complaints/update", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const out = (await res.json().catch(() => null)) as { ok?: boolean; data?: { statusLabel?: string } } | null;
      if (!res.ok || !out?.ok) {
        onError(errorText(out, res.status));
        return false;
      }
      onNotice(`Saved — ${out.data?.statusLabel?.toLowerCase() || "updated"}.`);
      return true;
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not reach the server.");
      return false;
    } finally {
      setBusyId(null);
      // Re-read either way: the server copy is the truth, and a refusal may
      // mean the ticket moved (the office closed or reassigned it).
      void load(which);
    }
  }

  return (
    <div className="space-y-4">
      <ModuleTabs value={which} onChange={(id) => setWhich(id as Which)} items={TABS} />
      <p className="text-xs text-[var(--muted)]">
        Complaints about your classes, or assigned to you. The office assigns, closes and removes tickets.
      </p>
      {loadError ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-6 text-center text-sm text-[var(--danger)]">
          Could not load your complaints: {loadError}
        </p>
      ) : rows === null ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          {which === "open" ? "No open complaints for your classes." : "No resolved complaints for your classes."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <TeacherTicket key={r.id} row={r} busy={busyId === r.id} readOnly={readOnly} onAct={onAct} />
          ))}
        </ul>
      )}
    </div>
  );
}
