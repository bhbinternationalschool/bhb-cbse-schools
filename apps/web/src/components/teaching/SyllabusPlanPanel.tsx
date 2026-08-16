"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  addResourceLink,
  computeSyllabusProgress,
  importSyllabusUnits,
  removeResourceLink,
  removeSyllabusUnit,
  upsertSyllabusUnit,
  type ResourceKind,
  type SyllabusImportChapter,
  type TeachingState,
  type UnitProgress,
  type UnitStatus,
} from "@/lib/teaching";
import { AddResourceForm, ResourceList } from "@/components/teaching/ResourceLinks";
import { SyllabusOcrImport } from "@/components/teaching/SyllabusOcrImport";

const STATUS_LABEL: Record<UnitStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  unknown: "Taught — no estimate",
};

const STATUS_CLASS: Record<UnitStatus, string> = {
  not_started: "bg-[var(--surface-sunken)] text-[var(--muted)]",
  in_progress: "bg-[var(--info-soft)] text-[var(--info)]",
  complete: "bg-[var(--success-soft)] text-[var(--success)]",
  unknown: "bg-[var(--warning-soft)] text-[var(--warning)]",
};

export function SyllabusPlanPanel(props: {
  state: TeachingState;
  onChange: (next: TeachingState) => void;
  academicYearCode: string;
  classId: string;
  subjectId: string;
  canEdit: boolean;
  createdBy: string;
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

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chapterDraft, setChapterDraft] = useState({
    code: "",
    title: "",
    plannedPeriods: "",
    targetEndDate: "",
  });
  const [topicDraft, setTopicDraft] = useState<{
    parentId: string;
    title: string;
    plannedPeriods: string;
  }>({ parentId: "", title: "", plannedPeriods: "" });

  const progress = useMemo(() => {
    if (!classId || !subjectId) return null;
    return computeSyllabusProgress({
      state,
      academicYearCode: ay,
      classId,
      subjectId,
    });
  }, [state, ay, classId, subjectId]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addChapter() {
    props.onError(null);
    const result = upsertSyllabusUnit(state, {
      academicYearCode: ay,
      classId,
      subjectId,
      code: chapterDraft.code,
      title: chapterDraft.title,
      plannedPeriods: Number(chapterDraft.plannedPeriods) || 0,
      targetEndDate: chapterDraft.targetEndDate,
    });
    if (!result.ok) return props.onError(result.error);
    onChange(result.value.state);
    setChapterDraft({
      code: "",
      title: "",
      plannedPeriods: "",
      targetEndDate: "",
    });
    props.onNotice("Chapter added");
  }

  function addTopic(parentId: string) {
    props.onError(null);
    const result = upsertSyllabusUnit(state, {
      academicYearCode: ay,
      classId,
      subjectId,
      parentId,
      title: topicDraft.title,
      plannedPeriods: Number(topicDraft.plannedPeriods) || 0,
    });
    if (!result.ok) return props.onError(result.error);
    onChange(result.value.state);
    setTopicDraft({ parentId: "", title: "", plannedPeriods: "" });
    props.onNotice("Topic added");
  }

  function importChapters(chapters: SyllabusImportChapter[]) {
    props.onError(null);
    const result = importSyllabusUnits(state, {
      academicYearCode: ay,
      classId,
      subjectId,
      chapters,
    });
    if (!result.ok) return props.onError(result.error);
    onChange(result.value.state);
    const { chaptersAdded, topicsAdded, skipped } = result.value.summary;
    props.onNotice(
      `Added ${chaptersAdded} chapter${chaptersAdded === 1 ? "" : "s"}` +
        (topicsAdded ? ` and ${topicsAdded} topic${topicsAdded === 1 ? "" : "s"}` : "") +
        (skipped.length ? ` · ${skipped.length} already in the plan` : ""),
    );
  }

  function drop(unitId: string, label: string) {
    onChange(removeSyllabusUnit(state, unitId));
    props.onNotice(`${label} removed`);
  }

  function attach(
    unitId: string,
    input: { kind: ResourceKind; title: string; url: string; locator: string },
  ) {
    props.onError(null);
    const result = addResourceLink(
      state,
      { kind: "unit", id: unitId },
      input,
      props.createdBy,
    );
    if (!result.ok) return props.onError(result.error);
    onChange(result.value.state);
    props.onNotice("Link added");
  }

  function detach(unitId: string, resourceId: string) {
    onChange(removeResourceLink(state, { kind: "unit", id: unitId }, resourceId));
  }

  if (!classId || !subjectId) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Pick a class and subject to build its year plan.
      </p>
    );
  }
  if (!progress) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm">
        <span>
          <strong>{progress.completeUnits}</strong> of{" "}
          <strong>{progress.totalUnits}</strong> chapters complete
        </span>
        {progress.totalTopics > 0 ? (
          <span>
            <strong>{progress.completeTopics}</strong> of{" "}
            <strong>{progress.totalTopics}</strong> topics complete
          </span>
        ) : null}
        <span>
          <strong>{progress.taughtPeriods}</strong> of{" "}
          <strong>{progress.plannedPeriods}</strong> planned periods taught
        </span>
        <span>
          Pace:{" "}
          {progress.pace ? (
            <strong
              className={
                progress.pace.status === "behind"
                  ? "text-[var(--danger)]"
                  : "text-[var(--success)]"
              }
            >
              {progress.pace.status === "behind"
                ? `behind — ${progress.pace.unitsBehind} past target`
                : progress.pace.status.replace("_", " ")}
            </strong>
          ) : (
            <span className="text-[var(--muted)]">no target dates set</span>
          )}
        </span>
      </div>

      {progress.units.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No chapters yet. Add the first one below.
        </p>
      ) : (
        <ul className="space-y-2">
          {progress.units.map((chapter, i) => (
            <ChapterRow
              key={chapter.unit.id}
              index={i + 1}
              chapter={chapter}
              open={expanded.has(chapter.unit.id)}
              onToggle={() => toggle(chapter.unit.id)}
              canEdit={canEdit}
              topicDraft={topicDraft}
              setTopicDraft={setTopicDraft}
              onAddTopic={() => addTopic(chapter.unit.id)}
              onDrop={drop}
              onAttach={attach}
              onDetach={detach}
            />
          ))}
        </ul>
      )}

      {canEdit ? (
        <SyllabusOcrImport
          onImport={importChapters}
          onError={props.onError}
        />
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-3">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Code
            <input
              value={chapterDraft.code}
              onChange={(e) =>
                setChapterDraft((d) => ({ ...d, code: e.target.value }))
              }
              placeholder="Ch 1"
              className="mt-1 block w-24 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Chapter title
            <input
              value={chapterDraft.title}
              onChange={(e) =>
                setChapterDraft((d) => ({ ...d, title: e.target.value }))
              }
              className="mt-1 block w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Periods
            <input
              type="number"
              min={0}
              value={chapterDraft.plannedPeriods}
              onChange={(e) =>
                setChapterDraft((d) => ({
                  ...d,
                  plannedPeriods: e.target.value,
                }))
              }
              className="mt-1 block w-20 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Target by
            <input
              type="date"
              value={chapterDraft.targetEndDate}
              onChange={(e) =>
                setChapterDraft((d) => ({
                  ...d,
                  targetEndDate: e.target.value,
                }))
              }
              className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={addChapter}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)]"
          >
            Add chapter
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: UnitStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ChapterRow({
  index,
  chapter,
  open,
  onToggle,
  canEdit,
  topicDraft,
  setTopicDraft,
  onAddTopic,
  onDrop,
  onAttach,
  onDetach,
}: {
  index: number;
  chapter: UnitProgress;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  topicDraft: { parentId: string; title: string; plannedPeriods: string };
  setTopicDraft: (d: {
    parentId: string;
    title: string;
    plannedPeriods: string;
  }) => void;
  onAddTopic: () => void;
  onDrop: (id: string, label: string) => void;
  onAttach: (
    id: string,
    input: { kind: ResourceKind; title: string; url: string; locator: string },
  ) => void;
  onDetach: (unitId: string, resourceId: string) => void;
}) {
  const u = chapter.unit;
  const plannedFromTopics = chapter.topics.reduce(
    (s, t) => s + t.unit.plannedPeriods,
    0,
  );
  const planned =
    chapter.topics.length > 0 ? plannedFromTopics : u.plannedPeriods;

  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Collapse chapter" : "Expand chapter"}
          className="mt-0.5 shrink-0 text-[var(--muted)]"
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <span className="mt-0.5 shrink-0 text-xs text-[var(--muted)]">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--brand-deep)]">
              {u.code ? `${u.code} · ` : ""}
              {u.title}
            </span>
            <StatusPill status={chapter.status} />
          </div>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {chapter.periodsTaught} of {planned || "—"} periods taught
            {chapter.topics.length > 0
              ? ` · ${chapter.topics.filter((t) => t.status === "complete").length}/${chapter.topics.length} topics`
              : ""}
            {u.targetEndDate ? ` · target ${u.targetEndDate}` : ""}
          </p>
          <ResourceList
            resources={u.resources}
            onRemove={canEdit ? (rid) => onDetach(u.id, rid) : undefined}
          />
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => onDrop(u.id, "Chapter")}
            className="shrink-0 text-xs font-semibold text-[var(--danger)] underline"
          >
            Remove
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-[var(--border)] px-3 py-2.5 pl-10">
          {chapter.topics.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              No topics — the whole chapter is tracked as one unit.
            </p>
          ) : (
            <ul className="space-y-2">
              {chapter.topics.map((topic) => (
                <li
                  key={topic.unit.id}
                  className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[var(--brand-deep)]">
                          {topic.unit.title}
                        </span>
                        <StatusPill status={topic.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {topic.periodsTaught} of{" "}
                        {topic.unit.plannedPeriods || "—"} periods
                        {topic.lastTaughtOn
                          ? ` · last taught ${topic.lastTaughtOn}`
                          : ""}
                      </p>
                      <ResourceList
                        resources={topic.unit.resources}
                        onRemove={
                          canEdit
                            ? (rid) => onDetach(topic.unit.id, rid)
                            : undefined
                        }
                      />
                      {canEdit ? (
                        <AddResourceForm
                          compact
                          onAdd={(input) => onAttach(topic.unit.id, input)}
                        />
                      ) : null}
                    </div>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => onDrop(topic.unit.id, "Topic")}
                        className="shrink-0 text-xs font-semibold text-[var(--danger)] underline"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            <>
              <AddResourceForm onAdd={(input) => onAttach(u.id, input)} />
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  New topic
                  <input
                    value={
                      topicDraft.parentId === u.id ? topicDraft.title : ""
                    }
                    onChange={(e) =>
                      setTopicDraft({
                        parentId: u.id,
                        title: e.target.value,
                        plannedPeriods:
                          topicDraft.parentId === u.id
                            ? topicDraft.plannedPeriods
                            : "",
                      })
                    }
                    className="mt-1 block w-56 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="text-[11px] font-semibold text-[var(--muted)]">
                  Periods
                  <input
                    type="number"
                    min={0}
                    value={
                      topicDraft.parentId === u.id
                        ? topicDraft.plannedPeriods
                        : ""
                    }
                    onChange={(e) =>
                      setTopicDraft({
                        parentId: u.id,
                        title:
                          topicDraft.parentId === u.id ? topicDraft.title : "",
                        plannedPeriods: e.target.value,
                      })
                    }
                    className="mt-1 block w-20 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
                  />
                </label>
                <button
                  type="button"
                  onClick={onAddTopic}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                >
                  Add topic
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
