"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  CalendarOff,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  List,
} from "lucide-react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent, WorkspaceTabs, type WorkspaceTabItem } from "@/components/ui/workspace-tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { useModuleTabQuery } from "@/lib/useModuleTabQuery";
import {
  cancelStudentLeaveRequest,
  createStudentLeaveRequest,
  decideStudentLeave,
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  pendingApproverHint,
  runStudentLeaveReport,
  STUDENT_LEAVE_REPORTS,
  STUDENT_LEAVE_TYPES,
  type StudentLeaveReportId,
  type StudentLeaveRequest,
  type StudentLeaveState,
  type StudentLeaveType,
} from "@/lib/studentLeave";

type LeaveTab = "dashboard" | "pending" | "all" | "apply" | "reports";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  return `${todayIso().slice(0, 7)}-01`;
}

function classLabel(
  masters: MastersState,
  classId: string,
  sectionId: string,
): string {
  const c = masters.classes.find((x) => x.id === classId);
  const s = masters.sections.find((x) => x.id === sectionId);
  return [c?.name, s?.name].filter(Boolean).join(" · ") || "—";
}

function leaveStatusBadge(status: StudentLeaveRequest["status"]) {
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

function RequestRow({
  req,
  masters,
  sis,
  actorName,
  onRefresh,
  onFlash,
  onError,
  showActions,
}: {
  req: StudentLeaveRequest;
  masters: MastersState;
  sis: SisState;
  actorName: string;
  onRefresh: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
  showActions: boolean;
}) {
  const student = sis.students.find((s) => s.id === req.studentId);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {student?.fullName || req.studentId}
          </CardTitle>
          <CardDescription>
            {student
              ? classLabel(masters, student.classId, student.sectionId)
              : ""}{" "}
            · {leaveTypeLabel(req.leaveType)} · {req.fromDate}
            {req.toDate !== req.fromDate ? ` → ${req.toDate}` : ""} ·{" "}
            {leaveDayCount(req)} day(s)
          </CardDescription>
        </div>
        {leaveStatusBadge(req.status)}
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <p className="text-sm">{req.reason}</p>
        <p className="text-xs text-muted-foreground">
          {req.status === "pending" ? `${pendingApproverHint(req)} · ` : ""}
          {req.decidedBy ? `Decided by ${req.decidedBy}` : ""}
          {req.attendanceApplied ? " · Attendance applied" : ""}
        </p>
      </CardContent>
      {showActions && req.status === "pending" ? (
        <CardFooter className="flex flex-wrap gap-2 border-t-0 pt-0">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const r = decideStudentLeave({
                id: req.id,
                approve: true,
                by: actorName,
              });
              if (!r.ok) onError(r.error);
              else {
                onRefresh();
                onFlash("Approved");
              }
            }}
          >
            Approve
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const r = decideStudentLeave({
                id: req.id,
                approve: false,
                by: actorName,
              });
              if (!r.ok) onError(r.error);
              else {
                onRefresh();
                onFlash("Rejected");
              }
            }}
          >
            Reject
          </Button>
          {req.requestedBy === actorName ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                const r = cancelStudentLeaveRequest(req.id);
                if (!r.ok) onError(r.error);
                else {
                  onRefresh();
                  onFlash("Cancelled");
                }
              }}
            >
              Cancel
            </Button>
          ) : null}
        </CardFooter>
      ) : null}
      {!showActions && req.status === "pending" && req.requestedBy === actorName ? (
        <CardFooter className="border-t-0 pt-0">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              const r = cancelStudentLeaveRequest(req.id);
              if (!r.ok) onError(r.error);
              else {
                onRefresh();
                onFlash("Cancelled");
              }
            }}
          >
            Cancel
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function StudentLeaveWorkspace({
  embedded = false,
}: {
  /** When true, hide page chrome (used under Attendance › Student leave). */
  embedded?: boolean;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useModuleTabQuery<LeaveTab>("dashboard", [
    "dashboard",
    "pending",
    "all",
    "apply",
    "reports",
  ]);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [state, setState] = useState<StudentLeaveState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState(todayIso);
  const [toDate, setToDate] = useState(todayIso);
  const [leaveType, setLeaveType] = useState<StudentLeaveType>("SL");
  const [reason, setReason] = useState("");
  const [studentId, setStudentId] = useState("");

  const [reportFrom, setReportFrom] = useState(monthStart);
  const [reportTo, setReportTo] = useState(todayIso);
  const [reportFormat, setReportFormat] = useState<"excel" | "pdf">("excel");

  const actorName = session.fullName || "Staff";

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    setState(loadStudentLeave());
  }

  useEffect(() => {
    refresh();
  }, [ay]);

  const activeStudents = useMemo(() => {
    if (!sis) return [];
    return sis.students
      .filter(
        (s) =>
          s.status === "active" &&
          (s.academicYearCode === ay || !s.academicYearCode),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [sis, ay]);

  useEffect(() => {
    if (!studentId && activeStudents[0]) setStudentId(activeStudents[0].id);
  }, [studentId, activeStudents]);

  const pending = useMemo(() => {
    if (!state) return [];
    return state.requests.filter(
      (r) => r.academicYearCode === ay && r.status === "pending",
    );
  }, [state, ay]);

  const tabItems = useMemo<WorkspaceTabItem[]>(
    () => [
      {
        id: "dashboard",
        label: "Dashboard",
        tone: "navy",
        icon: <LayoutDashboard />,
      },
      {
        id: "pending",
        label: "Pending",
        tone: "amber",
        icon: <Clock3 />,
        badge: pending.length > 0 ? pending.length : undefined,
      },
      { id: "all", label: "All", tone: "sky", icon: <List /> },
      {
        id: "apply",
        label: "Apply (staff)",
        tone: "teal",
        icon: <ClipboardList />,
      },
      {
        id: "reports",
        label: "Reports",
        tone: "slate",
        icon: <BarChart3 />,
      },
    ],
    [pending.length],
  );

  const allRequests = useMemo(() => {
    if (!state) return [];
    return state.requests
      .filter((r) => r.academicYearCode === ay)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state, ay]);

  function submitApply() {
    const student = activeStudents.find((s) => s.id === studentId);
    const r = createStudentLeaveRequest({
      academicYearCode: ay,
      studentId,
      fromDate,
      toDate,
      leaveType,
      reason,
      requestedBy: actorName,
      householdId: student?.householdId || "",
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setReason("");
    refresh();
    flash("Leave request submitted");
    setTab("pending");
  }

  if (!state || !masters || !sis) {
    return (
      <div className="flex items-center justify-center px-4 py-8 text-sm text-muted-foreground">
        Loading student leave…
      </div>
    );
  }

  const rowProps = {
    masters,
    sis,
    actorName,
    onRefresh: refresh,
    onFlash: flash,
    onError: (msg: string) => {
      setError(msg);
      setNotice(null);
    },
  };

  return (
    <ErpWorkspaceShell
      embedded={embedded}
      title="Student leave"
      subtitle={
        embedded
          ? "Parent requests · approve · auto attendance codes (LE / HD)"
          : "Parent requests · staff approval · attendance codes"
      }
      icon={<CalendarOff className="size-6" aria-hidden />}
      actions={
        embedded ? undefined : (
          <Link
            href="/reports?module=student_leave"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <BarChart3 className="size-4" />
            Reports Center
          </Link>
        )
      }
      error={error}
      notice={notice}
    >
      <WorkspaceTabs
        value={tab}
        onValueChange={(value) => setTab(value as LeaveTab)}
        items={tabItems}
        aria-label="Student leave sections"
      >

        <TabsContent value="dashboard">
          <ModuleDashboardHost
            moduleId="student_leave"
            onNavigateTab={(t) => setTab(t as LeaveTab)}
          />
        </TabsContent>

        <TabsContent value="pending" className="grid gap-3">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending requests.</p>
          ) : (
            pending.map((req) => (
              <RequestRow
                key={req.id}
                req={req}
                showActions
                {...rowProps}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="all" className="grid gap-3">
          {allRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            allRequests.map((req) => (
              <RequestRow
                key={req.id}
                req={req}
                showActions={false}
                {...rowProps}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="apply">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle>Apply on behalf of student</CardTitle>
              <CardDescription>
                Staff can submit leave for a student (e.g. office walk-in).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="leave-student">Student</Label>
                <Select
                  value={studentId}
                  onValueChange={(v) => setStudentId(v ?? "")}
                >
                  <SelectTrigger id="leave-student" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeStudents.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.fullName} · {classLabel(masters, s.classId, s.sectionId)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="leave-type">Leave type</Label>
                <Select
                  value={leaveType}
                  onValueChange={(v) => setLeaveType(v as StudentLeaveType)}
                >
                  <SelectTrigger id="leave-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STUDENT_LEAVE_TYPES.map((t) => (
                      <SelectItem key={t.code} value={t.code}>
                        {t.label} — {t.note}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="leave-from">From</Label>
                  <Input
                    id="leave-from"
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="leave-to">To</Label>
                  <Input
                    id="leave-to"
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="leave-reason">Reason</Label>
                <Textarea
                  id="leave-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="button" onClick={submitApply}>
                Submit request
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="report-from">From</Label>
              <Input
                id="report-from"
                type="date"
                value={reportFrom}
                onChange={(e) => setReportFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-to">To</Label>
              <Input
                id="report-to"
                type="date"
                value={reportTo}
                onChange={(e) => setReportTo(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-format">Format</Label>
              <Select
                value={reportFormat}
                onValueChange={(v) => setReportFormat(v as "excel" | "pdf")}
              >
                <SelectTrigger id="report-format" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="excel">Excel</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            {STUDENT_LEAVE_REPORTS.map((r) => (
              <Card key={r.id} size="sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{r.label}</p>
                    {r.hint ? (
                      <p className="text-xs text-muted-foreground">{r.hint}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const res = runStudentLeaveReport(
                        r.id as StudentLeaveReportId,
                        {
                          academicYearCode: ay,
                          fromDate: reportFrom,
                          toDate: reportTo,
                          format: reportFormat,
                          leave: state,
                          masters,
                        },
                      );
                      if (!res.ok) setError(res.error);
                      else flash(res.message);
                    }}
                  >
                    Export
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </WorkspaceTabs>
    </ErpWorkspaceShell>
  );
}
