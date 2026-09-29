"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarOff, CheckCircle2, Clock3 } from "lucide-react";
import { useSessionReadOnly } from "@/components/shell/SessionContext";
import type { MyTeaching } from "@/components/staff/useMyTeaching";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TabsContent, WorkspaceTabs, type WorkspaceTabItem } from "@/components/ui/workspace-tabs";

/**
 * Student leave for a teacher (2026-09-29): their own classes only, from
 * the server.
 *
 * The office desk reads the whole school's leave from this browser's copy
 * and saves by pushing the whole desk back — a teacher saw every class's
 * requests and could approve any of them. Here the list comes from
 * GET /api/v1/staff/student-leave (scoped on the server to the sections the
 * teacher teaches) and each decision is one POST to
 * /api/v1/staff/student-leave/decide, which checks class teacher /
 * principal rules again and puts the leave on that one child's registers.
 * Nothing is shown as done until the server says it is.
 */

type LeaveRow = {
  id: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  fromDate: string;
  toDate: string;
  days: number;
  leaveType: string;
  leaveTypeLabel: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedBy: string;
  createdAt: string;
  decidedBy: string;
  decidedAt: string;
  decisionNote: string;
  approverHint: string;
  canDecide: boolean;
};

type DecideResult = {
  status: string;
  attendanceApplied: boolean;
  appliedDates?: string[];
  unmarkedDates?: string[];
  failedDates?: string[];
};

type Tab = "pending" | "decided";

async function readApi<T>(res: Response): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: { message?: string } | string }
    | null;
  if (res.ok && body?.ok && body.data !== undefined) return { ok: true, data: body.data };
  const msg =
    typeof body?.error === "string" ? body.error : body?.error?.message || "";
  return { ok: false, error: msg || `The school server answered ${res.status}` };
}

async function fetchRows(which: Tab): Promise<{ ok: true; rows: LeaveRow[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/v1/staff/student-leave?status=${which}`, { cache: "no-store" });
    const r = await readApi<{ requests: LeaveRow[] }>(res);
    if (!r.ok) return r;
    return { ok: true, rows: Array.isArray(r.data.requests) ? r.data.requests : [] };
  } catch {
    return { ok: false, error: "Could not reach the school server" };
  }
}

function statusBadge(status: LeaveRow["status"]) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary">Pending</Badge>;
    case "approved":
      return (
        <Badge variant="secondary" className="bg-[var(--ok)]/15 text-[var(--ok)]">
          Approved
        </Badge>
      );
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function listDates(dates: string[]): string {
  if (dates.length <= 3) return dates.join(", ");
  return `${dates.slice(0, 3).join(", ")} and ${dates.length - 3} more`;
}

/** What actually happened, in the teacher's words — never more than that. */
function decisionMessage(row: LeaveRow, r: DecideResult): string {
  if (r.status !== "approved") return `Rejected — ${row.studentName}`;
  const parts = [`Approved — ${row.studentName}`];
  const applied = r.appliedDates ?? [];
  const unmarked = r.unmarkedDates ?? [];
  const failed = r.failedDates ?? [];
  if (applied.length) parts.push(`leave marked on ${applied.length} register(s)`);
  if (unmarked.length) {
    parts.push(
      `no register yet for ${listDates(unmarked)} — mark ${row.studentName} on leave when you take attendance`,
    );
  }
  if (failed.length) {
    parts.push(`the register for ${listDates(failed)} could NOT be updated — please mark it by hand`);
  }
  return parts.join(" · ");
}

function RequestCard({
  row,
  busy,
  readOnly,
  onDecide,
}: {
  row: LeaveRow;
  busy: boolean;
  readOnly: boolean;
  onDecide?: (row: LeaveRow, approve: boolean, note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{row.studentName}</CardTitle>
          <CardDescription>
            {row.classLabel || "—"} · {row.leaveTypeLabel} · {row.fromDate}
            {row.toDate !== row.fromDate ? ` → ${row.toDate}` : ""} · {row.days} day(s)
          </CardDescription>
        </div>
        {statusBadge(row.status)}
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <p className="text-sm">{row.reason}</p>
        <p className="text-xs text-muted-foreground">
          {row.status === "pending" ? row.approverHint : ""}
          {row.decidedBy ? `Decided by ${row.decidedBy}` : ""}
          {row.decisionNote ? ` · ${row.decisionNote}` : ""}
        </p>
      </CardContent>
      {row.status === "pending" && onDecide ? (
        row.canDecide ? (
          <CardFooter className="flex flex-wrap items-center gap-2 border-t-0 pt-0">
            <Input
              aria-label={`Note for ${row.studentName}`}
              placeholder="Note to the parent (optional)"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              className="h-8 min-w-[12rem] flex-1"
              disabled={busy || readOnly}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || readOnly}
              onClick={() => onDecide(row, true, note)}
            >
              {busy ? "Saving…" : "Approve"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || readOnly}
              onClick={() => onDecide(row, false, note)}
            >
              Reject
            </Button>
          </CardFooter>
        ) : (
          <CardFooter className="border-t-0 pt-0 text-xs text-muted-foreground">
            Only the class teacher or the principal can decide this one.
          </CardFooter>
        )
      ) : null}
    </Card>
  );
}

export function TeacherStudentLeaveView({
  embedded = false,
  my,
}: {
  embedded?: boolean;
  my: MyTeaching;
}) {
  const readOnly = useSessionReadOnly();
  const [tab, setTab] = useState<Tab>("pending");
  const [pending, setPending] = useState<LeaveRow[] | null>(null);
  const [decided, setDecided] = useState<LeaveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([fetchRows("pending"), fetchRows("decided")]);
    // A failed read leaves the list as "unknown" (null), never as empty.
    if (p.ok) setPending(p.rows);
    if (d.ok) setDecided(d.rows);
    const failed = !p.ok ? p.error : !d.ok ? d.error : "";
    if (failed) setError(`Could not load leave requests — ${failed}`);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: LeaveRow, approve: boolean, note: string) {
    if (busyId) return;
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/staff/student-leave/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, approve, note: note.trim() }),
      });
      const r = await readApi<DecideResult>(res);
      if (!r.ok) {
        setError(`Not saved — ${r.error}`);
      } else {
        setNotice(decisionMessage(row, r.data));
      }
    } catch {
      setError("Not saved — could not reach the school server.");
    } finally {
      setBusyId(null);
      // Either way, show what the server now holds.
      await load();
    }
  }

  const tabItems = useMemo<WorkspaceTabItem[]>(
    () => [
      {
        id: "pending",
        label: "Pending",
        tone: "amber",
        icon: <Clock3 />,
        badge: pending && pending.length > 0 ? pending.length : undefined,
      },
      { id: "decided", label: "Decided", tone: "sky", icon: <CheckCircle2 /> },
    ],
    [pending],
  );

  const classNames = my.teaching
    .map((t) => `${t.className} ${t.sectionName}`.trim())
    .join(", ");

  function renderList(rows: LeaveRow[] | null, empty: string, withActions: boolean) {
    if (rows === null) {
      return <p className="text-sm text-muted-foreground">Loading…</p>;
    }
    if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
    return rows.map((row) => (
      <RequestCard
        key={row.id}
        row={row}
        busy={busyId === row.id}
        readOnly={readOnly || (busyId !== null && busyId !== row.id)}
        onDecide={withActions ? decide : undefined}
      />
    ));
  }

  return (
    <ErpWorkspaceShell
      embedded={embedded}
      title="Student leave"
      subtitle={
        classNames
          ? `Requests for your classes: ${classNames}`
          : "Requests for your classes"
      }
      icon={<CalendarOff className="size-6" aria-hidden />}
      error={error}
      notice={notice}
    >
      {my.teaching.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">
          No classes are linked to you yet — ask the office to add them (Staff → Duties).
        </p>
      ) : null}
      <WorkspaceTabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        items={tabItems}
        aria-label="Student leave sections"
      >
        <TabsContent value="pending" className="grid gap-3">
          {renderList(pending, "No pending requests for your classes.", true)}
        </TabsContent>
        <TabsContent value="decided" className="grid gap-3">
          {renderList(decided, "No decided requests yet.", false)}
        </TabsContent>
      </WorkspaceTabs>
    </ErpWorkspaceShell>
  );
}
