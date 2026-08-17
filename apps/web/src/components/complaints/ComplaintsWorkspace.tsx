"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { field } from "@/components/ui/erp-ui";
import { loadMasters, type MastersState } from "@/lib/masters";
import { teacherLabel } from "@/lib/timetable";
import { loadSis, type SisState } from "@/lib/sis";
import {
  assignTicket,
  complaintCategoryLabel,
  complaintSourceLabel,
  complaintStatusLabel,
  deleteTicket,
  emptyComplaintState,
  loadComplaints,
  mergeIncomingTickets,
  resolveTicket,
  saveComplaints,
  setTicketStatus,
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  type ComplaintCategory,
  type ComplaintState,
  type ComplaintStatus,
  type ComplaintTicket,
} from "@/lib/complaints";

type Tab = "all" | "mine";

const TABS: ModuleTabItem[] = [
  { id: "all", label: "All tickets", tone: "violet" },
  { id: "mine", label: "My tickets", tone: "amber" },
];

function TicketCard({
  ticket,
  masters,
  sis,
  readOnly,
  onAssign,
  onStatus,
  onResolve,
  onDelete,
}: {
  ticket: ComplaintTicket;
  masters: MastersState | null;
  sis: SisState | null;
  readOnly: boolean;
  onAssign: (id: string, staffId: string) => void;
  onStatus: (id: string, status: ComplaintStatus) => void;
  onResolve: (id: string, note: string) => void;
  onDelete: (id: string) => void;
}) {
  const [resolutionNote, setResolutionNote] = useState(ticket.resolutionNote);
  const student = ticket.studentId ? sis?.students.find((s) => s.id === ticket.studentId) : null;
  const staffOptions = masters?.staff ?? [];

  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{ticket.subject}</span>
          <span className="ml-2 text-xs text-[var(--muted)]">
            {complaintCategoryLabel(ticket.category)} · {ticket.date} · {complaintSourceLabel(ticket.source)}
            {student ? ` · re. ${student.fullName}` : ""}
          </span>
        </div>
        <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-bold text-[var(--muted)]">
          {complaintStatusLabel(ticket.status)}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {ticket.raisedByName}
        {ticket.raisedByMobile ? ` · ${ticket.raisedByMobile}` : ""}
      </p>
      <p className="mt-1 text-sm">{ticket.description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
          value={ticket.assignedToStaffId || ""}
          disabled={readOnly}
          onChange={(e) => onAssign(ticket.id, e.target.value)}
        >
          <option value="">Unassigned</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.fullName}</option>
          ))}
        </select>
        <select
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
          value={ticket.status}
          disabled={readOnly}
          onChange={(e) => onStatus(ticket.id, e.target.value as ComplaintStatus)}
        >
          {COMPLAINT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="text-xs font-bold text-[var(--danger)]"
          disabled={readOnly}
          onClick={() => onDelete(ticket.id)}
        >
          Delete
        </button>
      </div>

      {ticket.status !== "resolved" && ticket.status !== "closed" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className={`${field} !w-auto flex-1 !py-1.5 text-xs`}
            placeholder="Resolution note…"
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
            disabled={readOnly}
            onClick={() => onResolve(ticket.id, resolutionNote)}
          >
            Mark resolved
          </button>
        </div>
      ) : ticket.resolutionNote ? (
        <p className="mt-2 text-xs text-[var(--muted)]">Resolution: {ticket.resolutionNote}</p>
      ) : null}
    </li>
  );
}

export function ComplaintsWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [tab, setTab] = useState<Tab>("all");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [state, setState] = useState<ComplaintState>(emptyComplaintState());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
    setState(loadComplaints());
    void (async () => {
      const [{ ensureMastersHydrated }, { ensureSisHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/mastersPersistence"),
          import("@/lib/sisPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      await Promise.all([
        withHydrationSlot(() => ensureMastersHydrated()),
        withHydrationSlot(() => ensureSisHydrated()),
      ]);
      setMasters(loadMasters());
      setSis(loadSis());
    })();
    void (async () => {
      try {
        const res = await fetch("/api/wa/complaints", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { ok?: boolean; tickets?: ComplaintTicket[] };
        if (!body.ok || !Array.isArray(body.tickets) || body.tickets.length === 0) return;
        setState((cur) => {
          const merged = mergeIncomingTickets(cur, body.tickets!);
          if (merged !== cur) saveComplaints(merged);
          return merged;
        });
      } catch {
        /* WhatsApp-submitted tickets just won't show until next load */
      }
    })();
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 4000);
  }

  const [filterCategory, setFilterCategory] = useState<ComplaintCategory | "">("");
  const [filterStatus, setFilterStatus] = useState<ComplaintStatus | "">("");

  const allRows = useMemo(() => {
    return state.tickets
      .filter((t) => !filterCategory || t.category === filterCategory)
      .filter((t) => !filterStatus || t.status === filterStatus)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state, filterCategory, filterStatus]);

  const myRows = useMemo(() => {
    if (!session.staffId) return [];
    return state.tickets
      .filter((t) => t.assignedToStaffId === session.staffId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state, session.staffId]);

  function onAssign(id: string, staffId: string) {
    setState(assignTicket(state, id, staffId));
    flash(staffId ? `Assigned to ${teacherLabel(masters!, staffId)}.` : "Unassigned.");
  }

  function onStatus(id: string, status: ComplaintStatus) {
    setState(setTicketStatus(state, id, status));
  }

  function onResolve(id: string, note: string) {
    if (!note.trim()) {
      setError("Add a resolution note before marking resolved.");
      return;
    }
    setState(resolveTicket(state, id, note));
    flash("Marked resolved.");
  }

  function onDelete(id: string) {
    if (!window.confirm("Delete this complaint ticket?")) return;
    setState(deleteTicket(state, id));
  }

  const rows = tab === "all" ? allRows : myRows;

  return (
    <ErpWorkspaceShell
      title="Complaints / grievance"
      subtitle="Parent-portal complaint intake, staff triage and resolution"
      icon={<MessageSquareWarning className="size-6" aria-hidden />}
      notice={notice}
      error={error}
    >
      <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={TABS} />

      <div className="mt-5 space-y-4">
        {tab === "all" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Category</span>
              <select
                className={`${field} !py-1.5`}
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as ComplaintCategory | "")}
              >
                <option value="">All</option>
                {COMPLAINT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Status</span>
              <select
                className={`${field} !py-1.5`}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as ComplaintStatus | "")}
              >
                <option value="">All</option>
                {COMPLAINT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            {tab === "all" ? "No complaints match this filter." : "No tickets assigned to you."}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                masters={masters}
                sis={sis}
                readOnly={readOnly}
                onAssign={onAssign}
                onStatus={onStatus}
                onResolve={onResolve}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </ErpWorkspaceShell>
  );
}
