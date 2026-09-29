"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { field } from "@/components/ui/erp-ui";
import { DEFAULT_AY, loadMasters, type MastersState, currentAcademicYearCode} from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { classSectionLabel } from "@/lib/timetable";
import { loadSis, type SisState, type SisStudent, studentsInSession} from "@/lib/sis";
import {
  DISCIPLINE_SAVE_REFUSED,
  disciplineCategoryLabel,
  DISCIPLINE_CATEGORIES,
  escalationLevelLabel,
  ESCALATION_LEVELS,
  loadDiscipline,
  notifyDisciplineParent,
  recentIncidentCount,
  trySaveDiscipline,
  studentPointsTotal,
  suggestEscalationLevel,
  upsertIncident,
  type DisciplineCategory,
  type DisciplineIncident,
  type DisciplineState,
  type EscalationLevel,
  type IncidentStatus,
} from "@/lib/discipline";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { RowAction } from "@/components/ui/erp-grid";
import { isRestrictedTeacher, useMyTeaching } from "@/components/staff/useMyTeaching";
import { fetchForMySections, staffV1, studentsOfMySections } from "@/components/staff/staffV1";

/** One row of GET /api/v1/staff/discipline (already scoped to the teacher's sections). */
type ScopedIncident = Pick<
  DisciplineIncident,
  | "id"
  | "studentId"
  | "date"
  | "category"
  | "pointsDelta"
  | "description"
  | "escalationLevel"
  | "status"
  | "notifiedParentAt"
>;

type Tab = "log" | "all" | "student";

const TABS: ModuleTabItem[] = [
  { id: "log", label: "Log incident", tone: "rose" },
  { id: "all", label: "All incidents", tone: "amber" },
  { id: "student", label: "By student", tone: "sky" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function DisciplineWorkspace() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useState<Tab>("log");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [state, setState] = useState<DisciplineState>({ version: 1, incidents: [] });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration("discipline", () => { setState(loadDiscipline()); });
  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
    setState(loadDiscipline());
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
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 4000);
  }

  const canApprove = useMemo(
    () => (masters ? hasPermission(session, masters, "discipline", "approve") : false),
    [session, masters],
  );
  const canEdit = useMemo(
    () => (masters ? hasPermission(session, masters, "discipline", "edit") : false),
    [session, masters],
  );

  /**
   * Teacher mode (2026-09-29). A class or subject teacher sees and records
   * only for children of their own sections: the picker is narrowed to
   * them, the register is read from GET /api/v1/staff/discipline (scoped on
   * the server), and a new incident goes through the v1 POST, which checks
   * the child's section again. Edit, delete and escalation stay with the
   * office — the teacher's role has view + create, not edit, and the
   * desk's whole-blob save would be refused anyway.
   *
   * Until "my classes" has answered, someone who cannot edit is shown no
   * register at all rather than the whole school's: not knowing a
   * teacher's scope is not the same as their scope being everything.
   */
  const { my, loading: myLoading } = useMyTeaching();
  const teacherMode = isRestrictedTeacher(my);
  const scopeUnknown = !my && !canEdit;
  const [scoped, setScoped] = useState<DisciplineState | null>(null);
  const [scopedError, setScopedError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadScoped = useCallback(async () => {
    if (!isRestrictedTeacher(my)) return;
    const r = await fetchForMySections<ScopedIncident, { incidents: ScopedIncident[] }>(
      my,
      "/api/v1/staff/discipline",
      (b) => b.incidents ?? [],
    );
    if (!r.ok) {
      setScoped(null);
      setScopedError(`Could not load your classes' incidents: ${r.error}`);
      return;
    }
    setScopedError(null);
    setScoped({
      version: 1,
      incidents: r.data.map((i) => ({
        ...i,
        // The v1 read is already this session only; the points total below
        // filters on the year, so give each row the year it was read for.
        academicYearCode: my.academicYearCode,
        reportedByStaffId: "",
        createdAt: "",
        updatedAt: "",
      })),
    });
  }, [my]);

  useEffect(() => {
    void reloadScoped();
  }, [reloadScoped]);

  /** What every list on this page reads: the scoped server copy for a
   * teacher, the desk copy for the office. */
  const view = useMemo<DisciplineState>(
    () =>
      teacherMode
        ? (scoped ?? { version: 1, incidents: [] })
        : scopeUnknown
          ? { version: 1, incidents: [] }
          : state,
    [teacherMode, scoped, scopeUnknown, state],
  );

  /** Children a picker may offer: the teacher's sections, or the school. */
  const pickable = useMemo(() => {
    if (!sis) return [];
    if (teacherMode) return studentsOfMySections(sis, my.academicYearCode, my);
    if (scopeUnknown) return [];
    // One row per child, this session. SIS keeps a row per child per year and
    // marks them all active, so the same name appeared several times and, in a
    // capped list, pushed real matches off the end.
    return studentsInSession(sis, currentAcademicYearCode(masters));
  }, [sis, masters, teacherMode, scopeUnknown, my]);

  // --- Log incident ---
  const [studentQuery, setStudentQuery] = useState("");
  const [pickedStudent, setPickedStudent] = useState<SisStudent | null>(null);
  const [logCategory, setLogCategory] = useState<DisciplineCategory>("uniform");
  const [logPoints, setLogPoints] = useState("-1");
  const [logDescription, setLogDescription] = useState("");
  const [logDate, setLogDate] = useState(todayIso());

  const [logNotify, setLogNotify] = useState(false);

  const studentMatches = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return [];
    return pickable
      .filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q),
      )
      .slice(0, 15);
  }, [pickable, studentQuery]);

  function resetLogForm() {
    setPickedStudent(null);
    setStudentQuery("");
    setLogCategory("uniform");
    setLogPoints("-1");
    setLogDescription("");
    setLogDate(todayIso());
    setLogNotify(false);
  }

  async function onLogIncident() {
    if (!pickedStudent) {
      setError("Pick a student.");
      return;
    }
    const points = Number(logPoints);
    if (!Number.isFinite(points)) {
      setError("Points must be a number.");
      return;
    }
    if (!logDescription.trim()) {
      setError("Add a short description.");
      return;
    }
    if (teacherMode) {
      await logIncidentScoped(pickedStudent, points);
      return;
    }
    const { state: withIncident } = upsertIncident(state, {
      studentId: pickedStudent.id,
      academicYearCode: ay,
      date: logDate,
      category: logCategory,
      pointsDelta: points,
      description: logDescription.trim(),
      reportedByStaffId: session.staffId || "",
    });
    const saved = trySaveDiscipline(withIncident);
    if (!saved.ok) {
      // Keep the form filled so nothing typed is lost, and say so.
      setError(DISCIPLINE_SAVE_REFUSED);
      return;
    }
    setState(saved.state);
    resetLogForm();
    flash("Incident logged.");
  }

  /** Teacher path: the server checks the child is in one of their sections,
   * saves, and (when asked) sends the parent-app notice to that child's
   * family only. The register is re-read from the server afterwards so it
   * shows what was stored, not what the page hoped was stored. */
  async function logIncidentScoped(student: SisStudent, points: number) {
    if (logDescription.trim().length < 5) {
      setError("Describe what happened (a few words at least).");
      return;
    }
    if (Math.abs(points) > 20) {
      setError("Points must be between -20 and 20.");
      return;
    }
    setBusy(true);
    const r = await staffV1<{ id: string; escalationLabel: string; parentNotified: boolean }>(
      "/api/v1/staff/discipline",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student.id,
          date: logDate,
          category: logCategory,
          pointsDelta: Math.round(points),
          description: logDescription.trim(),
          notifyParent: logNotify,
        }),
      },
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const askedNotify = logNotify;
    resetLogForm();
    await reloadScoped();
    flash(
      !askedNotify
        ? "Incident logged."
        : r.data.parentNotified
          ? "Incident logged. The parent was notified on the school app."
          : "Incident logged. The parent app notice did not reach anyone (no app signed in for this family) — ask the office to call if the parent must hear today.",
    );
  }

  // --- All incidents ---
  const [filterCategory, setFilterCategory] = useState<DisciplineCategory | "">("");
  const [filterStatus, setFilterStatus] = useState<IncidentStatus | "">("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const allRows = useMemo(() => {
    return view.incidents
      .filter((i) => !filterCategory || i.category === filterCategory)
      .filter((i) => !filterStatus || i.status === filterStatus)
      .filter((i) => !filterFrom || i.date >= filterFrom)
      .filter((i) => !filterTo || i.date <= filterTo)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [view, filterCategory, filterStatus, filterFrom, filterTo]);

  function studentName(id: string): string {
    return sis?.students.find((s) => s.id === id)?.fullName || "—";
  }

  async function onNotifyParent(incident: DisciplineIncident) {
    if (!sis) return;
    const res = await notifyDisciplineParent(incident, sis);
    if (!res.ok) {
      setError(res.error || "Notify failed");
      return;
    }
    const { state: next } = upsertIncident(state, {
      ...incident,
      notifiedParentAt: new Date().toISOString(),
    });
    const saved = trySaveDiscipline(next);
    if (!saved.ok) {
      // The message went; only the "Parent told" mark could not be kept.
      setError(`WhatsApp sent to ${studentName(incident.studentId)}'s parent, but the register could not be updated. ${DISCIPLINE_SAVE_REFUSED}`);
      return;
    }
    setState(saved.state);
    flash(`Parent notified for ${studentName(incident.studentId)}.`);
  }

  function onSetEscalation(incident: DisciplineIncident, level: EscalationLevel) {
    if (level !== "none" && level !== "warning" && !canApprove) {
      setError("Escalating past Warning needs the Approve permission.");
      return;
    }
    const { state: next } = upsertIncident(state, {
      ...incident,
      escalationLevel: level,
    });
    const saved = trySaveDiscipline(next);
    if (!saved.ok) {
      setError(DISCIPLINE_SAVE_REFUSED);
      return;
    }
    setState(saved.state);
  }

  function onDelete(id: string) {
    if (!window.confirm("Delete this incident?")) return;
    const saved = trySaveDiscipline({
      ...state,
      incidents: state.incidents.filter((i) => i.id !== id),
    });
    if (!saved.ok) {
      setError(DISCIPLINE_SAVE_REFUSED);
      return;
    }
    setState(saved.state);
  }

  // --- By student ---
  const [byStudentQuery, setByStudentQuery] = useState("");
  const [byStudentId, setByStudentId] = useState<string | null>(null);
  const byStudentMatches = useMemo(() => {
    const q = byStudentQuery.trim().toLowerCase();
    if (!q) return [];
    return pickable
      .filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q),
      )
      .slice(0, 15);
  }, [pickable, byStudentQuery]);
  const byStudentHistory = useMemo(
    () => (byStudentId ? view.incidents.filter((i) => i.studentId === byStudentId) : []),
    [view, byStudentId],
  );
  const byStudentAy = teacherMode ? my.academicYearCode : ay;
  const byStudentTotal = byStudentId ? studentPointsTotal(view, byStudentId, byStudentAy) : 0;
  const byStudentRecent = byStudentId ? recentIncidentCount(view, byStudentId) : 0;
  const byStudentSuggestion = suggestEscalationLevel(byStudentTotal, byStudentRecent);
  // Looked up in the pickable list, not the whole SIS, so a stale id from
  // before the scope loaded can never show another class's child.
  const byStudent = pickable.find((s) => s.id === byStudentId) || null;

  /**
   * The incident register as a register. A child's name, what happened, when,
   * and what it cost them in points belong in columns — this is the list a
   * head of school reads down when deciding whether a pattern is forming,
   * and a run-on grey line cannot be sorted by date or by points.
   *
   * Escalation stays an editable cell rather than moving into the row menu:
   * changing it is the common act here, and burying a one-click change two
   * clicks deep would be a step backwards.
   */
  const incidentCols: DataTableColumn<(typeof allRows)[number]>[] = [
    { key: "student", header: "Student", sortable: true, value: (i) => studentName(i.studentId) },
    { key: "category", header: "Category", sortable: true, value: (i) => disciplineCategoryLabel(i.category) },
    { key: "date", header: "Date", sortable: true, value: (i) => i.date },
    {
      key: "points", header: "Points", align: "right", sortable: true,
      value: (i) => i.pointsDelta,
      render: (i) => `${i.pointsDelta >= 0 ? "+" : ""}${i.pointsDelta}`,
    },
    { key: "what", header: "What happened", value: (i) => i.description || "—" },
    {
      key: "escalation", header: "Escalation", sortable: true,
      value: (i) => i.escalationLevel,
      // A teacher reads the level; changing it is the office's (edit) call.
      render: (i) => teacherMode ? (
        escalationLevelLabel(i.escalationLevel)
      ) : (
        <select
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
          value={i.escalationLevel}
          onChange={(e) => onSetEscalation(i, e.target.value as EscalationLevel)}
          disabled={readOnly || !canEdit}
        >
          {ESCALATION_LEVELS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "parent", header: "Parent told", sortable: true,
      value: (i) => (i.notifiedParentAt ? i.notifiedParentAt : ""),
      render: (i) =>
        i.notifiedParentAt ? (
          <span className="text-[var(--ok)]">Notified</span>
        ) : (
          <span className="text-[var(--muted)]">Not yet</span>
        ),
    },
  ];

  /**
   * No row actions in teacher mode. "Notify parent" here is a WhatsApp
   * send through /api/wa/dispatch under the discipline module, which needs
   * discipline.edit — a teacher would only ever get a refusal. A teacher
   * tells the parent at the moment of logging instead (the "notify on the
   * school app" tick), which the v1 POST sends to that child's own family
   * and nobody else. Delete needs edit too.
   */
  const incidentActions: RowAction<(typeof allRows)[number]>[] = teacherMode
    ? []
    : [
        {
          id: "notify", label: "Notify parent",
          onSelect: (i) => onNotifyParent(i),
          disabled: (i) => readOnly || !canEdit || !!i.notifiedParentAt,
        },
        {
          id: "delete", label: "Delete", tone: "danger", separatorAbove: true,
          onSelect: (i) => onDelete(i.id),
          disabled: () => readOnly || !canEdit,
        },
      ];

  return (
    <ErpWorkspaceShell
      title="Discipline / behavior"
      subtitle="Incident log, merit/demerit points, escalation ladder, parent WhatsApp notify"
      icon={<ShieldAlert className="size-6" aria-hidden />}
      notice={notice}
      error={error}
    >
      <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={TABS} />

      {teacherMode ? (
        <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)]">
          {my.teaching.length === 0
            ? "You have no classes assigned for this session, so there is nobody to show. Ask the office to set your timetable or class-teacher section."
            : `Showing children of your classes only: ${my.teaching.map((t) => `${t.className}-${t.sectionName}`).join(", ")}. Changing or deleting an incident is done by the office.`}
        </p>
      ) : scopeUnknown ? (
        <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)]">
          {myLoading
            ? "Loading your classes…"
            : "Could not load your classes, so no records are shown. Reload the page to try again."}
        </p>
      ) : null}
      {scopedError ? (
        <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{scopedError}</p>
      ) : null}

      {tab === "log" ? (
        <div className="mt-5 max-w-xl space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Student</span>
            {pickedStudent ? (
              <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
                <span className="text-sm font-semibold">
                  {pickedStudent.fullName} · {classSectionLabel(masters!, pickedStudent.classId, pickedStudent.sectionId)}
                </span>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--brand-deep)] underline"
                  onClick={() => setPickedStudent(null)}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  className={field}
                  placeholder="Search name or admission no…"
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                />
                {studentMatches.length > 0 ? (
                  <ul className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)]">
                    {studentMatches.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]"
                          onClick={() => {
                            setPickedStudent(s);
                            setStudentQuery("");
                          }}
                        >
                          {s.fullName}
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            {s.admissionNo}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Date</span>
            <input
              type="date"
              className={field}
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Category</span>
            <select
              className={field}
              value={logCategory}
              onChange={(e) => setLogCategory(e.target.value as DisciplineCategory)}
            >
              {DISCIPLINE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Points (negative = demerit, positive = merit)
            </span>
            <input
              type="number"
              className={field}
              value={logPoints}
              onChange={(e) => setLogPoints(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Description</span>
            <textarea
              className={field}
              rows={3}
              value={logDescription}
              onChange={(e) => setLogDescription(e.target.value)}
            />
          </label>

          {teacherMode ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={logNotify} onChange={(e) => setLogNotify(e.target.checked)} />
              Notify the parent on the school app
            </label>
          ) : null}

          <button
            type="button"
            className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
            disabled={readOnly || busy || scopeUnknown}
            onClick={() => void onLogIncident()}
          >
            Log incident
          </button>
        </div>
      ) : null}

      {tab === "all" ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Category</span>
              <select
                className={`${field} !py-1.5`}
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as DisciplineCategory | "")}
              >
                <option value="">All</option>
                {DISCIPLINE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Status</span>
              <select
                className={`${field} !py-1.5`}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as IncidentStatus | "")}
              >
                <option value="">All</option>
                <option value="open">Open</option>
                <option value="reviewed">Reviewed</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">From</span>
              <input type="date" className={`${field} !py-1.5`} value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">To</span>
              <input type="date" className={`${field} !py-1.5`} value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </label>
          </div>

          {allRows.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
              {/* Not loaded is not "none": say which it is. */}
              {scopedError
                ? scopedError
                : scopeUnknown && !myLoading
                  ? "Could not load your classes, so no incidents are shown."
                  : scopeUnknown || (teacherMode && !scoped)
                    ? "Loading…"
                    : "No incidents match this filter."}
            </p>
          ) : (
            <DataTable
              columns={incidentCols}
              rows={allRows}
              rowKey={(i) => i.id}
              rowActions={incidentActions.length ? incidentActions : undefined}
              rowActionsLabel="Incident actions"
              minWidth="min-w-[980px]"
              exportFileBaseName="discipline-incidents"
              exportTitle="Discipline incidents"
              emptyTitle="No incidents match this filter."
            />
          )}
        </div>
      ) : null}

      {tab === "student" ? (
        <div className="mt-5 space-y-4">
          <label className="block max-w-md text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Student</span>
            <input
              className={field}
              placeholder="Search name or admission no…"
              value={byStudentQuery}
              onChange={(e) => setByStudentQuery(e.target.value)}
            />
            {byStudentMatches.length > 0 ? (
              <ul className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)]">
                {byStudentMatches.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]"
                      onClick={() => {
                        setByStudentId(s.id);
                        setByStudentQuery("");
                      }}
                    >
                      {s.fullName}
                      <span className="ml-2 text-xs text-[var(--muted)]">{s.admissionNo}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>

          {byStudent ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div>
                  <p className="text-sm font-bold">{byStudent.fullName}</p>
                  <p className="text-xs text-[var(--muted)]">{byStudent.admissionNo}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Points this AY</p>
                  <p className="text-lg font-bold text-[var(--brand-deep)]">{byStudentTotal}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Suggested — adjust to your school&apos;s policy
                  </p>
                  <p className="text-sm font-semibold">
                    {escalationLevelLabel(byStudentSuggestion)}
                  </p>
                </div>
              </div>

              {byStudentHistory.length === 0 ? (
                <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
                  {teacherMode && !scoped
                    ? scopedError || "Loading…"
                    : "No incidents logged for this student."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {byStudentHistory
                    .slice()
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((i) => (
                      <li key={i.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
                        <span className="font-semibold">{i.date}</span> ·{" "}
                        {disciplineCategoryLabel(i.category)} ·{" "}
                        {i.pointsDelta >= 0 ? "+" : ""}{i.pointsDelta} pt ·{" "}
                        {escalationLevelLabel(i.escalationLevel)}
                        <p className="text-[var(--muted)]">{i.description}</p>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </ErpWorkspaceShell>
  );
}
