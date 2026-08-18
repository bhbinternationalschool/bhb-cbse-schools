"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import {
  addResourceLink,
  listLessonPlans,
  removeLessonPlan,
  removeResourceLink,
  upsertLessonPlan,
  type LessonPlan,
  type LessonPlanSource,
  type ResourceKind,
  type SyllabusUnit,
  type TeachingState,
} from "@/lib/teaching";
import type { LessonPlanDraft, LessonPlanLanguage } from "@/lib/lessonPlanAi";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import { AddResourceForm, ResourceList } from "@/components/teaching/ResourceLinks";
import { VoiceDictateButton } from "@/components/teaching/VoiceDictateButton";

type Draft = {
  id: string;
  title: string;
  unitIds: string[];
  plannedDate: string;
  plannedPeriods: string;
  objectives: string;
  teachingAids: string;
  activities: string;
  assessment: string;
  homework: string;
  /** Provenance of the text fields as they stand in the editor */
  source: LessonPlanSource;
  aiModel: string;
  /** ai_generations id of the draft on screen; "" when typed or already reported */
  generationId: string;
};

/** The fields the AI drafts; a change to any of them after an AI draft flips ai → ai_edited. */
type TextKey =
  | "title"
  | "objectives"
  | "teachingAids"
  | "activities"
  | "assessment"
  | "homework";

function emptyDraft(): Draft {
  return {
    id: "",
    title: "",
    unitIds: [],
    plannedDate: "",
    plannedPeriods: "1",
    objectives: "",
    teachingAids: "",
    activities: "",
    assessment: "",
    homework: "",
    source: "manual",
    aiModel: "",
    generationId: "",
  };
}

function draftFrom(plan: LessonPlan): Draft {
  return {
    id: plan.id,
    title: plan.title,
    unitIds: [...plan.unitIds],
    plannedDate: plan.plannedDate,
    plannedPeriods: String(plan.plannedPeriods),
    objectives: plan.objectives,
    teachingAids: plan.teachingAids,
    activities: plan.activities,
    assessment: plan.assessment,
    homework: plan.homework,
    source: plan.source,
    aiModel: plan.aiModel,
    generationId: "",
  };
}

/** Text edit on a draft: keeps provenance honest (ai → ai_edited). */
function editText(draft: Draft, key: TextKey, value: string): Draft {
  const source: LessonPlanSource =
    draft.source === "ai" && value !== draft[key] ? "ai_edited" : draft.source;
  return { ...draft, [key]: value, source };
}

const SOURCE_LABEL: Record<LessonPlanSource, string> = {
  manual: "",
  ai: "AI draft",
  ai_edited: "AI · edited",
};

export function LessonPlansPanel(props: {
  state: TeachingState;
  onChange: (next: TeachingState) => void;
  academicYearCode: string;
  classId: string;
  subjectId: string;
  canEdit: boolean;
  createdBy: string;
  /** Human labels for the AI prompt — "VIII", "Mathematics" */
  classLabel: string;
  subjectName: string;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const {
    state,
    onChange,
    academicYearCode: ay,
    classId,
    subjectId,
    canEdit,
  } = props;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const plans = useMemo(
    () =>
      classId && subjectId
        ? listLessonPlans(state, {
            academicYearCode: ay,
            classId,
            subjectId,
          })
        : [],
    [state, ay, classId, subjectId],
  );

  /** Chapters with their topics, for the "what does this lesson cover" picker. */
  const unitOptions = useMemo(() => {
    const mine = state.units.filter(
      (u) =>
        u.isActive &&
        u.academicYearCode === ay &&
        u.classId === classId &&
        u.subjectId === subjectId,
    );
    const chapters = mine
      .filter((u) => u.level === "chapter")
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return chapters.map((c) => ({
      chapter: c,
      topics: mine
        .filter((u) => u.parentId === c.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }, [state.units, ay, classId, subjectId]);

  const unitById = useMemo(() => {
    const map = new Map<string, SyllabusUnit>();
    for (const u of state.units) map.set(u.id, u);
    return map;
  }, [state.units]);

  /** Period logs that recorded this plan as the lesson actually delivered. */
  const deliveredCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of state.logs) {
      if (!log.lessonPlanId) continue;
      if (log.status !== "delivered" && log.status !== "substituted") continue;
      counts.set(log.lessonPlanId, (counts.get(log.lessonPlanId) ?? 0) + 1);
    }
    return counts;
  }, [state.logs]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    if (!draft) return;
    props.onError(null);
    const result = upsertLessonPlan(state, {
      id: draft.id || undefined,
      academicYearCode: ay,
      classId,
      subjectId,
      title: draft.title,
      unitIds: draft.unitIds,
      plannedDate: draft.plannedDate,
      plannedPeriods: Number(draft.plannedPeriods) || 1,
      objectives: draft.objectives,
      teachingAids: draft.teachingAids,
      activities: draft.activities,
      assessment: draft.assessment,
      homework: draft.homework,
      source: draft.source,
      aiModel: draft.aiModel,
      createdBy: props.createdBy,
    });
    if (!result.ok) return props.onError(result.error);
    onChange(result.value.state);
    if (draft.generationId) {
      reportAiOutcome({
        ids: [draft.generationId],
        outcome: draft.source === "ai_edited" ? "edited" : "accepted",
        targetType: "lesson_plan",
        targetId: result.value.plan.id,
      });
    }
    setDraft(null);
    props.onNotice("Lesson plan saved");
  }

  /** Editor closed with an unsaved AI draft on screen → rejected. */
  function discardDraft() {
    if (draft?.generationId) {
      reportAiOutcome({ ids: [draft.generationId], outcome: "rejected", targetType: "lesson_plan" });
    }
    setDraft(null);
  }

  const [aiBusy, setAiBusy] = useState(false);
  const [aiLanguage, setAiLanguage] = useState<LessonPlanLanguage>("en");
  const [aiNote, setAiNote] = useState("");

  /**
   * Ask the server for a draft from the ticked units. The reply lands in
   * the editor only — nothing is saved until the teacher presses Save.
   */
  async function draftWithAi() {
    if (!draft || aiBusy) return;
    props.onError(null);
    setAiBusy(true);
    try {
      const units = draft.unitIds
        .map((id) => unitById.get(id))
        .filter((u): u is SyllabusUnit => !!u)
        .map((u) => ({
          level: u.level,
          code: u.code,
          title: u.title,
          learningOutcomes: u.learningOutcomes,
          plannedPeriods: u.plannedPeriods,
        }));
      const res = await fetch("/api/ai/lesson-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classLabel: props.classLabel,
          subjectName: props.subjectName,
          periods: Number(draft.plannedPeriods) || 1,
          language: aiLanguage,
          units,
          existing: {
            title: draft.title,
            objectives: draft.objectives,
            teachingAids: draft.teachingAids,
            activities: draft.activities,
            assessment: draft.assessment,
            homework: draft.homework,
          },
          teacherNote: aiNote,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        draft?: LessonPlanDraft;
        model?: string;
        generationId?: string;
      };
      if (!res.ok || !body.draft) {
        props.onError(body.error || `AI draft failed (${res.status})`);
        return;
      }
      const d = body.draft;
      setDraft({
        ...draft,
        title: d.title || draft.title,
        objectives: d.objectives,
        teachingAids: d.teachingAids,
        activities: d.activities,
        assessment: d.assessment,
        homework: d.homework,
        source: "ai",
        aiModel: body.model || "",
        generationId: body.generationId || "",
      });
      // Re-drafting over an unsaved draft: the earlier one was rejected.
      if (draft.generationId && draft.generationId !== body.generationId) {
        reportAiOutcome({ ids: [draft.generationId], outcome: "rejected", targetType: "lesson_plan" });
      }
      props.onNotice(
        `Draft ready${body.model ? ` · ${body.model}` : ""} — review, edit, then save`,
      );
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "AI draft failed");
    } finally {
      setAiBusy(false);
    }
  }

  function drop(planId: string) {
    onChange(removeLessonPlan(state, planId));
    props.onNotice("Lesson plan removed");
  }

  function attach(
    planId: string,
    input: { kind: ResourceKind; title: string; url: string; locator: string },
  ) {
    props.onError(null);
    const result = addResourceLink(
      state,
      { kind: "lessonPlan", id: planId },
      input,
      props.createdBy,
    );
    if (!result.ok) return props.onError(result.error);
    onChange(result.value.state);
    props.onNotice("Link added");
  }

  if (!classId || !subjectId) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Pick a class and subject to see its lesson plans.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <button
          type="button"
          onClick={() => (draft ? discardDraft() : setDraft(emptyDraft()))}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
        >
          {draft ? "Close editor" : "New lesson plan"}
        </button>
      ) : null}

      {draft ? (
        <LessonPlanEditor
          draft={draft}
          setDraft={setDraft}
          unitOptions={unitOptions}
          onSave={save}
          onCancel={discardDraft}
          ai={{
            busy: aiBusy,
            language: aiLanguage,
            setLanguage: setAiLanguage,
            note: aiNote,
            setNote: setAiNote,
            run: draftWithAi,
          }}
        />
      ) : null}

      {plans.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No lesson plans for this subject yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {plans.map((plan) => {
            const open = expanded.has(plan.id);
            const delivered = deliveredCount.get(plan.id) ?? 0;
            return (
              <li
                key={plan.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)]"
              >
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(plan.id)}
                    aria-label={open ? "Collapse plan" : "Expand plan"}
                    className="mt-0.5 shrink-0 text-[var(--muted)]"
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--brand-deep)]">
                        {plan.title}
                      </span>
                      {delivered > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                          <CheckCircle2 className="h-3 w-3" />
                          delivered {delivered}×
                        </span>
                      ) : null}
                      {plan.source !== "manual" ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]"
                          title={plan.aiModel ? `Drafted by ${plan.aiModel}` : undefined}
                        >
                          <Sparkles className="h-3 w-3" />
                          {SOURCE_LABEL[plan.source]}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {plan.plannedDate || "unscheduled"} ·{" "}
                      {plan.plannedPeriods} period
                      {plan.plannedPeriods === 1 ? "" : "s"}
                      {plan.unitIds.length > 0
                        ? ` · ${plan.unitIds
                            .map((id) => unitById.get(id)?.title)
                            .filter(Boolean)
                            .join(", ")}`
                        : " · no chapter linked"}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setDraft(draftFrom(plan))}
                        className="text-xs font-semibold text-[var(--brand-deep)] underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => drop(plan.id)}
                        className="text-xs font-semibold text-[var(--danger)] underline"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>

                {open ? (
                  <div className="space-y-2 border-t border-[var(--border)] px-3 py-3 pl-9 text-sm">
                    <Field label="Objectives" value={plan.objectives} />
                    <Field label="Teaching aids" value={plan.teachingAids} />
                    <Field label="Activities" value={plan.activities} />
                    <Field label="Assessment" value={plan.assessment} />
                    <Field label="Homework" value={plan.homework} />
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                        Content links
                      </p>
                      <ResourceList
                        resources={plan.resources}
                        onRemove={
                          canEdit
                            ? (rid) =>
                                onChange(
                                  removeResourceLink(
                                    state,
                                    { kind: "lessonPlan", id: plan.id },
                                    rid,
                                  ),
                                )
                            : undefined
                        }
                      />
                      {canEdit ? (
                        <AddResourceForm
                          compact
                          onAdd={(input) => attach(plan.id, input)}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
        {value}
      </p>
    </div>
  );
}

function LessonPlanEditor({
  draft,
  setDraft,
  unitOptions,
  onSave,
  onCancel,
  ai,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  unitOptions: { chapter: SyllabusUnit; topics: SyllabusUnit[] }[];
  onSave: () => void;
  onCancel: () => void;
  ai: {
    busy: boolean;
    language: LessonPlanLanguage;
    setLanguage: (l: LessonPlanLanguage) => void;
    note: string;
    setNote: (n: string) => void;
    run: () => void;
  };
}) {
  function toggleUnit(id: string) {
    setDraft({
      ...draft,
      unitIds: draft.unitIds.includes(id)
        ? draft.unitIds.filter((u) => u !== id)
        : [...draft.unitIds, id],
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-[var(--muted)]">
          Lesson title
          <input
            value={draft.title}
            onChange={(e) => setDraft(editText(draft, "title", e.target.value))}
            className="mt-1 block w-72 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Planned date
          <input
            type="date"
            value={draft.plannedDate}
            onChange={(e) =>
              setDraft({ ...draft, plannedDate: e.target.value })
            }
            className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Periods
          <input
            type="number"
            min={1}
            value={draft.plannedPeriods}
            onChange={(e) =>
              setDraft({ ...draft, plannedPeriods: e.target.value })
            }
            className="mt-1 block w-20 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
          Covers
        </p>
        {unitOptions.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            No chapters in this subject&apos;s plan yet — add them on the
            Syllabus tab first.
          </p>
        ) : (
          <div className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
            {unitOptions.map(({ chapter, topics }) => (
              <div key={chapter.id}>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={draft.unitIds.includes(chapter.id)}
                    onChange={() => toggleUnit(chapter.id)}
                  />
                  {chapter.code ? `${chapter.code} · ` : ""}
                  {chapter.title}
                </label>
                {topics.map((t) => (
                  <label
                    key={t.id}
                    className="ml-6 flex items-center gap-2 text-xs text-[var(--muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={draft.unitIds.includes(t.id)}
                      onChange={() => toggleUnit(t.id)}
                    />
                    {t.title}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[var(--border)] p-2">
        <label className="text-xs font-semibold text-[var(--muted)]">
          Draft language
          <select
            value={ai.language}
            onChange={(e) => ai.setLanguage(e.target.value as LessonPlanLanguage)}
            className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
          >
            <option value="en">English</option>
            <option value="hi">हिंदी</option>
          </select>
        </label>
        <label className="min-w-[200px] flex-1 text-xs font-semibold text-[var(--muted)]">
          Note for the AI (optional)
          <input
            value={ai.note}
            onChange={(e) => ai.setNote(e.target.value)}
            placeholder="e.g. no lab today · focus on word problems"
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={ai.run}
          disabled={ai.busy}
          title="Drafts objectives, aids, activities, assessment and homework from the ticked chapters and their learning outcomes. Nothing is saved until you press Save."
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--brand-deep)] disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          {ai.busy ? "Drafting…" : "Draft with AI"}
        </button>
        {draft.source !== "manual" ? (
          <span className="text-[11px] font-semibold text-[var(--muted)]">
            {SOURCE_LABEL[draft.source]}
            {draft.aiModel ? ` · ${draft.aiModel}` : ""}
          </span>
        ) : null}
      </div>

      <TextArea
        label="Objectives"
        value={draft.objectives}
        onChange={(v) => setDraft(editText(draft, "objectives", v))}
        placeholder="By the end of this lesson, learners can…"
      />
      <TextArea
        label="Teaching aids"
        value={draft.teachingAids}
        onChange={(v) => setDraft(editText(draft, "teachingAids", v))}
        placeholder="Smart board, number-line chart, lab kit…"
      />
      <TextArea
        label="Activities"
        value={draft.activities}
        onChange={(v) => setDraft(editText(draft, "activities", v))}
        placeholder="Recap 5 min · demo 15 min · group work 15 min…"
        rows={5}
      />
      <TextArea
        label="Assessment"
        value={draft.assessment}
        onChange={(v) => setDraft(editText(draft, "assessment", v))}
        placeholder="Oral check, exit ticket, worksheet…"
      />
      <TextArea
        label="Homework"
        value={draft.homework}
        onChange={(v) => setDraft(editText(draft, "homework", v))}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
        >
          Save lesson plan
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div className="block text-xs font-semibold text-[var(--muted)]">
      <div className="flex items-center gap-2">
        <span>{label}</span>
        <VoiceDictateButton
          title={`Dictate ${label.toLowerCase()}`}
          onText={(text) =>
            // Append, never replace — dictating a second sentence must not
            // wipe what the teacher already wrote.
            onChange(value.trim() ? `${value.trim()} ${text}` : text)
          }
        />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
      />
    </div>
  );
}
