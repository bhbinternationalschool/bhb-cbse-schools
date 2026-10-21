"use client";

import { useMemo, useState } from "react";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";
import {
  validateCurriculum,
  type StudentCurriculum,
} from "@/lib/studentCurriculum";
import { StudentCurriculumEditor } from "@/components/students/StudentCurriculumEditor";
import {
  ChildPicker,
  Flash,
  ParentReadState,
  parentPost,
  useActiveChild,
  useFlash,
  useParentRead,
  useParentRefresh,
} from "@/components/parent/parentData";

/** GET /api/parent-portal/subjects (lib/parentSubjects.server.ts). */
type SubjectsChild = {
  id: string;
  fullName: string;
  admissionNo: string;
  classId: string;
  classLabel: string;
  academicYearCode: string;
  choiceMode: "none" | "middle_options" | "secondary_cart" | "senior_cart";
  confirmed: { id: string; code: string; nameEn: string }[];
  draft: StudentCurriculum;
  pending: { id: string; requestedAt: string; note: string } | null;
};
type SubjectsView = {
  children: SubjectsChild[];
  masters: Pick<
    MastersState,
    "classes" | "subjects" | "classSubjects" | "seniorStreams" | "academicYears"
  >;
};

const KEY = ["subjects"] as const;

/**
 * Subjects for the parent's own children: what the office has confirmed, and
 * a subject-change request the server validates and files for office review.
 */
export function ParentSubjectsPortal() {
  const query = useParentRead<SubjectsView>(
    KEY,
    "/api/parent-portal/subjects",
    (v) =>
      Array.isArray(v.children) &&
      !!v.masters &&
      Array.isArray(v.masters.subjects),
    "Subjects",
  );
  return (
    <ParentReadState query={query} what="subjects">
      {(v) =>
        v.children.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--muted)]">
            No children are on your family&apos;s record this year. Please
            contact the school office.
          </p>
        ) : (
          <SubjectsBody view={v} />
        )
      }
    </ParentReadState>
  );
}

function SubjectsBody({ view }: { view: SubjectsView }) {
  const masters = useMemo(
    () => ({ ...emptyMastersShell(), ...view.masters }) as MastersState,
    [view.masters],
  );
  const { child, setActiveId, list } = useActiveChild(view.children);
  const active = view.children.find((c) => c.id === child?.id) ?? null;
  return (
    <div className="px-4 py-4" data-testid="parent-subjects">
      <ChildPicker list={list} child={child} onPick={setActiveId} />
      {active ? (
        <ChildSubjects key={active.id} child={active} masters={masters} />
      ) : null}
    </div>
  );
}

function ChildSubjects({
  child,
  masters,
}: {
  child: SubjectsChild;
  masters: MastersState;
}) {
  const [draft, setDraft] = useState<StudentCurriculum>(child.draft);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const flash = useFlash();
  const refresh = useParentRefresh();
  const student = {
    id: child.id,
    classId: child.classId,
    academicYearCode: child.academicYearCode,
    fullName: child.fullName,
  } as SisStudent;

  async function submit() {
    const check = validateCurriculum(student, draft, masters);
    if (!check.ok) return flash.fail(check.errors[0] ?? "Fix choices");
    setBusy(true);
    const r = await parentPost("/api/parent-portal/subjects", {
      studentId: child.id,
      proposedStreamId: draft.seniorStreamId,
      proposedChosenSubjectIds: draft.chosenSubjectIds,
      note: note.trim(),
    });
    setBusy(false);
    if (!r.ok) return flash.fail(r.error);
    await refresh(KEY);
    flash.ok("Request sent — the office will confirm");
  }

  return (
    <div className="mt-3 space-y-4">
      <Flash notice={flash.notice} error={flash.error} />
      <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {child.classLabel} · confirmed this year
        </p>
        {child.confirmed.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            The office has not confirmed subjects yet.
          </p>
        ) : (
          <ul
            className="mt-2 space-y-1"
            data-testid="parent-subjects-confirmed"
          >
            {child.confirmed.map((s) => (
              <li key={s.id} className="text-sm text-[var(--brand-deep)]">
                <span className="font-semibold">{s.code}</span> {s.nameEn}
              </li>
            ))}
          </ul>
        )}
      </div>
      {child.pending ? (
        <div
          className="rounded-xl border border-[rgba(196,149,58,0.35)] bg-[rgba(196,149,58,0.08)] p-3 text-sm"
          data-testid="parent-subjects-pending"
        >
          <p className="font-bold text-[var(--brand-deep)]">
            Change request pending
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The office will approve or reject it. You cannot send another
            request until then.
          </p>
        </div>
      ) : child.choiceMode === "none" ? (
        <p className="text-xs text-[var(--muted)]">
          This class has a fixed subject set — no parent choice needed.
        </p>
      ) : (
        <div className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] p-3">
          <StudentCurriculumEditor
            student={student}
            masters={masters}
            curriculum={draft}
            onChange={setDraft}
            mode="parent"
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
            className="mt-3 w-full rounded-xl bg-[var(--brand-deep)] py-2.5 text-sm font-bold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Sending…" : "Request subject change"}
          </button>
        </div>
      )}
    </div>
  );
}
