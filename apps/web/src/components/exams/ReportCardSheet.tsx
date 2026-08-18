"use client";

import { type ReportCard } from "@/lib/exams";
import { TENANT } from "@/lib/types";

export function printReportCard(studentId: string, examTermId: string) {
  const sheet = document.getElementById(
    `report-card-${studentId}-${examTermId}`,
  );
  if (!sheet) {
    window.print();
    return;
  }
  document.body.classList.add("printing-certificate");
  sheet.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-certificate");
    sheet.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

export function ReportCardSheet({ card }: { card: ReportCard }) {
  const hasSubjectRemarks = card.lines.some((l) => l.remark.trim());
  return (
    <div
      id={`report-card-${card.student.id}-${card.examTerm.id}`}
      className="certificate-sheet relative overflow-hidden rounded-xl border border-[rgba(32,48,80,0.18)] bg-white"
    >
      <div className="certificate-watermark pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="select-none text-5xl font-bold uppercase tracking-[0.2em] text-[rgba(32,48,80,0.06)] sm:text-6xl">
          {TENANT.shortName}
        </span>
      </div>

      <div className="certificate-inner relative px-5 py-6 sm:px-8 sm:py-8">
        <header className="border-b-2 border-[var(--brand-gold)] pb-3 text-center">
          <p className="font-brand-name text-sm tracking-[0.12em] text-[var(--brand-deep)] sm:text-base">
            {TENANT.nameDisplay}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {TENANT.schoolAddress} · Aff. No. {TENANT.affiliationNo}
          </p>
          <h1 className="mt-3 text-lg font-bold uppercase tracking-wide text-[var(--brand-deep)]">
            Progress report
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {card.examTerm.label}
            {card.aggregateMode !== "none"
              ? " (weighted aggregate)"
              : ""}{" "}
            · Session {card.academicYearCode}
          </p>
        </header>

        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Student
            </dt>
            <dd className="font-semibold text-[var(--brand-deep)]">
              {card.student.fullName}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Admission no.
            </dt>
            <dd className="font-medium">{card.student.admissionNo}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Class
            </dt>
            <dd className="font-medium">{card.classLabel}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Father / Mother
            </dt>
            <dd className="font-medium">
              {card.student.fatherName || "—"}
              {card.student.motherName
                ? ` / ${card.student.motherName}`
                : ""}
            </dd>
          </div>
        </dl>

        {card.curriculumNote ? (
          <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2 text-[11px] text-[var(--muted)]">
            {card.curriculumNote}
          </p>
        ) : null}

        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[rgba(32,48,80,0.2)] text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <th className="py-2 pr-2">Subject</th>
              <th className="py-2 pr-2 text-right">Max</th>
              <th className="py-2 pr-2 text-right">Obtained</th>
              <th className="py-2 text-right">Grade</th>
              {hasSubjectRemarks ? <th className="py-2 pl-3">Remark</th> : null}
            </tr>
          </thead>
          <tbody>
            {card.lines.map((line) => (
              <tr
                key={line.subjectId}
                className="border-b border-[rgba(32,48,80,0.08)]"
              >
                <td className="py-2 pr-2 font-medium text-[var(--brand-deep)]">
                  {line.subjectName}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {line.maxMarks}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {line.marksObtained == null ? "—" : line.marksObtained}
                </td>
                <td className="py-2 text-right font-semibold">
                  {line.grade}
                </td>
                {hasSubjectRemarks ? (
                  <td className="py-2 pl-3 text-xs text-[var(--muted)]">
                    {line.remark}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--brand-deep)] font-bold">
              <td className="py-2.5 pr-2">Total</td>
              <td className="py-2.5 pr-2 text-right tabular-nums">
                {card.totalMax}
              </td>
              <td className="py-2.5 pr-2 text-right tabular-nums">
                {card.totalObtained}
              </td>
              <td className="py-2.5 text-right">{card.overallGrade}</td>
              {hasSubjectRemarks ? <td /> : null}
            </tr>
          </tfoot>
        </table>

        {card.aggregateMode !== "none" && card.components.length > 0 ? (
          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Component exams (
              {card.aggregateMode === "hy" ? "Half-yearly" : "Final"} aggregate)
            </p>
            <table className="mt-2 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[rgba(32,48,80,0.15)] text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-1.5 pr-2">Exam</th>
                  <th className="py-1.5 pr-2">Subject</th>
                  <th className="py-1.5 pr-2 text-right">Wt</th>
                  <th className="py-1.5 pr-2 text-right">Max</th>
                  <th className="py-1.5 text-right">Obt.</th>
                </tr>
              </thead>
              <tbody>
                {card.components.map((c) => {
                  const sub = card.lines.find(
                    (l) => l.subjectId === c.subjectId,
                  );
                  return (
                    <tr
                      key={`${c.examTermId}-${c.subjectId}`}
                      className="border-b border-[rgba(32,48,80,0.06)]"
                    >
                      <td className="py-1.5 pr-2 font-medium">
                        {c.examCode}
                        {c.requiredOnMarksheet ? "" : " *"}
                      </td>
                      <td className="py-1.5 pr-2 text-[var(--muted)]">
                        {sub?.subjectName ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {c.weight}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {c.maxMarks}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {c.marksObtained == null ? "—" : c.marksObtained}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-[var(--muted)]">Percentage </span>
            <span className="font-bold text-[var(--brand-deep)]">
              {card.percent}%
            </span>
          </div>
          <div>
            <span className="text-[var(--muted)]">Overall grade </span>
            <span className="font-bold text-[var(--brand-deep)]">
              {card.overallGrade}
            </span>
          </div>
          {card.attendance ? (
            <div>
              <span className="text-[var(--muted)]">Attendance </span>
              <span className="font-bold text-[var(--brand-deep)]">
                {card.attendance.presentDays}/{card.attendance.workingDays} (
                {card.attendance.percent}%)
              </span>
            </div>
          ) : null}
        </div>

        {card.coScholastic.length > 0 ? (
          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Holistic Progress (Co-Scholastic Areas)
            </p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {card.coScholastic.map((c) => (
                <div key={c.domain}>
                  <span className="text-[var(--muted)]">
                    {c.domainLabel}{" "}
                  </span>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {c.rating ?? "—"}
                    {c.rating ? ` — ${c.ratingLabel}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {card.overallRemark ? (
          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Class teacher&apos;s remarks
            </p>
            {card.overallRemark.text ? (
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--brand-deep)]">
                {card.overallRemark.text}
              </p>
            ) : null}
            {card.overallRemark.textHi ? (
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--brand-deep)]" lang="hi">
                {card.overallRemark.textHi}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-10 grid grid-cols-3 gap-4 text-center text-[11px] text-[var(--muted)]">
          <div className="border-t border-[rgba(32,48,80,0.25)] pt-2">
            Class teacher
          </div>
          <div className="border-t border-[rgba(32,48,80,0.25)] pt-2">
            Examination in-charge
          </div>
          <div className="border-t border-[rgba(32,48,80,0.25)] pt-2">
            Principal
          </div>
        </div>
      </div>
    </div>
  );
}
