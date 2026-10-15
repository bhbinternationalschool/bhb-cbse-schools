"use client";

/**
 * Staff → Requests (15 Oct 2026). Read through the query kernel
 * (GET /api/data/views/staff-requests: a manager's whole queue, anyone else's
 * own) and refetched when erp_versions says staff_hr moved — so a request
 * raised on another device appears here within one versions poll (≤ 20 s).
 * Every change is one POST /api/staff/requests through the write kernel,
 * with the revision this screen loaded; nothing is kept in the browser.
 * Before this, requests were saved only in the browser that raised them.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QueryError } from "@/components/data/QueryError";
import {
  ErpTable,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { invalidateDesks, useErpQuery, useStaffList } from "@/lib/data/client/hooks";
import {
  STAFF_REQUEST_TYPE_LABELS,
  type StaffRequestStatus,
  type StaffRequestType,
} from "@/lib/staffHr";
import { postStaffRequest } from "@/lib/staffRequestsClient";
import {
  STAFF_REQUESTS_DESK,
  STAFF_REQUESTS_VIEW_PATH,
  parseStaffRequestsView,
  type StaffRequestRow,
  type StaffRequestTriage,
  type StaffRequestsView,
} from "@/lib/staffRequestsShared";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import { MonthGroupedTbody, useMonthGroups } from "@/components/ui/month-grouped-rows";

const STATUS_LABEL: Record<StaffRequestStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function StaffRequestsPanel() {
  const client = useQueryClient();
  const query = useErpQuery<StaffRequestsView>("staff-requests", STAFF_REQUESTS_VIEW_PATH, {
    desk: STAFF_REQUESTS_DESK,
    parse: parseStaffRequestsView,
  });
  // Names for "Raised by" / "Assigned to" — the redacted directory. If it
  // cannot be read, the request still shows the name it was raised with.
  const staffList = useStaffList();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | StaffRequestStatus>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | StaffRequestType>("all");
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const view = query.data;
  const isManager = view?.canManage ?? false;
  const roster = staffList.data?.staff ?? [];

  function staffLabel(id: string, fallback = "") {
    const s = roster.find((x) => x.id === id);
    return s ? `${s.empCode} · ${s.fullName}` : fallback || id || "—";
  }

  const rows = useMemo(() => {
    let list: StaffRequestRow[] = view?.requests ?? [];
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (typeFilter !== "all") list = list.filter((t) => t.type === typeFilter);
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [view, statusFilter, typeFilter]);

  // Open first when sorting by status, because an open request is the one
  // that needs somebody; the date sorts by its real timestamp.
  const reqSort = useTableSort(
    rows,
    {
      raisedBy: (t) => staffLabel(t.staffId, t.raisedByName),
      type: (t) => t.type,
      subject: (t) => t.subject,
      status: (t) => t.status,
      assignedTo: (t) =>
        t.assignedToStaffId ? staffLabel(t.assignedToStaffId) : null,
      date: (t) => t.updatedAt || t.createdAt,
    },
    "date",
    "desc",
  );

  // Folded by the IST month the request was raised, newest open. Filters
  // open every month with a match, and a month still holding an open or
  // in-progress request is never folded by default.
  const reqMonths = useMonthGroups({
    rows: reqSort.rows,
    dateOf: (t) => t.createdAt,
    filterActive: statusFilter !== "all" || typeFilter !== "all",
    filterKey: `${statusFilter}|${typeFilter}`,
    storageKey: "staff.requests",
    needsAttention: (t) => t.status === "open" || t.status === "in_progress",
  });

  async function onSave(ticket: StaffRequestRow, patch: StaffRequestTriage) {
    if (savingId) return;
    setSavingId(ticket.id);
    setNotice(null);
    try {
      const r = await postStaffRequest({ op: "update", id: ticket.id, base: ticket.rev, patch });
      if (!r.ok) {
        // A conflict: the server holds a newer version — show it.
        if (r.conflict) invalidateDesks(client, [STAFF_REQUESTS_DESK]);
        setNotice({ kind: "error", text: r.error });
        return;
      }
      if (patch.resolutionNote !== undefined) {
        setNoteDraft((cur) => {
          const next = { ...cur };
          delete next[ticket.id];
          return next;
        });
      }
      invalidateDesks(client, [STAFF_REQUESTS_DESK]);
      setNotice({ kind: "ok", text: "Request updated" });
      window.setTimeout(() => setNotice((n) => (n?.kind === "ok" ? null : n)), 2800);
    } finally {
      setSavingId(null);
    }
  }

  if (query.isError) {
    return <QueryError what="staff requests" error={query.error} retry={() => query.refetch()} />;
  }
  if (!view) {
    return <p className="text-sm text-[var(--muted)]">Loading requests…</p>;
  }
  return (
    <div className="space-y-5">
      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          data-testid="staff-requests-notice"
          className={
            notice.kind === "error"
              ? "flex items-start justify-between gap-3 rounded-lg border border-[var(--danger)] px-3 py-2 text-sm font-medium text-[var(--danger)]"
              : "rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]"
          }
        >
          <span>{notice.text}</span>
          {notice.kind === "error" ? (
            <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          ) : null}
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
                <ErpSortTh sort={reqSort} field="raisedBy" className="px-4 py-2">Raised by</ErpSortTh>
                <ErpSortTh sort={reqSort} field="type">Type</ErpSortTh>
                <ErpSortTh sort={reqSort} field="subject">Subject</ErpSortTh>
                <ErpSortTh sort={reqSort} field="status">Status</ErpSortTh>
                {isManager ? <ErpSortTh sort={reqSort} field="assignedTo" className="px-3 py-2">Assigned to</ErpSortTh> : null}
                <ErpSortTh sort={reqSort} field="date">Date</ErpSortTh>
                {isManager ? <th className="px-3 py-2">Action</th> : null}
              </tr>
            </ErpTableHead>
            <MonthGroupedTbody
              month={reqMonths}
              colSpan={isManager ? 7 : 5}
              rowKey={(t) => t.id}
              countLabel={(n) => `${n} ${n === 1 ? "request" : "requests"}`}
              renderRow={(t) => (
                <tr data-testid={`staff-request-${t.id}`}>
                  <td className="px-4 py-2 font-medium text-[var(--brand-deep)]">
                    {staffLabel(t.staffId, t.raisedByName)}
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
                        aria-label="Status"
                        value={t.status}
                        disabled={savingId === t.id}
                        onChange={(e) =>
                          void onSave(t, { status: e.target.value as StaffRequestStatus })
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
                        aria-label="Assigned to"
                        value={t.assignedToStaffId}
                        disabled={savingId === t.id}
                        onChange={(e) =>
                          void onSave(t, { assignedToStaffId: e.target.value })
                        }
                      >
                        <option value="">Unassigned</option>
                        {t.assignedToStaffId && !roster.some((s) => s.id === t.assignedToStaffId) ? (
                          <option value={t.assignedToStaffId}>{staffLabel(t.assignedToStaffId)}</option>
                        ) : null}
                        {roster
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
                          disabled={savingId === t.id}
                          onClick={() =>
                            void onSave(t, {
                              resolutionNote: noteDraft[t.id] ?? t.resolutionNote,
                            })
                          }
                        >
                          Save
                        </button>
                        <RowActionMenu
                          row={t}
                          label="Request actions"
                          actions={[
                            {
                              id: "save",
                              label: "Save resolution note",
                              onSelect: (x) =>
                                void onSave(x, { resolutionNote: noteDraft[x.id] ?? x.resolutionNote }),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  ) : null}
                </tr>
              )}
              empty={
                <tr>
                  <td
                    colSpan={isManager ? 7 : 5}
                    className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                  >
                    No requests {statusFilter !== "all" || typeFilter !== "all" ? "match this filter" : "yet"}.
                  </td>
                </tr>
              }
            />
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
