"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ATTENDANCE_POLICY,
  exceptionKindLabel,
  fileParentAttendanceDispute,
  getAttendancePolicy,
  listOpenAttendanceExceptions,
  listRecentAbsentNudges,
  loadAttendance,
  rebuildAttendanceExceptions,
  resolveAttendanceException,
  saveAttendancePolicy,
  type AttendanceException,
  type AttendanceExceptionKind,
  type AttendancePolicy,
} from "@/lib/attendance";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { hasPermission } from "@/lib/rbac";
import { useDemoSession } from "@/components/shell/SessionContext";
import { StudentNameLabel } from "@/components/students/StudentAvatar";

const KIND_FILTERS: { value: "" | AttendanceExceptionKind; label: string }[] = [
  { value: "", label: "All kinds" },
  { value: "present_on_leave", label: "Present on leave" },
  { value: "late_on_leave", label: "Late on leave" },
  { value: "absent_no_whatsapp", label: "Absent · no WA" },
  { value: "perfect_present_streak", label: "Perfect streak" },
  { value: "parent_dispute", label: "Parent dispute" },
];

export function AttendanceExceptionsPanel({ ay }: { ay: string }) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"" | AttendanceExceptionKind>(
    "",
  );
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});
  const [policyDraft, setPolicyDraft] = useState<AttendancePolicy>(
    DEFAULT_ATTENDANCE_POLICY,
  );
  const [disputeStudentId, setDisputeStudentId] = useState("");
  const [disputeDate, setDisputeDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [disputeDetail, setDisputeDetail] = useState("");

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    setPolicyDraft(getAttendancePolicy());
    setTick((x) => x + 1);
  }

  useEffect(() => {
    refresh();
  }, []);

  const canEdit = useMemo(() => {
    if (!masters) return false;
    return hasPermission(session, masters, "attendance", "edit");
  }, [masters, session, tick]);

  const canResolve = useMemo(() => {
    if (!masters) return false;
    return (
      hasPermission(session, masters, "attendance", "approve") ||
      hasPermission(session, masters, "attendance", "edit")
    );
  }, [masters, session, tick]);

  const openRows = useMemo(() => {
    void tick;
    let rows = listOpenAttendanceExceptions();
    if (kindFilter) rows = rows.filter((e) => e.kind === kindFilter);
    if (ay) rows = rows.filter((e) => e.academicYearCode === ay);
    return rows;
  }, [tick, kindFilter, ay]);

  const recentNudges = useMemo(() => {
    void tick;
    return listRecentAbsentNudges(12);
  }, [tick]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function classLabel(classId: string, sectionId: string) {
    const c = masters?.classes.find((x) => x.id === classId)?.name ?? "—";
    const s = masters?.sections.find((x) => x.id === sectionId)?.name ?? "";
    return s ? `${c}-${s}` : c;
  }

  function studentOf(id: string) {
    return sis?.students.find((s) => s.id === id) ?? null;
  }

  function onRebuild() {
    rebuildAttendanceExceptions();
    refresh();
    flash("Exceptions rebuilt from registers + leave");
  }

  function onSavePolicy() {
    const r = saveAttendancePolicy(policyDraft);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    refresh();
    flash(
      `Policy saved · cut-off ${r.policy.teacherCutoffTime} IST · nudge ${
        r.policy.absentNudgeEnabled ? "on" : "off"
      }`,
    );
  }

  function onResolve(ex: AttendanceException) {
    const note = (resolveNotes[ex.id] || "").trim();
    const r = resolveAttendanceException({
      id: ex.id,
      note,
      resolvedBy: session.fullName,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResolveNotes((prev) => {
      const next = { ...prev };
      delete next[ex.id];
      return next;
    });
    refresh();
    flash("Exception resolved");
  }

  function onFileDispute() {
    if (!disputeStudentId) {
      setError("Pick a student for the parent dispute");
      return;
    }
    const r = fileParentAttendanceDispute({
      studentId: disputeStudentId,
      date: disputeDate,
      academicYearCode: ay,
      detail: disputeDetail || undefined,
      filedBy: session.fullName,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDisputeDetail("");
    refresh();
    flash("Parent dispute filed");
  }

  const activeStudents = useMemo(() => {
    if (!sis) return [];
    return sis.students
      .filter(
        (s) =>
          s.status === "active" &&
          (!ay || !s.academicYearCode || s.academicYearCode === ay),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 400);
  }, [sis, ay]);

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Office exceptions
            </h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Daily anomalies only — leave mismatch, missing WhatsApp, perfect
              Present streaks, parent WRONG replies. Not every class.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="field !py-1.5 text-sm"
              value={kindFilter}
              onChange={(e) =>
                setKindFilter(e.target.value as "" | AttendanceExceptionKind)
              }
            >
              {KIND_FILTERS.map((k) => (
                <option key={k.value || "all"} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]"
              onClick={onRebuild}
            >
              Rebuild
            </button>
          </div>
        </div>

        <p className="mt-3 text-[11px] font-semibold text-[var(--brand-deep)]">
          Open {openRows.length}
          <span className="font-normal text-[var(--muted)]">
            {" "}
            · session {ay}
          </span>
        </p>

        {openRows.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            No open exceptions. Rebuild after morning marking, or file a parent
            dispute below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[rgba(32,48,80,0.08)] rounded-lg border border-[rgba(32,48,80,0.1)]">
            {openRows.map((ex) => {
              const st = studentOf(ex.studentId);
              return (
                <li key={ex.id} className="px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                        {exceptionKindLabel(ex.kind)}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-[var(--brand-deep)]">
                        {st ? (
                          <StudentNameLabel student={st} />
                        ) : (
                          ex.studentId
                        )}{" "}
                        <span className="font-normal text-[var(--muted)]">
                          · {classLabel(ex.classId, ex.sectionId)} · {ex.date}
                        </span>
                      </p>
                      <p className="mt-1 text-[12px] text-[var(--muted)]">
                        {ex.detail}
                      </p>
                    </div>
                  </div>
                  {canResolve ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        className="field !py-1.5 min-w-[12rem] flex-1 text-sm"
                        placeholder="Resolve note…"
                        value={resolveNotes[ex.id] || ""}
                        onChange={(e) =>
                          setResolveNotes((prev) => ({
                            ...prev,
                            [ex.id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="btn-accent rounded-lg px-3 py-2 text-sm font-bold"
                        onClick={() => onResolve(ex)}
                      >
                        Resolve
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Teacher cut-off & absent nudge
          </h3>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            After cut-off (IST), teachers cannot edit; office/principal can with
            a note. Newly marked Absent opens WhatsApp to parents (capped).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Cut-off (IST)
              </span>
              <input
                className="field !py-1.5"
                type="time"
                value={policyDraft.teacherCutoffTime}
                disabled={!canEdit}
                onChange={(e) =>
                  setPolicyDraft((p) => ({
                    ...p,
                    teacherCutoffTime: e.target.value || "10:30",
                  }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Max WA tabs / save
              </span>
              <input
                className="field !py-1.5"
                type="number"
                min={1}
                max={40}
                value={policyDraft.absentNudgeMaxOpen}
                disabled={!canEdit}
                onChange={(e) =>
                  setPolicyDraft((p) => ({
                    ...p,
                    absentNudgeMaxOpen: Number(e.target.value) || 12,
                  }))
                }
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={policyDraft.lockTeachersAfterCutoff}
                disabled={!canEdit}
                onChange={(e) =>
                  setPolicyDraft((p) => ({
                    ...p,
                    lockTeachersAfterCutoff: e.target.checked,
                  }))
                }
              />
              Lock teachers after cut-off
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={policyDraft.absentNudgeEnabled}
                disabled={!canEdit}
                onChange={(e) =>
                  setPolicyDraft((p) => ({
                    ...p,
                    absentNudgeEnabled: e.target.checked,
                  }))
                }
              />
              Absent WhatsApp nudge
            </label>
          </div>
          {canEdit ? (
            <button
              type="button"
              className="btn-accent mt-3 rounded-lg px-3 py-2 text-sm font-bold"
              onClick={onSavePolicy}
            >
              Save policy
            </button>
          ) : (
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              View only — need attendance edit to change policy.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            File parent dispute
          </h3>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            When a parent replies WRONG to an absent nudge, log it here for
            office follow-up.
          </p>
          <div className="mt-3 grid gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Student
              </span>
              <select
                className="field !py-1.5"
                value={disputeStudentId}
                onChange={(e) => setDisputeStudentId(e.target.value)}
              >
                <option value="">Select…</option>
                {activeStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} · {s.admissionNo}
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
                value={disputeDate}
                onChange={(e) => setDisputeDate(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Note
              </span>
              <input
                className="field !py-1.5"
                value={disputeDetail}
                onChange={(e) => setDisputeDetail(e.target.value)}
                placeholder="Parent said child was present…"
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.18)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]"
              onClick={onFileDispute}
            >
              File dispute
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Recent absent nudges
        </h3>
        {recentNudges.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No nudges logged yet. Mark Absent and save a register to open parent
            WhatsApp tabs.
          </p>
        ) : (
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-[12px]">
            {recentNudges.map((n) => {
              const st = studentOf(n.studentId);
              return (
                <li
                  key={n.id}
                  className="rounded-lg bg-[rgba(32,48,80,0.04)] px-2.5 py-2"
                >
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {st?.fullName || n.studentId}
                  </span>{" "}
                  · {n.date} · {n.mobile} · by {n.sentBy}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          Registers in store: {loadAttendance().registers.length}
        </p>
      </div>
    </div>
  );
}
