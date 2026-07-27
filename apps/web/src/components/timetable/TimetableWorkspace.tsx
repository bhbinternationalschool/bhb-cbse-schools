"use client";

import { useEffect, useMemo, useState } from "react";
import {
  WEEKDAY_SHORT,
  classSectionLabel,
  defaultBellTemplate,
  deleteGrid,
  detectTimetableConflicts,
  findGrid,
  loadTimetable,
  publishTimetable,
  removeSlotFromGrid,
  setBellTemplate,
  subjectLabel,
  teacherLabel,
  teachingPeriods,
  unpublishTimetable,
  upsertGridSlots,
  type BellPeriod,
  type BellPeriodKind,
  type TimetableSlot,
  type TimetableState,
} from "@/lib/timetable";
import {
  listAssignableSections,
  runAutoAssign,
  type AutoAssignResult,
} from "@/lib/timetableSolver";
import {
  describeEffectiveWeekdays,
  effectiveGridWeekdays,
  ensureTimetableWeekdaysFromMasters,
  schoolDefaultTimingWeekdays,
  syncTimetableWeekdaysFromSchoolTiming,
  weekdayHolidayBadge,
} from "@/lib/timetableCalendar";
import { WEEKDAY_LABELS } from "@/lib/schoolTiming";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import {
  examBlockAt,
  examBlocksForClassDate,
  isoDateWeekday,
} from "@/lib/examTimetable";
import { listSubstitutionsForDate } from "@/lib/timetableSubstitution";
import { SubstitutionPanel } from "@/components/timetable/SubstitutionPanel";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { resolveSessionStaff } from "@/lib/staffResolve";
import { hasPermission } from "@/lib/rbac";

type TtTab = "setup" | "class" | "auto" | "teacher" | "subs" | "publish";

export function TimetableWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<TtTab>("class");
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [state, setState] = useState<TimetableState | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [editSlots, setEditSlots] = useState<TimetableSlot[]>([]);
  const [pickSubjectId, setPickSubjectId] = useState("");
  const [pickTeacherId, setPickTeacherId] = useState("");

  const [bellDraft, setBellDraft] = useState<BellPeriod[]>(defaultBellTemplate);
  const [weekdaysDraft, setWeekdaysDraft] = useState<number[]>([
    1, 2, 3, 4, 5, 6,
  ]);

  const [autoTargets, setAutoTargets] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<AutoAssignResult | null>(null);
  const [teacherFilter, setTeacherFilter] = useState("");
  const [scheduleDate, setScheduleDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const ay = session.academicYearCode || DEFAULT_AY;
  const ayBounds = useMemo(() => {
    const year = masters?.academicYears?.find((y) => y.code === ay);
    return {
      startsOn: year?.startsOn?.slice(0, 10) || "",
      endsOn: year?.endsOn?.slice(0, 10) || "",
    };
  }, [masters, ay]);

  function refresh() {
    const m = loadMasters();
    ensureTimetableWeekdaysFromMasters(m);
    const t = loadTimetable();
    setMasters(m);
    setState(t);
    setBellDraft(t.bellTemplate);
    setWeekdaysDraft(t.workingWeekdays);
    setTick((x) => x + 1);
  }

  useEffect(() => {
    refresh();
    void (async () => {
      const { ensureTimetableHydrated } = await import(
        "@/lib/timetablePersistence"
      );
      const changed = await ensureTimetableHydrated();
      if (changed) refresh();
    })();
  }, []);

  useEffect(() => {
    if (!ayBounds.startsOn && !ayBounds.endsOn) return;
    setScheduleDate((prev) => {
      if (ayBounds.startsOn && prev < ayBounds.startsOn) {
        return ayBounds.startsOn;
      }
      if (ayBounds.endsOn && prev > ayBounds.endsOn) {
        return ayBounds.endsOn;
      }
      return prev;
    });
  }, [ay, ayBounds.startsOn, ayBounds.endsOn]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: TtTab[] = [
      "setup",
      "class",
      "auto",
      "teacher",
      "subs",
      "publish",
    ];
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as TtTab);
  }, []);

  const canEdit = useMemo(() => {
    if (!masters) return false;
    return hasPermission(session, masters, "timetable", "edit");
  }, [masters, session, tick]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter((s) => s.classId === classId && s.isActive);
  }, [masters, classId]);

  useEffect(() => {
    if (!sectionId || !state) {
      setEditSlots([]);
      return;
    }
    const g = findGrid(ay, classId, sectionId, state);
    setEditSlots(g ? [...g.slots] : []);
  }, [ay, classId, sectionId, state, tick]);

  const classSubjects = useMemo(() => {
    if (!masters || !classId) return [];
    return (masters.classSubjects ?? []).filter(
      (l) => l.classId === classId && l.isActive !== false,
    );
  }, [masters, classId]);

  const teacherOptions = useMemo(() => {
    if (!masters || !classId || !pickSubjectId) {
      return (masters?.staff ?? []).filter((s) => s.status === "active");
    }
    const linked = (masters.staff ?? []).filter((s) => {
      if (s.status !== "active") return false;
      return (s.subjectTeachingLinks ?? []).some(
        (l) =>
          l.subjectId === pickSubjectId &&
          (!l.academicYearCode || l.academicYearCode === ay) &&
          (l.classId === classId || !l.classId),
      );
    });
    return linked.length
      ? linked
      : (masters.staff ?? []).filter((s) => s.status === "active");
  }, [masters, classId, pickSubjectId, ay]);

  const assignable = useMemo(() => {
    if (!masters) return [];
    return listAssignableSections(masters, ay);
  }, [masters, ay, tick]);

  const conflicts = useMemo(() => {
    void tick;
    return detectTimetableConflicts(state ?? undefined, ay).filter(
      (c) => c.kind === "teacher_clash" || c.kind === "class_clash",
    );
  }, [state, tick, ay]);

  const teaching = useMemo(
    () => teachingPeriods(state?.bellTemplate ?? bellDraft),
    [state, bellDraft],
  );

  const schoolTimingHint = useMemo(() => {
    if (!masters) return null;
    return schoolDefaultTimingWeekdays(masters);
  }, [masters, tick]);

  const classCalendar = useMemo(() => {
    if (!masters || !classId) return null;
    return effectiveGridWeekdays(masters, ay, classId);
  }, [masters, ay, classId, tick]);

  /** Columns shown on class grid: timing days (holiday columns marked). */
  const gridColumns = useMemo(() => {
    if (classCalendar?.timingWeekdays.length) {
      return classCalendar.timingWeekdays;
    }
    return state?.workingWeekdays ?? weekdaysDraft;
  }, [classCalendar, state, weekdaysDraft]);

  /** Days auto-assign / placement may use. */
  const teachingWeekdays = useMemo(() => {
    if (classCalendar?.weekdays.length) return classCalendar.weekdays;
    return gridColumns;
  }, [classCalendar, gridColumns]);

  const examBlocks = useMemo(() => {
    if (!classId || !scheduleDate) return [];
    return examBlocksForClassDate({
      academicYearCode: ay,
      classId,
      date: scheduleDate,
      bellTemplate: state?.bellTemplate,
    });
  }, [ay, classId, scheduleDate, state?.bellTemplate, tick]);

  const examWeekday = isoDateWeekday(scheduleDate);

  const teacherExamBlocks = useMemo(() => {
    const byClass = new Map<
      string,
      ReturnType<typeof examBlocksForClassDate>
    >();
    if (!state || !scheduleDate) return byClass;
    for (const grid of state.grids) {
      if (grid.academicYearCode !== ay) continue;
      if (byClass.has(grid.classId)) continue;
      byClass.set(
        grid.classId,
        examBlocksForClassDate({
          academicYearCode: ay,
          classId: grid.classId,
          date: scheduleDate,
          bellTemplate: state.bellTemplate,
        }),
      );
    }
    return byClass;
  }, [state, scheduleDate, ay, tick]);

  /** Saved substitute arrangement for the schedule date (teacher view). */
  const daySubs = useMemo(() => {
    void tick;
    if (!state || !scheduleDate) return [];
    return listSubstitutionsForDate(ay, scheduleDate, state);
  }, [state, scheduleDate, ay, tick]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function onPullTiming() {
    if (!masters) return;
    const r = syncTimetableWeekdaysFromSchoolTiming(masters);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setWeekdaysDraft(r.weekdays);
    refresh();
    flash(
      `Weekdays from Masters timing: ${r.weekdays.map((d) => WEEKDAY_LABELS[d]).join("")}`,
    );
  }

  function onSaveBell() {
    const r = setBellTemplate(bellDraft, weekdaysDraft);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    refresh();
    flash("Bell template saved");
  }

  function setCell(weekday: number, periodNo: number) {
    if (!canEdit) return;
    if (!teachingWeekdays.includes(weekday)) {
      setError("This weekday is a full weekly holiday for the class — cannot place");
      return;
    }
    if (!pickSubjectId) {
      setError("Pick a subject first (palette below the grid)");
      return;
    }
    setEditSlots((prev) => {
      const rest = prev.filter(
        (s) => !(s.weekday === weekday && s.periodNo === periodNo),
      );
      return [
        ...rest,
        {
          weekday,
          periodNo,
          subjectId: pickSubjectId,
          teacherId: pickTeacherId,
          roomId: "",
        },
      ];
    });
  }

  function clearCell(weekday: number, periodNo: number) {
    setEditSlots((prev) =>
      prev.filter((s) => !(s.weekday === weekday && s.periodNo === periodNo)),
    );
  }

  function onSaveGrid() {
    if (!classId || !sectionId) {
      setError("Pick class and section");
      return;
    }
    const allowed = new Set(teachingWeekdays);
    const cleaned = editSlots.filter((s) => allowed.has(s.weekday));
    if (cleaned.length !== editSlots.length) {
      setEditSlots(cleaned);
    }
    const r = upsertGridSlots({
      academicYearCode: ay,
      classId,
      sectionId,
      slots: cleaned,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    refresh();
    flash(`Saved ${classSectionLabel(masters!, classId, sectionId)}`);
  }

  function onAutoAssign(all: boolean) {
    if (!masters) return;
    let targets: { classId: string; sectionId: string }[];
    if (all) {
      targets = assignable
        .filter((a) => a.loadSource !== "none")
        .map((a) => ({
          classId: a.classId,
          sectionId: a.sectionId,
        }));
    } else {
      targets = [...autoTargets].map((k) => {
        const [c, s] = k.split("|");
        return { classId: c!, sectionId: s! };
      });
      if (!targets.length && classId && sectionId) {
        targets = [{ classId, sectionId }];
      }
    }
    if (!targets.length) {
      setError("Select section(s) to auto-assign");
      return;
    }
    const result = runAutoAssign({
      masters,
      academicYearCode: ay,
      targets,
      clearExisting: true,
      persist: true,
    });
    setLastResult(result);
    refresh();
    flash(result.explanation[0]?.text || "Auto-assign complete");
  }

  function onPublish() {
    const r = publishTimetable(session.fullName, ay);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    refresh();
    flash(`Timetable published for ${ay}`);
  }

  function onUnpublish() {
    if (!window.confirm(`Unpublish the ${ay} timetable and go back to draft?`)) {
      return;
    }
    const r = unpublishTimetable(ay);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    refresh();
    flash(`Back to draft for ${ay} — published snapshot removed`);
  }

  function onClearGridDraft() {
    setEditSlots([]);
    flash("Grid cleared — press Save grid to persist");
  }

  function onDiscardGridChanges() {
    if (!state) return;
    const g = findGrid(ay, classId, sectionId, state);
    setEditSlots(g ? [...g.slots] : []);
    flash("Reverted to last saved grid");
  }

  function onDeleteGrid() {
    if (!classId || !sectionId || !masters) return;
    const label = classSectionLabel(masters, classId, sectionId);
    if (!window.confirm(`Delete the saved timetable for ${label}?`)) return;
    const r = deleteGrid(ay, classId, sectionId);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEditSlots([]);
    refresh();
    flash(`Deleted grid for ${label}`);
  }

  function onRemoveTeacherSlot(row: {
    weekday: number;
    periodNo: number;
    classId: string;
    sectionId: string;
  }) {
    const r = removeSlotFromGrid({
      academicYearCode: ay,
      classId: row.classId,
      sectionId: row.sectionId,
      weekday: row.weekday,
      periodNo: row.periodNo,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    refresh();
    flash("Period removed from class grid");
  }

  function onDeleteSelectedGrids() {
    const targets = [...autoTargets].map((k) => {
      const [c, s] = k.split("|");
      return { classId: c!, sectionId: s! };
    });
    if (!targets.length) {
      setError("Tick section(s) to remove their draft grids");
      return;
    }
    if (
      !window.confirm(
        `Delete draft timetable grid(s) for ${targets.length} section(s)?`,
      )
    ) {
      return;
    }
    let removed = 0;
    for (const t of targets) {
      const r = deleteGrid(ay, t.classId, t.sectionId);
      if (r.ok) removed += 1;
    }
    refresh();
    flash(`Removed ${removed} draft grid(s)`);
  }

  const savedGridExists = useMemo(() => {
    if (!state || !classId || !sectionId) return false;
    return !!findGrid(ay, classId, sectionId, state);
  }, [state, ay, classId, sectionId, tick]);

  const myStaff = useMemo(() => {
    if (!masters) return null;
    return resolveSessionStaff(session, masters);
  }, [masters, session]);

  const teacherViewId = teacherFilter || myStaff?.id || "";

  const teacherSlots = useMemo(() => {
    if (!state || !teacherViewId) return [];
    const rows: {
      weekday: number;
      periodNo: number;
      classId: string;
      sectionId: string;
      subjectId: string;
    }[] = [];
    for (const g of state.grids) {
      if (g.academicYearCode !== ay) continue;
      for (const s of g.slots) {
        if (s.teacherId !== teacherViewId) continue;
        rows.push({
          weekday: s.weekday,
          periodNo: s.periodNo,
          classId: g.classId,
          sectionId: g.sectionId,
          subjectId: s.subjectId,
        });
      }
    }
    return rows.sort(
      (a, b) => a.weekday - b.weekday || a.periodNo - b.periodNo,
    );
  }, [state, teacherViewId, ay, tick]);

  const sessionGrids = useMemo(
    () => (state?.grids ?? []).filter((g) => g.academicYearCode === ay),
    [state, ay],
  );
  const sessionPublishedGrids = useMemo(
    () =>
      (state?.publishedGrids ?? []).filter((g) => g.academicYearCode === ay),
    [state, ay],
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Timetable
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Weekly grids + Auto-assign (AI) for session {ay}. Holidays and exam
            date-sheet also follow this session. No double-book teachers.
          </p>
        </div>
        <span
          className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
            sessionPublishedGrids.length
              ? "bg-[rgba(15,122,76,0.12)] text-[var(--ok)]"
              : "bg-[rgba(217,119,6,0.15)] text-[#b45309]"
          }`}
        >
          {sessionPublishedGrids.length ? "Published" : "Draft"}
          {` · ${ay}`}
          {conflicts.length ? ` · ${conflicts.length} clash(es)` : ""}
        </span>
      </div>

      <ModuleTabs
        aria-label="Timetable"
        value={tab}
        onChange={(id) => setTab(id as TtTab)}
        items={[
          { id: "setup", label: "Setup", tone: "slate" },
          { id: "class", label: "By class", tone: "navy" },
          { id: "auto", label: "Auto-assign (AI)", tone: "violet" },
          { id: "teacher", label: "By teacher", tone: "teal" },
          { id: "subs", label: "Substitutes", tone: "rose" },
          { id: "publish", label: "Publish", tone: "amber" },
        ]}
      />

      {masters && !canEdit ? (
        <p className="mt-3 rounded-lg bg-[rgba(217,119,6,0.12)] px-3 py-2 text-[12px] text-[#b45309]">
          View only — your role has no timetable edit permission, so save /
          remove / auto-assign controls are hidden. Ask an admin to grant
          Timetable → Edit under Masters → Roles &amp; permissions.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      {tab === "setup" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                  Working weekdays
                </h2>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  School default for Setup. Class grids use Masters timing +
                  weekly holidays per class (see By class).
                  {schoolTimingHint
                    ? ` Masters timing: ${schoolTimingHint.weekdays.map((d) => WEEKDAY_LABELS[d]).join("")} · ${schoolTimingHint.startTime}–${schoolTimingHint.endTime}`
                    : ""}
                </p>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-1.5 text-sm font-semibold"
                  onClick={onPullTiming}
                >
                  Pull from Masters timing
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <label key={d} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={weekdaysDraft.includes(d)}
                    onChange={(e) => {
                      setWeekdaysDraft((prev) =>
                        e.target.checked
                          ? [...prev, d].sort()
                          : prev.filter((x) => x !== d),
                      );
                    }}
                  />
                  {WEEKDAY_SHORT[d]}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                Bell periods
              </h2>
              {canEdit ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-1.5 text-sm font-semibold"
                    onClick={() => setBellDraft(defaultBellTemplate())}
                  >
                    Reset default
                  </button>
                  <button
                    type="button"
                    className="btn-accent rounded-lg px-3 py-1.5 text-sm font-bold"
                    onClick={onSaveBell}
                  >
                    Save setup
                  </button>
                </div>
              ) : null}
            </div>
            <ul className="mt-3 space-y-2">
              {bellDraft.map((p, idx) => (
                <li
                  key={`${p.no}-${idx}`}
                  className="grid gap-2 rounded-lg bg-[rgba(32,48,80,0.04)] p-2 sm:grid-cols-[4rem_1fr_6rem_6rem_7rem_auto]"
                >
                  <input
                    className="field !py-1 text-sm"
                    type="number"
                    disabled={!canEdit}
                    value={p.no}
                    onChange={(e) => {
                      const no = Number(e.target.value);
                      setBellDraft((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, no } : x)),
                      );
                    }}
                  />
                  <input
                    className="field !py-1 text-sm"
                    disabled={!canEdit}
                    value={p.label}
                    onChange={(e) => {
                      const label = e.target.value;
                      setBellDraft((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, label } : x)),
                      );
                    }}
                  />
                  <input
                    className="field !py-1 text-sm"
                    type="time"
                    disabled={!canEdit}
                    value={p.startTime}
                    onChange={(e) => {
                      const startTime = e.target.value;
                      setBellDraft((prev) =>
                        prev.map((x, i) =>
                          i === idx ? { ...x, startTime } : x,
                        ),
                      );
                    }}
                  />
                  <input
                    className="field !py-1 text-sm"
                    type="time"
                    disabled={!canEdit}
                    value={p.endTime}
                    onChange={(e) => {
                      const endTime = e.target.value;
                      setBellDraft((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, endTime } : x)),
                      );
                    }}
                  />
                  <select
                    className="field !py-1 text-sm"
                    disabled={!canEdit}
                    value={p.kind}
                    onChange={(e) => {
                      const kind = e.target.value as BellPeriodKind;
                      setBellDraft((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, kind } : x)),
                      );
                    }}
                  >
                    <option value="teaching">Teaching</option>
                    <option value="break">Break</option>
                    <option value="assembly">Assembly</option>
                  </select>
                  {canEdit ? (
                    <button
                      type="button"
                      className="text-sm text-[#dc2626]"
                      onClick={() =>
                        setBellDraft((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <button
                type="button"
                className="mt-3 rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-1.5 text-sm font-semibold"
                onClick={() =>
                  setBellDraft((prev) => [
                    ...prev,
                    {
                      no:
                        Math.max(
                          0,
                          ...prev.filter((x) => x.kind === "teaching").map((x) => x.no),
                        ) + 1,
                      label: `Period ${prev.filter((x) => x.kind === "teaching").length + 1}`,
                      startTime: "15:20",
                      endTime: "16:00",
                      kind: "teaching",
                    },
                  ])
                }
              >
                Add period
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "class" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Class
                </span>
                <select
                  className="field !py-1.5"
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId("");
                  }}
                >
                  <option value="">Select…</option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Section
                </span>
                <select
                  className="field !py-1.5"
                  value={sectionId}
                  disabled={!classId}
                  onChange={(e) => setSectionId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {sectionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              {canEdit && sectionId ? (
                <div className="flex flex-wrap items-end gap-2">
                  <button
                    type="button"
                    className="btn-accent rounded-lg px-3 py-2 text-sm font-bold"
                    onClick={onSaveGrid}
                  >
                    Save grid
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-2 text-sm font-semibold"
                    onClick={onDiscardGridChanges}
                  >
                    Discard changes
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-2 text-sm font-semibold"
                    disabled={!editSlots.length}
                    onClick={onClearGridDraft}
                  >
                    Clear all
                  </button>
                  {savedGridExists ? (
                    <button
                      type="button"
                      className="rounded-lg border border-[#dc2626]/40 px-3 py-2 text-sm font-semibold text-[#dc2626]"
                      onClick={onDeleteGrid}
                    >
                      Delete grid
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {sectionId && masters ? (
              <>
                {classCalendar ? (
                  <p className="mt-3 text-[12px] text-[var(--muted)]">
                    {describeEffectiveWeekdays(classCalendar)}
                    {classCalendar.halfDays.length
                      ? ` · Half-day weekly: ${classCalendar.halfDays
                          .map(
                            (w) =>
                              `${WEEKDAY_LABELS[w.weekday]} (${w.title})`,
                          )
                          .join(", ")}`
                      : ""}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-[rgba(32,48,80,0.04)] p-3">
                  <label className="block text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Effective schedule date
                    </span>
                    <input
                      type="date"
                      className="field !w-auto !py-1.5"
                      min={ayBounds.startsOn || undefined}
                      max={ayBounds.endsOn || undefined}
                      value={scheduleDate}
                      onChange={(event) => setScheduleDate(event.target.value)}
                    />
                  </label>
                  <p className="max-w-xl text-[11px] text-[var(--muted)]">
                    The weekly grid stays reusable. On this exact date, exam
                    sittings from Exams → Date-sheet replace overlapping regular
                    periods and cannot be edited as teaching slots.
                  </p>
                </div>
                {examBlocks.length ? (
                  <div className="mt-2 rounded-lg bg-[rgba(124,58,237,0.1)] px-3 py-2 text-xs text-[#6d28d9]">
                    {examBlocks.map((block) => (
                      <div key={block.entry.id}>
                        <strong>Exam block:</strong> {block.subjectLabel} ·{" "}
                        {block.entry.startTime}–{block.endTime} ·{" "}
                        {block.entry.durationMinutes} minutes
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <label className="text-sm">
                    <span className="mr-2 text-[11px] text-[var(--muted)]">
                      Subject
                    </span>
                    <select
                      className="field !inline-block !w-auto !py-1"
                      value={pickSubjectId}
                      onChange={(e) => {
                        setPickSubjectId(e.target.value);
                        setPickTeacherId("");
                      }}
                    >
                      <option value="">Pick…</option>
                      {classSubjects.map((l) => (
                        <option key={l.id} value={l.subjectId}>
                          {subjectLabel(masters, l.subjectId)} (
                          {l.periodsPerWeek}/wk)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mr-2 text-[11px] text-[var(--muted)]">
                      Teacher
                    </span>
                    <select
                      className="field !inline-block !w-auto !py-1"
                      value={pickTeacherId}
                      onChange={(e) => setPickTeacherId(e.target.value)}
                    >
                      <option value="">Pick…</option>
                      {teacherOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.fullName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="w-full text-[11px] text-[var(--muted)]">
                    Tap a cell to place the selected subject + teacher. Use the ×
                    on a filled cell (or right-click) to remove it. Changes stay
                    local until you press Save grid.
                  </p>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-[640px] w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.04)] p-2 text-left">
                          Period
                        </th>
                        {gridColumns.map((d) => {
                          const badge = classCalendar
                            ? weekdayHolidayBadge(d, classCalendar)
                            : null;
                          const isFullOff = badge?.tone === "full";
                          return (
                            <th
                              key={d}
                              className={`border border-[rgba(32,48,80,0.12)] p-2 ${
                                isFullOff
                                  ? "bg-[#dc2626]/10 text-[#991b1b]"
                                  : badge?.tone === "half"
                                    ? "bg-[rgba(217,119,6,0.15)] text-[#b45309]"
                                    : "bg-[rgba(32,48,80,0.04)]"
                              }`}
                            >
                              <div>{WEEKDAY_SHORT[d]}</div>
                              {badge ? (
                                <div className="mt-0.5 text-[9px] font-semibold leading-tight">
                                  {isFullOff ? "OFF · " : ""}
                                  {badge.label}
                                </div>
                              ) : null}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {teaching.map((p) => (
                        <tr key={p.no}>
                          <td className="border border-[rgba(32,48,80,0.12)] p-2 font-semibold text-[var(--brand-deep)]">
                            {p.label}
                            <div className="font-normal text-[10px] text-[var(--muted)]">
                              {p.startTime}–{p.endTime}
                            </div>
                          </td>
                          {gridColumns.map((d) => {
                            const badge = classCalendar
                              ? weekdayHolidayBadge(d, classCalendar)
                              : null;
                            const isFullOff = badge?.tone === "full";
                            const examBlock =
                              d === examWeekday
                                ? examBlockAt(examBlocks, p.no)
                                : undefined;
                            const slot = editSlots.find(
                              (s) => s.weekday === d && s.periodNo === p.no,
                            );
                            return (
                              <td
                                key={`${d}-${p.no}`}
                                className={`border border-[rgba(32,48,80,0.12)] p-0 ${
                                  isFullOff ? "bg-[#dc2626]/05" : ""
                                }`}
                              >
                                {examBlock ? (
                                  <div className="flex min-h-[3.25rem] flex-col justify-center bg-[rgba(124,58,237,0.12)] px-1.5 py-1 text-[#6d28d9]">
                                    <span className="font-bold">
                                      EXAM · {examBlock.subjectLabel}
                                    </span>
                                    <span className="text-[9px]">
                                      {examBlock.entry.startTime}–
                                      {examBlock.endTime}
                                    </span>
                                  </div>
                                ) : isFullOff ? (
                                  <div className="flex min-h-[3.25rem] items-center justify-center px-1 text-[10px] font-semibold text-[#991b1b]">
                                    Holiday
                                  </div>
                                ) : (
                                  <div className="relative">
                                    <button
                                      type="button"
                                      disabled={!canEdit}
                                      onClick={() => setCell(d, p.no)}
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        if (canEdit) clearCell(d, p.no);
                                      }}
                                      className={`flex min-h-[3.25rem] w-full flex-col items-start px-1.5 py-1 text-left ${
                                        slot
                                          ? "bg-[rgba(32,48,80,0.08)]"
                                          : "hover:bg-[rgba(32,48,80,0.04)]"
                                      }`}
                                    >
                                      {slot ? (
                                        <>
                                          <span className="pr-4 font-bold text-[var(--brand-deep)]">
                                            {subjectLabel(masters, slot.subjectId)}
                                          </span>
                                          <span className="text-[10px] text-[var(--muted)]">
                                            {teacherLabel(masters, slot.teacherId)}
                                          </span>
                                        </>
                                      ) : (
                                        <span className="text-[var(--muted)]">·</span>
                                      )}
                                    </button>
                                    {canEdit && slot ? (
                                      <button
                                        type="button"
                                        aria-label="Remove period"
                                        title="Remove period"
                                        className="absolute right-0.5 top-0.5 rounded px-1 text-[11px] font-bold leading-none text-[#dc2626] hover:bg-[#dc2626]/10"
                                        onClick={() => clearCell(d, p.no)}
                                      >
                                        ×
                                      </button>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-[var(--muted)]">
                Select class and section to edit the weekly grid.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "auto" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Auto-assign (AI)
            </h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Places from Masters class subject periods/week + Staff → Duties
              teaching links. Classes without a subject map fall back to NEP
              stage suggested subjects/periods. Uses each class&apos;s school
              timing weekdays and skips published weekly holidays for that
              class. Hard rule: no teacher double-book.
            </p>

            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)] p-2">
              {assignable.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">
                  No active class–sections found. Add classes and sections in
                  Masters first.
                </p>
              ) : (
                assignable.map((a) => {
                  const key = `${a.classId}|${a.sectionId}`;
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[rgba(32,48,80,0.04)]"
                    >
                      <input
                        type="checkbox"
                        checked={autoTargets.has(key)}
                        onChange={(e) => {
                          setAutoTargets((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                      />
                      <span>{a.label}</span>
                      {a.loadSource === "nep_fallback" ? (
                        <span className="rounded-full bg-[rgba(180,83,9,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[#b45309]">
                          NEP suggested load
                        </span>
                      ) : a.loadSource === "none" ? (
                        <span className="rounded-full bg-[rgba(220,38,38,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[#dc2626]">
                          No subject load
                        </span>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>

            {canEdit ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-accent rounded-lg px-3 py-2 text-sm font-bold"
                  onClick={() => onAutoAssign(false)}
                >
                  Run for selected
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-2 text-sm font-semibold"
                  onClick={() => onAutoAssign(true)}
                >
                  Run for all classes
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[#dc2626]/40 px-3 py-2 text-sm font-semibold text-[#dc2626]"
                  onClick={onDeleteSelectedGrids}
                >
                  Remove grids for selected
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                View only — need timetable edit to run auto-assign.
              </p>
            )}
          </div>

          {lastResult ? (
            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                Last run
              </h3>
              <p className="mt-1 text-sm">
                Fill {lastResult.stats.fillPercent}% · placed{" "}
                {lastResult.stats.placed} · unfilled {lastResult.stats.unfilled}{" "}
                · score {lastResult.stats.score}
              </p>
              <ul className="mt-2 space-y-1 text-[12px]">
                {lastResult.explanation.map((e, i) => (
                  <li
                    key={i}
                    className={
                      e.level === "error"
                        ? "text-[#dc2626]"
                        : e.level === "warn"
                          ? "text-[#b45309]"
                          : "text-[var(--muted)]"
                    }
                  >
                    {e.text}
                  </li>
                ))}
              </ul>
              {lastResult.unfilled.length ? (
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-[12px] text-[var(--muted)]">
                  {lastResult.unfilled.map((u, i) => (
                    <li key={i}>
                      {masters
                        ? subjectLabel(masters, u.subjectId)
                        : u.subjectId}{" "}
                      · {u.remaining} left — {u.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "teacher" ? (
        <div className="mt-5 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            By teacher
          </h2>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Teacher
            </span>
            <select
              className="field !py-1.5 max-w-md"
              value={teacherViewId}
              onChange={(e) => setTeacherFilter(e.target.value)}
            >
              <option value="">Select…</option>
              {(masters?.staff ?? [])
                .filter((s) => s.status === "active")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
            </select>
          </label>
          <label className="mt-3 block max-w-xs text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Effective schedule date
            </span>
            <input
              type="date"
              className="field !py-1.5"
              min={ayBounds.startsOn || undefined}
              max={ayBounds.endsOn || undefined}
              value={scheduleDate}
              onChange={(event) => setScheduleDate(event.target.value)}
            />
          </label>

          {!teacherViewId ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              Pick a teacher to see their weekly load from draft grids.
            </p>
          ) : teacherSlots.length === 0 &&
            !daySubs.some((s) => s.substituteTeacherId === teacherViewId) ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              No periods assigned yet for this teacher.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[640px] w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.04)] p-2 text-left">
                      Period
                    </th>
                    {(state?.workingWeekdays ?? weekdaysDraft).map((d) => (
                      <th
                        key={d}
                        className="border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.04)] p-2"
                      >
                        {WEEKDAY_SHORT[d]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teaching.map((p) => (
                    <tr key={p.no}>
                      <td className="border border-[rgba(32,48,80,0.12)] p-2 font-semibold">
                        {p.label}
                      </td>
                      {(state?.workingWeekdays ?? weekdaysDraft).map((d) => {
                        const hit = teacherSlots.find(
                          (s) => s.weekday === d && s.periodNo === p.no,
                        );
                        const examBlock =
                          hit && d === examWeekday
                            ? examBlockAt(
                                teacherExamBlocks.get(hit.classId) ?? [],
                                p.no,
                              )
                            : undefined;
                        const subDuty =
                          d === examWeekday
                            ? daySubs.find(
                                (s) =>
                                  s.substituteTeacherId === teacherViewId &&
                                  s.periodNo === p.no,
                              )
                            : undefined;
                        const subCover =
                          hit && d === examWeekday
                            ? daySubs.find(
                                (s) =>
                                  s.absentTeacherId === teacherViewId &&
                                  s.periodNo === p.no &&
                                  s.classId === hit.classId &&
                                  s.sectionId === hit.sectionId,
                              )
                            : undefined;
                        return (
                          <td
                            key={`${d}-${p.no}`}
                            className="border border-[rgba(32,48,80,0.12)] p-1.5"
                          >
                            {subDuty && masters ? (
                              <div className="bg-[rgba(190,24,93,0.1)] p-1 text-[#9d174d]">
                                <div className="font-bold">
                                  SUBSTITUTE ·{" "}
                                  {classSectionLabel(
                                    masters,
                                    subDuty.classId,
                                    subDuty.sectionId,
                                  )}
                                </div>
                                <div className="text-[9px]">
                                  {subjectLabel(masters, subDuty.subjectId)} ·
                                  covering{" "}
                                  {teacherLabel(masters, subDuty.absentTeacherId)}{" "}
                                  · {scheduleDate}
                                </div>
                              </div>
                            ) : subCover && masters ? (
                              <div className="bg-[rgba(32,48,80,0.06)] p-1 text-[var(--muted)]">
                                <div className="font-bold line-through">
                                  {classSectionLabel(
                                    masters,
                                    hit!.classId,
                                    hit!.sectionId,
                                  )}{" "}
                                  · {subjectLabel(masters, hit!.subjectId)}
                                </div>
                                <div className="text-[9px] text-[#9d174d]">
                                  Absent on {scheduleDate} —{" "}
                                  {subCover.substituteTeacherId
                                    ? `covered by ${teacherLabel(masters, subCover.substituteTeacherId)}`
                                    : "period left free"}
                                </div>
                              </div>
                            ) : examBlock && hit && masters ? (
                              <div className="bg-[rgba(124,58,237,0.1)] p-1 text-[#6d28d9]">
                                <div className="font-bold">
                                  EXAM · {examBlock.subjectLabel}
                                </div>
                                <div className="text-[9px]">
                                  {classSectionLabel(
                                    masters,
                                    hit.classId,
                                    hit.sectionId,
                                  )}{" "}
                                  · regular lesson blocked
                                </div>
                              </div>
                            ) : hit && masters ? (
                              <div className="relative pr-4">
                                <div className="font-bold text-[var(--brand-deep)]">
                                  {classSectionLabel(
                                    masters,
                                    hit.classId,
                                    hit.sectionId,
                                  )}
                                </div>
                                <div className="text-[10px] text-[var(--muted)]">
                                  {subjectLabel(masters, hit.subjectId)}
                                </div>
                                {canEdit ? (
                                  <button
                                    type="button"
                                    aria-label="Remove period"
                                    title="Remove this period from the class grid"
                                    className="absolute -top-0.5 right-0 rounded px-1 text-[11px] font-bold leading-none text-[#dc2626] hover:bg-[#dc2626]/10"
                                    onClick={() => onRemoveTeacherSlot(hit)}
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-[var(--muted)]">·</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "subs" && masters ? (
        <SubstitutionPanel
          masters={masters}
          academicYearCode={ay}
          canEdit={canEdit}
          ayBounds={ayBounds}
          onError={(msg) => {
            setError(msg);
            setNotice(null);
          }}
          onNotice={flash}
          onChanged={refresh}
        />
      ) : null}

      {tab === "publish" ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Publish
            </h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Freezes a snapshot of all draft grids. Teachers use published
              version for “today’s periods”. Clashes must be zero.
            </p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[11px] text-[var(--muted)]">Status</dt>
                <dd className="font-semibold">{state?.meta.status}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--muted)]">Draft grids</dt>
                <dd className="font-semibold">{sessionGrids.length}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--muted)]">Clashes</dt>
                <dd className="font-semibold text-[#dc2626]">
                  {conflicts.length}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--muted)]">Last publish</dt>
                <dd className="font-semibold">
                  {state?.meta.publishedAt && sessionPublishedGrids.length
                    ? new Date(state.meta.publishedAt).toLocaleString()
                    : "—"}
                  {state?.meta.publishedBy && sessionPublishedGrids.length
                    ? ` · ${state.meta.publishedBy}`
                    : ""}
                </dd>
              </div>
            </dl>
            {conflicts.length ? (
              <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-[12px] text-[#dc2626]">
                {conflicts.slice(0, 20).map((c, i) => (
                  <li key={i}>
                    {WEEKDAY_SHORT[c.weekday]} P{c.periodNo}: {c.detail}
                    {masters
                      ? ` · ${classSectionLabel(masters, c.classId, c.sectionId)}`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {canEdit ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
                  disabled={!!conflicts.length || !sessionGrids.length}
                  onClick={onPublish}
                >
                  Publish timetable
                </button>
                {sessionPublishedGrids.length ? (
                  <button
                    type="button"
                    className="rounded-lg border border-[#dc2626]/40 px-4 py-2 text-sm font-semibold text-[#dc2626]"
                    onClick={onUnpublish}
                  >
                    Unpublish (back to draft)
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {sessionPublishedGrids.length && masters ? (
            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                Published snapshot · {ay}
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                {sessionPublishedGrids.map((g) => (
                  <li key={g.id}>
                    {classSectionLabel(masters, g.classId, g.sectionId)} —{" "}
                    {g.slots.length} slots
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
