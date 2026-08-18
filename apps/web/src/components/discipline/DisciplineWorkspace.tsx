"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useDemoSession, useSessionReadOnly } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { field } from "@/components/ui/erp-ui";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { classSectionLabel } from "@/lib/timetable";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import {
  deleteIncident,
  disciplineCategoryLabel,
  DISCIPLINE_CATEGORIES,
  escalationLevelLabel,
  ESCALATION_LEVELS,
  loadDiscipline,
  notifyDisciplineParent,
  recentIncidentCount,
  saveDiscipline,
  studentPointsTotal,
  suggestEscalationLevel,
  upsertIncident,
  type DisciplineCategory,
  type DisciplineIncident,
  type DisciplineState,
  type EscalationLevel,
  type IncidentStatus,
} from "@/lib/discipline";

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

  // --- Log incident ---
  const [studentQuery, setStudentQuery] = useState("");
  const [pickedStudent, setPickedStudent] = useState<SisStudent | null>(null);
  const [logCategory, setLogCategory] = useState<DisciplineCategory>("uniform");
  const [logPoints, setLogPoints] = useState("-1");
  const [logDescription, setLogDescription] = useState("");
  const [logDate, setLogDate] = useState(todayIso());

  const studentMatches = useMemo(() => {
    if (!sis) return [];
    const q = studentQuery.trim().toLowerCase();
    if (!q) return [];
    return sis.students
      .filter((s) => s.status === "active")
      .filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q),
      )
      .slice(0, 15);
  }, [sis, studentQuery]);

  function resetLogForm() {
    setPickedStudent(null);
    setStudentQuery("");
    setLogCategory("uniform");
    setLogPoints("-1");
    setLogDescription("");
    setLogDate(todayIso());
  }

  function onLogIncident() {
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
    const { state: withIncident } = upsertIncident(state, {
      studentId: pickedStudent.id,
      academicYearCode: ay,
      date: logDate,
      category: logCategory,
      pointsDelta: points,
      description: logDescription.trim(),
      reportedByStaffId: session.staffId || "",
    });
    const saved = saveDiscipline(withIncident);
    setState(saved);
    resetLogForm();
    flash("Incident logged.");
  }

  // --- All incidents ---
  const [filterCategory, setFilterCategory] = useState<DisciplineCategory | "">("");
  const [filterStatus, setFilterStatus] = useState<IncidentStatus | "">("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const allRows = useMemo(() => {
    return state.incidents
      .filter((i) => !filterCategory || i.category === filterCategory)
      .filter((i) => !filterStatus || i.status === filterStatus)
      .filter((i) => !filterFrom || i.date >= filterFrom)
      .filter((i) => !filterTo || i.date <= filterTo)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [state, filterCategory, filterStatus, filterFrom, filterTo]);

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
    setState(saveDiscipline(next));
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
    setState(saveDiscipline(next));
  }

  function onDelete(id: string) {
    if (!window.confirm("Delete this incident?")) return;
    setState(deleteIncident(state, id));
  }

  // --- By student ---
  const [byStudentQuery, setByStudentQuery] = useState("");
  const [byStudentId, setByStudentId] = useState<string | null>(null);
  const byStudentMatches = useMemo(() => {
    if (!sis) return [];
    const q = byStudentQuery.trim().toLowerCase();
    if (!q) return [];
    return sis.students
      .filter((s) => s.status === "active")
      .filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q),
      )
      .slice(0, 15);
  }, [sis, byStudentQuery]);
  const byStudentHistory = useMemo(
    () => (byStudentId ? state.incidents.filter((i) => i.studentId === byStudentId) : []),
    [state, byStudentId],
  );
  const byStudentTotal = byStudentId ? studentPointsTotal(state, byStudentId, ay) : 0;
  const byStudentRecent = byStudentId ? recentIncidentCount(state, byStudentId) : 0;
  const byStudentSuggestion = suggestEscalationLevel(byStudentTotal, byStudentRecent);
  const byStudent = sis?.students.find((s) => s.id === byStudentId) || null;

  return (
    <ErpWorkspaceShell
      title="Discipline / behavior"
      subtitle="Incident log, merit/demerit points, escalation ladder, parent WhatsApp notify"
      icon={<ShieldAlert className="size-6" aria-hidden />}
      notice={notice}
      error={error}
    >
      <ModuleTabs value={tab} onChange={(id) => setTab(id as Tab)} items={TABS} />

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

          <button
            type="button"
            className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
            disabled={readOnly}
            onClick={onLogIncident}
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
              No incidents match this filter.
            </p>
          ) : (
            <ul className="space-y-2">
              {allRows.map((i) => (
                <li key={i.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">{studentName(i.studentId)}</span>
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {disciplineCategoryLabel(i.category)} · {i.date} ·{" "}
                        {i.pointsDelta >= 0 ? "+" : ""}{i.pointsDelta} pt
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                        value={i.escalationLevel}
                        onChange={(e) => onSetEscalation(i, e.target.value as EscalationLevel)}
                        disabled={readOnly}
                      >
                        {ESCALATION_LEVELS.map((e) => (
                          <option key={e.value} value={e.value}>{e.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                        disabled={readOnly || !!i.notifiedParentAt}
                        onClick={() => onNotifyParent(i)}
                      >
                        {i.notifiedParentAt ? "Notified" : "Notify parent"}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-bold text-[var(--danger)]"
                        disabled={readOnly}
                        onClick={() => onDelete(i.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{i.description}</p>
                </li>
              ))}
            </ul>
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
                  No incidents logged for this student.
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
