"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  type PeriodDelivery,
  type TeachingLogStatus,
  type TeachingState,
} from "@/lib/teaching";
import { hasPermission } from "@/lib/rbac";
import { resolveSessionStaff } from "@/lib/staffResolve";
import { useDemoSession } from "@/components/shell/SessionContext";
import { SyllabusPlanPanel } from "@/components/teaching/SyllabusPlanPanel";
import { LessonPlansPanel } from "@/components/teaching/LessonPlansPanel";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";

type TeachTab = "today" | "plan" | "lessons" | "coverage";

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

  // A teacher without the export right sees only their own periods, and
  // cannot widen the filter to the rest of the staff room.
  const effectiveStaffFilter = canSeeEveryone ? staffFilter : me?.id || "";

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
    if (!timetable || !masters) return null;
    return resolveExpectedPeriods({
      timetable,
      masters,
      academicYearCode: ay,
      date,
      staffId: effectiveStaffFilter || undefined,
    });
  }, [timetable, masters, ay, date, effectiveStaffFilter]);

  const dayRows = useMemo(() => {
    if (!state || !dayResult?.ok) return [];
    return computeDelivery({
      expected: dayResult.periods,
      logs: state.logs,
      academicYearCode: ay,
      policy: state.policy,
    });
  }, [state, dayResult, ay]);

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
    saveTeaching(result.value.state);
    setState(result.value.state);
    setNotice(`Saved — ${STATUS_LABEL[status as PeriodDelivery["status"]]}`);
  }

  function setPeriodTopic(row: PeriodDelivery, unitIds: string[]) {
    if (!state || !row.log) return;
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
    saveTeaching(result.value.state);
    setState(result.value.state);
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
    if (!timetable || !masters || !state) {
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
  }, [timetable, masters, state, rangeDates, ay, effectiveStaffFilter]);

  const coverageSummary = useMemo(
    () => summarizeCoverage(coverage.rows),
    [coverage.rows],
  );
  const perTeacher = useMemo(
    () => summarizeByTeacher(coverage.rows),
    [coverage.rows],
  );

  /* ---------------------------------------------------------------- */
  /* Syllabus plan                                                    */
  /* ---------------------------------------------------------------- */

  const classSubjects = useMemo(() => {
    if (!masters || !planClassId) return [];
    const links = (masters.classSubjects ?? []).filter(
      (l) => l.classId === planClassId && l.isActive,
    );
    return links
      .map((l) => (masters.subjects ?? []).find((s) => s.id === l.subjectId))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [masters, planClassId]);

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
            {canSeeEveryone ? (
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
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2">Class</th>
                      <th className="px-3 py-2">Subject</th>
                      <th className="px-3 py-2">Teacher</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Topic covered</th>
                      {canEdit ? <th className="px-3 py-2">Log</th> : null}
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {dayRows.map((row) => {
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
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => logPeriod(row, "delivered")}
                                  className="rounded-lg bg-[var(--success)] px-2 py-1 text-xs font-semibold text-white"
                                >
                                  Taught
                                </button>
                                <button
                                  type="button"
                                  onClick={() => logPeriod(row, "not_delivered")}
                                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--danger)]"
                                >
                                  Not taught
                                </button>
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
                value={planClassId}
                onChange={(e) => {
                  setPlanClassId(e.target.value);
                  setPlanSubjectId("");
                }}
                className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {(masters.classes ?? [])
                  .filter((c) => c.isActive)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Subject
              <select
                value={planSubjectId}
                onChange={(e) => setPlanSubjectId(e.target.value)}
                disabled={!planClassId}
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

          {tab === "plan" ? (
            <SyllabusPlanPanel
              state={state}
              onChange={commit}
              academicYearCode={ay}
              classId={planClassId}
              subjectId={planSubjectId}
              canEdit={canManagePlan}
              createdBy={me?.id || session.fullName}
              onError={setError}
              onNotice={setNotice}
            />
          ) : (
            <LessonPlansPanel
              state={state}
              onChange={commit}
              academicYearCode={ay}
              classId={planClassId}
              subjectId={planSubjectId}
              canEdit={canEdit}
              createdBy={me?.id || session.fullName}
              onError={setError}
              onNotice={setNotice}
            />
          )}
        </section>
      ) : null}

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
            {canSeeEveryone ? (
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
                  <th className="px-3 py-2">Teacher</th>
                  <th className="px-3 py-2">Scheduled</th>
                  <th className="px-3 py-2">Taught</th>
                  <th className="px-3 py-2">Not taught</th>
                  <th className="px-3 py-2">Not logged</th>
                  <th className="px-3 py-2">Taught %</th>
                  <th className="px-3 py-2">Logged %</th>
                  <th className="px-3 py-2">Off campus</th>
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
                  perTeacher.map((row) => (
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
