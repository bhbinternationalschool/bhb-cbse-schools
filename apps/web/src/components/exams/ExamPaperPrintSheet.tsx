"use client";

import {
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
                              [{q.marks}] · {questionTypeLabel(q.type)}
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
                            <div className="mt-2 flex flex-wrap gap-3">
                              {q.images.map((img) => (
                                <figure key={img.id} className="max-w-[220px]">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={img.dataUrl}
                                    alt={img.caption || "Question figure"}
                                    className="max-h-40 w-auto rounded border border-[rgba(32,48,80,0.12)] object-contain"
                                  />
                                  {img.caption ? (
                                    <figcaption className="mt-0.5 text-center text-[10px] text-[var(--muted)]">
                                      {img.caption}
                                    </figcaption>
                                  ) : null}
                                </figure>
                              ))}
                            </div>
                          ) : null}
                          {q.type === "mcq" && q.options.length ? (
                            <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                              {q.options.map((opt, i) => (
                                <li key={i} className="text-[13px]">
                                  ({String.fromCharCode(97 + i)}) {opt}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {q.type === "true_false" ? (
                            <p className="mt-1 text-[12px] text-[var(--muted)]">
                              (True / False)
                            </p>
                          ) : null}
                          {showAnswers && q.answerKey ? (
                            <p className="mt-1 text-[11px] font-semibold text-[#0f7a4c] print-hide">
                              Key: {q.answerKey}
                            </p>
                          ) : null}
                          {showAnswers && q.markingScheme.length ? (
                            <ul className="mt-0.5 list-disc pl-4 text-[11px] text-[#0f7a4c] print-hide">
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
