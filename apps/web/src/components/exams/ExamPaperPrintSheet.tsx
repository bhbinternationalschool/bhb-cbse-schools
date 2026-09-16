"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  autoOptionColumns,
  matchAnswerKey,
  questionTotalMarks,
  shuffledMatchRights,
  activeSet,
  questionTypeLabel,
  schoolHeaderDefaults,
  setMarks,
  type ExamPaper,
  type ExamPaperQuestion,
  type ExamPaperSet,
} from "@/lib/examPapers";
import {
  FONT_SCALE_ZOOM,
  PX_PER_MM,
  imposeSheets,
  paginateBlocks,
  printLabels,
  resolveFontScale,
  resolveLanguage,
  sheetGeometry,
  subjectNameIn,
  type PrintLabels,
  type ResolvedLanguage,
  type SheetGeometry,
} from "@/lib/examPaperPrint";

export function printExamPaper(paperId: string) {
  const sheet = document.getElementById(`exam-paper-${paperId}`);
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-exam-paper");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-exam-paper");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

type Ctx = {
  paper: ExamPaper;
  set: ExamPaperSet;
  L: PrintLabels;
  lang: ResolvedLanguage;
  showAnswers: boolean;
};

/**
 * One printable unit: the header, the instructions, a section title or a
 * question. The single layout flows them; two-up / booklet measures them
 * and fills half-size pages.
 */
type Block = { key: string; keepWithNext?: boolean; node: ReactNode };

export function ExamPaperPrintSheet(props: {
  paper: ExamPaper;
  classLabel: string;
  subjectLabel: string;
  examLabel: string;
  /** When true, show answer keys (teacher copy) */
  showAnswers?: boolean;
}) {
  const { paper, classLabel, subjectLabel, examLabel, showAnswers = false } = props;
  const settings = paper.print;
  const lang = resolveLanguage(settings, subjectLabel);
  const L = printLabels(lang);
  const scale = resolveFontScale(settings, classLabel);
  const zoom = FONT_SCALE_ZOOM[scale];
  const geo = sheetGeometry(settings);
  const imposed = settings.layout !== "single";
  const set = activeSet(paper);
  const ctx: Ctx = { paper, set, L, lang, showAnswers };

  const blocks: Block[] = [];
  blocks.push({
    key: "header",
    keepWithNext: true,
    node: (
      <PaperHeader
        ctx={ctx}
        classLabel={classLabel}
        subjectLabel={subjectNameIn(lang, subjectLabel)}
        examLabel={examLabel}
      />
    ),
  });
  if (paper.generalInstructions) {
    blocks.push({
      key: "instructions",
      node: (
        <div className="rounded border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
          <strong>{L.generalInstructions}</strong>
          {"\n"}
          {paper.generalInstructions}
        </div>
      ),
    });
  }
  let qNo = 0;
  set.sections.forEach((section) => {
    blocks.push({
      key: `sec-${section.id}`,
      keepWithNext: true,
      node: (
        <div className="pt-1">
          <h3 className="border-b border-[rgba(32,48,80,0.15)] pb-1 text-sm font-bold uppercase tracking-wide text-[var(--brand-deep)]">
            {section.title}
            <span className="ml-2 text-[11px] font-normal normal-case text-[var(--muted)]">
              ({section.questions.reduce((s, q) => s + questionTotalMarks(q), 0)} {L.marks})
            </span>
          </h3>
          {section.instructions ? (
            <p className="mt-1 text-[11px] italic text-[var(--muted)]">{section.instructions}</p>
          ) : null}
        </div>
      ),
    });
    section.questions.forEach((q) => {
      qNo += 1;
      blocks.push({ key: `q-${q.id}`, node: <QuestionBlock ctx={ctx} q={q} qNo={qNo} /> });
    });
  });

  const pageStyle = `@media print { @page { size: ${geo.sheetWidthMm}mm ${geo.sheetHeightMm}mm; margin: ${
    imposed ? "0" : `${geo.marginMm.top}mm ${geo.marginMm.right}mm ${geo.marginMm.bottom + geo.footerMm}mm ${geo.marginMm.left}mm`
  }; } }`;

  return (
    <div
      id={`exam-paper-${paper.id}`}
      data-lang={lang}
      data-imposed={imposed ? "true" : "false"}
      className="exam-paper-sheet relative overflow-hidden rounded-xl border border-[rgba(32,48,80,0.18)] bg-white"
      style={{ ["--exam-page-content-w" as string]: `${geo.contentWidthMm}mm` }}
    >
      <style>{pageStyle}</style>
      {imposed ? (
        <ImposedSheets blocks={blocks} geo={geo} zoom={zoom} ctx={ctx} />
      ) : (
        <div className="relative px-5 py-6 sm:px-8 sm:py-8" style={{ zoom }}>
          <div className="space-y-4">
            {blocks.map((b) => (
              <div key={b.key}>{b.node}</div>
            ))}
          </div>
          <footer className="exam-paper-page-footer mt-8 flex items-center justify-between border-t border-[rgba(32,48,80,0.15)] pt-2 text-[10px] text-[var(--muted)]">
            <span>
              {schoolHeaderDefaults().shortName} · {paper.paperCode} · {L.set} {set.setCode}
            </span>
            <span className="tabular-nums">
              {L.page} <span className="exam-paper-page-num" /> {L.of} <span className="exam-paper-page-total" />
            </span>
          </footer>
          <p className="mt-1 text-center text-[10px] text-[var(--muted)] print-hide">
            Page numbers appear as “Page X of Y” when printed (browser footer / print dialog). Soft preview uses this bar as a guide.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Two-up / booklet ───────────────────────────────────────────── */

function ImposedSheets(props: { blocks: Block[]; geo: SheetGeometry; zoom: number; ctx: Ctx }) {
  const { blocks, geo, zoom, ctx } = props;
  const { paper, set, L } = ctx;
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[][]>([]);
  // Re-measure whenever the paper, its type size or its layout changes.
  const signature = useMemo(() => JSON.stringify([paper, zoom, ctx.showAnswers, geo]), [paper, zoom, ctx.showAnswers, geo]);
  const gapPx = 4 * PX_PER_MM;

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const run = () => {
      const heights = Array.from(el.children).map((c) => (c as HTMLElement).getBoundingClientRect().height);
      const limit = geo.contentHeightMm * PX_PER_MM;
      el.dataset.measure = JSON.stringify({ heights: heights.map(Math.round), limit: Math.round(limit), gap: Math.round(gapPx) });
      setPages(paginateBlocks(heights, blocks.map((b) => !!b.keepWithNext), limit, gapPx));
    };
    run();
    // Web fonts and pictures settle a moment after first paint.
    const t = window.setTimeout(run, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // On screen the landscape sheet is wider than the panel: scale it to fit.
  // In print the CSS drops the transform and each face is a real page.
  const fitRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const sheetPx = geo.sheetWidthMm * PX_PER_MM;
    const update = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setFit(Math.min(1, (inner > 0 ? inner : sheetPx) / sheetPx));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [geo.sheetWidthMm]);

  const pageCount = pages.length;
  const sheets = imposeSheets(paper.print.layout, pageCount, paper.print.duplexFlip);
  const sideLabel = paper.print.layout === "booklet" ? "Booklet" : "Two-up";

  const renderPage = (pageNo: number) => (
    <div
      className="exam-page relative box-border overflow-hidden"
      style={{
        width: `${geo.pageWidthMm}mm`,
        height: `${geo.pageHeightMm}mm`,
        padding: `${geo.marginMm.top}mm ${geo.marginMm.right}mm ${geo.marginMm.bottom + geo.footerMm}mm ${geo.marginMm.left}mm`,
      }}
    >
      {pageNo > 0 ? (
        <>
          <div style={{ zoom }}>
            <div className="flex flex-col" style={{ gap: `${gapPx / zoom}px` }}>
              {(pages[pageNo - 1] ?? []).map((bi) => (
                <div key={blocks[bi]!.key}>{blocks[bi]!.node}</div>
              ))}
            </div>
          </div>
          <footer
            className="absolute flex items-center justify-between border-t border-[rgba(32,48,80,0.15)] pt-1 text-[9px] text-[var(--muted)]"
            style={{ left: `${geo.marginMm.left}mm`, right: `${geo.marginMm.right}mm`, bottom: `${geo.marginMm.bottom - 2}mm` }}
          >
            <span>
              {schoolHeaderDefaults().shortName} · {paper.paperCode} · {L.set} {set.setCode}
            </span>
            <span className="tabular-nums">
              {L.page} {pageNo} {L.of} {pageCount}
            </span>
          </footer>
        </>
      ) : null}
    </div>
  );

  return (
    <div ref={fitRef} className="exam-paper-preview-wrap relative overflow-hidden p-3 sm:p-4">
      <p className="mb-2 text-[11px] text-[var(--muted)] print-hide">
        {sideLabel} · {pageCount} page{pageCount === 1 ? "" : "s"} on {sheets.length} sheet{sheets.length === 1 ? "" : "s"} ·{" "}
        {geo.sheetWidthMm} × {geo.sheetHeightMm} mm landscape · print both sides
        {paper.print.layout === "booklet" ? `, flip on ${paper.print.duplexFlip} edge, fold down the middle` : ""}.
      </p>
      <div className="exam-sheet-faces space-y-4" style={{ ["--exam-fit" as string]: fit }}>
        {sheets.map((sh, si) =>
          (["front", "back"] as const).map((side) => (
            <div key={`${si}-${side}`} className="exam-sheet-face-wrap">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--muted)] print-hide">
                Sheet {si + 1} · {side}
                {side === "front" ? "" : " (reverse)"} · pages {sh[side].map((p) => (p ? p : "blank")).join(" | ")}
              </p>
              <div
                className="exam-sheet-face-scale"
                style={{ width: `${geo.sheetWidthMm * fit}mm`, height: `${geo.sheetHeightMm * fit}mm` }}
              >
              <div
                className="exam-sheet-face grid origin-top-left border border-dashed border-[rgba(32,48,80,0.25)] bg-white"
                style={{
                  width: `${geo.sheetWidthMm}mm`,
                  height: `${geo.sheetHeightMm}mm`,
                  gridTemplateColumns: "1fr 1fr",
                  transform: fit < 1 ? `scale(${fit})` : undefined,
                }}
              >
                {renderPage(sh[side][0])}
                <div className="relative">
                  <div className="exam-fold-line absolute inset-y-0 left-0 border-l border-dashed border-[rgba(32,48,80,0.2)]" />
                  {renderPage(sh[side][1])}
                </div>
              </div>
              </div>
            </div>
          )),
        )}
      </div>
      {/* Measuring copy: same width and zoom as a page, laid out inside a zero-height clip. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-hidden" style={{ visibility: "hidden" }}>
        {/* CSS zoom scales lengths too, so the un-zoomed width is content ÷ zoom. */}
        <div ref={measureRef} className="exam-measure flex flex-col" style={{ width: `${geo.contentWidthMm / zoom}mm`, zoom }}>
        {blocks.map((b) => (
          <div key={b.key}>{b.node}</div>
        ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Header ─────────────────────────────────────────────────────── */

function PaperHeader(props: { ctx: Ctx; classLabel: string; subjectLabel: string; examLabel: string }) {
  const { ctx, classLabel, subjectLabel, examLabel } = props;
  const { paper, set, L } = ctx;
  const header = schoolHeaderDefaults();
  const h = paper.print.header;
  const marks = setMarks(set);
  return (
    <header className="border-b-2 border-[var(--brand-gold)] pb-3">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={header.logoUrl} alt="" className="h-14 w-14 object-contain" />
        <div className="min-w-0 flex-1 text-center">
          <p className="font-brand-name text-base tracking-[0.1em] text-[var(--brand-deep)] sm:text-lg">
            {h.schoolName || header.schoolName}
          </p>
          <p className="text-[11px] text-[var(--muted)]">
            {h.address || header.address} · {L.affiliation} {header.affiliationNo} · {L.schoolCode} {header.schoolCode}
          </p>
          <p className="mt-1 text-sm font-bold uppercase tracking-wide text-[var(--brand-deep)]">
            {h.examName || paper.examName || examLabel || L.examination}
          </p>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">{h.title || paper.title}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={header.crestUrl} alt="" className="hidden h-14 w-14 object-contain sm:block" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <span className="text-[var(--muted)]">{L.class} </span>
          <strong>{classLabel}</strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">{L.subject} </span>
          <strong>{subjectLabel}</strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">{L.duration} </span>
          <strong>
            {paper.durationMinutes} {L.minutes}
          </strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">{L.maxMarks} </span>
          <strong>
            {paper.maxMarks || marks} {marks !== paper.maxMarks ? `(${L.set} ${marks})` : ""}
          </strong>
        </div>
        <div>
          <span className="text-[var(--muted)]">{L.set} </span>
          <strong>{set.setCode}</strong>
        </div>
        <div className="sm:col-span-3">
          <span className="text-[var(--muted)]">{L.paperCode} </span>
          <strong className="font-mono tracking-wide">{paper.paperCode}</strong>
        </div>
      </div>
    </header>
  );
}

/* ─── Question ───────────────────────────────────────────────────── */

function MatchTable(props: { ctx: Ctx; pairs: { left: string; right: string }[]; seed: string; indent?: boolean }) {
  const { ctx, pairs, seed, indent } = props;
  const { L, showAnswers } = ctx;
  const rights = shuffledMatchRights(pairs, seed);
  return (
    <div className={indent ? "ml-6 mt-0.5" : "mt-1"}>
      <table className="w-full max-w-md border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
            <th className="py-0.5 pr-4">{L.columnA}</th>
            <th className="py-0.5">{L.columnB}</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair, i) => (
            <tr key={i}>
              <td className="py-0.5 pr-4">
                {i + 1}. {pair.left}
              </td>
              <td className="py-0.5">
                ({String.fromCharCode(97 + i)}) {rights[i] ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        {L.answer}: {pairs.map((_, i) => `${i + 1}-____`).join("  ")}
      </p>
      {showAnswers ? (
        <p className="mt-0.5 text-[11px] font-semibold text-[var(--success)] print-hide">
          {L.key}: {matchAnswerKey(pairs, rights)}
        </p>
      ) : null}
    </div>
  );
}

function QuestionBlock(props: { ctx: Ctx; q: ExamPaperQuestion; qNo: number }) {
  const { ctx, q, qNo } = props;
  const { paper, set, L, showAnswers } = ctx;
  return (
    <div className="text-sm leading-relaxed">
      <div className="flex gap-2">
        <span className="font-bold tabular-nums">{qNo}.</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="whitespace-pre-wrap">{q.text}</p>
            <span className="shrink-0 text-[11px] font-semibold text-[var(--muted)]">
              [{questionTotalMarks(q)}]<span className="print-hide"> · {questionTypeLabel(q.type)}</span>
            </span>
          </div>
          {q.icons.length ? (
            <div className="mt-1 flex flex-wrap gap-2 text-2xl">
              {q.icons.map((ic, i) => (
                <span key={`${q.id}-ic-${i}`}>{ic}</span>
              ))}
            </div>
          ) : null}
          {q.formulas.length ? (
            <ul className="mt-1 space-y-0.5 font-mono text-[12px] text-[var(--brand-deep)]">
              {q.formulas.map((f, i) => (
                <li key={`${q.id}-f-${i}`}>{f}</li>
              ))}
            </ul>
          ) : null}
          {q.images.length ? (
            <div
              className="mt-2 grid gap-3"
              style={{ gridTemplateColumns: `repeat(${Math.min(q.imageColumns, q.images.length)}, minmax(0, 1fr))` }}
            >
              {q.images.map((img) => (
                <figure key={img.id} className="min-w-0">
                  <div className="relative inline-block max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.dataUrl}
                      alt={img.caption || "Question figure"}
                      className={`${q.imageColumns > 1 ? "max-h-56" : "max-h-72"} w-auto max-w-full rounded border border-[rgba(32,48,80,0.12)] object-contain`}
                    />
                    {img.labels.length ? (
                      <svg
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden
                      >
                        {img.labels.map((l) => (
                          <g key={l.n}>
                            <line
                              x1={l.x * 100}
                              y1={l.y * 100}
                              x2={l.lx * 100}
                              y2={l.ly * 100}
                              stroke="#203050"
                              strokeWidth={0.6}
                              vectorEffect="non-scaling-stroke"
                            />
                            <circle cx={l.x * 100} cy={l.y * 100} r={1.1} fill="#203050" />
                          </g>
                        ))}
                      </svg>
                    ) : null}
                    {img.labels.map((l) => (
                      <span
                        key={`n-${l.n}`}
                        className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#203050] bg-white text-[10px] font-bold text-[#203050]"
                        style={{ left: `${l.lx * 100}%`, top: `${l.ly * 100}%` }}
                      >
                        {l.n}
                      </span>
                    ))}
                  </div>
                  {img.caption ? (
                    <figcaption className="mt-0.5 text-center text-[10px] text-[var(--muted)]">{img.caption}</figcaption>
                  ) : null}
                  {img.labels.length ? (
                    <ol className="mt-1 grid grid-cols-2 gap-x-4 text-[12px]">
                      {img.labels.map((l) => (
                        <li key={`b-${l.n}`}>{l.n}. ____________</li>
                      ))}
                    </ol>
                  ) : null}
                </figure>
              ))}
            </div>
          ) : null}
          {(q.type === "mcq" || q.type === "assertion_reason") && q.options.length ? (
            <ul
              className="mt-1 grid gap-x-4 gap-y-1"
              style={{
                gridTemplateColumns: `repeat(${
                  q.type === "assertion_reason" ? 1 : q.optionColumns || autoOptionColumns(q.options)
                }, minmax(0, 1fr))`,
              }}
            >
              {q.options.map((opt, i) => (
                <li key={i} className="text-[13px]">
                  ({String.fromCharCode(97 + i)}) {opt}
                </li>
              ))}
            </ul>
          ) : null}
          {q.type === "true_false" ? (
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {L.trueFalse} &nbsp; {L.answer}: ______
            </p>
          ) : null}
          {q.type === "fill" && q.options.length ? (
            <p className="mt-1 rounded border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[12px]">
              <span className="text-[var(--muted)]">{L.wordBank}: </span>
              {q.options.filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {q.type === "match" && q.pairs.length ? (
            <MatchTable ctx={ctx} pairs={q.pairs} seed={`${paper.id}:${set.setCode}:${q.id}`} />
          ) : null}
          {q.type === "diagram" && q.options.length ? (
            <ol className="mt-1 list-decimal pl-5 text-[13px]">
              {q.options.filter(Boolean).map((label, i) => (
                <li key={i}>{label}: ____________</li>
              ))}
            </ol>
          ) : null}
          {q.subQuestions.length ? (
            <div className="mt-2">
              {q.attemptAny > 0 && q.attemptAny < q.subQuestions.length ? (
                <p className="text-[12px] italic text-[var(--muted)]">{L.attemptAny(q.attemptAny, q.subQuestions.length)}</p>
              ) : null}
              <ol className="mt-1 space-y-1.5 pl-1 text-[13px]">
                {q.subQuestions.map((sq, i) => {
                  const roman = ROMAN[i] ?? String(i + 1);
                  const cols = q.optionColumns || autoOptionColumns(sq.options);
                  const pairs = sq.pairs.filter((p) => p.left || p.right);
                  return (
                    <li key={i}>
                      <div className="flex justify-between gap-3">
                        <span>
                          ({roman}) {sq.text}
                          {sq.type === "true_false" ? <span className="text-[var(--muted)]"> {L.trueFalse}</span> : null}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--muted)]">[{sq.marks}]</span>
                      </div>
                      {(sq.type === "mcq" || sq.type === "assertion_reason") && sq.options.some(Boolean) ? (
                        <ul
                          className="ml-6 mt-0.5 grid gap-x-4 gap-y-0.5"
                          style={{ gridTemplateColumns: `repeat(${sq.type === "assertion_reason" ? 1 : cols}, minmax(0, 1fr))` }}
                        >
                          {sq.options.filter(Boolean).map((opt, k) => (
                            <li key={k} className="text-[13px]">
                              ({String.fromCharCode(97 + k)}) {opt}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {sq.type === "fill" && sq.options.length ? (
                        <p className="ml-6 mt-0.5 text-[12px] text-[var(--muted)]">
                          {L.wordBank}: {sq.options.filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {sq.type === "diagram" && sq.options.length ? (
                        <ol className="ml-6 mt-0.5 list-decimal pl-5 text-[13px]">
                          {sq.options.filter(Boolean).map((label, k) => (
                            <li key={k}>{label}: ____________</li>
                          ))}
                        </ol>
                      ) : null}
                      {sq.type === "match" && pairs.length ? (
                        <MatchTable ctx={ctx} pairs={pairs} seed={`${paper.id}:${set.setCode}:${q.id}:${i}`} indent />
                      ) : null}
                      {sq.type === "numerical" ? (
                        <p className="ml-6 mt-0.5 text-[12px] text-[var(--muted)]">
                          {L.showWorking} &nbsp; {L.answer}: ______________
                        </p>
                      ) : null}
                      {showAnswers && sq.answerKey && sq.type !== "match" ? (
                        <p className="ml-6 text-[11px] font-semibold text-[var(--success)] print-hide">
                          {L.key}: {sq.answerKey}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
          {q.type === "numerical" ? (
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {L.showWorking} &nbsp; {L.answer}: ______________
            </p>
          ) : null}
          {q.answerLines > 0 && !showAnswers ? (
            <div className="mt-2 space-y-4">
              {Array.from({ length: q.answerLines }).map((_, i) => (
                <div key={i} className="border-b border-[rgba(32,48,80,0.25)]" />
              ))}
            </div>
          ) : null}
          {showAnswers && q.answerKey && q.type !== "match" ? (
            <p className="mt-1 text-[11px] font-semibold text-[var(--success)] print-hide">
              {L.key}: {q.answerKey}
            </p>
          ) : null}
          {showAnswers && q.markingScheme.length ? (
            <ul className="mt-0.5 list-disc pl-4 text-[11px] text-[var(--success)] print-hide">
              {q.markingScheme.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          ) : null}
          {showAnswers && (q.competencyCode || q.bloomLevel) ? (
            <p className="mt-0.5 text-[10px] text-[var(--muted)] print-hide">
              {[q.competencyCode, q.bloomLevel].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
