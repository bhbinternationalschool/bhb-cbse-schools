"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import {
  classLabelForStudent,
  resolveParentHousehold,
} from "@/lib/parentPortal";
import {
  loadSis,
  pendingCurriculumRequests,
  submitCurriculumRequest,
  type CurriculumRequest,
  type Household,
  type SisStudent,
} from "@/lib/sis";
import {
  curriculumChoiceMode,
  classGroupForStudent,
  defaultCurriculum,
  resolveStudentSubjects,
  type StudentCurriculum,
  validateCurriculum,
} from "@/lib/studentCurriculum";
import { StudentCurriculumEditor } from "@/components/students/StudentCurriculumEditor";
import { StudentNameLabel } from "@/components/students/StudentAvatar";

export function ParentSubjectsPortal({
  guardianDisplayName,
}: {
  guardianDisplayName: string;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [children, setChildren] = useState<SisStudent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudentCurriculum | null>(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<CurriculumRequest | null>(null);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function reload() {
    const m = loadMasters();
    const sis = loadSis();
    setMasters(m);
    const hh = resolveParentHousehold(sis, {
      guardianName: guardianDisplayName,
      mobile: "9876543210",
    });
    setHousehold(hh);
    if (!hh) {
      setChildren([]);
      setActiveId(null);
      return;
    }
    const kids = sis.students.filter(
      (s) => s.householdId === hh.id && s.status === "active",
    );
    setChildren(kids);
    const aid = activeId && kids.some((k) => k.id === activeId)
      ? activeId
      : kids[0]?.id ?? null;
    setActiveId(aid);
    const stu = kids.find((k) => k.id === aid);
    if (stu) {
      setDraft(
        defaultCurriculum(
          {
            classId: stu.classId,
            academicYearCode: stu.academicYearCode,
            curriculum: stu.curriculum,
          },
          m,
        ),
      );
      setPending(pendingCurriculumRequests(sis, stu.id)[0] ?? null);
    } else {
      setDraft(null);
      setPending(null);
    }
  }

  useEffect(() => {
    void (async () => {
      const [{ ensureSisHydrated }, { withHydrationSlot }] = await Promise.all([
        import("@/lib/sisPersistence"),
        import("@/lib/deskHydrateGuard"),
      ]);
      await withHydrationSlot(() => ensureSisHydrated());
      reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianDisplayName]);

  const active = useMemo(
    () => children.find((c) => c.id === activeId) ?? null,
    [children, activeId],
  );

  const choiceMode = active && masters
    ? curriculumChoiceMode(classGroupForStudent(active, masters))
    : "none";

  const confirmedSubjects =
    active && masters
      ? resolveStudentSubjects(active, masters)
      : [];

  function selectChild(id: string) {
    if (!masters) return;
    setActiveId(id);
    const stu = children.find((c) => c.id === id);
    if (!stu) return;
    const sis = loadSis();
    setDraft(
      defaultCurriculum(
        {
          classId: stu.classId,
          academicYearCode: stu.academicYearCode,
          curriculum: stu.curriculum,
        },
        masters,
      ),
    );
    setPending(pendingCurriculumRequests(sis, stu.id)[0] ?? null);
    setNote("");
  }

  function submitRequest() {
    if (!active || !draft || !masters) return;
    const check = validateCurriculum(active, draft, masters);
    if (!check.ok) {
      flash(check.errors[0] ?? "Fix choices");
      return;
    }
    const res = submitCurriculumRequest({
      studentId: active.id,
      academicYearCode: active.academicYearCode || DEFAULT_AY,
      proposedStreamId: draft.seniorStreamId,
      proposedChosenSubjectIds: draft.chosenSubjectIds,
      note: note.trim(),
    });
    if (!res.ok) {
      flash(res.error);
      return;
    }
    setPending(res.request);
    flash("Request sent — office will confirm");
  }

  if (!household || !masters) {
    return (
      <p className="px-4 py-8 text-sm text-[var(--muted)]">
        Household not found. Sign in as the demo parent (Ramesh Singh /
        9876543210).
      </p>
    );
  }

  return (
    <div className="px-4 py-4">
      {notice ? (
        <p className="mb-3 rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-xs font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {children.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => selectChild(c.id)}
            className={`shrink-0 rounded-xl border px-3 py-2 text-left ${
              c.id === activeId
                ? "border-[var(--brand-deep)] bg-white"
                : "border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)]"
            }`}
          >
            <div className="text-sm font-semibold text-[var(--brand-deep)]">
              <StudentNameLabel student={c} />
            </div>
            <div className="text-[10px] text-[var(--muted)]">
              {classLabelForStudent(c, masters)}
            </div>
          </button>
        ))}
      </div>

      {active && draft ? (
        <div className="mt-3 space-y-4">
          <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Confirmed this year
            </p>
            {confirmedSubjects.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Office has not confirmed subjects yet — use the cart below to
                request a subject mix for this grade.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {confirmedSubjects.map((s) => (
                  <li key={s.id} className="text-sm text-[var(--brand-deep)]">
                    <span className="font-semibold">{s.code}</span> {s.nameEn}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pending ? (
            <div className="rounded-xl border border-[rgba(196,149,58,0.35)] bg-[rgba(196,149,58,0.08)] p-3 text-sm">
              <p className="font-bold text-[var(--brand-deep)]">
                Change request pending
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Office will approve or reject. You cannot send another request
                until then.
              </p>
            </div>
          ) : choiceMode === "none" ? (
            <p className="text-xs text-[var(--muted)]">
              This class has a fixed subject set — no parent choice needed.
            </p>
          ) : (
            <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
              <StudentCurriculumEditor
                student={active}
                masters={masters}
                curriculum={draft}
                onChange={setDraft}
                mode="parent"
                disabled={!!pending}
              />
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Note to office
                </span>
                <textarea
                  className="field min-h-[72px]"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional message"
                />
              </label>
              <button
                type="button"
                className="mt-3 w-full rounded-xl bg-[var(--brand-deep)] py-2.5 text-sm font-bold text-white"
                onClick={submitRequest}
              >
                Request subject change
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-[var(--muted)]">No children on this household.</p>
      )}
    </div>
  );
}
