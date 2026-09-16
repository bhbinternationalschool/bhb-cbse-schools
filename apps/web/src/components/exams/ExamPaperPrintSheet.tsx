"use client";

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
} from "@/lib/examPapers";

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

export function ExamPaperPrintSheet(props: {
  paper: ExamPaper;
  classLabel: string;
  subjectLabel: string;
  examLabel: string;
  /** When true, show answer keys (teacher copy) */
  showAnswers?: boolean;
}) {
  const { paper, classLabel, subjectLabel, examLabel, showAnswers } = props;
  const header = schoolHeaderDefaults();
  const set = activeSet(paper);
  const marks = setMarks(set);
  let qNo = 0;

  return (
    <div
      id={`exam-paper-${paper.id}`}
      className="exam-paper-sheet relative overflow-hidden rounded-xl border border-[rgba(32,48,80,0.18)] bg-white"
    >
      <div className="relative px-5 py-6 sm:px-8 sm:py-8">
        <header className="border-b-2 border-[var(--brand-gold)] pb-3">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={header.logoUrl}
              alt=""
              className="h-14 w-14 object-contain"
            />
            <div className="min-w-0 flex-1 text-center">
              <p className="font-brand-name text-base tracking-[0.1em] text-[var(--brand-deep)] sm:text-lg">
                {header.schoolName}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                {header.address} · Aff. {header.affiliationNo} · School code{" "}
                {header.schoolCode}
              </p>
              <p className="mt-1 text-sm font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                {paper.examName || examLabel || "Examination"}
              </p>
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                {paper.title}
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={header.crestUrl}
              alt=""
              className="hidden h-14 w-14 object-contain sm:block"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <span className="text-[var(--muted)]">Class </span>
              <strong>{classLabel}</strong>
            </div>
            <div>
              <span className="text-[var(--muted)]">Subject </span>
              <strong>{subjectLabel}</strong>
            </div>
            <div>
              <span className="text-[var(--muted)]">Duration </span>
              <strong>{paper.durationMinutes} min</strong>
            </div>
            <div>
              <span className="text-[var(--muted)]">Max marks </span>
              <strong>
                {paper.maxMarks || marks}{" "}
                {marks !== paper.maxMarks ? `(set ${marks})` : ""}
              </strong>
            </div>
            <div>
              <span className="text-[var(--muted)]">Set </span>
              <strong>{set.setCode}</strong>
            </div>
            <div className="sm:col-span-3">
              <span className="text-[var(--muted)]">Paper code </span>
              <strong className="font-mono tracking-wide">{paper.paperCode}</strong>
            </div>
          </div>
        </header>

        {paper.generalInstructions ? (
          <div className="mt-3 rounded border border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.03)] p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
            <strong>General instructions</strong>
            {"\n"}
            {paper.generalInstructions}
          </div>
        ) : null}

        <div className="mt-4 space-y-5">
          {set.sections.map((section) => (
            <section key={section.id}>
              <h3 className="border-b border-[rgba(32,48,80,0.15)] pb-1 text-sm font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                {section.title}
                <span className="ml-2 text-[11px] font-normal normal-case text-[var(--muted)]">
                  ({section.questions.reduce((s, q) => s + q.marks, 0)} marks)
                </span>
              </h3>
              {section.instructions ? (
                <p className="mt-1 text-[11px] italic text-[var(--muted)]">
                  {section.instructions}
                </p>
              ) : null}
              <ol className="mt-2 space-y-4">
                {section.questions.map((q) => {
                  qNo += 1;
                  return (
                    <li key={q.id} className="text-sm leading-relaxed">
                      <div className="flex gap-2">
                        <span className="font-bold tabular-nums">{qNo}.</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="whitespace-pre-wrap">{q.text}</p>
                            <span className="shrink-0 text-[11px] font-semibold text-[var(--muted)]">
                              [{questionTotalMarks(q)}] · {questionTypeLabel(q.type)}
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
                                            <line x1={l.x * 100} y1={l.y * 100} x2={l.lx * 100} y2={l.ly * 100} stroke="#203050" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
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
                                    <figcaption className="mt-0.5 text-center text-[10px] text-[var(--muted)]">
                                      {img.caption}
                                    </figcaption>
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
                              (True / False) &nbsp; Answer: ______
                            </p>
                          ) : null}
                          {q.type === "fill" && q.options.length ? (
                            <p className="mt-1 rounded border border-[rgba(32,48,80,0.15)] px-2 py-1 text-[12px]">
                              <span className="text-[var(--muted)]">Word bank: </span>
                              {q.options.filter(Boolean).join(" · ")}
                            </p>
                          ) : null}
                          {q.type === "match" && q.pairs.length ? (() => {
                            const rights = shuffledMatchRights(q.pairs, `${paper.id}:${set.setCode}:${q.id}`);
                            return (
                              <div className="mt-1">
                                <table className="w-full max-w-md border-collapse text-[13px]">
                                  <thead>
                                    <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                                      <th className="py-0.5 pr-4">Column A</th>
                                      <th className="py-0.5">Column B</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {q.pairs.map((pair, i) => (
                                      <tr key={i}>
                                        <td className="py-0.5 pr-4">{i + 1}. {pair.left}</td>
                                        <td className="py-0.5">({String.fromCharCode(97 + i)}) {rights[i] ?? ""}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <p className="mt-1 text-[12px] text-[var(--muted)]">
                                  Answer: {q.pairs.map((_, i) => `${i + 1}-____`).join("  ")}
                                </p>
                                {showAnswers ? (
                                  <p className="mt-0.5 text-[11px] font-semibold text-[var(--success)] print-hide">
                                    Key: {matchAnswerKey(q.pairs, rights)}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })() : null}
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
                                <p className="text-[12px] italic text-[var(--muted)]">
                                  Attempt any {q.attemptAny} of the following {q.subQuestions.length}.
                                </p>
                              ) : null}
                              <ol className="mt-1 space-y-1.5 pl-1 text-[13px]">
                                {q.subQuestions.map((sq, i) => {
                                  const roman = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][i] ?? String(i + 1);
                                  const cols = q.optionColumns || autoOptionColumns(sq.options);
                                  return (
                                    <li key={i}>
                                      <div className="flex justify-between gap-3">
                                        <span>
                                          ({roman}) {sq.text}
                                          {sq.type === "true_false" ? <span className="text-[var(--muted)]"> (True / False)</span> : null}
                                        </span>
                                        <span className="shrink-0 text-[11px] text-[var(--muted)]">[{sq.marks}]</span>
                                      </div>
                                      {(sq.type === "mcq" || sq.type === "assertion_reason") && sq.options.length ? (
                                        <ul
                                          className="ml-6 mt-0.5 grid gap-x-4 gap-y-0.5"
                                          style={{ gridTemplateColumns: `repeat(${sq.type === "assertion_reason" ? 1 : cols}, minmax(0, 1fr))` }}
                                        >
                                          {sq.options.map((opt, k) => (
                                            <li key={k} className="text-[13px]">
                                              ({String.fromCharCode(97 + k)}) {opt}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : null}
                                      {sq.type === "fill" && sq.options.length ? (
                                        <p className="ml-6 mt-0.5 text-[12px] text-[var(--muted)]">Word bank: {sq.options.filter(Boolean).join(" · ")}</p>
                                      ) : null}
                                      {showAnswers && sq.answerKey ? (
                                        <p className="ml-6 text-[11px] font-semibold text-[var(--success)] print-hide">Key: {sq.answerKey}</p>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ol>
                            </div>
                          ) : null}
                          {q.type === "numerical" ? (
                            <p className="mt-1 text-[12px] text-[var(--muted)]">Show your working. &nbsp; Answer: ______________</p>
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
                              Key: {q.answerKey}
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
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>

        <footer className="exam-paper-page-footer mt-8 flex items-center justify-between border-t border-[rgba(32,48,80,0.15)] pt-2 text-[10px] text-[var(--muted)]">
          <span>
            {header.shortName} · {paper.paperCode} · Set {set.setCode}
          </span>
          <span className="tabular-nums">
            Page <span className="exam-paper-page-num" /> of{" "}
            <span className="exam-paper-page-total" />
          </span>
        </footer>
        <p className="mt-1 text-center text-[10px] text-[var(--muted)] print-hide">
          Page numbers appear as “Page X of Y” when printed (browser footer /
          print dialog). Soft preview uses this bar as a guide.
        </p>
      </div>
    </div>
  );
}
