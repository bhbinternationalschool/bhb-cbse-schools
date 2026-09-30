"use client";

/**
 * Masters → Subjects, as three tables:
 *
 *   1. School subjects & components — everything the school teaches, each
 *      component right under its subject, every row with a "…" menu (Edit ·
 *      Add component · Activate/Deactivate · Delete). Nothing the school adds
 *      is ever hidden: see lib/subjectMasters.ts for why the old screen lost
 *      MATH and MATH-ORAL.
 *   2. NCF / NEP suggestions for a stage — the reference list, kept apart
 *      from the school's own table, with "Add to school subjects" per row.
 *   3. Subjects by class — a class dropdown: what that class studies as a
 *      tree, components it does not take yet shown as gaps, and Add
 *      subjects / New subject / Add component / Remove, all for that class.
 *      "All classes" shows every link, flat.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BulkAction, RowAction } from "@/components/ui/erp-grid";
import { MastersTabStack } from "@/components/masters/MastersLayout";
import {
  newFoundationId,
  normalizeSubject,
  type ClassSubjectLink,
  type Subject,
  type SubjectCategory,
} from "@/lib/foundationMasters";
import {
  NCF_SUBJECT_TAGS,
  cbseGroupForSubject,
  type LanguageSubtype,
  type NcfTagId,
} from "@/lib/cbseSubjectGroups";
import {
  CLASS_GROUPS,
  classGroupCodeForName,
  classesInGroup,
  type ClassGroupCode,
  type MastersState,
  type SchoolClass,
} from "@/lib/masters";
import {
  NEP_STAGE_PACKS,
  analyseNepPack,
  applyNepSuggestions,
  applySeniorStreamPackages,
  periodsForSuggestion,
  suggestedPeriodsPerWeek,
  suggestedWeeklyLoad,
} from "@/lib/nepSubjectSuggestions";
import { ncfCartOfferingsReady, seedNcfCartOfferings } from "@/lib/ncfCartSeed";
import {
  CLASS_GROUP_TO_NEP,
  applySubjectDraft,
  draftFromSubject,
  emptySubjectDraft,
  ncfSuggestionRows,
  schoolSubjectRows,
  singleSuggestionPack,
  subjectDeleteBlockers,
  subjectDraftError,
  subjectFromDraft,
  classLinkIdsToRemove,
  classSubjectRows,
  type ClassSubjectRow,
  type NcfSuggestionRow,
  type SchoolSubjectRow,
  type SubjectDraft,
  type SubjectsSlice,
} from "@/lib/subjectMasters";

type Commit = (s: MastersState, msg?: string) => void;

const LANGUAGE_CODES = ["ENG", "HIN", "SKT", "URDU", "L1", "L2", "L3"];

function Badge({ tone, children }: { tone: "teal" | "gold" | "muted" | "danger" | "brand"; children: React.ReactNode }) {
  const cls = {
    teal: "bg-[rgba(15,118,110,0.12)] text-[var(--tone-teal)]",
    gold: "bg-[rgba(196,149,58,0.15)] text-[var(--brand-gold)]",
    muted: "bg-[var(--surface-sunken)] text-[var(--muted)]",
    danger: "bg-[rgba(220,38,38,0.1)] text-[var(--danger)]",
    brand: "bg-[var(--surface-sunken)] text-[var(--brand-mid)]",
  }[tone];
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${cls}`}>
      {children}
    </span>
  );
}

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-1)]">
      <header className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">{hint}</p> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function classStage(c: SchoolClass): ClassGroupCode {
  return c.groupCode ?? classGroupCodeForName(c.name);
}

export function SubjectsPanel({ state, commit }: { state: MastersState; commit: Commit }) {
  const slice: SubjectsSlice = {
    subjects: state.subjects ?? [],
    classSubjects: state.classSubjects ?? [],
    classes: state.classes ?? [],
    staff: state.staff ?? [],
  };
  const subjects = slice.subjects;
  const activeClasses = useMemo(
    () => slice.classes.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [slice.classes],
  );

  /* ── School table filters ── */
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<ClassGroupCode | "">("");
  const [showInactive, setShowInactive] = useState(true);

  /* ── NCF table stage ── */
  const [ncfStage, setNcfStage] = useState<ClassGroupCode>("PRIMARY");
  const nepPack =
    NEP_STAGE_PACKS.find((p) => p.id === CLASS_GROUP_TO_NEP[ncfStage]) ?? NEP_STAGE_PACKS[0]!;

  /* ── Dialog state ── */
  const [editor, setEditor] = useState<{
    editingId?: string;
    draft: SubjectDraft;
    /** Opened from the class view: the new subject/component is linked to this class too. */
    linkClassId?: string;
  } | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Subject | null>(null);
  const [linkEdit, setLinkEdit] = useState<{ link: ClassSubjectLink; periods: number } | null>(null);

  /* ── Link form ── */
  const [mapSubjectIds, setMapSubjectIds] = useState<string[]>([]);
  const [periods, setPeriods] = useState(0);
  const [linkAsOptional, setLinkAsOptional] = useState(false);
  // The class view opens on the first class so what a class studies is the
  // first thing seen; "All classes" is one option away.
  const [mapClassFilter, setMapClassFilter] = useState(
    () => (state.classes ?? []).filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id ?? "",
  );

  const allNepCodes = useMemo(() => {
    const set = new Set<string>();
    for (const p of NEP_STAGE_PACKS) for (const s of p.subjects) set.add(s.code.toUpperCase());
    return set;
  }, []);

  /* ════════════════ 1. School subjects & components ════════════════ */

  const groupClassIds = useMemo(
    () =>
      stageFilter
        ? new Set(classesInGroup(slice.classes, stageFilter).map((c) => c.id))
        : null,
    [slice.classes, stageFilter],
  );

  const schoolRows = useMemo(() => {
    const rows = schoolSubjectRows(slice, { groupClassIds, query });
    if (showInactive) return rows;
    const activeTop = new Set(rows.filter((r) => r.depth === 0 && r.subject.isActive).map((r) => r.subject.id));
    return rows.filter((r) =>
      r.depth === 0 ? r.subject.isActive : r.subject.isActive && activeTop.has(r.parent!.id),
    );
    // slice is rebuilt each render from state; its parts are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.subjects, state.classSubjects, state.classes, groupClassIds, query, showInactive]);

  const counts = useMemo(() => {
    const top = subjects.filter((s) => !s.parentId);
    const comps = subjects.filter((s) => !!s.parentId);
    return {
      subjects: top.filter((s) => s.isActive).length,
      components: comps.filter((s) => s.isActive).length,
      inactive: subjects.filter((s) => !s.isActive).length,
      links: slice.classSubjects.filter((l) => l.isActive).length,
    };
  }, [subjects, slice.classSubjects]);

  function openAdd(parentId = "", linkClassId?: string) {
    setEditorError(null);
    setEditor({ draft: emptySubjectDraft(parentId), linkClassId });
  }

  function openEdit(s: Subject) {
    setEditorError(null);
    setEditor({ editingId: s.id, draft: draftFromSubject(s) });
  }

  function saveEditor() {
    if (!editor) return;
    const err = subjectDraftError(subjects, editor.draft, editor.editingId);
    if (err) {
      setEditorError(err);
      return;
    }
    if (editor.editingId) {
      const existing = subjects.find((s) => s.id === editor.editingId);
      if (!existing) {
        setEditorError("That subject no longer exists");
        return;
      }
      const next = applySubjectDraft(subjects, existing, editor.draft);
      // A subject's category is its components' category.
      const nextSubjects = subjects.map((s) => {
        if (s.id === next.id) return next;
        if (s.parentId === next.id && s.category !== next.category) {
          return normalizeSubject({ ...s, category: next.category });
        }
        return s;
      });
      commit({ ...state, subjects: nextSubjects }, `Saved ${next.code}`);
    } else {
      const row = subjectFromDraft(subjects, editor.draft);
      const parent = row.parentId ? subjects.find((s) => s.id === row.parentId) : null;
      const cls = editor.linkClassId ? slice.classes.find((c) => c.id === editor.linkClassId) : undefined;
      const link: ClassSubjectLink[] = cls
        ? [
            {
              id: newFoundationId("csub"),
              classId: cls.id,
              subjectId: row.id,
              periodsPerWeek: nepPeriodsFor(cls, row),
              isActive: true,
              isOptional: row.isElective,
            },
          ]
        : [];
      const what = parent ? `Added ${row.code} under ${parent.code}` : `Added ${row.code}`;
      commit(
        { ...state, subjects: [...subjects, row], classSubjects: [...slice.classSubjects, ...link] },
        cls ? `${what} · linked to ${cls.name}` : what,
      );
    }
    setEditor(null);
  }

  function setActive(ids: string[], isActive: boolean) {
    const set = new Set(ids);
    // Deactivating a subject takes its components with it; a component left
    // active under an inactive subject would still be offered for linking.
    if (!isActive) for (const s of subjects) if (s.parentId && set.has(s.parentId)) set.add(s.id);
    const changed = subjects.filter((s) => set.has(s.id) && s.isActive !== isActive).length;
    if (changed === 0) return;
    commit(
      { ...state, subjects: subjects.map((s) => (set.has(s.id) ? { ...s, isActive } : s)) },
      `${isActive ? "Activated" : "Deactivated"} ${changed} subject${changed === 1 ? "" : "s"}`,
    );
  }

  function deleteSubject(s: Subject) {
    if (subjectDeleteBlockers(slice, s.id).length > 0) return;
    commit(
      { ...state, subjects: subjects.filter((x) => x.id !== s.id) },
      `Deleted ${s.code}`,
    );
  }

  const schoolColumns: DataTableColumn<SchoolSubjectRow>[] = [
    {
      key: "code",
      header: "Code",
      value: (r) => r.subject.code,
      render: (r) => (
        <span className={`whitespace-nowrap font-semibold text-[var(--brand-deep)] ${r.depth === 1 ? "pl-5" : ""}`}>
          {r.depth === 1 ? <span className="mr-1 text-[var(--muted)]">↳</span> : null}
          {r.subject.code}
        </span>
      ),
    },
    {
      key: "name",
      header: "Name",
      value: (r) => r.subject.nameEn,
      render: (r) => <span className={r.subject.isActive ? "" : "text-[var(--muted)] line-through"}>{r.subject.nameEn}</span>,
    },
    {
      key: "type",
      header: "Type",
      value: (r) => (r.depth === 1 ? `Component of ${r.parent?.code}` : "Subject"),
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.depth === 1 ? (
            <Badge tone="muted">Component</Badge>
          ) : (
            <Badge tone="teal">{r.componentCount > 0 ? `Subject · ${r.componentCount}` : "Subject"}</Badge>
          )}
          {allNepCodes.has(r.subject.code.toUpperCase()) ? <Badge tone="gold">NCF</Badge> : <Badge tone="brand">School</Badge>}
          {r.subject.isElective ? <Badge tone="gold">Elective</Badge> : null}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      value: (r) => (r.subject.category === "co_scholastic" ? "Co-scholastic" : "Scholastic"),
      render: (r) =>
        r.subject.category === "co_scholastic"
          ? `Co-scholastic${r.subject.coScholasticArea ? ` · ${r.subject.coScholasticArea}` : ""}`
          : "Scholastic",
    },
    {
      key: "tag",
      header: "NCF tag",
      value: (r) => cbseGroupForSubject(r.subject),
      render: (r) => {
        const id = cbseGroupForSubject(r.subject);
        const tag = NCF_SUBJECT_TAGS.find((t) => t.id === id);
        return (
          <span title={tag?.label}>
            {id}
            {tag ? <span className="text-[var(--muted)]"> · {tag.shortLabel}</span> : null}
            {id === "A" && r.subject.languageSubtype ? (
              <span className="text-[var(--muted)]"> · {r.subject.languageSubtype}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "classes",
      header: "Classes",
      value: (r) => r.classNames.join(", "),
      render: (r) =>
        r.classNames.length === 0 ? (
          <span className="text-[var(--muted)]">Not linked</span>
        ) : (
          <span title={r.classNames.join(", ")}>
            {r.classNames.length <= 4 ? r.classNames.join(", ") : `${r.classNames.slice(0, 3).join(", ")} +${r.classNames.length - 3}`}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      value: (r) => (r.subject.isActive ? "Active" : "Inactive"),
      render: (r) => (r.subject.isActive ? <Badge tone="teal">Active</Badge> : <Badge tone="danger">Inactive</Badge>),
    },
  ];

  const schoolActions: RowAction<SchoolSubjectRow>[] = [
    { id: "edit", label: "Edit", onSelect: (r) => openEdit(r.subject) },
    {
      id: "add-component",
      label: "Add component",
      onSelect: (r) => openAdd(r.subject.id),
      hidden: (r) => r.depth === 1,
    },
    {
      id: "toggle",
      label: "Deactivate",
      onSelect: (r) => setActive([r.subject.id], false),
      hidden: (r) => !r.subject.isActive,
    },
    {
      id: "activate",
      label: "Activate",
      onSelect: (r) => setActive([r.subject.id], true),
      hidden: (r) => r.subject.isActive,
    },
    {
      id: "delete",
      label: "Delete",
      tone: "danger",
      separatorAbove: true,
      onSelect: (r) => setToDelete(r.subject),
    },
  ];

  const schoolBulk: BulkAction[] = [
    { id: "activate", label: "Activate", onRun: (keys) => setActive(keys, true) },
    { id: "deactivate", label: "Deactivate", onRun: (keys) => setActive(keys, false) },
  ];

  /* ════════════════ 2. NCF / NEP suggestions ════════════════ */

  const ncfRows = useMemo(
    () => ncfSuggestionRows(nepPack, subjects, (item) => periodsForSuggestion(nepPack.id, item)),
    [nepPack, subjects],
  );
  const nepAnalysis = useMemo(() => analyseNepPack(nepPack, subjects), [nepPack, subjects]);
  const weeklyLoad = useMemo(() => suggestedWeeklyLoad(nepPack), [nepPack]);

  function addAllMissing() {
    const { subjects: next, added } = applyNepSuggestions(subjects, nepPack);
    if (added === 0) return;
    commit({ ...state, subjects: next }, `Added ${added} NCF subject${added === 1 ? "" : "s"} · ${nepPack.label}`);
  }

  function addOneSuggestion(code: string) {
    const { subjects: next, added } = applyNepSuggestions(subjects, singleSuggestionPack(nepPack, code));
    if (added === 0) return;
    commit({ ...state, subjects: next }, `Added ${code} to school subjects`);
  }

  function seedCartOfferings() {
    const seeded = seedNcfCartOfferings({
      classes: state.classes,
      subjects,
      classSubjects: slice.classSubjects,
    });
    commit(
      { ...state, subjects: seeded.subjects, classSubjects: seeded.classSubjects },
      seeded.alreadySeeded
        ? "IX–X / XI–XII cart offerings already complete · tags refreshed"
        : `Seeded cart · +${seeded.subjectsAdded} subjects · +${seeded.linksAdded} class links`,
    );
  }

  function applyStreams() {
    const result = applySeniorStreamPackages(subjects, state.seniorStreams ?? []);
    commit(
      { ...state, subjects: result.subjects, seniorStreams: result.seniorStreams },
      result.subjectsAdded > 0
        ? `Streams ready · ${result.subjectsAdded} subjects added · ${result.streamsUpserted} pathways`
        : `XI–XII streams refreshed · ${result.streamsUpserted} pathways`,
    );
  }

  const ncfColumns: DataTableColumn<NcfSuggestionRow>[] = [
    {
      key: "code",
      header: "Code",
      value: (r) => r.code,
      render: (r) => (
        <span className={`whitespace-nowrap font-semibold text-[var(--brand-deep)] ${r.underCode ? "pl-5" : ""}`}>
          {r.underCode ? <span className="mr-1 text-[var(--muted)]">↳</span> : null}
          {r.code}
        </span>
      ),
    },
    {
      key: "name",
      header: "Suggested subject",
      value: (r) => r.nameEn,
      render: (r) => (
        <span>
          {r.nameEn}
          {r.note ? <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted)]">{r.note}</span> : null}
        </span>
      ),
    },
    { key: "under", header: "Under", value: (r) => r.underCode || "—" },
    {
      key: "category",
      header: "Category",
      value: (r) => (r.category === "co_scholastic" ? "Co-scholastic" : "Scholastic"),
    },
    { key: "periods", header: "Periods / wk", align: "right", value: (r) => r.periodsPerWeek },
    {
      key: "status",
      header: "In school?",
      value: (r) => (r.present ? (r.present.isActive ? "Yes" : "Inactive") : "Missing"),
      render: (r) =>
        r.present ? (
          r.present.isActive ? (
            <Badge tone="teal">In school</Badge>
          ) : (
            <Badge tone="muted">In school · inactive</Badge>
          )
        ) : (
          <Badge tone="danger">Missing</Badge>
        ),
    },
  ];

  const ncfActions: RowAction<NcfSuggestionRow>[] = [
    {
      id: "add",
      label: "Add to school subjects",
      onSelect: (r) => addOneSuggestion(r.code),
      hidden: (r) => !!r.present,
    },
    {
      id: "edit",
      label: "Edit school subject",
      onSelect: (r) => r.present && openEdit(r.present),
      hidden: (r) => !r.present,
    },
    {
      id: "activate",
      label: "Activate school subject",
      onSelect: (r) => r.present && setActive([r.present.id], true),
      hidden: (r) => !r.present || r.present.isActive,
    },
  ];

  const streams = (state.seniorStreams ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);

  /* ════════════════ 3. Subjects by class ════════════════ */

  type MapRow = { link: ClassSubjectLink; cls: SchoolClass | undefined; subject: Subject; parent: Subject | null };

  const viewClass = activeClasses.find((c) => c.id === mapClassFilter);

  /** "All classes": every link, flat. */
  const mapRows = useMemo<MapRow[]>(() => {
    const clsById = new Map(slice.classes.map((c) => [c.id, c] as const));
    const subById = new Map(subjects.map((s) => [s.id, s] as const));
    return slice.classSubjects
      .filter((l) => l.isActive)
      .map((l) => {
        const subject = subById.get(l.subjectId);
        if (!subject) return null;
        return {
          link: l,
          cls: clsById.get(l.classId),
          subject,
          parent: subject.parentId ? subById.get(subject.parentId) ?? null : null,
        };
      })
      .filter((r): r is MapRow => !!r)
      .sort(
        (a, b) =>
          (a.cls?.sortOrder ?? 999) - (b.cls?.sortOrder ?? 999) ||
          (a.parent?.code ?? a.subject.code).localeCompare(b.parent?.code ?? b.subject.code) ||
          (a.parent ? 1 : 0) - (b.parent ? 1 : 0) ||
          a.subject.code.localeCompare(b.subject.code),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.classSubjects, state.subjects, state.classes]);

  /** One class: its subjects as a tree, unlinked components shown as gaps. */
  const classRows = useMemo<ClassSubjectRow[]>(
    () => (viewClass ? classSubjectRows(slice, viewClass.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.classSubjects, state.subjects, viewClass],
  );

  function nepPeriodsFor(cls: SchoolClass | undefined, s: Subject): number {
    const stage = CLASS_GROUP_TO_NEP[cls ? classStage(cls) : "MIDDLE"];
    return suggestedPeriodsPerWeek(stage, s.code, s.category);
  }

  function updateLink(id: string, patch: Partial<ClassSubjectLink>, msg: string) {
    commit(
      { ...state, classSubjects: slice.classSubjects.map((l) => (l.id === id ? { ...l, ...patch } : l)) },
      msg,
    );
  }

  function removeLinks(ids: string[], msg?: string) {
    if (ids.length === 0) return;
    const set = new Set(ids);
    commit(
      { ...state, classSubjects: slice.classSubjects.filter((l) => !set.has(l.id)) },
      msg ?? `Removed ${ids.length} class link${ids.length === 1 ? "" : "s"}`,
    );
  }

  function linkToClass(cls: SchoolClass, subjectIds: string[], opts?: { periods?: number; optional?: boolean }) {
    const existing = new Set(
      slice.classSubjects.filter((l) => l.classId === cls.id && l.isActive).map((l) => l.subjectId),
    );
    const toAdd = subjectIds.filter((id) => !existing.has(id));
    if (toAdd.length === 0) {
      commit(state, `Already linked to ${cls.name}`);
      return;
    }
    const rows: ClassSubjectLink[] = toAdd.map((subjectId) => {
      const s = subjects.find((x) => x.id === subjectId)!;
      return {
        id: newFoundationId("csub"),
        classId: cls.id,
        subjectId,
        periodsPerWeek: opts?.periods && opts.periods > 0 ? opts.periods : nepPeriodsFor(cls, s),
        isActive: true,
        isOptional: !!opts?.optional || !!s.isElective,
      };
    });
    const codes = rows.map((r) => subjects.find((s) => s.id === r.subjectId)?.code).join(", ");
    commit(
      { ...state, classSubjects: [...slice.classSubjects, ...rows] },
      rows.length === 1 ? `${codes} added to ${cls.name}` : `${rows.length} subjects added to ${cls.name}`,
    );
  }

  function removeFromClass(cls: SchoolClass, subjectIds: string[]) {
    const ids = [...new Set(subjectIds.flatMap((id) => classLinkIdsToRemove(slice, cls.id, id)))];
    const codes = subjectIds.map((id) => subjects.find((s) => s.id === id)?.code).filter(Boolean);
    removeLinks(
      ids,
      codes.length === 1 ? `${codes[0]} removed from ${cls.name}` : `${codes.length} subjects removed from ${cls.name}`,
    );
  }

  const mapColumns: DataTableColumn<MapRow>[] = [
    { key: "class", header: "Class", value: (r) => r.cls?.name ?? "?" },
    {
      key: "subject",
      header: "Subject",
      value: (r) => (r.parent ? `${r.parent.code}/${r.subject.code}` : r.subject.code),
      render: (r) => (
        <span className="font-semibold text-[var(--brand-deep)]">
          {r.parent ? <span className="text-[var(--muted)]">{r.parent.code}/</span> : null}
          {r.subject.code}
          <span className="ml-1 font-normal text-[var(--muted)]">{r.subject.nameEn}</span>
        </span>
      ),
    },
    { key: "periods", header: "Periods / wk", align: "right", value: (r) => r.link.periodsPerWeek },
    { key: "nep", header: "NCF suggests", align: "right", value: (r) => nepPeriodsFor(r.cls, r.subject) },
    {
      key: "optional",
      header: "Type",
      value: (r) => (r.link.isOptional || r.subject.isElective ? "Optional" : "Compulsory"),
      render: (r) =>
        r.link.isOptional || r.subject.isElective ? <Badge tone="gold">Optional</Badge> : <Badge tone="muted">Compulsory</Badge>,
    },
  ];

  const mapActions: RowAction<MapRow>[] = [
    {
      id: "open",
      label: "Open this class",
      onSelect: (r) => r.cls && setMapClassFilter(r.cls.id),
    },
    {
      id: "periods",
      label: "Edit periods / week",
      onSelect: (r) => setLinkEdit({ link: r.link, periods: r.link.periodsPerWeek }),
    },
    {
      id: "remove",
      label: "Remove from class",
      tone: "danger",
      separatorAbove: true,
      onSelect: (r) => removeLinks([r.link.id], `${r.subject.code} removed from ${r.cls?.name ?? "class"}`),
    },
  ];

  const mapBulk: BulkAction[] = [
    { id: "remove", label: "Remove links", tone: "danger", onRun: (keys) => removeLinks(keys) },
  ];

  const classColumns: DataTableColumn<ClassSubjectRow>[] = [
    {
      key: "code",
      header: "Subject",
      value: (r) => r.subject.code,
      render: (r) => (
        <span className={`whitespace-nowrap font-semibold ${r.link ? "text-[var(--brand-deep)]" : "text-[var(--muted)]"} ${r.depth === 1 ? "pl-5" : ""}`}>
          {r.depth === 1 ? <span className="mr-1 text-[var(--muted)]">↳</span> : null}
          {r.subject.code}
        </span>
      ),
    },
    {
      key: "name",
      header: "Name",
      value: (r) => r.subject.nameEn,
      render: (r) => <span className={r.link ? "" : "text-[var(--muted)]"}>{r.subject.nameEn}</span>,
    },
    {
      key: "periods",
      header: "Periods / wk",
      align: "right",
      value: (r) => (r.link ? r.link.periodsPerWeek : ""),
      render: (r) => (r.link ? r.link.periodsPerWeek : <span className="text-[var(--muted)]">—</span>),
    },
    {
      key: "nep",
      header: "NCF suggests",
      align: "right",
      value: (r) => nepPeriodsFor(viewClass, r.subject),
    },
    {
      key: "status",
      header: "In this class",
      value: (r) =>
        !r.link ? "Not added" : r.link.isOptional || r.subject.isElective ? "Optional" : "Compulsory",
      render: (r) =>
        !r.link ? (
          <Badge tone="danger">Not added</Badge>
        ) : r.link.isOptional || r.subject.isElective ? (
          <Badge tone="gold">Optional</Badge>
        ) : (
          <Badge tone="teal">Compulsory</Badge>
        ),
    },
  ];

  const classActions: RowAction<ClassSubjectRow>[] = [
    {
      id: "add",
      label: "Add to this class",
      onSelect: (r) => viewClass && linkToClass(viewClass, [r.subject.id]),
      hidden: (r) => !!r.link || !r.subject.isActive,
    },
    {
      id: "add-component",
      label: "Add component",
      onSelect: (r) => viewClass && openAdd(r.subject.id, viewClass.id),
      hidden: (r) => r.depth === 1,
    },
    {
      id: "periods",
      label: "Edit periods / week",
      onSelect: (r) => r.link && setLinkEdit({ link: r.link, periods: r.link.periodsPerWeek }),
      hidden: (r) => !r.link,
    },
    {
      id: "nep",
      label: "Use NCF periods",
      onSelect: (r) =>
        r.link &&
        updateLink(
          r.link.id,
          { periodsPerWeek: nepPeriodsFor(viewClass, r.subject) },
          `${viewClass?.name} · ${r.subject.code} → NCF periods`,
        ),
      hidden: (r) => !r.link || r.link.periodsPerWeek === nepPeriodsFor(viewClass, r.subject),
    },
    {
      id: "optional",
      label: "Mark optional",
      onSelect: (r) => r.link && updateLink(r.link.id, { isOptional: true }, `${r.subject.code} optional for ${viewClass?.name}`),
      hidden: (r) => !r.link || !!r.link.isOptional,
    },
    {
      id: "compulsory",
      label: "Mark compulsory",
      onSelect: (r) => r.link && updateLink(r.link.id, { isOptional: false }, `${r.subject.code} compulsory for ${viewClass?.name}`),
      hidden: (r) => !r.link || !r.link.isOptional,
    },
    { id: "edit", label: "Edit subject", onSelect: (r) => openEdit(r.subject) },
    {
      id: "remove",
      label: "Remove from this class",
      tone: "danger",
      separatorAbove: true,
      onSelect: (r) => viewClass && removeFromClass(viewClass, [r.subject.id]),
      hidden: (r) => !viewClass || classLinkIdsToRemove(slice, viewClass.id, r.subject.id).length === 0,
    },
  ];

  const classBulk: BulkAction[] = [
    {
      id: "add",
      label: "Add to class",
      onRun: (keys) => viewClass && linkToClass(viewClass, keys),
    },
    {
      id: "remove",
      label: "Remove from class",
      tone: "danger",
      onRun: (keys) => viewClass && removeFromClass(viewClass, keys),
    },
  ];

  const classPicker = (
    <select
      className="field !w-auto min-w-[9rem] !py-1.5 text-xs font-semibold"
      value={mapClassFilter}
      onChange={(e) => setMapClassFilter(e.target.value)}
      aria-label="Class"
    >
      <option value="">All classes</option>
      {activeClasses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );

  /* ── "Add subjects to class" picker ── */

  const [pickerOpen, setPickerOpen] = useState(false);
  const pickable = useMemo(() => {
    if (!viewClass) return [];
    const linked = new Set(
      slice.classSubjects.filter((l) => l.classId === viewClass.id && l.isActive).map((l) => l.subjectId),
    );
    return schoolSubjectRows(slice).filter(
      (r) =>
        r.subject.isActive &&
        (r.depth === 0 || r.parent?.isActive) &&
        // A subject stays pickable while any of its components is still to add.
        (!linked.has(r.subject.id) ||
          (r.depth === 0 && subjects.some((k) => k.parentId === r.subject.id && k.isActive && !linked.has(k.id)))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.subjects, state.classSubjects, viewClass]);

  function openPicker() {
    setMapSubjectIds([]);
    setPeriods(0);
    setLinkAsOptional(false);
    setPickerOpen(true);
  }

  function toggleMapSubject(id: string) {
    const kids = subjects.filter((s) => s.parentId === id && s.isActive).map((s) => s.id);
    setMapSubjectIds((prev) => {
      const on = prev.includes(id);
      if (kids.length > 0) {
        if (on || kids.every((k) => prev.includes(k))) return prev.filter((x) => x !== id && !kids.includes(x));
        return [...new Set([...prev, id, ...kids])];
      }
      return on ? prev.filter((x) => x !== id) : [...prev, id];
    });
  }

  function addPicked() {
    if (!viewClass || mapSubjectIds.length === 0) return;
    linkToClass(viewClass, mapSubjectIds, { periods, optional: linkAsOptional });
    setPickerOpen(false);
  }

  /* ── Dialog pieces ── */

  const deleteBlockers = toDelete ? subjectDeleteBlockers(slice, toDelete.id) : [];
  const editorParent = editor?.draft.parentId ? subjects.find((s) => s.id === editor.draft.parentId) : null;
  const parentOptions = subjects
    .filter((s) => !s.parentId && s.id !== editor?.editingId)
    .sort((a, b) => a.code.localeCompare(b.code));
  const draftTag = editor?.draft.ncfTagId;
  const showLanguage =
    !!editor &&
    (draftTag === "A" || (!draftTag && LANGUAGE_CODES.includes(editor.draft.code.trim().toUpperCase())));
  function patchDraft(p: Partial<SubjectDraft>) {
    setEditorError(null);
    setEditor((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e));
  }

  return (
    <>
    <MastersTabStack
      intro="Your school's own subjects and components are in the first table — every row has a … menu to edit, add a component, deactivate or delete. NCF / NEP suggestions are a separate reference table; add from there only what you teach."
      tables={
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Subjects", value: counts.subjects },
              { label: "Components", value: counts.components },
              { label: "Inactive", value: counts.inactive },
              { label: "Class links", value: counts.links },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{m.label}</div>
                <div className="text-lg font-bold text-[var(--brand-deep)]">{m.value}</div>
              </div>
            ))}
          </div>

          {/* 1 ── School subjects & components */}
          <SectionCard
            title="School subjects & components"
            hint="What your school actually teaches. Components (Oral, Written…) sit under their subject. A subject not yet linked to any class always shows here."
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                className="field !w-auto min-w-[10rem] flex-1 !py-1.5"
                placeholder="Search code or name…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search subjects"
              />
              <select
                className="field !w-auto !py-1.5 text-xs"
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value as ClassGroupCode | "")}
                aria-label="Stage filter"
              >
                <option value="">All stages</option>
                {CLASS_GROUPS.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label} ({g.shortLabel})
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-deep)]">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Show inactive
              </label>
              <Button type="button" size="sm" onClick={() => openAdd()}>
                <Plus className="size-4" /> Add subject
              </Button>
            </div>
            <DataTable
              columns={schoolColumns}
              rows={schoolRows}
              rowKey={(r) => r.subject.id}
              rowActions={schoolActions}
              rowActionsLabel="Subject actions"
              bulkActions={schoolBulk}
              selectionNoun="subject"
              pageSize={500}
              minWidth="min-w-[860px]"
              exportFileBaseName="school-subjects"
              exportTitle="School subjects & components"
              emptyTitle={query || stageFilter ? "No subject matches" : "No subjects yet"}
              emptyDescription={query || stageFilter ? "Clear the search or stage filter." : "Add a subject, or add from the NCF suggestions below."}
            />
          </SectionCard>

          {/* 2 ── NCF / NEP suggestions */}
          <SectionCard
            title={`NCF / NEP suggestions · ${nepPack.label}`}
            hint={
              <>
                Reference list only — nothing here is taught until it is in the school table above.{" "}
                {nepAnalysis.presentCount}/{nepAnalysis.gaps.length} already in school · indicative load ~{weeklyLoad.total} periods/week.
              </>
            }
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                className="field !w-auto !py-1.5 text-xs"
                value={ncfStage}
                onChange={(e) => setNcfStage(e.target.value as ClassGroupCode)}
                aria-label="NCF stage"
              >
                {CLASS_GROUPS.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label} ({g.shortLabel})
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={nepAnalysis.missingCount === 0}
                onClick={addAllMissing}
              >
                {nepAnalysis.missingCount === 0 ? "All in school" : `Add ${nepAnalysis.missingCount} missing`}
              </Button>
              {ncfStage === "SECONDARY" || ncfStage === "SENIOR" ? (
                <Button type="button" size="sm" variant="outline" onClick={seedCartOfferings}>
                  {ncfCartOfferingsReady(state) ? "Refresh cart seed" : "Seed cart for IX–XII"}
                </Button>
              ) : null}
            </div>
            <DataTable
              columns={ncfColumns}
              rows={ncfRows}
              rowKey={(r) => r.code}
              rowActions={ncfActions}
              rowActionsLabel="Suggestion actions"
              pageSize={200}
              minWidth="min-w-[760px]"
              exportFileBaseName={`ncf-suggestions-${ncfStage.toLowerCase()}`}
              exportTitle={`NCF / NEP suggestions · ${nepPack.label}`}
              emptyTitle="No suggestions for this stage"
            />
            <details className="mt-3 rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-deep)]">
                About this stage · ages {nepPack.ages}
              </summary>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{nepPack.summary}</p>
              <ul className="mt-2 space-y-1">
                {nepPack.tips.map((t) => (
                  <li key={t} className="text-[11px] leading-snug text-[var(--brand-deep)]">
                    <span className="mr-1 text-[var(--tone-teal)]">▸</span>
                    {t}
                  </li>
                ))}
              </ul>
            </details>

            {ncfStage === "SENIOR" ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-[var(--brand-deep)]">XI–XII streams / pathways</h3>
                    <p className="text-[11px] text-[var(--muted)]">
                      Science (PCM / PCB), Commerce, Humanities. Activate only the streams your school runs.
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={applyStreams}>
                    Sync streams + XI–XII subjects
                  </Button>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {streams.map((st) => (
                    <div
                      key={st.id}
                      className={`rounded-lg border border-[var(--border)] px-3 py-2 ${st.isActive ? "" : "opacity-70"}`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-[var(--brand-deep)]">{st.nameEn}</span>
                        <Badge tone="muted">{st.traditionalLabel}</Badge>
                        {st.isActive ? <Badge tone="teal">Offered</Badge> : <Badge tone="muted">Inactive</Badge>}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--brand-deep)]">
                        Core: {st.coreCodes.join(" · ") || "—"}
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">Electives: {st.electiveCodes.join(" · ") || "—"}</p>
                      <button
                        type="button"
                        className="mt-1 text-[11px] font-semibold text-[var(--brand-mid)] underline-offset-2 hover:underline"
                        onClick={() =>
                          commit(
                            {
                              ...state,
                              seniorStreams: state.seniorStreams.map((x) =>
                                x.id === st.id ? { ...x, isActive: !x.isActive } : x,
                              ),
                            },
                            st.isActive ? `${st.nameEn} inactivated` : `${st.nameEn} activated`,
                          )
                        }
                      >
                        {st.isActive ? "Inactivate" : "Activate"}
                      </button>
                    </div>
                  ))}
                  {streams.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">No streams yet — click Sync to load them.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </SectionCard>

          {/* 3 ── Subjects by class */}
          <SectionCard
            title={viewClass ? `Subjects in ${viewClass.name}` : "Subjects by class"}
            hint={
              viewClass
                ? "Pick a class to see exactly what it studies. Components the class does not take yet show as Not added — add them from the … menu."
                : "Every class link. Choose a class to add, remove or add components for that class."
            }
          >
            {/* The class picker lives OUTSIDE the table: inside its toolbar it
                sat in the subtree that switching class re-renders, and a
                select torn down mid-change crashed React (removeChild of
                null) and snapped the view back to the first class. */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {classPicker}
              {viewClass ? (
                <>
                  <span className="text-xs text-[var(--muted)]">
                    {classRows.filter((r) => r.link).length} linked ·{" "}
                    {classRows.filter((r) => r.link).reduce((n, r) => n + (r.link?.periodsPerWeek ?? 0), 0)} periods/wk
                  </span>
                  <span className="flex-1" />
                  <Button type="button" size="sm" onClick={openPicker}>
                    <Plus className="size-4" /> Add subjects
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => openAdd("", viewClass.id)}>
                    New subject for {viewClass.name}
                  </Button>
                </>
              ) : null}
            </div>
            {viewClass ? (
              <DataTable
                columns={classColumns}
                rows={classRows}
                rowKey={(r) => r.subject.id}
                rowActions={classActions}
                rowActionsLabel="Class subject actions"
                bulkActions={classBulk}
                selectionNoun="subject"
                pageSize={200}
                minWidth="min-w-[640px]"
                exportFileBaseName={`subjects-${viewClass.name.toLowerCase().replace(/\s+/g, "-")}`}
                exportTitle={`Subjects in ${viewClass.name}`}
                emptyTitle={`No subjects in ${viewClass.name} yet`}
                emptyDescription="Use Add subjects to link the school's subjects to this class."
              />
            ) : (
              <DataTable
                columns={mapColumns}
                rows={mapRows}
                rowKey={(r) => r.link.id}
                rowActions={mapActions}
                rowActionsLabel="Link actions"
                bulkActions={mapBulk}
                selectionNoun="link"
                pageSize={100}
                minWidth="min-w-[640px]"
                exportFileBaseName="class-subject-map"
                exportTitle="Class–subject map"
                emptyTitle="No class links yet"
              />
            )}
          </SectionCard>
        </div>
      }
    />

    {/* Add subjects to one class */}
    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
      <DialogPopup size="lg">
        <DialogHeader>
          <DialogTitle>Add subjects to {viewClass?.name}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Tap a subject to take it with all its components, or tap single components. Already-added ones are not listed.
        </DialogDescription>
        <div className="mt-3 flex max-h-72 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
          {pickable.map(({ subject: s, depth, componentCount }) => {
            const on = mapSubjectIds.includes(s.id);
            const already =
              !!viewClass &&
              slice.classSubjects.some((l) => l.classId === viewClass.id && l.subjectId === s.id && l.isActive);
            return (
              <button
                key={s.id}
                type="button"
                title={s.nameEn}
                onClick={() => toggleMapSubject(s.id)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${depth === 1 ? "ml-2" : ""} ${
                  on
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : already
                      ? "bg-[var(--surface-sunken)] text-[var(--muted)] ring-1 ring-[var(--border)]"
                      : componentCount > 0
                        ? "bg-[rgba(15,118,110,0.12)] text-[var(--tone-teal)]"
                        : "bg-[var(--surface)] text-[var(--brand-deep)] ring-1 ring-[var(--border)]"
                }`}
              >
                {componentCount > 0 ? "▣ " : depth === 1 ? "· " : ""}
                {s.code}
                <span className="ml-1 font-normal opacity-70">{s.nameEn}</span>
                {already && !on ? " ✓" : ""}
              </button>
            );
          })}
          {pickable.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Every active subject is already in {viewClass?.name}. Create a new one with “New subject”.
            </p>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Periods / week</span>
            <input
              className="field !py-1.5 w-28"
              type="number"
              min={0}
              max={12}
              value={periods}
              onChange={(e) => setPeriods(Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="mt-0.5 block text-[10px] text-[var(--muted)]">0 = NCF suggestion each</span>
          </label>
          <label className="flex items-center gap-2 pb-5 text-xs font-semibold text-[var(--brand-deep)]">
            <input type="checkbox" checked={linkAsOptional} onChange={(e) => setLinkAsOptional(e.target.checked)} />
            Optional (student choice)
          </label>
        </div>
        <DialogFooter className="mt-4">
          <Button
            type="button"
            variant="outline"
            className="mr-auto"
            onClick={() => {
              setPickerOpen(false);
              if (viewClass) openAdd("", viewClass.id);
            }}
          >
            New subject…
          </Button>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <Button type="button" disabled={mapSubjectIds.length === 0} onClick={addPicked}>
            Add {mapSubjectIds.length || ""} to {viewClass?.name}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>

    {/* Add / edit subject or component */}
    <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
      <DialogPopup size="md">
        <DialogHeader>
          <DialogTitle>
            {editor?.editingId
              ? `Edit ${editorParent ? "component" : "subject"}`
              : editorParent
                ? `Add component under ${editorParent.code}`
                : "Add subject"}
          </DialogTitle>
        </DialogHeader>
        {editor ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveEditor();
            }}
          >
            {editor.linkClassId && !editor.editingId ? (
              <p className="rounded-lg bg-[rgba(15,118,110,0.08)] px-3 py-2 text-[11px] font-semibold text-[var(--tone-teal)] sm:col-span-2">
                Will also be added to {slice.classes.find((c) => c.id === editor.linkClassId)?.name}, with the NCF periods per week.
              </p>
            ) : null}
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Component of</span>
              <select
                className="field !py-1.5"
                value={editor.draft.parentId}
                onChange={(e) => patchDraft({ parentId: e.target.value })}
              >
                <option value="">— None: this is a subject —</option>
                {parentOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.nameEn}
                    {s.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Code</span>
              <input
                className="field !py-1.5 uppercase"
                autoFocus
                placeholder={editorParent ? `e.g. ${editorParent.code}-ORAL` : "e.g. GK"}
                value={editor.draft.code}
                onChange={(e) => patchDraft({ code: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Name</span>
              <input
                className="field !py-1.5"
                placeholder={editorParent ? `e.g. ${editorParent.nameEn} — Oral` : "e.g. General Knowledge"}
                value={editor.draft.nameEn}
                onChange={(e) => patchDraft({ nameEn: e.target.value })}
              />
            </label>
            {!editorParent ? (
              <>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Category</span>
                  <select
                    className="field !py-1.5"
                    value={editor.draft.category}
                    onChange={(e) => patchDraft({ category: e.target.value as SubjectCategory })}
                  >
                    <option value="scholastic">Scholastic</option>
                    <option value="co_scholastic">Co-scholastic</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Co-scholastic area</span>
                  <input
                    className="field !py-1.5"
                    placeholder="e.g. Art Education"
                    disabled={editor.draft.category !== "co_scholastic"}
                    value={editor.draft.coScholasticArea}
                    onChange={(e) => patchDraft({ coScholasticArea: e.target.value })}
                  />
                </label>
              </>
            ) : (
              <p className="text-[11px] text-[var(--muted)] sm:col-span-2">
                Category follows {editorParent.code} ({editorParent.category === "co_scholastic" ? "co-scholastic" : "scholastic"}).
              </p>
            )}
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">NCF tag</span>
              <select
                className="field !py-1.5"
                value={editor.draft.ncfTagId}
                onChange={(e) => patchDraft({ ncfTagId: e.target.value as NcfTagId | "" })}
              >
                <option value="">Auto from code</option>
                {NCF_SUBJECT_TAGS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            {showLanguage ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold text-[var(--muted)]">Language type</span>
                <select
                  className="field !py-1.5"
                  value={editor.draft.languageSubtype}
                  onChange={(e) => patchDraft({ languageSubtype: e.target.value as LanguageSubtype })}
                >
                  <option value="">Auto from code</option>
                  <option value="native">Native</option>
                  <option value="regional">Regional</option>
                  <option value="foreign">Foreign</option>
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-deep)] sm:col-span-2">
              <input
                type="checkbox"
                checked={editor.draft.isElective}
                onChange={(e) => patchDraft({ isElective: e.target.checked })}
              />
              Elective (students choose it)
            </label>
            {editorError ? (
              <p role="alert" className="rounded-lg bg-[rgba(220,38,38,0.08)] px-3 py-2 text-xs font-semibold text-[var(--danger)] sm:col-span-2">
                {editorError}
              </p>
            ) : null}
            <DialogFooter className="sm:col-span-2">
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit">{editor.editingId ? "Save" : editorParent ? "Add component" : "Add subject"}</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogPopup>
    </Dialog>

    {/* Delete — or, when something still points at it, deactivate instead */}
    <ConfirmDialog
      open={!!toDelete}
      onOpenChange={(o) => !o && setToDelete(null)}
      title={
        toDelete
          ? deleteBlockers.length > 0
            ? `${toDelete.code} can't be deleted`
            : `Delete ${toDelete.code}?`
          : ""
      }
      description={
        toDelete
          ? deleteBlockers.length > 0
            ? `It is still ${deleteBlockers.join("; ")}. Deactivate it instead — it stays on past records but is no longer offered.`
            : `${toDelete.nameEn} will be removed from the school's subjects. This cannot be undone.`
          : ""
      }
      confirmLabel={deleteBlockers.length > 0 ? (toDelete?.isActive ? "Deactivate instead" : "Close") : "Delete"}
      tone={deleteBlockers.length > 0 ? "default" : "danger"}
      onConfirm={() => {
        if (!toDelete) return;
        if (deleteBlockers.length > 0) {
          if (toDelete.isActive) setActive([toDelete.id], false);
        } else {
          deleteSubject(toDelete);
        }
        setToDelete(null);
      }}
    />

    {/* Periods per week for one class link */}
    <Dialog open={!!linkEdit} onOpenChange={(o) => !o && setLinkEdit(null)}>
      <DialogPopup size="sm">
        <DialogHeader>
          <DialogTitle>Periods per week</DialogTitle>
        </DialogHeader>
        {linkEdit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cls = slice.classes.find((c) => c.id === linkEdit.link.classId);
              const s = subjects.find((x) => x.id === linkEdit.link.subjectId);
              updateLink(
                linkEdit.link.id,
                { periodsPerWeek: Math.max(0, Math.min(20, linkEdit.periods)) },
                `${cls?.name ?? "Class"} · ${s?.code ?? "subject"} → ${linkEdit.periods}/wk`,
              );
              setLinkEdit(null);
            }}
          >
            <DialogDescription>
              {slice.classes.find((c) => c.id === linkEdit.link.classId)?.name} ·{" "}
              {subjects.find((x) => x.id === linkEdit.link.subjectId)?.code}
            </DialogDescription>
            <input
              className="field mt-3 !py-1.5"
              type="number"
              min={0}
              max={20}
              autoFocus
              value={linkEdit.periods}
              onChange={(e) => setLinkEdit({ ...linkEdit, periods: Number(e.target.value) || 0 })}
            />
            <DialogFooter className="mt-4">
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogPopup>
    </Dialog>
    </>
  );
}
