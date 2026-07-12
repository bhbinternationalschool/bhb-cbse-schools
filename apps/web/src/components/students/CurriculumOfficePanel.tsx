"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_AY, type MastersState } from "@/lib/masters";
import {
  pendingCurriculumRequests,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import {
  applyCurriculumBulk,
  classNeedsCartEnrollment,
  copyCurriculumFromStudent,
  draftFromTemplate,
  enrollmentStatusOf,
  rollCurriculumToNewAy,
  summarizeClassCurriculum,
  templateForClass,
  upsertClassCurriculumTemplate,
  type BulkApplyPolicy,
  type YearRollMode,
} from "@/lib/officeCurriculumWorkflow";
import {
  validateCurriculum,
  type StudentCurriculum,
} from "@/lib/studentCurriculum";
import { StudentCurriculumEditor } from "@/components/students/StudentCurriculumEditor";

export function CurriculumOfficePanel({
  masters,
  sis,
  classId,
  sectionId,
  students,
  onApplied,
}: {
  masters: MastersState;
  sis: SisState;
  classId: string;
  sectionId: string;
  students: SisStudent[];
  onApplied: (next: SisState, msg: string) => void;
}) {
  const ay =
    masters.academicYears?.find((y) => y.status === "current")?.code ??
    DEFAULT_AY;
  const nextAyOptions = (masters.academicYears ?? [])
    .map((y) => y.code)
    .filter((c) => c !== ay);
  // Prefer a future/non-current year if present; never preselect a closed past year
  const preferredNextAy =
    nextAyOptions.find((c) => c > ay) ??
    nextAyOptions.find((c) =>
      !(masters.academicYears ?? []).some(
        (y) => y.code === c && y.status === "closed",
      ),
    ) ??
    "";

  const needsCart = classNeedsCartEnrollment(classId, masters);
  const pendingIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) {
      if (pendingCurriculumRequests(sis, s.id).length > 0) set.add(s.id);
    }
    return set;
  }, [sis, students]);

  const summary = useMemo(
    () => summarizeClassCurriculum(students, pendingIds),
    [students, pendingIds],
  );

  const savedTemplate = useMemo(
    () => templateForClass(classId, ay),
    [classId, ay, students],
  );

  const [draft, setDraft] = useState<StudentCurriculum>(() =>
    savedTemplate
      ? draftFromTemplate(savedTemplate)
      : {
          academicYearCode: ay,
          seniorStreamId: null,
          chosenSubjectIds: [],
          confirmedAt: "",
          confirmedBy: "system",
        },
  );
  const [policy, setPolicy] = useState<BulkApplyPolicy>("skip_confirmed");
  const [confirmOnApply, setConfirmOnApply] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copyFromId, setCopyFromId] = useState("");
  const [rollAy, setRollAy] = useState(preferredNextAy);
  const [rollMode, setRollMode] = useState<YearRollMode>("clear");
  const [error, setError] = useState<string | null>(null);

  // Reset draft when class changes
  useEffect(() => {
    const tmpl = templateForClass(classId, ay);
    setDraft(
      tmpl
        ? draftFromTemplate(tmpl)
        : {
            academicYearCode: ay,
            seniorStreamId: null,
            chosenSubjectIds: [],
            confirmedAt: "",
            confirmedBy: "system",
          },
    );
    setSelectedIds([]);
    setCopyFromId("");
    setError(null);
  }, [classId, ay]);

  const proxyStudent = useMemo(
    () =>
      ({
        classId,
        academicYearCode: ay,
        curriculum: draft,
      }) as Pick<SisStudent, "classId" | "academicYearCode" | "curriculum">,
    [classId, ay, draft],
  );

  const validation = validateCurriculum(proxyStudent, draft, masters);

  const targetIds =
    selectedIds.length > 0 ? selectedIds : students.map((s) => s.id);

  function toggleStudent(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectNeeding() {
    setSelectedIds(
      students
        .filter((s) => enrollmentStatusOf(s) !== "confirmed")
        .map((s) => s.id),
    );
  }

  function saveTemplate() {
    upsertClassCurriculumTemplate({
      classId,
      academicYearCode: ay,
      chosenSubjectIds: draft.chosenSubjectIds,
      seniorStreamId: draft.seniorStreamId,
      label: `Template · ${ay}`,
    });
    onApplied(sis, "Class curriculum template saved");
  }

  function applyBulk() {
    setError(null);
    if (!validation.ok) {
      setError(validation.errors[0] ?? "Fix the cart before applying");
      return;
    }
    if (targetIds.length === 0) {
      setError("No students in scope");
      return;
    }
    const result = applyCurriculumBulk({
      state: sis,
      studentIds: targetIds,
      curriculum: { ...draft, academicYearCode: ay },
      masters,
      policy,
      confirm: confirmOnApply,
      classId,
    });
    if (!result.ok) {
      setError(result.errors[0] ?? "Could not apply");
      return;
    }
    upsertClassCurriculumTemplate({
      classId,
      academicYearCode: ay,
      chosenSubjectIds: draft.chosenSubjectIds,
      seniorStreamId: draft.seniorStreamId,
    });
    onApplied(
      result.state,
      `Applied to ${result.updated} student${result.updated === 1 ? "" : "s"}` +
        (result.skipped ? ` · skipped ${result.skipped}` : "") +
        (confirmOnApply ? " · confirmed" : " · draft"),
    );
  }

  function applyCopy() {
    setError(null);
    if (!copyFromId) {
      setError("Pick a source student");
      return;
    }
    const toIds = targetIds.filter((id) => id !== copyFromId);
    if (toIds.length === 0) {
      setError("Select at least one other student");
      return;
    }
    const result = copyCurriculumFromStudent({
      state: sis,
      fromStudentId: copyFromId,
      toStudentIds: toIds,
      masters,
      policy,
      confirm: confirmOnApply,
    });
    if (!result.ok) {
      setError(result.errors[0] ?? "Copy failed");
      return;
    }
    onApplied(
      result.state,
      `Copied curriculum to ${result.updated} · skipped ${result.skipped}`,
    );
  }

  function applyYearRoll() {
    setError(null);
    if (!rollAy) {
      setError("Select the new academic year");
      return;
    }
    const result = rollCurriculumToNewAy({
      state: sis,
      studentIds: targetIds,
      toAy: rollAy,
      mode: rollMode,
      masters,
    });
    onApplied(
      result.state,
      `Year roll → ${rollAy} · ${result.updated} student${result.updated === 1 ? "" : "s"}` +
        (rollMode === "clear" ? " · carts cleared" : " · drafts kept"),
    );
  }

  const clsName =
    masters.classes.find((c) => c.id === classId)?.name ?? "Class";
  const secName = sectionId
    ? (masters.sections.find((s) => s.id === sectionId)?.name ?? "")
    : "";

  if (!needsCart) {
    return (
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <p className="text-sm font-bold text-[var(--brand-deep)]">
          Curriculum · {clsName}
          {secName ? `-${secName}` : ""}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          This stage uses a fixed / class-map subject set. Bulk cart enrollment
          is for Middle options and IX–XII.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[rgba(15,118,110,0.25)] bg-[rgba(15,118,110,0.05)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[#0f766e]">
            Office · Curriculum · {clsName}
            {secName ? `-${secName}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Build a template cart, apply to the class (or selection), then
            confirm for exams / report cards.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-wide">
          <span className="rounded bg-[rgba(15,118,110,0.15)] px-2 py-0.5 text-[#0f766e]">
            Confirmed {summary.confirmed}
          </span>
          <span className="rounded bg-[rgba(196,149,58,0.2)] px-2 py-0.5 text-[var(--brand-gold)]">
            Draft {summary.draft}
          </span>
          <span className="rounded bg-[rgba(32,48,80,0.1)] px-2 py-0.5 text-[var(--muted)]">
            Empty {summary.empty}
          </span>
          {summary.pendingRequests > 0 ? (
            <span className="rounded bg-[rgba(180,60,60,0.12)] px-2 py-0.5 text-[var(--danger)]">
              Parent req {summary.pendingRequests}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-[rgba(180,60,60,0.1)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
        <StudentCurriculumEditor
          student={proxyStudent}
          masters={masters}
          curriculum={draft}
          onChange={setDraft}
          mode="office"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Apply policy
          </span>
          <select
            className="field !py-1.5"
            value={policy}
            onChange={(e) => setPolicy(e.target.value as BulkApplyPolicy)}
          >
            <option value="skip_confirmed">Skip already confirmed</option>
            <option value="empty_only">Only empty carts</option>
            <option value="overwrite">Overwrite everyone</option>
          </select>
        </label>
        <label className="flex items-end gap-2 pb-1 text-sm">
          <input
            type="checkbox"
            checked={confirmOnApply}
            onChange={(e) => setConfirmOnApply(e.target.checked)}
          />
          <span className="text-[12px] text-[var(--brand-deep)]">
            Confirm on apply (required for final report cards)
          </span>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-[#0f766e] px-3 py-2 text-xs font-bold text-white"
          onClick={applyBulk}
        >
          Apply to {selectedIds.length > 0 ? selectedIds.length : "all"}{" "}
          ({targetIds.length})
        </button>
        <button
          type="button"
          className="rounded-lg border border-[#0f766e] bg-white px-3 py-2 text-xs font-bold text-[#0f766e]"
          onClick={saveTemplate}
        >
          Save as class template
        </button>
        <button
          type="button"
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)]"
          onClick={selectNeeding}
        >
          Select needing confirm
        </button>
        <button
          type="button"
          className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)]"
          onClick={() => setSelectedIds([])}
        >
          Clear selection
        </button>
      </div>

      <div className="rounded-lg border border-dashed border-[rgba(32,48,80,0.2)] bg-white/80 p-3">
        <p className="text-xs font-bold text-[var(--brand-deep)]">
          Copy from a student
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            className="field !max-w-xs !py-1.5"
            value={copyFromId}
            onChange={(e) => setCopyFromId(e.target.value)}
          >
            <option value="">— Source —</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName} · {enrollmentStatusOf(s)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-bold text-[var(--brand-mid)]"
            onClick={applyCopy}
          >
            Copy to selection / class
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-[rgba(32,48,80,0.2)] bg-white/80 p-3">
        <p className="text-xs font-bold text-[var(--brand-deep)]">
          Year roll (new session)
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">
          Moves selected/all students to a new academic year and clears
          confirmation. Promotion to a new class already clears the cart.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            className="field !w-auto !py-1.5"
            value={rollAy}
            onChange={(e) => setRollAy(e.target.value)}
          >
            <option value="">— New AY —</option>
            {nextAyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!nextAyOptions.includes("2026-27") ? (
              <option value="2026-27">2026-27</option>
            ) : null}
          </select>
          <select
            className="field !w-auto !py-1.5"
            value={rollMode}
            onChange={(e) => setRollMode(e.target.value as YearRollMode)}
          >
            <option value="clear">Clear carts (re-enrol)</option>
            <option value="draft_copy">Keep as unconfirmed draft</option>
          </select>
          <button
            type="button"
            className="rounded-lg border border-[rgba(180,60,60,0.35)] px-3 py-1.5 text-xs font-bold text-[var(--danger)]"
            onClick={applyYearRoll}
          >
            Roll session
          </button>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Students in scope ({students.length})
          {selectedIds.length > 0
            ? ` · ${selectedIds.length} selected`
            : " · all"}
        </p>
        <ul className="max-h-48 divide-y divide-[rgba(32,48,80,0.06)] overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)] bg-white">
          {students.map((s) => {
            const st = enrollmentStatusOf(s);
            const on = selectedIds.includes(s.id);
            return (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-[rgba(32,48,80,0.03)]">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleStudent(s.id)}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-[var(--brand-deep)]">
                    {s.fullName}
                  </span>
                  <span
                    className={`text-[9px] font-bold uppercase ${
                      st === "confirmed"
                        ? "text-[#0f766e]"
                        : st === "draft"
                          ? "text-[var(--brand-gold)]"
                          : "text-[var(--muted)]"
                    }`}
                  >
                    {st}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
