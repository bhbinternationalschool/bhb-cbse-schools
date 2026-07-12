"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ATTENDANCE_STATUSES,
  defaultMarksForRoster,
  findRegister,
  listRecentRegisters,
  loadAttendance,
  rosterForSection,
  statusTone,
  summarizeMarks,
  todayIso,
  upsertRegister,
  type AttendanceMark,
  type AttendanceStatus,
} from "@/lib/attendance";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { isPublishedHoliday } from "@/lib/foundationMasters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  StudentAvatar,
  StudentTypeBadge,
} from "@/components/students/StudentAvatar";
import { FilterExportButtons } from "@/components/reports/FilterExportButtons";
import { describeFilters } from "@/lib/reportExport";
import { TENANT } from "@/lib/types";
import { useDemoSession } from "@/components/shell/SessionContext";

export function AttendanceWorkspace() {
  const session = useDemoSession();
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

  const ay = session.academicYearCode || DEFAULT_AY;

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    setTick((x) => x + 1);
  }

  useEffect(() => {
    refresh();
  }, []);

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
    if (!masters) return null;
    return isPublishedHoliday(masters, date, ay);
  }, [masters, date, ay]);

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
    setMarks((prev) =>
      prev.map((m) => (m.studentId === studentId ? { ...m, status } : m)),
    );
    setDirty(true);
  }

  function markAll(status: AttendanceStatus) {
    setMarks((prev) => prev.map((m) => ({ ...m, status })));
    setDirty(true);
  }

  function onSave() {
    if (!classId || !sectionId) {
      setError("Pick class and section first");
      return;
    }
    if (masters) {
      const hol = isPublishedHoliday(masters, date, ay);
      if (hol) {
        setError(
          `Published holiday: ${hol.title} (${hol.startsOn}${
            hol.endsOn !== hol.startsOn ? `–${hol.endsOn}` : ""
          }). Attendance is not marked on holidays.`,
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
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDirty(false);
    refresh();
    const s = summarizeMarks(result.register.marks);
    flash(
      `Saved ${classLabel(classId, sectionId)} · ${date} — P ${s.present} · A ${s.absent}`,
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
            Daily class register by section. Fee holds never block marking —
            every enrolled student stays on the sheet.
          </p>
        </div>
        <span className="rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ok)]">
          Never blocked by fee holds
        </span>
      </div>

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
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                Mark register
              </h2>
              <p className="text-[11px] text-[var(--muted)]">
                Teacher: {session.fullName} · Session {ay}
              </p>
            </div>

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
                <strong>{holidayOnDate.title}</strong> — published holiday.
                Class attendance cannot be saved for this date. Change the date
                or unpublish in Masters → Holidays.
              </div>
            ) : null}

            {sectionId ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-[#16a34a] px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                    disabled={!!holidayOnDate}
                    onClick={() => markAll("P")}
                  >
                    All present
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-[#dc2626] px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                    disabled={!!holidayOnDate}
                    onClick={() => markAll("A")}
                  >
                    All absent
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-40"
                    disabled={!!holidayOnDate}
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
                                <StudentTypeBadge type={st.studentType} />
                                {st.fullName}
                              </div>
                              <div className="text-[10px] text-[var(--muted)]">
                                {st.admissionNo}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {ATTENDANCE_STATUSES.map((s) => {
                              const active = mark.status === s.code;
                              const tone = statusTone(s.code);
                              return (
                                <button
                                  key={s.code}
                                  type="button"
                                  title={s.label}
                                  aria-pressed={active}
                                  className={`min-w-[2.25rem] rounded-md px-1.5 py-1 text-[11px] font-bold ${
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
                    onChange={(e) => {
                      setRemark(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="e.g. Class test period 3"
                  />
                </label>

                <button
                  type="button"
                  className="btn-accent mt-4 rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50"
                  disabled={!sectionId || roster.length === 0 || !!holidayOnDate}
                  onClick={onSave}
                >
                  {existing ? "Update register" : "Save register"}
                </button>
              </>
            ) : (
              <p className="mt-4 text-sm text-[var(--muted)]">
                Select class and section to load the roster.
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
    </div>
  );
}
