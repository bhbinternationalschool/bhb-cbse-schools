"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { urlAsksForTab } from "@/lib/nucleusHandoff";
import { BookMarked } from "lucide-react";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import {
  classSectionLabel,
  loadTimetable,
  subjectLabel,
  teacherLabel,
  type TimetableState,
} from "@/lib/timetable";
import {
  computeDelivery,
  istDateOf,
  loadTeaching,
  resolveExpectedPeriods,
  saveTeaching,
  summarizeByTeacher,
  summarizeCoverage,
  upsertTeachingLog,
  writeTeachingLocalRaw,
  type PeriodDelivery,
  type SyllabusImportChapter,
  type TeachingLog,
  type TeachingLogStatus,
  type TeachingState,
} from "@/lib/teaching";
import { hasPermission } from "@/lib/rbac";
import { resolveSessionStaff } from "@/lib/staffResolve";
import { useDemoSession } from "@/components/shell/SessionContext";
import { isRestrictedTeacher, useMyTeaching } from "@/components/staff/useMyTeaching";
import {
  postLessonPlan,
  postPeriodLog,
  postSyllabusImport,
} from "@/components/teaching/teachingApi";
import { SyllabusPlanPanel } from "@/components/teaching/SyllabusPlanPanel";
import { LessonPlansPanel } from "@/components/teaching/LessonPlansPanel";
import { ChapterOutcomesPanel } from "@/components/teaching/ChapterOutcomesPanel";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { NucleusProgressPanel } from "@/components/teaching/NucleusProgressPanel";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

type TeachTab = "today" | "plan" | "lessons" | "coverage" | "outcomes" | "nucleus";

const STATUS_LABEL: Record<PeriodDelivery["status"], string> = {
  delivered: "Taught",
  not_delivered: "Not taught",
  substituted: "Taught by substitute",
  unlogged: "Not logged",
  pending: "Not due yet",
};

const STATUS_CLASS: Record<PeriodDelivery["status"], string> = {
  delivered: "bg-[var(--success-soft)] text-[var(--success)]",
  not_delivered: "bg-[var(--danger-soft)] text-[var(--danger)]",
  substituted: "bg-[var(--info-soft)] text-[var(--info)]",
  unlogged: "bg-[var(--warning-soft)] text-[var(--warning)]",
  pending: "bg-[var(--surface-sunken)] text-[var(--muted)]",
};

/** Reason text for a day whose schedule could not be resolved. */
const REFUSAL_TEXT: Record<string, string> = {
  no_published_timetable:
    "No published timetable for this year — publish the timetable before coverage can be measured.",
  non_working_weekday: "Not a working day on the bell calendar.",
  holiday: "Holiday — no periods scheduled.",
  invalid_date: "Pick a valid date.",
};

function pct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

export function TeachingWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<TeachTab>("today");

  // The Nucleus bookmark opens this workspace straight at Nucleus progress, so the
  // office never hunts for the tab. Read once, on the client, and never
  // written back to the URL.
  useEffect(() => {
    if (urlAsksForTab(window.location.search, "nucleus")) setTab("nucleus");
  }, []);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [timetable, setTimetable] = useState<TimetableState | null>(null);
  const [state, setState] = useState<TeachingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [date, setDate] = useState(() => istDateOf());
  const [staffFilter, setStaffFilter] = useState("");
  const [planClassId, setPlanClassId] = useState("");
  const [planSubjectId, setPlanSubjectId] = useState("");
  const [fromDate, setFromDate] = useState(() => istDateOf());
  const [toDate, setToDate] = useState(() => istDateOf());

  const ay = session.academicYearCode || DEFAULT_AY;

  const refresh = useCallback(() => {
    setMasters(loadMasters());
    setTimetable(loadTimetable());
    setState(loadTeaching());
  }, []);

  useEffect(() => {
    refresh();
    void (async () => {
      const [{ ensureTimetableHydrated }, { ensureTeachingHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/timetablePersistence"),
          import("@/lib/teachingPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      const [ttChanged, tChanged] = await Promise.all([
        withHydrationSlot(() => ensureTimetableHydrated()),
        withHydrationSlot(() => ensureTeachingHydrated()),
      ]);
      if (ttChanged || tChanged) refresh();
    })();
  }, [refresh]);

  const me = useMemo(
    () => (masters ? resolveSessionStaff(session, masters) : null),
    [session, masters],
  );

  const canEdit = useMemo(
    () => hasPermission(session, masters, "teaching", "edit"),
    [session, masters],
  );
  const canManagePlan = useMemo(
    () => hasPermission(session, masters, "teaching", "delete"),
    [session, masters],
  );
  const canSeeEveryone = useMemo(
    () => hasPermission(session, masters, "teaching", "export"),
    [session, masters],
  );
  // Agreeing with a chapter's learning outcomes is not an edit to one lesson:
  // it puts a sentence in front of every lesson plan for that chapter. Only
  // the role that holds `approve` may do it; everyone else reads the list.
  const canApproveOutcomes = useMemo(
    () => hasPermission(session, masters, "teaching", "approve"),
    [session, masters],
  );

  // "My classes" from the server — the same answer the v1 routes use to
  // allow or refuse a save. Principal / office come back unrestricted and
  // keep the whole-school desk.
  const { my } = useMyTeaching();
  const teacherMode = isRestrictedTeacher(my);
  const seeEveryone = canSeeEveryone && !teacherMode;
  // Pickers are narrowed for a teacher, and — failing closed — for anyone
  // without the export right while "my classes" has not arrived.
  const restrictPickers = teacherMode || (!my && !canSeeEveryone);
  // Anyone not confirmed school-wide saves one row at a time through the
  // scope-checked v1 routes; the whole-blob push refuses them (2026-09-29).
  const writesViaApi = my ? !my.unrestricted : !canSeeEveryone;

  // A teacher without the export right sees only their own periods, and
  // cannot widen the filter to the rest of the staff room.
  // The session's own staff id, not resolveSessionStaff(): that looks the
  // person up in Masters, and when Masters' staff list was empty it found
  // nobody — the filter became "" and a teacher saw every teacher's
  // periods (fixed 2026-09-29). No staff id now means no periods.
  const ownStaffId = session.staffId || "";
  const effectiveStaffFilter = seeEveryone ? staffFilter : ownStaffId;
  const noOwnPeriods = !seeEveryone && !ownStaffId;

  const teachingStaff = useMemo(() => {
    if (!masters) return [];
    return (masters.staff ?? [])
      .filter((s) => s.stream === "teaching" && s.status === "active")
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [masters]);

  /* ---------------------------------------------------------------- */
  /* Today                                                            */
  /* ---------------------------------------------------------------- */

  const dayResult = useMemo(() => {
    if (!timetable || !masters || noOwnPeriods) return null;
    return resolveExpectedPeriods({
      timetable,
      masters,
      academicYearCode: ay,
      date,
      staffId: effectiveStaffFilter || undefined,
    });
  }, [timetable, masters, ay, date, effectiveStaffFilter, noOwnPeriods]);

  const dayRows = useMemo(() => {
    if (!state || !dayResult?.ok) return [];
    return computeDelivery({
      expected: dayResult.periods,
      logs: state.logs,
      academicYearCode: ay,
      policy: state.policy,
    });
  }, [state, dayResult, ay]);

  // Sorting by status groups the periods nobody has logged yet. Topic and Log hold controls, so they are not sort handles.
  const dayRowSort = useTableSort(
    dayRows,
    {
      period: (row) => row.expected.bellLabel,
      klass: (row) => (masters ? classSectionLabel(masters, row.expected.classId, row.expected.sectionId) : ""),
      subject: (row) => (masters ? subjectLabel(masters, row.expected.subjectId) : ""),
      teacher: (row) => (masters ? teacherLabel(masters, row.expected.effectiveStaffId) : ""),
      status: (row) => row.log ? 1 : 0,
    },
    "period",
    "asc",
  );

  function logPeriod(row: PeriodDelivery, status: TeachingLogStatus) {
    if (!state) return;
    setError(null);
    setNotice(null);
    const now = new Date();
    const result = upsertTeachingLog(state, {
      academicYearCode: ay,
      date: row.expected.date,
      periodNo: row.expected.periodNo,
      classId: row.expected.classId,
      sectionId: row.expected.sectionId,
      subjectId: row.expected.subjectId,
      staffId: row.expected.effectiveStaffId,
      scheduledStaffId: row.expected.isSubstituted
        ? row.expected.scheduledStaffId
        : "",
      status: row.expected.isSubstituted && status === "delivered"
        ? "substituted"
        : status,
      // Only stamp a start time when the teacher is logging the period
      // as it happens; a backfill leaves punctuality unmeasured rather
      // than inventing an on-time start.
      startedAt:
        row.expected.date === istDateOf(now) && status !== "not_delivered"
          ? now.toISOString()
          : row.log?.startedAt || "",
      unitIds: row.log?.unitIds ?? [],
      note: row.log?.note ?? "",
      createdBy: me?.id || session.fullName,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const label = STATUS_LABEL[status as PeriodDelivery["status"]];
    void persistLog(row, result.value.state, result.value.log, `Saved — ${label}`);
  }

  const [logBusy, setLogBusy] = useState(false);

  /**
   * The office saves the whole desk as before. Anyone else sends the one
   * period to /api/v1/teaching/log, which re-finds it on their own
   * timetable before saving; it lands on screen only once the server has
   * it (the blob push would be refused for them anyway).
   */
  async function persistLog(
    row: PeriodDelivery,
    next: TeachingState,
    log: TeachingLog,
    doneNotice: string | null,
  ) {
    if (!writesViaApi) {
      saveTeaching(next);
      setState(next);
      if (doneNotice) setNotice(doneNotice);
      return;
    }
    if (logBusy) return;
    setLogBusy(true);
    const res = await postPeriodLog({
      date: row.expected.date,
      periodNo: row.expected.periodNo,
      classId: row.expected.classId,
      sectionId: row.expected.sectionId,
      status: log.status,
      unitIds: log.unitIds,
      lessonPlanId: log.lessonPlanId,
      note: log.note,
      startedAt: log.startedAt || undefined,
    });
    setLogBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Local copy only — no blob push. The next hydrate merges the server's.
    writeTeachingLocalRaw(next);
    setState(next);
    if (doneNotice) setNotice(doneNotice);
  }

  function setPeriodTopic(row: PeriodDelivery, unitIds: string[]) {
    if (!state || !row.log) return;
    setError(null);
    const result = upsertTeachingLog(
      state,
      {
        academicYearCode: ay,
        date: row.expected.date,
        periodNo: row.expected.periodNo,
        classId: row.expected.classId,
        sectionId: row.expected.sectionId,
        subjectId: row.expected.subjectId,
        staffId: row.log.staffId,
        scheduledStaffId: row.log.scheduledStaffId,
        status: row.log.status,
        startedAt: row.log.startedAt,
        endedAt: row.log.endedAt,
        unitIds,
        note: row.log.note,
        createdBy: row.log.createdBy,
      },
      { skipBackdateCheck: true },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    void persistLog(row, result.value.state, result.value.log, null);
  }

  /** Teacher-mode lesson-plan writes; the panel applies the server's copy. */
  const persistPlan = writesViaApi ? postLessonPlan : undefined;

  /** Put a server-saved change on screen without pushing the blob. */
  function commitLocal(next: TeachingState) {
    writeTeachingLocalRaw(next);
    setState(next);
  }

  /**
   * A teacher's scanned contents page, saved by the scope-checked v1 route
   * (2026-09-30), then the server's rows for that class and subject put on
   * screen in place of ours — ids included, so a later lesson plan or log
   * points at a chapter the server actually has.
   */
  async function importSyllabusViaApi(classId: string, subjectId: string, chapters: SyllabusImportChapter[]) {
    const r = await postSyllabusImport({ classId, subjectId, chapters });
    if (!r.ok) return { ok: false as const, error: r.error };
    const { units, ...summary } = r.data;
    if (units) {
      // The local copy as it is now, not as it was when the scan began.
      const base = loadTeaching();
      const inScope = (u: TeachingState["units"][number]) =>
        u.academicYearCode === ay && u.classId === classId && u.subjectId === subjectId;
      commitLocal({ ...base, units: [...base.units.filter((u) => !inScope(u)), ...units] });
    }
    return { ok: true as const, summary };
  }

  const daySummary = useMemo(() => summarizeCoverage(dayRows), [dayRows]);

  /* ---------------------------------------------------------------- */
  /* Coverage over a date range                                       */
  /* ---------------------------------------------------------------- */

  const rangeDates = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return [];
    const out: string[] = [];
    const cursor = new Date(`${fromDate}T12:00:00`);
    const end = new Date(`${toDate}T12:00:00`);
    // Guard against an accidental multi-year range locking the browser.
    let guard = 0;
    while (cursor <= end && guard < 400) {
      out.push(istDateOf(cursor));
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
    return out;
  }, [fromDate, toDate]);

  const coverage = useMemo(() => {
    if (!timetable || !masters || !state || noOwnPeriods) {
      return { rows: [] as PeriodDelivery[], skipped: [] as string[] };
    }
    const rows: PeriodDelivery[] = [];
    const skipped: string[] = [];
    for (const d of rangeDates) {
      const res = resolveExpectedPeriods({
        timetable,
        masters,
        academicYearCode: ay,
        date: d,
        staffId: effectiveStaffFilter || undefined,
      });
      if (!res.ok) {
        // Days we could not resolve are named, not silently dropped —
        // a report that quietly skips a fortnight of unpublished
        // timetable would read as a fortnight of perfect coverage.
        if (res.reason === "no_published_timetable") skipped.push(d);
        continue;
      }
      rows.push(
        ...computeDelivery({
          expected: res.periods,
          logs: state.logs,
          academicYearCode: ay,
          policy: state.policy,
        }),
      );
    }
    return { rows, skipped };
  }, [timetable, masters, state, rangeDates, ay, effectiveStaffFilter, noOwnPeriods]);

  const coverageSummary = useMemo(
    () => summarizeCoverage(coverage.rows),
    [coverage.rows],
  );
  const perTeacher = useMemo(
    () => summarizeByTeacher(coverage.rows),
    [coverage.rows],
  );
  const perTeacherSort = useTableSort(
    perTeacher,
    {
      teacher: (row) => (masters ? teacherLabel(masters, row.staffId) : row.staffId),
      scheduled: (row) => row.summary.expectedPeriods,
      taught: (row) => row.summary.delivered + row.summary.substituted,
      notTaught: (row) => row.summary.notDelivered,
      unlogged: (row) => row.summary.unlogged,
      taughtPct: (row) => row.summary.deliveryPercent,
      loggedPct: (row) => row.summary.logPercent,
      // No location-bearing logs shows "—": unknown, so it sorts last.
      offCampus: (row) =>
        row.summary.locationChecked === 0 ? null : row.summary.offCampus,
    },
    "teacher",
  );

  /* ---------------------------------------------------------------- */
  /* Syllabus plan                                                    */
  /* ---------------------------------------------------------------- */

  // A teacher's Syllabus / Lesson plans pickers list only their own
  // classes, and in each only the subjects they teach there (all of them
  // for a class teacher). Until 2026-09-29 every class was offered, and a
  // teacher could write lesson plans for any class and subject.
  const planClasses = useMemo(() => {
    if (!masters) return [];
    const active = (masters.classes ?? [])
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (!restrictPickers) return active;
    if (!teacherMode) return [];
    const mine = new Set(my.teaching.map((t) => t.classId));
    return active.filter((c) => mine.has(c.id));
  }, [masters, restrictPickers, teacherMode, my]);

  const classSubjects = useMemo(() => {
    if (!masters || !planClassId) return [];
    const links = (masters.classSubjects ?? []).filter(
      (l) => l.classId === planClassId && l.isActive,
    );
    let allowed: Set<string> | null = null;
    if (restrictPickers) {
      allowed = new Set(
        teacherMode
          ? my.teaching
              .filter((t) => t.classId === planClassId)
              .flatMap((t) => t.subjects.map((s) => s.id))
          : [],
      );
    }
    return links
      .filter((l) => !allowed || allowed.has(l.subjectId))
      .map((l) => (masters.subjects ?? []).find((s) => s.id === l.subjectId))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [masters, planClassId, restrictPickers, teacherMode, my]);

  // A choice made before "my classes" arrived must not survive narrowing.
  const pickedClassId = planClasses.some((c) => c.id === planClassId) ? planClassId : "";
  const pickedSubjectId =
    pickedClassId && classSubjects.some((s) => s.id === planSubjectId) ? planSubjectId : "";

  // The Nucleus tab reads the whole school's progress; it is the office's.
  const showNucleus = !restrictPickers;
  useEffect(() => {
    if (!showNucleus && tab === "nucleus") setTab("today");
  }, [showNucleus, tab]);

  /** Persist a panel's edit and keep the workspace copy in step. */
  function commit(next: TeachingState) {
    saveTeaching(next);
    setState(next);
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  if (!masters || !timetable || !state) {
    return <p className="text-sm text-[var(--muted)]">Loading teaching desk…</p>;
  }

  const unitsForDay = (row: PeriodDelivery) =>
    state.units.filter(
      (u) =>
        u.isActive &&
        u.academicYearCode === ay &&
        u.classId === row.expected.classId &&
        u.subjectId === row.expected.subjectId,
    );

  return (
    <ErpWorkspaceShell
      title="Teaching & syllabus"
      subtitle="What was actually taught, against the timetable and the year plan"
      icon={<BookMarked className="h-5 w-5" />}
      error={error}
      notice={notice}
      toolbar={
        <ModuleTabs
          items={[
            { id: "today", label: "Period log" },
            { id: "plan", label: "Syllabus" },
            { id: "lessons", label: "Lesson plans" },
            { id: "coverage", label: "Coverage" },
            { id: "outcomes", label: "Learning outcomes" },
            ...(showNucleus ? [{ id: "nucleus", label: "Nucleus progress" }] : []),
          ]}
          value={tab}
          onChange={(id) => setTab(id as TeachTab)}
          aria-label="Teaching sections"
        />
      }
    >
      {tab === "today" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-[var(--muted)]">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              />
            </label>
            {seeEveryone ? (
              <label className="text-xs font-semibold text-[var(--muted)]">
                Teacher
                <select
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                >
                  <option value="">All teachers</option>
                  {teachingStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {noOwnPeriods ? (
            <p className="text-sm text-[var(--muted)]">
              This login is not linked to a staff record, so there are no
              periods of yours to show. Ask the office to link it (Staff →
              Login).
            </p>
          ) : null}

          {!dayResult ? null : !dayResult.ok ? (
            <div className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                Schedule unavailable
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {REFUSAL_TEXT[dayResult.reason] ?? dayResult.detail}
              </p>
            </div>
          ) : dayRows.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No periods scheduled for this selection.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm">
                <span>
                  <strong>{daySummary.expectedPeriods}</strong> scheduled
                </span>
                <span className="text-[var(--success)]">
                  <strong>{daySummary.delivered + daySummary.substituted}</strong>{" "}
                  taught
                </span>
                <span className="text-[var(--danger)]">
                  <strong>{daySummary.notDelivered}</strong> not taught
                </span>
                <span className="text-[var(--warning)]">
                  <strong>{daySummary.unlogged}</strong> not logged
                </span>
                <span className="text-[var(--muted)]">
                  <strong>{daySummary.pending}</strong> not due yet
                </span>
              </div>

              <div className="overflow-x-auto">
                <ErpTable minWidth="min-w-[900px]">
                  <ErpTableHead>
                    <tr>
                      <ErpSortTh sort={dayRowSort} field="period" className="px-3 py-2">Period</ErpSortTh>
                      <ErpSortTh sort={dayRowSort} field="klass" className="px-3 py-2">Class</ErpSortTh>
                      <ErpSortTh sort={dayRowSort} field="subject" className="px-3 py-2">Subject</ErpSortTh>
                      <ErpSortTh sort={dayRowSort} field="teacher" className="px-3 py-2">Teacher</ErpSortTh>
                      <ErpSortTh sort={dayRowSort} field="status" className="px-3 py-2">Status</ErpSortTh>
                      <th className="px-3 py-2">Topic covered</th>
                      {canEdit ? <th className="px-3 py-2">Log</th> : null}
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {dayRowSort.rows.map((row) => {
                      const key = `${row.expected.periodNo}-${row.expected.classId}-${row.expected.sectionId}`;
                      const units = unitsForDay(row);
                      return (
                        <tr key={key}>
                          <td className="px-3 py-2">
                            <div className="font-semibold">
                              {row.expected.bellLabel}
                            </div>
                            <div className="text-xs text-[var(--muted)]">
                              {row.expected.startTime}–{row.expected.endTime}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {classSectionLabel(
                              masters,
                              row.expected.classId,
                              row.expected.sectionId,
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {subjectLabel(masters, row.expected.subjectId)}
                          </td>
                          <td className="px-3 py-2">
                            {teacherLabel(
                              masters,
                              row.expected.effectiveStaffId,
                            )}
                            {row.expected.isSubstituted ? (
                              <div className="text-xs text-[var(--info)]">
                                for{" "}
                                {teacherLabel(
                                  masters,
                                  row.expected.scheduledStaffId,
                                )}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[row.status]}`}
                            >
                              {STATUS_LABEL[row.status]}
                            </span>
                            {row.startedOnTime === false ? (
                              <div className="text-xs text-[var(--warning)]">
                                started {row.minutesLate} min late
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {row.log && canEdit ? (
                              <select
                                value={row.log.unitIds[0] ?? ""}
                                onChange={(e) =>
                                  setPeriodTopic(
                                    row,
                                    e.target.value ? [e.target.value] : [],
                                  )
                                }
                                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                              >
                                <option value="">— not recorded —</option>
                                {units.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.code ? `${u.code} · ` : ""}
                                    {u.title}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">
                                {row.log?.unitIds
                                  .map(
                                    (id) =>
                                      state.units.find((u) => u.id === id)
                                        ?.title ?? "",
                                  )
                                  .filter(Boolean)
                                  .join(", ") || "—"}
                              </span>
                            )}
                          </td>
                          {canEdit ? (
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => logPeriod(row, "delivered")}
                                  className="rounded-lg bg-[var(--success)] px-2 py-1 text-xs font-semibold text-white"
                                >
                                  Taught
                                </button>
                                <RowActionMenu
                                  row={row}
                                  label="Period actions"
                                  actions={[
                                    { id: "taught", label: "Mark taught", onSelect: (x) => logPeriod(x, "delivered") },
                                    {
                                      id: "not",
                                      label: "Mark not taught",
                                      tone: "danger",
                                      onSelect: (x) => logPeriod(x, "not_delivered"),
                                    },
                                  ]}
                                />
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </ErpTableBody>
                </ErpTable>
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "plan" || tab === "lessons" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-[var(--muted)]">
              Class
              <select
                value={pickedClassId}
                onChange={(e) => {
                  setPlanClassId(e.target.value);
                  setPlanSubjectId("");
                }}
                className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {planClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Subject
              <select
                value={pickedSubjectId}
                onChange={(e) => setPlanSubjectId(e.target.value)}
                disabled={!pickedClassId}
                className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">Select…</option>
                {classSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameEn}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {restrictPickers && planClasses.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {teacherMode
                ? "No classes are linked to you yet — ask the office to add them (Staff → Duties)."
                : "Loading your classes…"}
            </p>
          ) : null}

          {tab === "plan" ? (
            <SyllabusPlanPanel
              state={state}
              onChange={commit}
              academicYearCode={ay}
              classId={pickedClassId}
              subjectId={pickedSubjectId}
              classLabel={masters?.classes.find((c) => c.id === pickedClassId)?.name ?? ""}
              subjectName={masters ? subjectLabel(masters, pickedSubjectId) : ""}
              // The syllabus is the school's plan, saved by whole-desk push —
              // which only the office and principal may make.
              canEdit={canManagePlan && !writesViaApi}
              createdBy={me?.id || session.fullName}
              onError={setError}
              onNotice={setNotice}
              // A teacher adds a scanned book's chapters to their own class's
              // plan through the v1 route, which checks the class and subject.
              onServerImport={
                writesViaApi && canEdit && pickedClassId && pickedSubjectId
                  ? (chapters) => importSyllabusViaApi(pickedClassId, pickedSubjectId, chapters)
                  : undefined
              }
            />
          ) : (
            <LessonPlansPanel
              state={state}
              onChange={writesViaApi ? commitLocal : commit}
              persist={persistPlan}
              academicYearCode={ay}
              classId={pickedClassId}
              subjectId={pickedSubjectId}
              canEdit={canEdit}
              createdBy={me?.id || session.fullName}
              classLabel={
                masters?.classes.find((c) => c.id === pickedClassId)?.name ??
                ""
              }
              subjectName={masters ? subjectLabel(masters, pickedSubjectId) : ""}
              onError={setError}
              onNotice={setNotice}
            />
          )}
        </section>
      ) : null}

      {tab === "outcomes" ? <ChapterOutcomesPanel canApprove={canApproveOutcomes} /> : null}

      {tab === "nucleus" && showNucleus ? <NucleusProgressPanel academicYearCode={ay} /> : null}

      {tab === "coverage" ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-[var(--muted)]">
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              />
            </label>
            {seeEveryone ? (
              <label className="text-xs font-semibold text-[var(--muted)]">
                Teacher
                <select
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                >
                  <option value="">All teachers</option>
                  {teachingStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {coverage.skipped.length > 0 ? (
            <div className="rounded-xl border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                {coverage.skipped.length} day(s) excluded — no published
                timetable
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                These days are not counted in the figures below, in either
                direction.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard
              label="Periods scheduled"
              value={String(coverageSummary.expectedPeriods)}
            />
            <SummaryCard
              label="Taught (of decided)"
              value={pct(coverageSummary.deliveryPercent)}
              hint={`${coverageSummary.delivered + coverageSummary.substituted} taught · ${coverageSummary.notDelivered} not`}
            />
            <SummaryCard
              label="Periods logged"
              value={pct(coverageSummary.logPercent)}
              hint={`${coverageSummary.unlogged} still unlogged`}
              warn={
                coverageSummary.logPercent !== null &&
                coverageSummary.logPercent < 80
              }
            />
            <SummaryCard
              label="On-time starts"
              value={
                coverageSummary.onTimeStarts + coverageSummary.lateStarts === 0
                  ? "—"
                  : `${coverageSummary.onTimeStarts}/${
                      coverageSummary.onTimeStarts + coverageSummary.lateStarts
                    }`
              }
              hint="only periods with a live start tap"
            />
            <SummaryCard
              label="Logged off campus"
              value={
                coverageSummary.locationChecked === 0
                  ? "—"
                  : `${coverageSummary.offCampus}/${coverageSummary.locationChecked}`
              }
              hint={
                coverageSummary.locationChecked === 0
                  ? "no logs carried a location check"
                  : "of the logs that carried a location"
              }
              warn={coverageSummary.offCampus > 0}
            />
          </div>

          {coverageSummary.offCampus > 0 ? (
            <p className="text-xs text-[var(--muted)]">
              A period logged off campus is a question to ask, not a finding.
              A phone that fixed its position late, a teacher who logged on the
              walk home, and a period that never happened all look the same
              here.
            </p>
          ) : null}

          {coverageSummary.logPercent !== null &&
          coverageSummary.logPercent < 80 ? (
            <p className="text-xs text-[var(--muted)]">
              Read the &ldquo;taught&rdquo; figure alongside the logged figure —
              with {coverageSummary.unlogged} periods unlogged, it describes
              only the periods someone recorded, not the whole school.
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <ErpTable minWidth="min-w-[820px]">
              <ErpTableHead>
                <tr>
                  <ErpSortTh sort={perTeacherSort} field="teacher" className="px-3 py-2">Teacher</ErpSortTh>
                  <ErpSortTh sort={perTeacherSort} field="scheduled" className="px-3 py-2">Scheduled</ErpSortTh>
                  <ErpSortTh sort={perTeacherSort} field="taught" className="px-3 py-2">Taught</ErpSortTh>
                  <ErpSortTh sort={perTeacherSort} field="notTaught" className="px-3 py-2">Not taught</ErpSortTh>
                  <ErpSortTh sort={perTeacherSort} field="unlogged" className="px-3 py-2">Not logged</ErpSortTh>
                  <ErpSortTh sort={perTeacherSort} field="taughtPct" className="px-3 py-2">Taught %</ErpSortTh>
                  <ErpSortTh sort={perTeacherSort} field="loggedPct" className="px-3 py-2">Logged %</ErpSortTh>
                  <ErpSortTh sort={perTeacherSort} field="offCampus" className="px-3 py-2">Off campus</ErpSortTh>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {perTeacher.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-6 text-center text-sm text-[var(--muted)]"
                    >
                      No scheduled periods in this range.
                    </td>
                  </tr>
                ) : (
                  perTeacherSort.rows.map((row) => (
                    <tr key={row.staffId}>
                      <td className="px-3 py-2">
                        {teacherLabel(masters, row.staffId)}
                      </td>
                      <td className="px-3 py-2">
                        {row.summary.expectedPeriods}
                      </td>
                      <td className="px-3 py-2 text-[var(--success)]">
                        {row.summary.delivered + row.summary.substituted}
                      </td>
                      <td className="px-3 py-2 text-[var(--danger)]">
                        {row.summary.notDelivered}
                      </td>
                      <td className="px-3 py-2 text-[var(--warning)]">
                        {row.summary.unlogged}
                      </td>
                      <td className="px-3 py-2">
                        {pct(row.summary.deliveryPercent)}
                      </td>
                      <td className="px-3 py-2">
                        {pct(row.summary.logPercent)}
                      </td>
                      <td className="px-3 py-2">
                        {row.summary.locationChecked === 0 ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <span
                            className={
                              row.summary.offCampus > 0
                                ? "text-[var(--warning)]"
                                : undefined
                            }
                          >
                            {row.summary.offCampus}/
                            {row.summary.locationChecked}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </ErpTableBody>
            </ErpTable>
          </div>
        </section>
      ) : null}
    </ErpWorkspaceShell>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        warn
          ? "border-[var(--warning)]/30 bg-[var(--warning-soft)]"
          : "border-[var(--border)] bg-[var(--card)]"
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-[var(--brand-deep)]">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
