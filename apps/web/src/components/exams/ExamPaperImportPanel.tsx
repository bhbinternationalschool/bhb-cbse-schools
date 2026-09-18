"use client";

/**
 * Import a publisher's folder of question papers.
 *
 * The school downloads a term's papers as a tree of Word files — class,
 * subject, exam, set — and until now the only way in was to type them again.
 *
 * The shape of this screen follows from one promise: **nothing is written
 * until the school has seen what will be written.** So the whole reading —
 * unzipping 88 Word files, parsing every question, working out which class,
 * subject and exam each belongs to — happens here in the browser, before a
 * single byte is uploaded. What the school sees is a table with a verdict per
 * file. Only when they press Import does anything leave the machine, and only
 * the files the table said would go.
 *
 * The second promise is that it never guesses. A subject or an exam name it
 * has not been taught shows up as a row with an empty box, naming the exact
 * word it did not understand. Fill the box once and it is remembered with the
 * papers, so next term's download goes through on its own.
 */

import { useMemo, useRef, useState } from "react";
import type { MastersState } from "@/lib/masters";
import type { ExamTerm } from "@/lib/exams";
import {
  applyImportedSets,
  bankImportedQuestions,
  existingPaperFacts,
  loadExamPapers,
  saveExamPapers,
  type ExamPaperSet,
  type ImportedPaperInput,
} from "@/lib/examPapers";
import {
  mergeImportMappings,
  planPaperImport,
  type ImportCatalog,
  type ImportFileFacts,
  type ImportMappings,
  type ImportPlan,
  type ImportPlanRow,
  type ImportVerdict,
} from "@/lib/examPaperImport";
import { readPaperFile } from "@/lib/examPaperRead";

type Props = {
  masters: MastersState;
  academicYearCode: string;
  terms: ExamTerm[];
  canEdit: boolean;
  actorName: string;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  /** Papers changed — the list behind this panel must re-read them. */
  onImported: () => void;
};

type Learned = {
  classes: Record<string, string>;
  subjects: Record<string, string>;
  exams: Record<string, string>;
};

const VERDICT_LABEL: Record<ImportVerdict, string> = {
  import: "Will import",
  duplicate: "Already here",
  needs_mapping: "Needs mapping",
  rejected: "Cannot import",
};

const VERDICT_TONE: Record<ImportVerdict, string> = {
  import: "text-[var(--success,#15803d)]",
  duplicate: "text-[var(--muted)]",
  needs_mapping: "text-[var(--warn,#b45309)]",
  rejected: "text-[var(--danger)]",
};

export function ExamPaperImportPanel({
  masters,
  academicYearCode: ay,
  terms,
  canEdit,
  actorName,
  onError,
  onNotice,
  onImported,
}: Props) {
  const picker = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(0);
  const [readTotal, setReadTotal] = useState(0);
  const [facts, setFacts] = useState<ImportFileFacts[]>([]);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [learned, setLearned] = useState<Learned>({
    classes: {},
    subjects: {},
    exams: {},
  });
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(0);
  const [failures, setFailures] = useState<{ relPath: string; error: string }[]>([]);
  const [showAll, setShowAll] = useState(false);
  /**
   * On by default: a paper the school can only reprint is worth far less than
   * questions it can build the next paper from, and nobody will press
   * "save to bank" four hundred times by hand.
   */
  const [toBank, setToBank] = useState(true);

  const catalog = useMemo<ImportCatalog>(
    () => ({
      academicYearCode: ay,
      classes: masters.classes
        .filter((c) => c.isActive)
        .map((c) => ({ id: c.id, name: c.name })),
      subjects: (masters.subjects ?? []).map((s) => ({
        id: s.id,
        code: s.code,
        nameEn: s.nameEn || s.code,
      })),
      terms: terms.map((t) => ({
        id: t.id,
        code: t.code,
        label: t.label,
        academicYearCode: t.academicYearCode,
        maxMarks: t.maxMarks,
      })),
    }),
    [ay, masters, terms],
  );

  const mappings = useMemo<ImportMappings>(() => {
    const stored = loadExamPapers().importMappings ?? {};
    return mergeImportMappings({
      classes: { ...stored.classes, ...learned.classes },
      subjects: { ...stored.subjects, ...learned.subjects },
      exams: { ...stored.exams, ...learned.exams },
    });
  }, [learned]);

  const plan = useMemo<ImportPlan | null>(() => {
    if (!facts.length) return null;
    return planPaperImport({
      files: facts,
      catalog,
      mappings,
      existing: existingPaperFacts(loadExamPapers()),
    });
  }, [facts, catalog, mappings]);

  async function onPick(picked: FileList | null) {
    if (!picked?.length) return;
    const docx = [...picked].filter((f) => f.name.toLowerCase().endsWith(".docx"));
    if (!docx.length) {
      onError("No .docx question papers in that folder");
      return;
    }

    setFacts([]);
    setFailures([]);
    setDone(0);
    setReadTotal(docx.length);
    setReading(0);

    const nextFacts: ImportFileFacts[] = [];
    const nextFiles = new Map<string, File>();
    for (const file of docx) {
      // webkitRelativePath carries the folder tree; a plain multi-file pick
      // does not, and then the file's own name is all there is to go on.
      const relPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const read = await readPaperFile(relPath, bytes);
        nextFacts.push(read.facts);
        nextFiles.set(relPath, file);
      } catch (e) {
        nextFacts.push({
          relPath,
          fileHash: "",
          header: {
            docClass: "",
            docTitle: "",
            docSubject: "",
            maxMarks: 0,
            durationMinutes: 0,
          },
          questionCount: 0,
          parsedMarks: 0,
          readError: e instanceof Error ? e.message : "Could not read this file",
        });
      }
      setReading((n) => n + 1);
    }
    setFiles(nextFiles);
    setFacts(nextFacts);
  }

  /** Teach the importer one word, and re-plan with it. */
  function teach(kind: keyof Learned, word: string, value: string) {
    setLearned((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], [word.toLowerCase()]: value },
    }));
  }

  async function onImport() {
    if (!plan || !canEdit || importing) return;
    const rows = plan.rows.filter((r) => r.verdict === "import");
    if (!rows.length) {
      onError("Nothing in this folder is ready to import");
      return;
    }

    setImporting(true);
    setDone(0);
    setFailures([]);

    const setsByGroup = new Map<string, ExamPaperSet[]>();
    const problems: { relPath: string; error: string }[] = [];

    for (const row of rows) {
      const file = files.get(row.relPath);
      if (!file) {
        problems.push({ relPath: row.relPath, error: "File no longer available" });
        setDone((n) => n + 1);
        continue;
      }
      const form = new FormData();
      form.append("file", file);
      form.append(
        "meta",
        JSON.stringify({
          relPath: row.relPath,
          academicYearCode: ay,
          examTermCode: row.examTermCode,
          className: row.className,
          subjectCode: row.subjectCode,
          setCode: row.setCode,
          publisherLabel: row.publisherLabel,
          fileHash: row.fileHash,
          importedBy: actorName,
        }),
      );
      try {
        const res = await fetch("/api/exams/papers/import", {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        const body = (await res.json()) as { ok?: boolean; set?: ExamPaperSet; error?: string };
        if (!res.ok || !body.ok || !body.set) {
          problems.push({ relPath: row.relPath, error: body.error || `Failed (${res.status})` });
        } else {
          const list = setsByGroup.get(row.groupKey) ?? [];
          list.push(body.set);
          setsByGroup.set(row.groupKey, list);
        }
      } catch (e) {
        problems.push({
          relPath: row.relPath,
          error: e instanceof Error ? e.message : "Could not reach the server",
        });
      }
      setDone((n) => n + 1);
    }

    const inputs: ImportedPaperInput[] = [];
    for (const group of plan.groups) {
      const sets = setsByGroup.get(group.groupKey);
      if (!sets?.length) continue;
      const first = group.rows[0]!;
      const term = terms.find((t) => t.id === group.examTermId);
      inputs.push({
        targetPaperId: group.targetPaperId,
        academicYearCode: ay,
        examTermId: group.examTermId,
        classId: group.classId,
        subjectId: group.subjectId,
        examCode: term?.code || "",
        examName: term ? `${term.code} · ${term.label}` : group.examTermLabel,
        className: group.className,
        subjectCode: first.subjectCode,
        title: `${group.examTermLabel} · ${group.className} · ${group.subjectName}`,
        // The paper's own marks and minutes, not the term's — the exams desk
        // is told about the difference, it is not made to agree.
        maxMarks: first.header.maxMarks,
        durationMinutes: first.header.durationMinutes,
        sets: sets.sort((a, b) => a.setCode.localeCompare(b.setCode)),
      });
    }

    const state = loadExamPapers();
    const outcome = applyImportedSets(state, inputs, actorName);
    const banked = toBank
      ? bankImportedQuestions(outcome.state, inputs, actorName)
      : { state: outcome.state, added: 0 };
    saveExamPapers({
      ...banked.state,
      importMappings: {
        classes: { ...state.importMappings?.classes, ...learned.classes },
        subjects: { ...state.importMappings?.subjects, ...learned.subjects },
        exams: { ...state.importMappings?.exams, ...learned.exams },
      },
    });

    setFailures(problems);
    setImporting(false);
    setFacts([]);
    setFiles(new Map());
    onImported();
    onNotice(
      `Imported ${outcome.addedSets} set${outcome.addedSets === 1 ? "" : "s"} — ` +
        `${outcome.created} new paper${outcome.created === 1 ? "" : "s"}, ` +
        `${outcome.updated} updated` +
        (banked.added ? `, ${banked.added} questions into the bank` : "") +
        (problems.length ? `. ${problems.length} file(s) failed — see below.` : ""),
    );
  }

  const busy = readTotal > 0 && reading < readTotal;
  const rowsToShow = useMemo(() => {
    if (!plan) return [];
    if (showAll) return plan.rows;
    // The ones that need a decision first; the rest are just reassurance.
    return plan.rows.filter((r) => r.verdict !== "import" || r.warnings.length);
  }, [plan, showAll]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Import papers from a folder
          </h3>
          <p className="mt-1 max-w-3xl text-[12px] text-[var(--muted)]">
            Pick the folder your publisher gave you — class, subject and exam
            are read from the papers themselves. You see everything that will
            be filed before anything is uploaded.
          </p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              ref={picker}
              type="file"
              className="hidden"
              multiple
              accept=".docx"
              // Not in React's HTML types; both spellings are needed for the
              // browsers the office actually uses.
              {...{ webkitdirectory: "", directory: "" }}
              onChange={(e) => {
                void onPick(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-2 text-sm font-bold"
              disabled={busy || importing}
              onClick={() => picker.current?.click()}
            >
              {busy ? `Reading ${reading}/${readTotal}…` : "Choose folder"}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-[var(--muted)]">
            View only — need Exams → Edit to import.
          </p>
        )}
      </div>

      {plan ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            {(["import", "needs_mapping", "rejected", "duplicate"] as ImportVerdict[]).map(
              (v) => (
                <span key={v} className={`font-semibold ${VERDICT_TONE[v]}`}>
                  {plan.counts[v]} {VERDICT_LABEL[v].toLowerCase()}
                </span>
              ),
            )}
            <span className="text-[var(--muted)]">
              → {plan.groups.length} paper{plan.groups.length === 1 ? "" : "s"}
            </span>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              Show every file
            </label>
          </div>

          {plan.unmapped.length ? (
            <div className="rounded-lg border border-[var(--warn,#b45309)] bg-[rgba(180,83,9,0.08)] p-3">
              <p className="text-[12px] font-semibold">
                {plan.unmapped.length} word
                {plan.unmapped.length === 1 ? "" : "s"} this school has not
                mapped yet
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                Tell it once what each one means. The answer is kept with the
                papers, so next term&rsquo;s download goes through on its own.
              </p>
              <div className="mt-2 space-y-2">
                {plan.unmapped.map((entry) => {
                  const [kind, ...rest] = entry.split(":");
                  const word = rest.join(":");
                  return (
                    <div key={entry} className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px]">
                        <span className="text-[var(--muted)]">{kind}</span>{" "}
                        <strong>{word}</strong> →
                      </span>
                      {kind === "subject" ? (
                        <select
                          className="field !w-auto !py-1 text-[12px]"
                          defaultValue=""
                          onChange={(e) =>
                            e.target.value && teach("subjects", word, e.target.value)
                          }
                        >
                          <option value="">Select subject…</option>
                          {catalog.subjects.map((s) => (
                            <option key={s.id} value={s.code}>
                              {s.nameEn}
                            </option>
                          ))}
                        </select>
                      ) : kind === "class" ? (
                        <select
                          className="field !w-auto !py-1 text-[12px]"
                          defaultValue=""
                          onChange={(e) =>
                            e.target.value && teach("classes", word, e.target.value)
                          }
                        >
                          <option value="">Select class…</option>
                          {catalog.classes.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          className="field !w-auto !py-1 text-[12px]"
                          defaultValue=""
                          onChange={(e) =>
                            e.target.value && teach("exams", word, e.target.value)
                          }
                        >
                          <option value="">Select exam…</option>
                          {catalog.terms.map((t) => (
                            <option key={t.id} value={t.code}>
                              {t.code} · {t.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr>
                  {["File", "Class", "Subject", "Exam", "Set", "Questions", "Marks", "Verdict"].map(
                    (h) => (
                      <th
                        key={h}
                        className="border border-[var(--border)] bg-[var(--surface-sunken)] p-2"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rowsToShow.map((row) => (
                  <PlanRow key={row.relPath} row={row} />
                ))}
                {!rowsToShow.length ? (
                  <tr>
                    <td
                      className="border border-[var(--border)] p-3 text-[var(--muted)]"
                      colSpan={8}
                    >
                      Every file reads cleanly. Tick &ldquo;show every
                      file&rdquo; to look through them.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
                disabled={importing || !plan.counts.import}
                onClick={() => void onImport()}
              >
                {importing
                  ? `Importing ${done}/${plan.counts.import}…`
                  : `Import ${plan.counts.import} paper set${plan.counts.import === 1 ? "" : "s"}`}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                disabled={importing}
                onClick={() => {
                  setFacts([]);
                  setFiles(new Map());
                  setReadTotal(0);
                }}
              >
                Clear
              </button>
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={toBank}
                  onChange={(e) => setToBank(e.target.checked)}
                  disabled={importing}
                />
                Also put every question in the question bank, so next
                term&rsquo;s paper can be built from them
              </label>
              <span className="text-[11px] text-[var(--muted)]">
                Imported papers arrive as drafts — nothing is marked ready to
                print until a teacher has looked.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {failures.length ? (
        <div className="mt-3 rounded-lg border border-[var(--danger)] bg-[rgba(220,38,38,0.06)] p-3">
          <p className="text-[12px] font-semibold">
            {failures.length} file{failures.length === 1 ? "" : "s"} did not
            import
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {failures.map((f) => (
              <li key={f.relPath}>
                <span className="font-mono">{f.relPath}</span> — {f.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PlanRow({ row }: { row: ImportPlanRow }) {
  const notes = [...row.reasons, ...row.warnings];
  return (
    <>
      <tr>
        <td className="border border-[var(--border)] p-2">
          <span className="block max-w-[26rem] truncate" title={row.relPath}>
            {row.publisherLabel || row.fileName}
          </span>
          <span className="block max-w-[26rem] truncate text-[10px] text-[var(--muted)]">
            {row.relPath}
          </span>
        </td>
        <td className="border border-[var(--border)] p-2">{row.className || "—"}</td>
        <td className="border border-[var(--border)] p-2">{row.subjectName || "—"}</td>
        <td className="border border-[var(--border)] p-2">{row.examTermLabel || "—"}</td>
        <td className="border border-[var(--border)] p-2 text-center">
          {row.setCode || "—"}
        </td>
        <td className="border border-[var(--border)] p-2 text-right tabular-nums">
          {row.questionCount}
        </td>
        <td className="border border-[var(--border)] p-2 text-right tabular-nums">
          {row.header.maxMarks || "—"}
        </td>
        <td
          className={`border border-[var(--border)] p-2 font-semibold ${VERDICT_TONE[row.verdict]}`}
        >
          {VERDICT_LABEL[row.verdict]}
        </td>
      </tr>
      {notes.length ? (
        <tr>
          <td
            className="border border-[var(--border)] px-2 pb-2 text-[11px] text-[var(--muted)]"
            colSpan={8}
          >
            {notes.join(" · ")}
          </td>
        </tr>
      ) : null}
    </>
  );
}
