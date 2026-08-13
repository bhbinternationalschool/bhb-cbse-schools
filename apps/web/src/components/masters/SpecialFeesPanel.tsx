"use client";

import { useEffect, useMemo, useState } from "react";
import {
  checkAssignmentRemoval,
  checkSpecialFeeRemoval,
  formatInr,
  newId,
  parseInrToPaise,
  currentAcademicYearCode,
  removeSpecialFee,
  resolveSpecialFeeAssignees,
  type MastersState,
  type SpecialFee,
  type SpecialFeeAssignment,
} from "@/lib/masters";
import { EditControl } from "@/components/masters/EditControl";
import { RemoveControl } from "@/components/masters/RemoveControl";
import { useDemoSessionOptional } from "@/components/shell/SessionContext";
import { loadSis } from "@/lib/sis";

type Commit = (s: MastersState, msg?: string) => void;

export function SpecialFeesPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const session = useDemoSessionOptional();
  // Header-selected session, falling back to the masters "current" year.
  const ay = session?.academicYearCode || currentAcademicYearCode(state);
  const sessionStudents = useMemo(
    () =>
      loadSis().students.filter(
        (s) => s.academicYearCode === ay,
      ),
    [ay, state.students],
  );
  const sessionState = useMemo(
    () => ({ ...state, students: sessionStudents }),
    [state, sessionStudents],
  );
  const specialFees = (state.specialFees ?? []).filter(
    (f) => f.academicYearCode === ay,
  );
  const [selectedId, setSelectedId] = useState(specialFees[0]?.id ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);

  const selected = specialFees.find((f) => f.id === selectedId);

  // Create / edit form
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [feeHeadId, setFeeHeadId] = useState(
    state.feeHeads.find((h) => h.code === "EXAM")?.id ??
      state.feeHeads[0]?.id ??
      "",
  );
  const [amount, setAmount] = useState("500");
  const [dueOn, setDueOn] = useState("2025-09-15");
  const [reason, setReason] = useState("");

  useEffect(() => {
    setSelectedId(specialFees[0]?.id ?? "");
    setEditingId(null);
    setDueOn(`${ay.slice(0, 4)}-09-15`);
    // Session change intentionally resets the session-specific editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  // Assign form
  const [classIds, setClassIds] = useState<string[]>([]);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [pickerSectionId, setPickerSectionId] = useState("");

  const usableHeads = state.feeHeads.filter(
    (h) => h.isActive && !["LATE", "TUITION", "ADMISSION"].includes(h.code),
  );

  const pickerSectionOptions = useMemo(() => {
    if (classIds.length !== 1) return [];
    const classId = classIds[0];
    return state.sections.filter((s) => s.classId === classId && s.isActive);
  }, [state.sections, classIds]);

  useEffect(() => {
    if (!pickerSectionId) return;
    if (!pickerSectionOptions.some((s) => s.id === pickerSectionId)) {
      setPickerSectionId("");
    }
  }, [pickerSectionId, pickerSectionOptions]);

  const studentsForPicker = useMemo(() => {
    let list = sessionStudents.filter((s) => s.status === "active");
    if (classIds.length > 0) {
      list = list.filter((s) => classIds.includes(s.classId));
    }
    if (pickerSectionId) {
      list = list.filter((s) => s.sectionId === pickerSectionId);
    }
    if (studentQuery.trim()) {
      const q = studentQuery.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q),
      );
    }
    return list;
  }, [sessionStudents, classIds, pickerSectionId, studentQuery]);

  const assignmentsForSelected = useMemo(
    () =>
      (state.specialFeeAssignments ?? []).filter(
        (a) => a.specialFeeId === selectedId,
      ),
    [state.specialFeeAssignments, selectedId],
  );

  function resetFeeForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setFeeHeadId(
      state.feeHeads.find((h) => h.code === "EXAM")?.id ??
        state.feeHeads[0]?.id ??
        "",
    );
    setAmount("500");
    setDueOn(`${ay.slice(0, 4)}-09-15`);
    setReason("");
  }

  function startEdit(fee: SpecialFee) {
    setSelectedId(fee.id);
    setEditingId(fee.id);
    setCode(fee.code);
    setName(fee.name);
    setFeeHeadId(fee.feeHeadId);
    setAmount(String(fee.amountPaise / 100));
    setDueOn(fee.dueOn);
    setReason(fee.reason);
  }

  function toggleClass(id: string) {
    setClassIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      return next;
    });
    setPickerSectionId("");
  }

  function toggleStudent(id: string) {
    setStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAllVisibleStudents() {
    setStudentIds(studentsForPicker.map((s) => s.id));
  }

  function saveFee(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim() || !feeHeadId) return;
    const nextCode = code.trim().toUpperCase();
    if (
      specialFees.some(
        (f) =>
          f.code.toUpperCase() === nextCode && f.id !== editingId,
      )
    ) {
      commit(state, "Special fee code already exists");
      return;
    }

    if (editingId) {
      commit(
        {
          ...state,
          specialFees: (state.specialFees ?? []).map((f) =>
            f.id === editingId
              ? {
                  ...f,
                  code: nextCode,
                  name: name.trim(),
                  feeHeadId,
                  amountPaise: parseInrToPaise(amount),
                  dueOn,
                  reason: reason.trim(),
                }
              : f,
          ),
        },
        "Special fee updated",
      );
      resetFeeForm();
      return;
    }

    const fee: SpecialFee = {
      id: newId("spf"),
      code: nextCode,
      name: name.trim(),
      feeHeadId,
      academicYearCode: ay,
      amountPaise: parseInrToPaise(amount),
      dueOn,
      reason: reason.trim(),
      isActive: true,
    };
    commit(
      { ...state, specialFees: [...(state.specialFees ?? []), fee] },
      "Special fee created",
    );
    setSelectedId(fee.id);
    resetFeeForm();
  }

  function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    if (classIds.length === 0 && studentIds.length === 0) {
      commit(state, "Select at least one class or student");
      return;
    }
    const scope: SpecialFeeAssignment["scope"] =
      classIds.length > 0 && studentIds.length > 0
        ? "mixed"
        : classIds.length > 0
          ? "classes"
          : "students";
    const row: SpecialFeeAssignment = {
      id: newId("sfa"),
      specialFeeId: selectedId,
      classIds: [...classIds],
      studentIds: [...studentIds],
      scope,
      createdAt: new Date().toISOString(),
    };
    const nextState = {
      ...state,
      specialFeeAssignments: [
        ...(state.specialFeeAssignments ?? []),
        row,
      ],
    };
    const count = resolveSpecialFeeAssignees(
      { ...nextState, students: sessionStudents },
      row,
    ).length;
    commit(nextState, `Assigned to ${count} student(s)`);
    setClassIds([]);
    setStudentIds([]);
  }

  function removeAssignment(id: string) {
    commit(
      {
        ...state,
        specialFeeAssignments: (state.specialFeeAssignments ?? []).filter(
          (a) => a.id !== id,
        ),
      },
      "Assignment removed",
    );
  }

  function toggleActive(fee: SpecialFee) {
    commit(
      {
        ...state,
        specialFees: (state.specialFees ?? []).map((f) =>
          f.id === fee.id ? { ...f, isActive: !f.isActive } : f,
        ),
      },
      fee.isActive ? "Special fee inactivated" : "Special fee activated",
    );
  }

  function classLabel(classId: string) {
    return state.classes.find((c) => c.id === classId)?.name ?? "—";
  }

  function sectionLabel(sectionId: string) {
    return state.sections.find((s) => s.id === sectionId)?.name ?? "";
  }

  function headLabel(feeHeadId: string) {
    return state.feeHeads.find((h) => h.id === feeHeadId)?.nameEn ?? "—";
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--muted)]">
        Create special / misc fees (exam, certificate, activity…) then assign to{" "}
        <strong>classes</strong> and/or <strong>individual students</strong>.
        Demo roster is used until SIS is live.
      </p>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.15fr]">
        {/* List + create */}
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
              Special fees · {ay}
            </div>
            <ul className="max-h-[320px] divide-y divide-[var(--border)] overflow-y-auto">
              {specialFees.map((f) => {
                const on = f.id === selectedId;
                const assignCount = (state.specialFeeAssignments ?? []).filter(
                  (a) => a.specialFeeId === f.id,
                ).length;
                return (
                  <li
                    key={f.id}
                    className={`flex items-start gap-2 px-4 py-3 ${
                      on ? "bg-[var(--surface-sunken)]" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(f.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div>
                        <div className="font-medium text-[var(--brand-deep)]">
                          {f.name}{" "}
                          <span className="text-xs font-normal text-[var(--muted)]">
                            {f.code}
                          </span>
                          {!f.isActive ? (
                            <span className="ml-1 text-xs text-[var(--muted)]">
                              · inactive
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          {headLabel(f.feeHeadId)} · {formatInr(f.amountPaise)} ·
                          due {f.dueOn}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {assignCount} assignment
                          {assignCount === 1 ? "" : "s"}
                        </div>
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <EditControl
                        active={editingId === f.id}
                        onEdit={() => startEdit(f)}
                      />
                      <RemoveControl
                        check={checkSpecialFeeRemoval(state, f.id)}
                        onRemove={() => {
                          const result = removeSpecialFee(state, f.id);
                          if (!result.ok) {
                            commit(state, result.reason);
                            return;
                          }
                          const nextId =
                            result.state.specialFees?.find(
                              (x) => x.id === selectedId,
                            )?.id ??
                            result.state.specialFees?.[0]?.id ??
                            "";
                          setSelectedId(nextId);
                          if (editingId === f.id) resetFeeForm();
                          commit(result.state, "Special fee removed");
                        }}
                      />
                    </div>
                  </li>
                );
              })}
              {specialFees.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No special fees yet — create one below
                </li>
              ) : null}
            </ul>
            {selected ? (
              <div className="border-t border-[var(--border)] px-4 py-2">
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--brand-mid)]"
                  onClick={() => toggleActive(selected)}
                >
                  {selected.isActive ? "Inactivate" : "Activate"} selected
                </button>
              </div>
            ) : null}
          </div>

          <form
            onSubmit={saveFee}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
              {editingId ? "Edit special fee" : "Create special fee"}
            </h3>
            <label className="mt-3 block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">Code</span>
              <input
                className="field"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="EXAM_HY"
                required
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">Name</span>
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Exam fee — Half yearly"
                required
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">Fee head</span>
              <select
                className="field"
                value={feeHeadId}
                onChange={(e) => setFeeHeadId(e.target.value)}
              >
                {(usableHeads.length ? usableHeads : state.feeHeads).map(
                  (h) => (
                    <option key={h.id} value={h.id}>
                      {h.nameEn} ({h.code})
                    </option>
                  ),
                )}
              </select>
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block text-[var(--muted)]">
                  Amount (₹)
                </span>
                <input
                  className="field"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block text-[var(--muted)]">Due date</span>
                <input
                  type="date"
                  className="field"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                />
              </label>
            </div>
            <label className="mt-3 block text-sm">
              <span className="mb-1.5 block text-[var(--muted)]">
                Reason / ref
              </span>
              <input
                className="field"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Half-yearly session 2025-26"
              />
            </label>
            <div className="mt-4 flex gap-2">
              {editingId ? (
                <button
                  type="button"
                  className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-deep)]"
                  onClick={resetFeeForm}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                className="btn-accent flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
              >
                {editingId ? "Update special fee" : "Save special fee"}
              </button>
            </div>
          </form>
        </div>

        {/* Assign */}
        <div className="space-y-4">
          <form
            onSubmit={assign}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
              Assign
              {selected ? (
                <span className="font-normal text-[var(--muted)]">
                  {" "}
                  · {selected.name}
                </span>
              ) : null}
            </h3>
            {!selected ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Select a special fee on the left first.
              </p>
            ) : (
              <>
                <div className="mt-3">
                  <div className="mb-1.5 text-sm text-[var(--muted)]">
                    Classes (optional — all students in class)
                  </div>
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
                    {state.classes
                      .filter((c) => c.isActive)
                      .map((c) => {
                        const on = classIds.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleClass(c.id)}
                            className={`rounded-lg px-2 py-1 text-xs font-medium ${
                              on
                                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                : "bg-[var(--surface)] text-[var(--brand-deep)]"
                            }`}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-[var(--muted)]">
                      Students (optional — pick individuals)
                    </span>
                    <button
                      type="button"
                      className="text-xs text-[var(--brand-mid)] underline-offset-2 hover:underline"
                      onClick={selectAllVisibleStudents}
                    >
                      Select visible
                    </button>
                  </div>
                  <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)]">
                    <input
                      className="field"
                      value={studentQuery}
                      onChange={(e) => setStudentQuery(e.target.value)}
                      placeholder="Search name / admission no."
                    />
                    <select
                      className="field !py-1.5"
                      value={pickerSectionId}
                      disabled={classIds.length !== 1}
                      onChange={(e) => setPickerSectionId(e.target.value)}
                      title={
                        classIds.length === 1
                          ? "Filter by section"
                          : "Pick exactly one class to filter by section"
                      }
                    >
                      <option value="">
                        {classIds.length === 1
                          ? "All sections"
                          : "Section (1 class)"}
                      </option>
                      {pickerSectionOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ul className="max-h-52 overflow-y-auto rounded-xl border border-[var(--border)]">
                    {studentsForPicker.map((s) => {
                      const on = studentIds.includes(s.id);
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => toggleStudent(s.id)}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                              on ? "bg-[var(--surface-sunken)]" : ""
                            }`}
                          >
                            <span>
                              <span className="font-medium text-[var(--brand-deep)]">
                                {s.fullName}
                              </span>
                              <span className="ml-2 text-xs text-[var(--muted)]">
                                {classLabel(s.classId)}-
                                {sectionLabel(s.sectionId)} · {s.admissionNo}
                              </span>
                            </span>
                            <span className="text-xs text-[var(--brand-mid)]">
                              {on ? "✓" : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {studentsForPicker.length === 0 ? (
                      <li className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                        No students match — pick classes or clear search
                      </li>
                    ) : null}
                  </ul>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    {classIds.length} class(es) · {studentIds.length} student(s)
                    selected
                  </p>
                </div>

                <button
                  type="submit"
                  className="btn-accent mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
                  disabled={classIds.length === 0 && studentIds.length === 0}
                >
                  Assign special fee
                </button>
              </>
            )}
          </form>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
              Assignments
              {selected ? ` · ${selected.name}` : ""}
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {assignmentsForSelected.map((a) => {
                const people = resolveSpecialFeeAssignees(sessionState, a);
                const classNames = a.classIds
                  .map((id) => classLabel(id))
                  .join(", ");
                return (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="text-sm text-[var(--brand-deep)]">
                        Scope: <strong>{a.scope}</strong>
                        {classNames ? ` · ${classNames}` : ""}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--muted)]">
                        {people.length} student(s) will be charged
                        {selected
                          ? ` ${formatInr(selected.amountPaise)}`
                          : ""}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--muted)]">
                        {people
                          .slice(0, 5)
                          .map((p) => p.fullName)
                          .join(", ")}
                        {people.length > 5 ? ` +${people.length - 5}` : ""}
                      </div>
                    </div>
                    <RemoveControl
                      check={checkAssignmentRemoval(people.length)}
                      onRemove={() => removeAssignment(a.id)}
                    />
                  </li>
                );
              })}
              {selected && assignmentsForSelected.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  Not assigned yet
                </li>
              ) : null}
              {!selected ? (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  Select a special fee
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
