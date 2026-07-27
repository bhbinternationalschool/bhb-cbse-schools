"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ATTENDANCE_STATUSES,
  attendanceLockReason,
  canOverrideAttendanceLock,
  defaultMarksForRoster,
  findRegister,
  getAttendancePolicy,
  isTeacherAttendanceLocked,
  listOpenAttendanceExceptions,
  listRecentRegisters,
  rosterForSection,
  statusTone,
  summarizeMarks,
  todayIso,
  upsertRegister,
  type AttendanceMark,
  type AttendanceStatus,
} from "@/lib/attendance";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { classifyClassHolidayDay } from "@/lib/holidayPolicy";
import { loadSis, type SisState } from "@/lib/sis";
import {
  StudentAvatar,
  StudentNameLabel,
} from "@/components/students/StudentAvatar";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { StaffAttendancePanel } from "@/components/attendance/StaffAttendancePanel";
import { AttendanceExceptionsPanel } from "@/components/attendance/AttendanceExceptionsPanel";
import { StaffAttendanceReportsPanel } from "@/components/staff/StaffLeaveReportsPanel";
import { StudentAttendanceReportsPanel } from "@/components/attendance/StudentAttendanceReportsPanel";
import { StudentLeaveWorkspace } from "@/components/studentLeave/StudentLeaveWorkspace";
import { resolveSessionStaff } from "@/lib/staffResolve";

type AttTab =
  | "dashboard"
  | "students"
  | "staff"
  | "leave"
  | "exceptions"
  | "student-reports"
  | "staff-reports";

export function AttendanceWorkspace() {
  const session = useDemoSession();
  const [tab, setTab] = useState<AttTab>("dashboard");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    const allowed: AttTab[] = [
      "dashboard",
      "students",
      "staff",
      "leave",
      "exceptions",
      "student-reports",
      "staff-reports",
    ];
    if (raw === "reports") {
      setTab("student-reports");
      return;
    }
    if (raw === "student-leave" || raw === "student_leave") {
      setTab("leave");
      return;
    }
    if (raw && (allowed as string[]).includes(raw)) setTab(raw as AttTab);
  }, []);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(todayIso);
  const [marks, setMarks] = useState<AttendanceMark[]>([]);
  const [remark, setRemark] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [myClassAutoDone, setMyClassAutoDone] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setClockTick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const ay = session.academicYearCode || DEFAULT_AY;

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    setTick((x) => x + 1);
  }

  useEffect(() => {
    refresh();
    void (async () => {
      const { ensureAttendanceHydrated } = await import(
        "@/lib/attendancePersistence"
      );
      const changed = await ensureAttendanceHydrated();
      if (changed) refresh();
    })();
  }, []);

  /** Sections this staff is class teacher of (for phone/tablet quick mark). */
  const myClassSections = useMemo(() => {
    if (!masters) return [];
    const staff = resolveSessionStaff(session, masters);
    if (!staff) return [];
    const out: { classId: string; sectionId: string; label: string }[] = [];
    for (const link of staff.classTeacherLinks ?? []) {
      if (link.academicYearCode && link.academicYearCode !== ay) continue;
      const cls = masters.classes.find((c) => c.id === link.classId);
      const sec = masters.sections.find((s) => s.id === link.sectionId);
      if (!cls || !sec) continue;
      out.push({
        classId: link.classId,
        sectionId: link.sectionId,
        label: `${cls.name || "Class"} · ${sec.name || ""}`.trim(),
      });
    }
    return out;
  }, [masters, session, ay, tick]);

  useEffect(() => {
    if (myClassAutoDone || myClassSections.length === 0) return;
    if (classId && sectionId) {
      setMyClassAutoDone(true);
      return;
    }
    const first = myClassSections[0]!;
    setClassId(first.classId);
    setSectionId(first.sectionId);
    setMyClassAutoDone(true);
  }, [myClassSections, myClassAutoDone, classId, sectionId]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter((s) => s.classId === classId && s.isActive);
  }, [masters, classId]);

  useEffect(() => {
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  const roster = useMemo(() => {
    if (!sis || !sectionId) return [];
    return rosterForSection(sis.students, sectionId, {
      classId: classId || undefined,
      academicYearCode: ay,
    });
  }, [sis, sectionId, classId, ay, tick]);

  const existing = useMemo(() => {
    void tick;
    if (!sectionId) return undefined;
    return findRegister(ay, sectionId, date);
  }, [ay, sectionId, date, tick]);

  useEffect(() => {
    if (!sectionId) {
      setMarks([]);
      setRemark("");
      setDirty(false);
      return;
    }
    const reg = findRegister(ay, sectionId, date);
    setMarks(defaultMarksForRoster(roster, reg));
    setRemark(reg?.remark ?? "");
    setDirty(false);
    setError(null);
  }, [ay, sectionId, date, roster]);

  const summary = useMemo(() => summarizeMarks(marks), [marks]);

  const holidayOnDate = useMemo(() => {
    if (!masters || !classId) return null;
    const c = classifyClassHolidayDay(masters, date, ay, classId);
    if (c.status === "working") return null;
    return c;
  }, [masters, date, ay, classId]);

  const holidayBlocks = holidayOnDate?.status === "holiday";

  const policy = useMemo(() => {
    void tick;
    return getAttendancePolicy();
  }, [tick]);

  const teacherLocked = useMemo(() => {
    void clockTick;
    return isTeacherAttendanceLocked(date, policy);
  }, [date, policy, clockTick]);

  const canOverrideLock = useMemo(() => canOverrideAttendanceLock(), [tick]);

  const lockBlocksTeacher =
    teacherLocked && !canOverrideLock;

  const openExceptionCount = useMemo(() => {
    void tick;
    return listOpenAttendanceExceptions().filter(
      (e) => !ay || e.academicYearCode === ay,
    ).length;
  }, [tick, ay]);

  const recent = useMemo(() => {
    void tick;
    return listRecentRegisters(10);
  }, [tick]);

  const classLabel = (cId: string, sId: string) => {
    const c = masters?.classes.find((x) => x.id === cId)?.name ?? "—";
    const s = masters?.sections.find((x) => x.id === sId)?.name ?? "";
    return s ? `${c}-${s}` : c;
  };

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function setStatus(studentId: string, status: AttendanceStatus) {
    if (lockBlocksTeacher) return;
    setMarks((prev) =>
      prev.map((m) => (m.studentId === studentId ? { ...m, status } : m)),
    );
    setDirty(true);
  }

  function markAll(status: AttendanceStatus) {
    if (lockBlocksTeacher) return;
    setMarks((prev) => prev.map((m) => ({ ...m, status })));
    setDirty(true);
  }

  function onSave() {
    if (!classId || !sectionId) {
      setError("Pick class and section first");
      return;
    }
    if (lockBlocksTeacher) {
      setError(
        attendanceLockReason(date, policy) ||
          "Locked after teacher cut-off",
      );
      return;
    }
    if (teacherLocked && canOverrideLock && !overrideNote.trim()) {
      setError("Office override note required after cut-off");
      return;
    }
    if (masters && classId) {
      const hol = classifyClassHolidayDay(masters, date, ay, classId);
      if (hol.status === "holiday" && hol.holiday) {
        setError(
          `Published holiday for this class: ${hol.label}. Attendance is not marked on full holidays.`,
        );
        return;
      }
    }
    if (roster.length === 0) {
      setError("No active students in this section");
      return;
    }
    const campusId =
      roster[0]?.campusId || masters?.campuses?.[0]?.id || "";
    const result = upsertRegister({
      academicYearCode: ay,
      campusId,
      classId,
      sectionId,
      date,
      marks,
      markedBy: session.fullName,
      remark,
      officeOverrideNote: teacherLocked ? overrideNote : undefined,
      classLabel: classLabel(classId, sectionId),
      students: sis?.students,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDirty(false);
    setOverrideNote("");
    refresh();
    const s = summarizeMarks(result.register.marks);
    const nudgePart =
      result.nudgesOpened > 0
        ? ` · opened ${result.nudgesOpened} absent WhatsApp nudge${
            result.nudgesOpened === 1 ? "" : "s"
          }`
        : result.nudges.length === 0 && s.absent > 0
          ? " · no new absent nudges"
          : "";
    flash(
      `Saved ${classLabel(classId, sectionId)} · ${date} — P ${s.present} · A ${s.absent}${
        result.lockedOverride ? " · office override" : ""
      }${nudgePart}`,
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--brand-deep)]">
            Attendance
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Class teacher marks students on phone/tablet (bulk All present /
            All absent). Staff uses punch / rules separately.
          </p>
        </div>
        <span className="rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ok)]">
          Never blocked by fee holds
        </span>
      </div>

      <ModuleTabs
        aria-label="Attendance"
        value={tab}
        onChange={(id) => setTab(id as AttTab)}
        items={[
          { id: "dashboard", label: "Dashboard", tone: "navy" },
          { id: "students", label: "Students", tone: "navy" },
          { id: "staff", label: "Staff", tone: "teal" },
          { id: "leave", label: "Student leave", tone: "sky" },
          {
            id: "exceptions",
            label:
              openExceptionCount > 0
                ? `Exceptions (${openExceptionCount})`
                : "Exceptions",
            tone: "amber",
          },
          { id: "student-reports", label: "Student reports", tone: "amber" },
          { id: "staff-reports", label: "Staff reports", tone: "violet" },
        ]}
      />

      {tab === "dashboard" ? (
        <div className="mt-5">
          <ModuleDashboardHost
            moduleId="attendance"
            onNavigateTab={(t) => setTab(t as AttTab)}
          />
        </div>
      ) : null}

      {tab === "staff" ? (
        <div className="mt-5">
          <StaffAttendancePanel ay={ay} />
        </div>
      ) : null}

      {tab === "leave" ? (
        <div className="mt-5">
          <StudentLeaveWorkspace embedded />
        </div>
      ) : null}

      {tab === "exceptions" ? (
        <div className="mt-5">
          <AttendanceExceptionsPanel ay={ay} />
        </div>
      ) : null}

      {tab === "student-reports" ? (
        <div className="mt-5">
          <StudentAttendanceReportsPanel ay={ay} />
        </div>
      ) : null}

      {tab === "staff-reports" ? (
        <div className="mt-5">
          <StaffAttendanceReportsPanel ay={ay} />
        </div>
      ) : null}

      {tab === "students" ? (
      <>
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

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 pb-24 sm:pb-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                Mark register
              </h2>
              <p className="text-[11px] text-[var(--muted)]">
                Teacher: {session.fullName} · Session {ay}
              </p>
            </div>

            {myClassSections.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  My class (tap to open)
                </p>
                <div className="flex flex-wrap gap-2">
                  {myClassSections.map((c) => {
                    const active =
                      c.classId === classId && c.sectionId === sectionId;
                    return (
                      <button
                        key={`${c.classId}-${c.sectionId}`}
                        type="button"
                        onClick={() => {
                          setClassId(c.classId);
                          setSectionId(c.sectionId);
                        }}
                        className={`min-h-11 rounded-xl px-3.5 py-2 text-sm font-bold ${
                          active
                            ? "bg-[var(--brand-deep)] text-white shadow-sm"
                            : "border border-[rgba(32,48,80,0.15)] bg-[rgba(32,48,80,0.04)] text-[var(--brand-deep)]"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  Phone/tablet: All present → correct absentees → Save.
                </p>
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
                  <option value="">Select class…</option>
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
                  <option value="">
                    {classId ? "Select section…" : "Pick class first"}
                  </option>
                  {sectionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Date
                </span>
                <input
                  className="field !py-1.5"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>

            {holidayOnDate ? (
              <div className="mt-3 rounded-lg border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-3 py-2 text-sm text-[var(--brand-deep)]">
                <strong>{holidayOnDate.label}</strong>
                {holidayBlocks
                  ? " — full holiday for this class. Attendance cannot be saved. Change the date or adjust Masters → Holidays."
                  : " — half-day policy for this class. You may still mark attendance."}
              </div>
            ) : null}

            {teacherLocked ? (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                  lockBlocksTeacher
                    ? "border-[#dc2626]/35 bg-[#dc2626]/10 text-[#991b1b]"
                    : "border-[rgba(217,119,6,0.45)] bg-[rgba(217,119,6,0.12)] text-[var(--brand-deep)]"
                }`}
              >
                <strong>
                  {lockBlocksTeacher ? "Locked for teachers" : "Cut-off passed"}
                </strong>
                {" — "}
                {attendanceLockReason(date, policy) ||
                  `Teacher cut-off ${policy.teacherCutoffTime} IST.`}
                {canOverrideLock
                  ? " You can save with an office override note."
                  : " Ask office/principal to correct."}
              </div>
            ) : policy.lockTeachersAfterCutoff ? (
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                Teacher cut-off {policy.teacherCutoffTime} IST
                {policy.absentNudgeEnabled
                  ? " · Absent saves open parent WhatsApp nudges"
                  : ""}
                .
              </p>
            ) : null}

            {sectionId ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="min-h-11 min-w-[7.5rem] flex-1 rounded-xl bg-[#16a34a] px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40 sm:flex-none"
                    disabled={holidayBlocks || lockBlocksTeacher}
                    onClick={() => markAll("P")}
                  >
                    All present
                  </button>
                  <button
                    type="button"
                    className="min-h-11 min-w-[7.5rem] flex-1 rounded-xl bg-[#dc2626] px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40 sm:flex-none"
                    disabled={holidayBlocks || lockBlocksTeacher}
                    onClick={() => markAll("A")}
                  >
                    All absent
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-xl border border-[rgba(32,48,80,0.18)] px-3 py-2.5 text-sm font-semibold text-[var(--brand-deep)] disabled:opacity-40"
                    disabled={holidayBlocks || lockBlocksTeacher}
                    onClick={() => {
                      setMarks(defaultMarksForRoster(roster, existing));
                      setRemark(existing?.remark ?? "");
                      setDirty(false);
                    }}
                  >
                    Reset
                  </button>
                  <div className="ml-auto">
                    <FilterExportButtons
                      title="Attendance register"
                      subtitle={`${TENANT.shortName} · ${ay}`}
                      filterNote={describeFilters([
                        classOptions.find((c) => c.id === classId)?.name
                          ? `Class ${classOptions.find((c) => c.id === classId)?.name}`
                          : "",
                        sectionOptions.find((s) => s.id === sectionId)?.name
                          ? `Sec ${sectionOptions.find((s) => s.id === sectionId)?.name}`
                          : "",
                        date,
                      ])}
                      fileBaseName="attendance_register"
                      columns={[
                        { key: "rollNo", header: "Roll", width: 0.6 },
                        { key: "admissionNo", header: "Adm no", width: 1 },
                        { key: "fullName", header: "Name", width: 1.6 },
                        { key: "status", header: "Status", width: 0.8 },
                      ]}
                      rows={roster.map((st) => {
                        const mark =
                          marks.find((m) => m.studentId === st.id)?.status ??
                          "P";
                        const label =
                          ATTENDANCE_STATUSES.find((s) => s.code === mark)
                            ?.label ?? mark;
                        return {
                          rollNo: st.rollNo,
                          admissionNo: st.admissionNo,
                          fullName: st.fullName,
                          status: label,
                        };
                      })}
                      onMessage={(msg) => {
                        setNotice(msg);
                        window.setTimeout(() => setNotice(null), 2200);
                      }}
                    />
                  </div>
                  {existing ? (
                    <span className="text-[11px] text-[var(--muted)]">
                      Last saved {new Date(existing.markedAt).toLocaleString()}{" "}
                      by {existing.markedBy}
                      {dirty ? " · unsaved edits" : ""}
                    </span>
                  ) : dirty ? (
                    <span className="text-[11px] text-[#d97706]">
                      Unsaved
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
                  <span className="font-semibold text-[var(--brand-deep)]">
                    Strength {summary.total}
                  </span>
                  <span className="text-[#16a34a]">P {summary.present}</span>
                  <span className="text-[#dc2626]">A {summary.absent}</span>
                  <span className="text-[#d97706]">L {summary.late}</span>
                  <span className="text-[#2563eb]">HD {summary.halfDay}</span>
                  <span className="text-[#7c3aed]">LE {summary.leave}</span>
                </div>

                {roster.length === 0 ? (
                  <p className="mt-4 text-sm text-[var(--muted)]">
                    No active students in this section for {ay}.
                  </p>
                ) : (
                  <ul className="mt-3 max-h-[28rem] divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)]">
                    {roster.map((st) => {
                      const mark =
                        marks.find((m) => m.studentId === st.id) ?? {
                          studentId: st.id,
                          status: "P" as AttendanceStatus,
                          note: "",
                        };
                      return (
                        <li
                          key={st.id}
                          className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="w-7 shrink-0 text-center text-[11px] font-bold tabular-nums text-[var(--muted)]">
                              {st.rollNo || "—"}
                            </span>
                            <StudentAvatar student={st} size={32} />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-[var(--brand-deep)]">
                                <StudentNameLabel student={st} />
                              </div>
                              <div className="text-[10px] text-[var(--muted)]">
                                {st.admissionNo}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {ATTENDANCE_STATUSES.map((s) => {
                              const active = mark.status === s.code;
                              const tone = statusTone(s.code);
                              return (
                                <button
                                  key={s.code}
                                  type="button"
                                  title={s.label}
                                  aria-pressed={active}
                                  disabled={lockBlocksTeacher}
                                  className={`min-h-10 min-w-[2.75rem] rounded-lg px-2 py-2 text-xs font-bold disabled:opacity-40 ${
                                    active
                                      ? `${tone.bg} ${tone.text}`
                                      : "bg-[rgba(32,48,80,0.06)] text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.1)]"
                                  }`}
                                  onClick={() => setStatus(st.id, s.code)}
                                >
                                  {s.short}
                                </button>
                              );
                            })}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <label className="mt-3 block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Day remark (optional)
                  </span>
                  <input
                    className="field !py-1.5"
                    value={remark}
                    disabled={lockBlocksTeacher}
                    onChange={(e) => {
                      setRemark(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="e.g. Class test period 3"
                  />
                </label>

                {teacherLocked && canOverrideLock ? (
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block text-[11px] font-semibold text-[#b45309]">
                      Office override note (required)
                    </span>
                    <input
                      className="field !py-1.5"
                      value={overrideNote}
                      onChange={(e) => setOverrideNote(e.target.value)}
                      placeholder="Why are you correcting this register after cut-off?"
                    />
                  </label>
                ) : null}

                <button
                  type="button"
                  className="btn-accent mt-4 hidden rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50 sm:inline-flex"
                  disabled={
                    !sectionId ||
                    roster.length === 0 ||
                    holidayBlocks ||
                    lockBlocksTeacher
                  }
                  onClick={onSave}
                >
                  {existing ? "Update register" : "Save register"}
                </button>

                {/* Sticky phone/tablet action bar */}
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgba(32,48,80,0.12)] bg-[rgba(248,248,240,0.96)] p-3 backdrop-blur-md sm:hidden">
                  <div className="mx-auto flex max-w-lg gap-2">
                    <button
                      type="button"
                      className="min-h-12 flex-1 rounded-xl bg-[#16a34a] text-sm font-bold text-white disabled:opacity-40"
                      disabled={
                        !sectionId || holidayBlocks || lockBlocksTeacher
                      }
                      onClick={() => markAll("P")}
                    >
                      All P
                    </button>
                    <button
                      type="button"
                      className="min-h-12 flex-1 rounded-xl bg-[#dc2626] text-sm font-bold text-white disabled:opacity-40"
                      disabled={
                        !sectionId || holidayBlocks || lockBlocksTeacher
                      }
                      onClick={() => markAll("A")}
                    >
                      All A
                    </button>
                    <button
                      type="button"
                      className="btn-accent min-h-12 flex-[1.4] rounded-xl text-sm font-bold disabled:opacity-50"
                      disabled={
                        !sectionId ||
                        roster.length === 0 ||
                        holidayBlocks ||
                        lockBlocksTeacher
                      }
                      onClick={onSave}
                    >
                      {dirty ? "Save*" : existing ? "Update" : "Save"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-[var(--muted)]">
                {myClassSections.length > 0
                  ? "Tap your class above, or pick class and section."
                  : "Select class and section to load the roster. Class teachers: link yourself in Staff → Duties to see My class shortcuts."}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Status key
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              {ATTENDANCE_STATUSES.map((s) => {
                const tone = statusTone(s.code);
                return (
                  <li key={s.code} className="flex items-center gap-2">
                    <span
                      className={`inline-flex min-w-[2.25rem] justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold ${tone.bg} ${tone.text}`}
                    >
                      {s.short}
                    </span>
                    <span className="text-[var(--brand-deep)]">{s.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Recent registers
            </h2>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                No registers saved yet.
              </p>
            ) : (
              <ul className="mt-2 max-h-80 divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto">
                {recent.map((r) => {
                  const s = summarizeMarks(r.marks);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="w-full py-2 text-left hover:bg-[rgba(32,48,80,0.03)]"
                        onClick={() => {
                          setClassId(r.classId);
                          setSectionId(r.sectionId);
                          setDate(r.date);
                        }}
                      >
                        <div className="text-sm font-semibold text-[var(--brand-deep)]">
                          {classLabel(r.classId, r.sectionId)} · {r.date}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          P {s.present} · A {s.absent} · L {s.late} · by{" "}
                          {r.markedBy}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      </>
      ) : null}
    </div>
  );
}
