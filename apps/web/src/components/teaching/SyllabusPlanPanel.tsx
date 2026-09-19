"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleDashed, Clock, Eraser, Trash2 } from "lucide-react";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { loadMasters } from "@/lib/masters";
import {
  addResourceLink,
  computeSyllabusProgress,
  importSyllabusUnits,
  removeResourceLink,
  removeSyllabusUnit,
  syllabusCoverage,
  upsertSyllabusUnit,
  type ResourceKind,
  type SyllabusImportChapter,
  type SyllabusUnit,
  type TeachingState,
  type UnitProgress,
  type UnitStatus,
} from "@/lib/teaching";
import { AddResourceForm, ResourceList } from "@/components/teaching/ResourceLinks";
import { SyllabusOcrImport } from "@/components/teaching/SyllabusOcrImport";
import { applyOutcomesImport, parseOutcomesCsv } from "@/lib/syllabusOutcomesImport";

/**
 * Three coloured lines and one number: done, part-done, not started.
 *
 * The director asked for this on every subject — a head of school wants to
 * see where a class is without reading twelve rows. The number is generous
 * on purpose (a part-taught chapter counts a half), and the tooltip says
 * what it is made of, so nobody reads 60% as "sixty percent of the periods".
 */
function CoverageBar({
  rows,
  compact = false,
}: {
  rows: { status: UnitStatus }[];
  compact?: boolean;
}) {
  const c = syllabusCoverage(rows);
  if (!c.total) return null;
  const pct = (n: number) => `${(n / c.total) * 100}%`;
  return (
    <span className={`flex items-center gap-2 ${compact ? "text-[11px]" : "text-xs"}`}>
      <span
        className={`flex ${compact ? "h-1.5 w-24" : "h-2 w-40"} overflow-hidden rounded-full bg-[var(--surface-sunken)]`}
        title={`${c.complete} complete · ${c.partial} part-taught · ${c.notStarted} not started`}
      >
        <span style={{ width: pct(c.complete) }} className="bg-[var(--success)]" />
        <span style={{ width: pct(c.partial) }} className="bg-[var(--warning)]" />
        <span style={{ width: pct(c.notStarted) }} className="bg-transparent" />
      </span>
      <strong className="text-[var(--brand-deep)]">{c.percent}%</strong>
      {compact ? null : (
        <span className="text-[var(--muted)]">
          {c.complete} done · {c.partial} part · {c.notStarted} left
        </span>
      )}
    </span>
  );
}

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
  /** Show every chapter's topics at once — the default after a fill. */
  const [expandAll, setExpandAll] = useState(false);
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

  /**
   * The same measure for every subject this class has a plan for.
   *
   * The director asked to see coverage "on every subject" — one subject at a
   * time answers a teacher's question, not a head of school's. Subjects with
   * no chapters at all are left out: a row reading 0% would be read as
   * "nobody has taught it" when it means "nobody has entered it".
   */
  const subjectCoverage = useMemo(() => {
    if (!classId) return [];
    const masters = loadMasters();
    const name = (id: string) =>
      (masters.subjects ?? []).find((x) => x.id === id)?.nameEn || "Subject";
    const ids = [
      ...new Set(
        (state.units ?? [])
          .filter((u) => u.classId === classId && u.academicYearCode === ay && u.isActive)
          .map((u) => u.subjectId),
      ),
    ];
    return ids
      .map((id) => {
        const p = computeSyllabusProgress({ state, academicYearCode: ay, classId, subjectId: id });
        return { id, label: name(id), cover: syllabusCoverage(p.units), units: p.units };
      })
      .filter((row) => row.cover.total > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [state, ay, classId]);

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

  // The school's own books, already in the ERP for the AI to read from.
  // Until 19 Sep 2026 nothing on this screen could see them, so a syllabus
  // that was fully loaded (68 books, 1,538 chapters) showed as empty.
  const [fillingFromBooks, setFillingFromBooks] = useState(false);

  async function fillFromBooks() {
    if (!classId || !subjectId) return props.onError("Pick a class and subject first");
    props.onError(null);
    props.onNotice(null);
    setFillingFromBooks(true);
    try {
      const res = await fetch(
        `/api/v1/teaching/syllabus-from-books?classId=${encodeURIComponent(classId)}&subjectId=${encodeURIComponent(subjectId)}`,
      );
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; data?: { book: string | null; chapters: SyllabusImportChapter[]; reason?: string }; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.ok) {
        return props.onError(body?.error?.message || "Could not read the school's books");
      }
      const found = body.data;
      if (!found || !found.chapters.length) {
        // Say which book is missing, rather than leaving the teacher to guess
        // whether the screen failed or the shelf is empty.
        return props.onError(found?.reason || "No book is loaded for this class and subject");
      }
      importChapters(found.chapters);
      // Show what arrived: a filled plan whose chapters are all collapsed
      // looks exactly like an empty one.
      setExpandAll(true);
      if (found.book) props.onNotice(`From ${found.book} · check it against your own plan before teaching`);
    } catch (e) {
      props.onError((e as Error)?.message || "Could not read the school's books");
    } finally {
      setFillingFromBooks(false);
    }
  }

  const [outcomesCsv, setOutcomesCsv] = useState("");
  const [showOutcomesImport, setShowOutcomesImport] = useState(false);

  /** CSV/TSV of chapter → outcomes + LO codes (from the board's LO document / school mapping sheet). */
  function importOutcomes(text: string) {
    props.onError(null);
    const parsed = parseOutcomesCsv(text);
    if (parsed.error) return props.onError(parsed.error);
    const r = applyOutcomesImport(state, { academicYearCode: ay, classId, subjectId, rows: parsed.rows });
    if (r.errors.length) props.onError(r.errors.slice(0, 3).join(" · "));
    onChange(r.state);
    props.onNotice(`Outcomes import: ${r.updated} chapter${r.updated === 1 ? "" : "s"} updated, ${r.created} created`);
    setOutcomesCsv("");
    setShowOutcomesImport(false);
  }

  /** Learning outcomes + CBSE LO codes for a chapter — feeds lesson plans and paper tagging. */
  function saveOutcomes(unit: SyllabusUnit, learningOutcomes: string, codesRaw: string) {
    props.onError(null);
    const competencyCodes = codesRaw
      .split(/[,\s;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const result = upsertSyllabusUnit(state, { ...unit, learningOutcomes, competencyCodes });
    if (!result.ok) return props.onError(result.error);
    onChange(result.value.state);
    props.onNotice("Learning outcomes saved");
  }

  /** The teacher's own word on a chapter or topic. Their mark wins. */
  function mark(unit: SyllabusUnit, status: "not_started" | "in_progress" | "complete" | null) {
    props.onError(null);
    const result = upsertSyllabusUnit(state, { ...unit, markedStatus: status });
    if (!result.ok) return props.onError(result.error);
    onChange(result.value.state);
    props.onNotice(
      status === null
        ? "Mark cleared — back to counting periods"
        : `Marked ${STATUS_LABEL[status].toLowerCase()}`,
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

      {subjectCoverage.length > 1 ? (
        <div className="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3">
          <p className="text-xs font-semibold text-[var(--brand-deep)]">
            Coverage across this class
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {subjectCoverage.map((row) => (
              <li key={row.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`min-w-[8rem] truncate ${
                    row.id === subjectId ? "font-semibold text-[var(--brand-deep)]" : ""
                  }`}
                >
                  {row.label}
                </span>
                <CoverageBar rows={row.units} compact />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 px-1">
        <CoverageBar rows={progress.units} />
        {progress.units.length > 0 ? (
          <button
            type="button"
            className="ml-auto text-xs underline text-[var(--muted)]"
            onClick={() => {
              setExpandAll((v) => !v);
              setExpanded(new Set());
            }}
          >
            {expandAll ? "Collapse all" : "Show every topic"}
          </button>
        ) : null}
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
              open={expandAll !== expanded.has(chapter.unit.id)}
              onToggle={() => toggle(chapter.unit.id)}
              canEdit={canEdit}
              onMark={mark}
              topicDraft={topicDraft}
              setTopicDraft={setTopicDraft}
              onAddTopic={() => addTopic(chapter.unit.id)}
              onDrop={drop}
              onAttach={attach}
              onDetach={detach}
              onSaveOutcomes={saveOutcomes}
            />
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--brand-deep)]">From the school&apos;s own book</span>
            <span className="text-[var(--muted)]">
              The chapters and topics already loaded for this class and subject. Anything already in the plan is left as it is.
            </span>
            <button
              type="button"
              className="ml-auto rounded-lg border border-[var(--border)] px-2 py-1 font-semibold disabled:opacity-50"
              onClick={fillFromBooks}
              disabled={fillingFromBooks}
            >
              {fillingFromBooks ? "Reading…" : "Fill from the book"}
            </button>
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <SyllabusOcrImport
          onImport={importChapters}
          onError={props.onError}
        />
      ) : null}

      {canEdit ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--brand-deep)]">Learning outcomes · LO codes import</span>
            <span className="text-[var(--muted)]">
              CSV/TSV: chapter code · chapter title · learning outcomes (separate with ;) · LO codes (comma). Codes are copied as typed — from the board&apos;s LO document.
            </span>
            <button type="button" className="ml-auto underline" onClick={() => setShowOutcomesImport((v) => !v)}>
              {showOutcomesImport ? "Hide" : "Paste / upload"}
            </button>
          </div>
          {showOutcomesImport ? (
            <div className="mt-2 space-y-2">
              <textarea
                className="block min-h-[80px] w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-[11px]"
                placeholder={"Chapter code,Chapter title,Learning outcomes,LO codes\nCh 3,Understanding Quadrilaterals,Classifies quadrilaterals; Applies angle-sum property,\"M801, M802\""}
                value={outcomesCsv}
                onChange={(e) => setOutcomesCsv(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!outcomesCsv.trim()}
                  onClick={() => importOutcomes(outcomesCsv)}
                  className="rounded-lg bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  Import
                </button>
                <label className="cursor-pointer underline">
                  Upload CSV / TSV
                  <input
                    type="file"
                    accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void f.text().then((t) => importOutcomes(t));
                    }}
                  />
                </label>
                <span className="text-[var(--muted)]">Existing chapters are matched by code or title; outcomes are merged, codes added.</span>
              </div>
            </div>
          ) : null}
        </div>
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

/**
 * The same three dots every other module's rows carry, with the words a
 * teacher would use: done, part done, not started — and "clear" to hand the
 * row back to the period log.
 */
function markActions(
  onMark: (unit: SyllabusUnit, status: "not_started" | "in_progress" | "complete" | null) => void,
  onRemove: (unit: SyllabusUnit) => void,
) {
  return [
    {
      id: "complete",
      label: "Mark complete",
      icon: <Check className="size-4" aria-hidden />,
      onSelect: (u: SyllabusUnit) => onMark(u, "complete"),
      hidden: (u: SyllabusUnit) => u.markedStatus === "complete",
    },
    {
      id: "partial",
      label: "Mark part done",
      icon: <Clock className="size-4" aria-hidden />,
      onSelect: (u: SyllabusUnit) => onMark(u, "in_progress"),
      hidden: (u: SyllabusUnit) => u.markedStatus === "in_progress",
    },
    {
      id: "due",
      label: "Mark not started",
      icon: <CircleDashed className="size-4" aria-hidden />,
      onSelect: (u: SyllabusUnit) => onMark(u, "not_started"),
      hidden: (u: SyllabusUnit) => u.markedStatus === "not_started",
    },
    {
      id: "clear",
      label: "Clear mark (count periods)",
      icon: <Eraser className="size-4" aria-hidden />,
      onSelect: (u: SyllabusUnit) => onMark(u, null),
      hidden: (u: SyllabusUnit) => !u.markedStatus,
      separatorAbove: true,
    },
    {
      id: "remove",
      label: "Remove",
      icon: <Trash2 className="size-4" aria-hidden />,
      tone: "danger" as const,
      onSelect: (u: SyllabusUnit) => onRemove(u),
      separatorAbove: true,
    },
  ];
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
  onSaveOutcomes,
  onMark,
}: {
  index: number;
  chapter: UnitProgress;
  open: boolean;
  onToggle: () => void;
  canEdit: boolean;
  onMark: (unit: SyllabusUnit, status: "not_started" | "in_progress" | "complete" | null) => void;
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
  onSaveOutcomes: (unit: SyllabusUnit, learningOutcomes: string, codesRaw: string) => void;
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
            {chapter.statusSource === "marked" ? " · marked by a teacher" : ""}
          </p>
          {chapter.topics.length > 0 ? (
            <div className="mt-1">
              <CoverageBar rows={chapter.topics} compact />
            </div>
          ) : null}
          <ResourceList
            resources={u.resources}
            onRemove={canEdit ? (rid) => onDetach(u.id, rid) : undefined}
          />
        </div>
        {canEdit ? (
          <RowActionMenu
            row={u}
            label="Chapter actions"
            className="shrink-0"
            actions={markActions(onMark, (unit) => onDrop(unit.id, "Chapter"))}
          />
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-[var(--border)] px-3 py-2.5 pl-10">
          <OutcomesEditor
            key={`${u.id}:${u.updatedAt}`}
            unit={u}
            canEdit={canEdit}
            onSave={onSaveOutcomes}
          />
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
                        {topic.statusSource === "marked" ? " · marked by a teacher" : ""}
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
                      <RowActionMenu
                        row={topic.unit}
                        label="Topic actions"
                        className="shrink-0"
                        actions={markActions(onMark, (unit) => onDrop(unit.id, "Topic"))}
                      />
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

/**
 * Learning outcomes (free text, one per line) and CBSE LO codes for a
 * chapter. Codes are typed from the board's published LO document — the
 * ERP never generates them; the exam-paper AI can only tag a question with
 * a code that appears here.
 */
function OutcomesEditor({
  unit,
  canEdit,
  onSave,
}: {
  unit: SyllabusUnit;
  canEdit: boolean;
  onSave: (unit: SyllabusUnit, learningOutcomes: string, codesRaw: string) => void;
}) {
  const [outcomes, setOutcomes] = useState(unit.learningOutcomes);
  const [codes, setCodes] = useState(unit.competencyCodes.join(", "));
  const dirty =
    outcomes !== unit.learningOutcomes || codes !== unit.competencyCodes.join(", ");
  if (!canEdit && !unit.learningOutcomes && unit.competencyCodes.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-dashed border-[var(--border)] p-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
        Learning outcomes · LO codes
      </p>
      {canEdit ? (
        <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_220px_auto]">
          <textarea
            value={outcomes}
            onChange={(e) => setOutcomes(e.target.value)}
            rows={2}
            placeholder="One outcome per line — e.g. Classifies quadrilaterals by sides and angles"
            className="block w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
          />
          <input
            value={codes}
            onChange={(e) => setCodes(e.target.value)}
            placeholder="CBSE LO codes, e.g. M801, M802"
            title="From the board's Learning Outcomes document for this class and subject"
            className="block w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs uppercase"
          />
          <button
            type="button"
            disabled={!dirty}
            onClick={() => onSave(unit, outcomes, codes)}
            className="self-start rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50"
          >
            Save
          </button>
        </div>
      ) : (
        <div className="mt-1 text-xs text-[var(--brand-deep)]">
          <p className="whitespace-pre-wrap">{unit.learningOutcomes || "—"}</p>
          {unit.competencyCodes.length ? (
            <p className="mt-1 text-[var(--muted)]">LO codes: {unit.competencyCodes.join(", ")}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
