"use client";

/**
 * Masters → Subjects: what NCERT / CBSE list for a class (from DIKSHA, synced
 * weekly), applied to the class in bulk, then kept, removed or renamed by the
 * school. Changes a sync finds wait here for the office.
 *
 * The school's own subjects and class links are written through the normal
 * Masters save (commit); only the matches and decisions go to the API.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { ClassSubjectLink, Subject } from "@/lib/foundationMasters";
import { classGroupCodeForName, type MastersState, type SchoolClass } from "@/lib/masters";
import { suggestedPeriodsPerWeek } from "@/lib/nepSubjectSuggestions";
import {
  NCF_FRAMEWORKS,
  dikshaGradeForClass,
  officialKey,
  planApplyToClass,
  resolveSchoolSubject,
  type NcfBoard,
  type NcfMapping,
} from "@/lib/ncfOfficial";
import { CLASS_GROUP_TO_NEP, classLinkIdsToRemove } from "@/lib/subjectMasters";

type Commit = (s: MastersState, msg?: string) => void;

type View = {
  lists: Record<NcfBoard, Record<string, string[]>>;
  changes: { id: string; board: NcfBoard; grade: string; subject: string; kind: "added" | "removed"; detectedAt: string }[];
  mappings: NcfMapping[];
  lastSyncAt: string | null;
};

type Row = { official: string; subject: Subject | null; link: ClassSubjectLink | null };

function periodsFor(cls: SchoolClass, s: Subject): number {
  const group = cls.groupCode ?? classGroupCodeForName(cls.name);
  return suggestedPeriodsPerWeek(CLASS_GROUP_TO_NEP[group], s.code, s.category);
}

function when(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function NcfOfficialSubjectsCard({
  state,
  commit,
  classes,
  onShowClass,
  onEditSubject,
}: {
  state: MastersState;
  commit: Commit;
  classes: SchoolClass[];
  /** Open this class in the "Subjects by class" table below. */
  onShowClass: (classId: string) => void;
  onEditSubject: (s: Subject) => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "load" | "sync" | "apply">("load");
  const [board, setBoard] = useState<NcfBoard>("NCERT");
  const [classId, setClassId] = useState(
    () => classes.find((c) => dikshaGradeForClass(c.name)?.startsWith("Class"))?.id ?? classes[0]?.id ?? "",
  );
  const [matchFor, setMatchFor] = useState<{ official: string; pick: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const subjects = useMemo(() => state.subjects ?? [], [state.subjects]);
  const classSubjects = useMemo(() => state.classSubjects ?? [], [state.classSubjects]);
  const cls = classes.find((c) => c.id === classId) ?? null;
  const grade = cls ? dikshaGradeForClass(cls.name) : null;

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const res = await fetch("/api/curriculum/ncf-official", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as View & { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setView({ lists: json.lists, changes: json.changes, mappings: json.mappings, lastSyncAt: json.lastSyncAt });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: unknown): Promise<{ ok: boolean; error?: string } & Partial<View>> {
    const res = await fetch("/api/curriculum/ncf-official", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Partial<View>;
    return { ...json, ok: res.ok && !!json.ok, error: json.error || (res.ok ? undefined : `HTTP ${res.status}`) };
  }

  async function syncNow() {
    setBusy("sync");
    const r = await post({ action: "sync" });
    setBusy("");
    if (r.lists && r.changes && r.mappings) {
      setView({ lists: r.lists, changes: r.changes, mappings: r.mappings, lastSyncAt: r.lastSyncAt ?? null });
    }
    setNote(r.ok ? "Checked DIKSHA — lists are up to date" : `Check failed: ${r.error ?? "unknown"}`);
  }

  const officialList = useMemo(
    () => (view && grade ? view.lists[board]?.[grade] ?? [] : []),
    [view, board, grade],
  );

  const rows = useMemo<Row[]>(() => {
    if (!cls) return [];
    const mappings = view?.mappings ?? [];
    return officialList.map((official) => {
      const subject = resolveSchoolSubject(official, subjects, mappings);
      const link = subject
        ? classSubjects.find((l) => l.isActive && l.classId === cls.id && l.subjectId === subject.id) ?? null
        : null;
      return { official, subject, link };
    });
  }, [officialList, subjects, classSubjects, cls, view]);

  /** Apply official subjects to one class; returns false when nothing was done. */
  async function applyTo(target: SchoolClass, officials: string[]): Promise<boolean> {
    if (officials.length === 0) return false;
    setBusy("apply");
    const plan = planApplyToClass({
      officialSubjects: officials,
      classId: target.id,
      subjects,
      classSubjects,
      mappings: view?.mappings ?? [],
      periodsFor: (s) => periodsFor(target, s),
    });
    if (plan.newSubjects.length || plan.newLinks.length) {
      commit(
        {
          ...state,
          subjects: [...subjects, ...plan.newSubjects],
          classSubjects: [...classSubjects, ...plan.newLinks],
        },
        `${target.name}: ${plan.newLinks.length} subject${plan.newLinks.length === 1 ? "" : "s"} added` +
          (plan.newSubjects.length ? ` (${plan.newSubjects.length} new: ${plan.newSubjects.map((s) => s.code).join(", ")})` : ""),
      );
    } else {
      setNote(`${target.name} already has ${officials.length === 1 ? "it" : "all of them"}`);
    }
    if (plan.newMappings.length) {
      const r = await post({ action: "map", mappings: plan.newMappings });
      if (r.ok) {
        setView((v) =>
          v
            ? {
                ...v,
                mappings: [
                  ...v.mappings.filter((m) => !plan.newMappings.some((n) => n.subjectKey === m.subjectKey)),
                  ...plan.newMappings,
                ],
              }
            : v,
        );
      }
    }
    setBusy("");
    onShowClass(target.id);
    return plan.newLinks.length > 0 || plan.newSubjects.length > 0;
  }

  function removeFrom(target: SchoolClass, subject: Subject) {
    const ids = new Set(classLinkIdsToRemove({ subjects, classSubjects, classes }, target.id, subject.id));
    if (ids.size === 0) return;
    commit(
      { ...state, classSubjects: classSubjects.filter((l) => !ids.has(l.id)) },
      `${subject.code} removed from ${target.name}`,
    );
  }

  async function saveMatch() {
    if (!matchFor) return;
    const r = await post({
      action: "map",
      mappings: [{ subjectKey: officialKey(matchFor.official), schoolSubjectId: matchFor.pick || null }],
    });
    if (!r.ok) {
      setNote(`Match not saved: ${r.error ?? "unknown"}`);
      return;
    }
    setView((v) =>
      v
        ? {
            ...v,
            mappings: [
              ...v.mappings.filter((m) => m.subjectKey !== officialKey(matchFor.official)),
              ...(matchFor.pick ? [{ subjectKey: officialKey(matchFor.official), schoolSubjectId: matchFor.pick }] : []),
            ],
          }
        : v,
    );
    setNote(`"${matchFor.official}" now matches ${subjects.find((s) => s.id === matchFor.pick)?.code ?? "a new subject"}`);
    setMatchFor(null);
  }

  async function decide(id: string, status: "done" | "dismissed") {
    const r = await post({ action: "decide", id, status });
    if (r.ok) setView((v) => (v ? { ...v, changes: v.changes.filter((c) => c.id !== id) } : v));
    else setNote(`Not saved: ${r.error ?? "unknown"}`);
  }

  const columns: DataTableColumn<Row>[] = [
    { key: "official", header: `${board} lists`, value: (r) => r.official, render: (r) => <span className="font-semibold text-[var(--brand-deep)]">{r.official}</span> },
    {
      key: "school",
      header: "School subject",
      value: (r) => (r.subject ? `${r.subject.code} ${r.subject.nameEn}` : "New"),
      render: (r) =>
        r.subject ? (
          <span>
            <span className="font-semibold">{r.subject.code}</span>{" "}
            <span className="text-[var(--muted)]">{r.subject.nameEn}</span>
            {!r.subject.isActive ? <span className="ml-1 text-[10px] font-bold uppercase text-[var(--danger)]">inactive</span> : null}
          </span>
        ) : (
          <span className="text-[var(--muted)]">Will be created</span>
        ),
    },
    {
      key: "status",
      header: cls ? `In ${cls.name}` : "In class",
      value: (r) => (r.link ? "Added" : "Not added"),
      render: (r) =>
        r.link ? (
          <span className="rounded bg-[rgba(15,118,110,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--tone-teal)]">Added</span>
        ) : (
          <span className="rounded bg-[rgba(220,38,38,0.1)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--danger)]">Not added</span>
        ),
    },
  ];

  const actions: RowAction<Row>[] = [
    { id: "apply", label: cls ? `Add to ${cls.name}` : "Add to class", onSelect: (r) => cls && void applyTo(cls, [r.official]), hidden: (r) => !!r.link },
    {
      id: "match",
      label: "Match to a school subject…",
      onSelect: (r) => setMatchFor({ official: r.official, pick: r.subject?.id ?? "" }),
    },
    { id: "rename", label: "Rename school subject", onSelect: (r) => r.subject && onEditSubject(r.subject), hidden: (r) => !r.subject },
    {
      id: "remove",
      label: cls ? `Remove from ${cls.name}` : "Remove from class",
      tone: "danger",
      separatorAbove: true,
      onSelect: (r) => cls && r.subject && removeFrom(cls, r.subject),
      hidden: (r) => !r.link,
    },
  ];

  const bulk: BulkAction[] = [
    {
      id: "apply",
      label: cls ? `Add to ${cls.name}` : "Add to class",
      onRun: (keys) => {
        if (cls) void applyTo(cls, keys);
      },
    },
  ];

  const notAdded = rows.filter((r) => !r.link).map((r) => r.official);
  const topSubjects = subjects.filter((s) => !s.parentId).sort((a, b) => a.code.localeCompare(b.code));
  const classesForGrade = (g: string) => classes.filter((c) => dikshaGradeForClass(c.name) === g);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-1)]">
      <header className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">NCERT / CBSE subjects by class (from DIKSHA)</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
          The subjects NCERT and CBSE tag each class with on DIKSHA, checked every Sunday. Add them to a class in bulk, then
          keep, remove or rename them below as the school teaches. A starting list, not the scheme of studies — periods
          and components stay the school&apos;s. Last checked: <b>{when(view?.lastSyncAt ?? null)}</b>.
        </p>
      </header>
      <div className="space-y-3 p-3">
        {loadError ? (
          <p className="rounded-lg bg-[rgba(220,38,38,0.08)] px-3 py-2 text-xs font-semibold text-[var(--danger)]">
            {loadError}
          </p>
        ) : null}
        {[1, 2, 3].includes(new Date().getMonth()) ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--brand-deep)]">
            New session season: CBSE publishes next year&apos;s curriculum around March–April at{" "}
            <a className="font-semibold underline" href="https://cbseacademic.nic.in/" target="_blank" rel="noreferrer">
              cbseacademic.nic.in
            </a>
            . DIKSHA does not carry it — check it by hand before the session starts.
          </p>
        ) : null}
        {note ? (
          <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--brand-deep)]">{note}</p>
        ) : null}

        {view && view.changes.length > 0 ? (
          <div className="rounded-xl border border-[rgba(196,149,58,0.45)] bg-[rgba(196,149,58,0.08)] p-3">
            <p className="text-xs font-bold text-[var(--brand-deep)]">
              {view.changes.length} change{view.changes.length === 1 ? "" : "s"} found on DIKSHA — the school decides
            </p>
            <ul className="mt-2 space-y-1.5">
              {view.changes.slice(0, 30).map((c) => {
                const targets = classesForGrade(c.grade);
                const subject = resolveSchoolSubject(c.subject, subjects, view.mappings);
                const linkedIn = targets.filter(
                  (t) => subject && classSubjects.some((l) => l.isActive && l.classId === t.id && l.subjectId === subject.id),
                );
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span>
                      <b>{c.board}</b> · {c.grade}: {c.kind === "added" ? "added" : "no longer lists"} <b>{c.subject}</b>
                    </span>
                    <span className="flex-1" />
                    {c.kind === "added"
                      ? targets.map((t) => (
                          <Button
                            key={t.id}
                            type="button"
                            size="xs"
                            onClick={async () => {
                              await applyTo(t, [c.subject]);
                              await decide(c.id, "done");
                            }}
                          >
                            Add to {t.name}
                          </Button>
                        ))
                      : linkedIn.map((t) => (
                          <Button
                            key={t.id}
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={async () => {
                              if (subject) removeFrom(t, subject);
                              await decide(c.id, "done");
                            }}
                          >
                            Remove from {t.name}
                          </Button>
                        ))}
                    <Button type="button" size="xs" variant="outline" onClick={() => void decide(c.id, "dismissed")}>
                      {c.kind === "added" ? "Dismiss" : "Keep it"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="field !w-auto !py-1.5 text-xs font-semibold"
            value={board}
            onChange={(e) => setBoard(e.target.value as NcfBoard)}
            aria-label="Board"
          >
            {NCF_FRAMEWORKS.map((f) => (
              <option key={f.board} value={f.board}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            className="field !w-auto min-w-[8rem] !py-1.5 text-xs font-semibold"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            aria-label="Class for NCERT/CBSE list"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--muted)]">
            {grade ? `${grade} · ${officialList.length} listed · ${notAdded.length} not added` : "not on DIKSHA"}
          </span>
          <span className="flex-1" />
          <Button
            type="button"
            size="sm"
            disabled={!cls || notAdded.length === 0 || busy === "apply"}
            onClick={() => cls && void applyTo(cls, notAdded)}
          >
            {cls ? `Add all ${notAdded.length} to ${cls.name}` : "Add all"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy === "sync"} onClick={() => void syncNow()}>
            <RefreshCw className={`size-4 ${busy === "sync" ? "animate-spin" : ""}`} /> Check DIKSHA now
          </Button>
        </div>

        {grade && grade.startsWith("Preschool") && officialList.length === 0 && view ? (
          <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)]">
            DIKSHA lists no subjects for pre-primary. Use the NCF-FS suggestions above (Pre-Primary stage) for Nursery, LKG
            and UKG.
          </p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.official}
            rowActions={actions}
            rowActionsLabel="NCF subject actions"
            bulkActions={bulk}
            selectionNoun="subject"
            pageSize={100}
            minWidth="min-w-[560px]"
            exportFileBaseName={`ncf-${board.toLowerCase()}-${(cls?.name ?? "class").toLowerCase()}`}
            exportTitle={`${board} subjects · ${cls?.name ?? ""}`}
            loading={busy === "load" && !view}
            emptyTitle={view ? "Nothing listed for this class yet" : loadError ? "Not available yet" : "Loading…"}
            emptyDescription={view && !view.lastSyncAt ? "Not synced yet — press Check DIKSHA now." : undefined}
          />
        )}
      </div>

      <Dialog open={!!matchFor} onOpenChange={(o) => !o && setMatchFor(null)}>
        <DialogPopup size="sm">
          <DialogHeader>
            <DialogTitle>Match “{matchFor?.official}”</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            Which school subject is this? The match is kept even if you rename the school subject later.
          </DialogDescription>
          {matchFor ? (
            <select
              className="field mt-3 !py-1.5"
              value={matchFor.pick}
              onChange={(e) => setMatchFor({ ...matchFor, pick: e.target.value })}
              aria-label="School subject"
            >
              <option value="">— none: create a new subject when added —</option>
              {topSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.nameEn}
                  {s.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          ) : null}
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="button" onClick={() => void saveMatch()}>
              Save match
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
