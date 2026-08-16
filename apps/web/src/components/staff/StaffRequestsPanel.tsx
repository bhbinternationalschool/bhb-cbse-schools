"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  STAFF_REQUEST_TYPE_LABELS,
  loadStaffHr,
  updateStaffRequestTicket,
  type StaffHrState,
  type StaffRequestStatus,
  type StaffRequestTicket,
  type StaffRequestType,
} from "@/lib/staffHr";
import { canManageStaffLeave, resolveSessionStaff } from "@/lib/staffResolve";

const STATUS_LABEL: Record<StaffRequestStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function StaffRequestsPanel() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [hr, setHr] = useState<StaffHrState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | StaffRequestStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | StaffRequestType>("all");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  function reload() {
    setMasters(loadMasters());
    setHr(loadStaffHr());
  }

  useEffect(() => {
    reload();
    void (async () => {
      const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
      const { ensureStaffHrHydrated } = await import("@/lib/staffHrPersistence");
      const [didStaff, didHr] = await Promise.all([
        ensureStaffHydrated(),
        ensureStaffHrHydrated(),
      ]);
      if (didStaff || didHr) reload();
    })();
  }, []);

  const selfStaff = useMemo(() => {
    if (!masters) return null;
    return resolveSessionStaff(session, masters);
  }, [masters, session]);

  const isManager = useMemo(() => {
    if (!masters) return false;
    return canManageStaffLeave(session, masters);
  }, [masters, session]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function staffLabel(id: string) {
    const s = masters?.staff.find((x) => x.id === id);
    return s ? `${s.empCode} · ${s.fullName}` : id || "—";
  }

  const rows = useMemo(() => {
    let list = hr?.staffRequests ?? [];
    if (!isManager && selfStaff) {
      list = list.filter((t) => t.staffId === selfStaff.id);
    }
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (typeFilter !== "all") list = list.filter((t) => t.type === typeFilter);
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [hr, isManager, selfStaff, statusFilter, typeFilter]);

  function onSave(ticket: StaffRequestTicket, patch: Partial<StaffRequestTicket>) {
    const result = updateStaffRequestTicket(ticket.id, {
      assignedToStaffId: patch.assignedToStaffId,
      status: patch.status,
      resolutionNote: patch.resolutionNote,
    });
    if (!result.ok) {
      flash(result.error);
      return;
    }
    setHr(result.state);
    flash("Request updated");
  }

  if (!masters || !hr) {
    return <p className="text-sm text-[var(--muted)]">Loading requests…</p>;
  }

  return (
    <div className="space-y-5">
      {notice ? (
        <p className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2.5 text-sm text-[var(--muted)]">
        {isManager ? (
          <>
            Operational requests staff raise from the WhatsApp panel —
            stationery/supplies, repairs/maintenance, vehicle/driver
            issues, and classroom problems. Assign and resolve below.
          </>
        ) : (
          <>
            Requests you&apos;ve raised via the header WhatsApp panel
            (&ldquo;Owner / Admin / Principal&rdquo; → &ldquo;Raise a
            request&rdquo;).
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="field !w-auto !py-1 text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | StaffRequestStatus)}
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select
          className="field !w-auto !py-1 text-xs"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | StaffRequestType)}
        >
          <option value="all">All types</option>
          {Object.entries(STAFF_REQUEST_TYPE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <div className="overflow-x-auto">
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-4 py-2">Raised by</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Status</th>
                {isManager ? <th className="px-3 py-2">Assigned to</th> : null}
                <th className="px-3 py-2">Date</th>
                {isManager ? <th className="px-3 py-2">Action</th> : null}
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2 font-medium text-[var(--brand-deep)]">
                    {staffLabel(t.staffId)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {STAFF_REQUEST_TYPE_LABELS[t.type]}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-semibold text-[var(--ink)]">{t.subject}</div>
                    {t.description ? (
                      <div className="mt-0.5 max-w-xs whitespace-pre-wrap text-[var(--muted)]">
                        {t.description}
                      </div>
                    ) : null}
                    {t.resolutionNote ? (
                      <div className="mt-1 text-[10px] text-[var(--success)]">
                        Resolution: {t.resolutionNote}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {isManager ? (
                      <select
                        className="field !w-auto !py-1 text-xs"
                        value={t.status}
                        onChange={(e) =>
                          onSave(t, { status: e.target.value as StaffRequestStatus })
                        }
                      >
                        {Object.entries(STATUS_LABEL).map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusPill status={t.status} />
                    )}
                  </td>
                  {isManager ? (
                    <td className="px-3 py-2">
                      <select
                        className="field !w-auto !py-1 text-xs"
                        value={t.assignedToStaffId}
                        onChange={(e) =>
                          onSave(t, { assignedToStaffId: e.target.value })
                        }
                      >
                        <option value="">Unassigned</option>
                        {(masters.staff ?? [])
                          .filter((s) => s.status === "active")
                          .sort((a, b) => a.empCode.localeCompare(b.empCode))
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.empCode} · {s.fullName}
                            </option>
                          ))}
                      </select>
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">{t.date}</td>
                  {isManager ? (
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          className="field !w-40 !py-1 text-xs"
                          placeholder="Resolution note"
                          value={noteDraft[t.id] ?? t.resolutionNote}
                          onChange={(e) =>
                            setNoteDraft((cur) => ({ ...cur, [t.id]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--brand-deep)]"
                          onClick={() =>
                            onSave(t, {
                              resolutionNote: noteDraft[t.id] ?? t.resolutionNote,
                            })
                          }
                        >
                          Save
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={isManager ? 7 : 5}
                    className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                  >
                    No requests {statusFilter !== "all" || typeFilter !== "all" ? "match this filter" : "yet"}.
                  </td>
                </tr>
              ) : null}
            </ErpTableBody>
          </ErpTable>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: StaffRequestStatus }) {
  const cls =
    status === "resolved" || status === "closed"
      ? "bg-[rgba(21,128,61,0.12)] text-[var(--success)]"
      : status === "in_progress"
        ? "bg-[rgba(197,160,40,0.2)] text-[var(--brand-deep)]"
        : "bg-[var(--surface-sunken)] text-[var(--muted)]";
  return (
    <span className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${cls}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
