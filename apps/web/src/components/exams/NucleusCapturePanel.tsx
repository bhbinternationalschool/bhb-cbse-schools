"use client";
// ratchet-allow: grids_without_row_menu — a capture preview of what the publisher's portal returned; the one action, Send papers to ERP, applies to the whole batch

/**
 * Get papers and answer keys from the publisher, without leaving this screen.
 *
 * The office user's whole job is four actions: log in to Nucleus, click one
 * bookmark, paste what it copied here, press Get. No folder is downloaded, no
 * paper is opened to find its answer key, and nothing is saved to their
 * computer. The server fetches every file itself, because the publisher's
 * papers and keys are public once their addresses are known.
 *
 * The one step that cannot be automated is the login: the publisher has no
 * API and its sign-in is behind a captcha. So this screen asks for the one
 * thing only a logged-in person can produce — the list of addresses — and
 * does everything else.
 *
 * What the office sees before anything happens is the same promise the folder
 * import makes: a table of what will be filed, and nothing written until they
 * press the button.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { MastersState } from "@/lib/masters";
import type { ExamTerm } from "@/lib/exams";
import {
  applyImportedSets,
  bankImportedQuestions,
  loadExamPapers,
  saveExamPapers,
  type ExamPaperSet,
  type ImportedPaperInput,
} from "@/lib/examPapers";
import { mergeImportMappings, type ImportCatalog } from "@/lib/examPaperImport";
import { announceReady, readHandoffMessage } from "@/lib/nucleusHandoff";
import {
  planNucleusCapture,
  readNucleusManifest,
  type CapturePlan,
  type CapturePlanRow,
  type CaptureVerdict,
} from "@/lib/nucleusManifest";

type Props = {
  masters: MastersState;
  academicYearCode: string;
  terms: ExamTerm[];
  canEdit: boolean;
  actorName: string;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onImported: () => void;
};

const VERDICT_LABEL: Record<CaptureVerdict, string> = {
  fetch: "Will fetch",
  already_here: "Already here",
  needs_mapping: "Needs mapping",
  rejected: "Cannot fetch",
};

const VERDICT_TONE: Record<CaptureVerdict, string> = {
  fetch: "text-[var(--success,#15803d)]",
  already_here: "text-[var(--muted)]",
  needs_mapping: "text-[var(--warn,#b45309)]",
  rejected: "text-[var(--danger)]",
};

/** Small enough that a failure names a paper, large enough to be quick. */
const BATCH = 4;

export function NucleusCapturePanel({
  masters,
  academicYearCode: ay,
  terms,
  canEdit,
  actorName,
  onError,
  onNotice,
  onImported,
}: Props) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [plan, setPlan] = useState<CapturePlan | null>(null);
  const [capturedOn, setCapturedOn] = useState("");
  const [ignored, setIgnored] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);

  const catalog = useMemo<ImportCatalog>(
    () => ({
      academicYearCode: ay,
      classes: masters.classes.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name })),
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

  /**
   * Take a capture that arrives on its own.
   *
   * The bookmark opens this tab when it is clicked and posts the reading in
   * when it finishes, so the office does not copy, switch tab or paste. What
   * arrives is treated exactly as a paste would be — read, planned, and only
   * then fetched — because a message is not more trustworthy than a person.
   *
   * The listener is installed once and calls through a ref, so it always runs
   * the current render's `read` and `fetchAll`. Installed with the closure it
   * was born with, it would plan against whichever catalog existed when the
   * screen first opened.
   */
  const onCaptureRef = useRef<(e: MessageEvent) => void>(() => {});
  useEffect(() => {
    onCaptureRef.current = (e: MessageEvent) => {
      const arriving = readHandoffMessage(e.origin, e.data, "papers");
      if (!arriving.ok) {
        if (arriving.speak) onError(`Nucleus sent a capture this screen could not take: ${arriving.why}`);
        return;
      }
      setOpen(true);
      setPaste(arriving.payload);
      const planned = read(arriving.payload);
      if (!planned) return;
      if (!canEdit) {
        onNotice("A capture arrived from Nucleus. You do not have permission to add papers, so it is only shown.");
        return;
      }
      if (busy) {
        onNotice("A capture arrived while this screen was still fetching. Press Get when it finishes.");
        return;
      }
      if (!planned.counts.fetch) {
        onNotice(`The capture arrived: all ${planned.rows.length} papers in it are already here.`);
        return;
      }
      void fetchAll(planned);
    };
  });

  useEffect(() => {
    announceReady();
    const listener = (e: MessageEvent) => onCaptureRef.current(e);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  function read(text: string = paste): CapturePlan | null {
    const result = readNucleusManifest(text);
    if (!result.ok) {
      onError(result.error);
      return null;
    }
    const state = loadExamPapers();
    const existing = state.papers.flatMap((p) =>
      p.sets.map((s) => ({
        academicYearCode: p.academicYearCode,
        examTermId: p.examTermId,
        classId: p.classId,
        subjectId: p.subjectId,
        publisherLabel: s.source?.publisherLabel ?? s.label,
      })),
    );
    setCapturedOn(result.capturedOn);
    setIgnored(result.ignored);
    setProblems([]);
    setDone(0);
    const planned = planNucleusCapture({
      rows: result.rows,
      catalog,
      mappings: mergeImportMappings(state.importMappings),
      existing,
    });
    setPlan(planned);
    return planned;
  }

  async function fetchAll(use?: CapturePlan) {
    const active = use ?? plan;
    if (!active || !canEdit || busy) return;
    const wanted = active.rows.filter((r) => r.verdict === "fetch");
    if (!wanted.length) {
      onError("Nothing in this capture is new");
      return;
    }

    setBusy(true);
    setDone(0);
    const failures: string[] = [];
    const byGroup = new Map<string, { row: CapturePlanRow; sets: ExamPaperSet[] }>();
    let answers = 0;

    for (let i = 0; i < wanted.length; i += BATCH) {
      const batch = wanted.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/exams/papers/from-nucleus", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorName,
            rows: batch.map((r) => ({
              row: r.row,
              academicYearCode: ay,
              examTermCode: r.examTermCode,
              className: r.className,
              subjectCode: r.subjectCode,
              setCode: r.setCode,
            })),
          }),
        });
        // A server that fell over answers with something that is not JSON;
        // saying so beats "Unexpected end of JSON input".
        const raw = await res.text();
        let body: {
          ok?: boolean;
          error?: string;
          results?: {
            who: string;
            set?: ExamPaperSet;
            answersFilled?: number;
            note?: string;
            error?: string;
          }[];
        } = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          failures.push(
            `The server could not finish these ${batch.length} — it answered ${res.status} with no detail.`,
          );
          setDone(Math.min(i + BATCH, wanted.length));
          continue;
        }
        if (!res.ok || !body.ok || !body.results) {
          failures.push(body.error || `The server answered ${res.status}`);
        } else {
          for (const [n, result] of body.results.entries()) {
            const planned = batch[n]!;
            if (result.error || !result.set) {
              failures.push(`${result.who} — ${result.error ?? "nothing came back"}`);
              continue;
            }
            answers += result.answersFilled ?? 0;
            if (result.note) failures.push(`${result.who} — ${result.note}`);
            const key = `${ay}|${planned.examTermId}|${planned.classId}|${planned.subjectId}`;
            const group = byGroup.get(key) ?? { row: planned, sets: [] };
            group.sets.push(result.set);
            byGroup.set(key, group);
          }
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Could not reach the server");
      }
      setDone(Math.min(i + BATCH, wanted.length));
    }

    // Filing is the folder import's job, unchanged: sets join the paper they
    // belong to, or make one, and every question goes into the bank.
    const state = loadExamPapers();
    const inputs: ImportedPaperInput[] = [...byGroup.values()].map(({ row, sets }) => {
      const existing = state.papers.find(
        (p) =>
          p.academicYearCode === ay &&
          p.examTermId === row.examTermId &&
          p.classId === row.classId &&
          p.subjectId === row.subjectId,
      );
      return {
        targetPaperId: existing?.id ?? "",
        academicYearCode: ay,
        examTermId: row.examTermId,
        classId: row.classId,
        subjectId: row.subjectId,
        examCode: row.examTermCode,
        examName: `${row.examTermCode} · ${row.examTermLabel}`,
        className: row.className,
        subjectCode: row.subjectCode,
        title: `${row.examTermLabel} · ${row.className} · ${row.row.subject}`,
        maxMarks: 0,
        durationMinutes: 0,
        sets: sets.sort((a, b) => a.setCode.localeCompare(b.setCode)),
      };
    });

    const filed = applyImportedSets(state, inputs, actorName);
    const banked = bankImportedQuestions(filed.state, inputs, actorName);
    saveExamPapers(banked.state);

    setProblems(failures);
    setBusy(false);
    setPlan(null);
    setPaste("");
    onImported();
    onNotice(
      `Fetched ${filed.addedSets} paper${filed.addedSets === 1 ? "" : "s"} from Nucleus — ` +
        `${filed.created} new, ${answers} questions answered, ${banked.added} into the bank` +
        (failures.length ? `. ${failures.length} need a look.` : ""),
    );
  }

  if (!canEdit) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Get papers from Nucleus
          </h3>
          <p className="mt-1 max-w-3xl text-[12px] text-[var(--muted)]">
            Papers and answer keys come straight from the publisher — no folder
            to download, no opening each paper for its key.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Paste a capture"}
        </button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          <ol className="space-y-1 text-[12px] text-[var(--muted)]">
            <li>1. Open Nucleus and sign in as usual.</li>
            <li>
              2. On the <strong>Assessments &amp; Answer key</strong> page, click
              the <strong>Send papers to ERP</strong> bookmark and wait for it to
              finish.
            </li>
            <li>3. Paste what it copied into the box below.</li>
          </ol>

          <textarea
            className="field min-h-24 w-full font-mono text-[11px]"
            placeholder="Paste the capture here"
            value={paste}
            disabled={busy}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
              disabled={!paste.trim() || busy}
              onClick={() => void read()}
            >
              Read capture
            </button>
            {capturedOn ? (
              <span className="text-[11px] text-[var(--muted)]">
                captured {capturedOn}
              </span>
            ) : null}
          </div>

          {plan ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                {(["fetch", "already_here", "needs_mapping", "rejected"] as CaptureVerdict[]).map(
                  (v) => (
                    <span key={v} className={`font-semibold ${VERDICT_TONE[v]}`}>
                      {plan.counts[v]} {VERDICT_LABEL[v].toLowerCase()}
                    </span>
                  ),
                )}
              </div>

              {plan.unmapped.length ? (
                <p className="rounded-lg border border-[var(--warn,#b45309)] bg-[rgba(180,83,9,0.08)] p-2 text-[11px]">
                  {plan.unmapped.length} word
                  {plan.unmapped.length === 1 ? "" : "s"} not mapped yet:{" "}
                  {plan.unmapped.join(", ")}. Import a folder once to teach them,
                  or ask for them to be added.
                </p>
              ) : null}

              <div className="max-h-72 overflow-auto">
                <table className="w-full border-collapse text-left text-[12px]">
                  <thead>
                    <tr>
                      {["Paper", "Class", "Subject", "Exam", "Set", ""].map((h) => (
                        <th
                          key={h}
                          className="border border-[var(--border)] bg-[var(--surface-sunken)] p-2"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r) => (
                      <tr key={`${r.row.paperId}-${r.row.title}`}>
                        <td className="border border-[var(--border)] p-2">{r.row.title}</td>
                        <td className="border border-[var(--border)] p-2">
                          {r.className || r.row.classLabel}
                        </td>
                        <td className="border border-[var(--border)] p-2">{r.row.subject}</td>
                        <td className="border border-[var(--border)] p-2">
                          {r.examTermLabel || "—"}
                        </td>
                        <td className="border border-[var(--border)] p-2 text-center">
                          {r.setCode || "—"}
                        </td>
                        <td
                          className={`border border-[var(--border)] p-2 font-semibold ${VERDICT_TONE[r.verdict]}`}
                        >
                          {VERDICT_LABEL[r.verdict]}
                          {r.reason ? (
                            <span className="block font-normal text-[10px] text-[var(--muted)]">
                              {r.reason}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
                disabled={busy || !plan.counts.fetch}
                onClick={() => void fetchAll()}
              >
                {busy
                  ? `Fetching ${done}/${plan.counts.fetch}…`
                  : `Get ${plan.counts.fetch} paper${plan.counts.fetch === 1 ? "" : "s"} and their keys`}
              </button>
            </>
          ) : null}

          {ignored.length ? (
            <details className="text-[11px] text-[var(--muted)]">
              <summary>{ignored.length} row(s) in the capture were ignored</summary>
              <ul className="mt-1 space-y-0.5">
                {ignored.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {problems.length ? (
            <div className="rounded-lg border border-[var(--danger)] bg-[rgba(220,38,38,0.06)] p-2 text-[11px]">
              <p className="font-semibold">{problems.length} need a look</p>
              <ul className="mt-1 space-y-0.5">
                {problems.slice(0, 20).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
