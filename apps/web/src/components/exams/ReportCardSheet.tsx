"use client";

/* ratchet-allow: raw_table — printed document: ErpTableShell brings a card shadow, rounded border, hover
 * tint and theme-aware colours, all of which are wrong on paper — a sheet that
 * followed dark mode would print white ink on white stock. */

import { type ReportCard } from "@/lib/exams";
import { StudentAvatar } from "@/components/students/StudentAvatar";
import {
  schoolAddressLine,
  schoolPrintName,
  schoolShortName,
  schoolStatutoryLine,
} from "@/lib/schoolIdentity";

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

function fmtDob(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/**
 * The printed report card. What it carries and how it is laid out comes
 * from `card.presentation` — the class's report card template with the
 * assessment scheme's switches as fallback — so the same component prints
 * a Holistic Progress Card for Nursery and a board-style statement for X.
 */
export function ReportCardSheet({ card }: { card: ReportCard }) {
  const p = card.presentation;
  const compact = p.layout === "compact";
  const hpc = p.layout === "hpc";
  const termwise = p.layout === "termwise" && card.aggregateMode !== "none" && card.components.length > 0;
  // What the class's scheme says the card shows: numbers and a grade,
  // a grade alone, or a descriptor. HPC never shows numbers.
  const gradesOnly = hpc || card.displayMode !== "marks_grade";
  const descriptors = hpc || card.displayMode === "descriptors";
  const hasSubjectRemarks = p.showSubjectRemarks && card.lines.some((l) => l.remark.trim());
  const partCodes =
    p.showComponents && !termwise
      ? (card.lines.find((l) => l.parts.length > 0)?.parts.map((x) => ({ code: x.code, label: x.label })) ?? [])
      : [];
  const showTotals = !gradesOnly && card.totalMax > 0;
  const examColumns = termwise
    ? [...new Map(card.components.map((c) => [c.examTermId, { id: c.examTermId, code: c.examCode }])).values()]
    : [];
  const legend = p.showGradeLegend
    ? [...new Map(card.lines.filter((l) => l.grade !== "—" && l.grade !== "AB").map((l) => [l.grade, l.gradeLabel])).entries()].filter(
        ([, label]) => label,
      )
    : [];
  const st = card.student;
  const health = p.showHealth
    ? [
        st.heightCm ? `Height ${st.heightCm} cm` : "",
        st.weightKg ? `Weight ${st.weightKg} kg` : "",
        st.bloodGroup ? `Blood group ${st.bloodGroup}` : "",
      ].filter(Boolean)
    : [];
  const text = compact ? "text-xs" : "text-sm";
  const cell = compact ? "py-1 pr-2" : "py-2 pr-2";

  const remarksBlock =
    p.showRemarks && card.overallRemark ? (
      <div className={compact ? "mt-3" : "mt-5"}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Class teacher&apos;s remarks
        </p>
        {card.overallRemark.text ? (
          <p className={`mt-1.5 leading-relaxed text-[var(--brand-deep)] ${text}`}>{card.overallRemark.text}</p>
        ) : null}
        {card.overallRemark.textHi ? (
          <p className={`mt-1.5 leading-relaxed text-[var(--brand-deep)] ${text}`} lang="hi">
            {card.overallRemark.textHi}
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <div
      id={`report-card-${card.student.id}-${card.examTerm.id}`}
      className="certificate-sheet relative overflow-hidden rounded-xl border border-[rgba(32,48,80,0.18)] bg-white"
    >
      {p.showWatermark ? (
        <div className="certificate-watermark pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="select-none text-5xl font-bold uppercase tracking-[0.2em] text-[rgba(32,48,80,0.06)] sm:text-6xl">
            {schoolShortName()}
          </span>
        </div>
      ) : null}

      <div className={`certificate-inner relative ${compact ? "px-4 py-4 sm:px-6 sm:py-5" : "px-5 py-6 sm:px-8 sm:py-8"}`}>
        <header className="border-b-2 border-[var(--brand-gold)] pb-3 text-center">
          <p className="font-brand-name text-sm tracking-[0.12em] text-[var(--brand-deep)] sm:text-base">
            {schoolPrintName()}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {[schoolAddressLine(), schoolStatutoryLine()].filter(Boolean).join(" · ")}
          </p>
          <h1 className={`mt-3 font-bold uppercase tracking-wide text-[var(--brand-deep)] ${compact ? "text-base" : "text-lg"}`}>
            {p.title}
          </h1>
          {p.subtitle ? <p className="mt-0.5 text-xs text-[var(--muted)]">{p.subtitle}</p> : null}
          <p className="mt-1 text-sm text-[var(--muted)]">
            {card.examTerm.label}
            {card.aggregateMode !== "none" ? " (weighted aggregate)" : ""} · Session {card.academicYearCode}
          </p>
        </header>

        <div className={`mt-4 flex gap-4 ${text}`}>
          {p.showPhoto ? (
            <div className="shrink-0">
              <StudentAvatar student={st} size={compact ? 56 : 80} />
            </div>
          ) : null}
          <dl className="grid flex-1 gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Student</dt>
              <dd className="font-semibold text-[var(--brand-deep)]">{st.fullName}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Class</dt>
              <dd className="font-medium">
                {card.classLabel}
                {p.showRollNo && st.rollNo ? ` · Roll ${st.rollNo}` : ""}
              </dd>
            </div>
            {p.showAdmissionNo ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Admission no.</dt>
                <dd className="font-medium">{st.admissionNo}</dd>
              </div>
            ) : null}
            {p.showDob && st.dob ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Date of birth</dt>
                <dd className="font-medium">{fmtDob(st.dob)}</dd>
              </div>
            ) : null}
            {p.showParents ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Father / Mother</dt>
                <dd className="font-medium">
                  {st.fatherName || "—"}
                  {st.motherName ? ` / ${st.motherName}` : ""}
                </dd>
              </div>
            ) : null}
            {health.length > 0 ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Health</dt>
                <dd className="font-medium">{health.join(" · ")}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {card.absent ? (
          <p className="mt-3 rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]">
            Absent in this examination
            {card.absent.reason ? <span className="font-normal text-[var(--muted)]"> — {card.absent.reason}</span> : null}
          </p>
        ) : card.absentSubjects.length > 0 ? (
          <p className="mt-3 rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-sm text-[var(--brand-deep)]">
            <span className="font-semibold">Absent for:</span> {card.absentSubjects.join(", ")}
          </p>
        ) : null}

        {card.curriculumNote ? (
          <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2 text-[11px] text-[var(--muted)]">{card.curriculumNote}</p>
        ) : null}

        {hpc ? remarksBlock : null}

        {hpc ? (
          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Learning areas</p>
            <ul className={`mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 ${text}`}>
              {card.lines.map((line) => (
                <li key={line.subjectId} className="flex items-baseline justify-between gap-3 border-b border-[rgba(32,48,80,0.08)] py-1">
                  <span className="font-medium text-[var(--brand-deep)]">{line.subjectName}</span>
                  <span className="text-right font-semibold">
                    {line.absent ? "AB" : line.gradeLabel || line.grade}
                    {!line.absent && line.gradeLabel && line.grade !== "—" ? (
                      <span className="ml-1 font-normal text-[var(--muted)]">({line.grade})</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <table className={`mt-5 w-full border-collapse ${text}`}>
            <thead>
              <tr className="border-b border-[rgba(32,48,80,0.2)] text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                <th className={cell}>Subject</th>
                {examColumns.map((c) => (
                  <th key={c.id} className={`${cell} text-right`}>
                    {c.code}
                  </th>
                ))}
                {!gradesOnly
                  ? partCodes.map((pc) => (
                      <th key={pc.code} className={`${cell} text-right`} title={pc.label}>
                        {pc.code}
                      </th>
                    ))
                  : null}
                {!gradesOnly ? <th className={`${cell} text-right`}>Max</th> : null}
                {!gradesOnly ? <th className={`${cell} text-right`}>{termwise ? "Total" : "Obtained"}</th> : null}
                <th className={`py-2 ${gradesOnly ? "text-left" : "text-right"}`}>{descriptors ? "Assessment" : "Grade"}</th>
                {hasSubjectRemarks ? <th className="py-2 pl-3">Remark</th> : null}
              </tr>
            </thead>
            <tbody>
              {card.lines.map((line) => (
                <tr key={line.subjectId} className="border-b border-[rgba(32,48,80,0.08)]">
                  <td className={`${cell} font-medium text-[var(--brand-deep)]`}>{line.subjectName}</td>
                  {examColumns.map((c) => {
                    const comp = card.components.find((x) => x.examTermId === c.id && x.subjectId === line.subjectId);
                    return (
                      <td key={c.id} className={`${cell} text-right tabular-nums`}>
                        {comp ? `${comp.marksObtained == null ? "—" : comp.marksObtained}/${comp.maxMarks}` : "—"}
                      </td>
                    );
                  })}
                  {!gradesOnly
                    ? partCodes.map((pc) => {
                        const part = line.parts.find((x) => x.code === pc.code);
                        return (
                          <td key={pc.code} className={`${cell} text-right tabular-nums`}>
                            {part
                              ? `${part.marksObtained == null ? "—" : part.marksObtained}/${part.maxMarks}${part.failed ? " *" : ""}`
                              : "—"}
                          </td>
                        );
                      })
                    : null}
                  {!gradesOnly ? <td className={`${cell} text-right tabular-nums`}>{line.maxMarks}</td> : null}
                  {!gradesOnly ? (
                    <td className={`${cell} text-right tabular-nums`}>
                      {line.absent ? "AB" : line.marksObtained == null ? "—" : line.marksObtained}
                    </td>
                  ) : null}
                  <td className={`py-2 font-semibold ${gradesOnly ? "text-left" : "text-right"}`}>
                    {descriptors ? line.gradeLabel || line.grade : gradesOnly && line.gradeLabel ? `${line.grade} · ${line.gradeLabel}` : line.grade}
                  </td>
                  {hasSubjectRemarks ? <td className="py-2 pl-3 text-xs text-[var(--muted)]">{line.remark}</td> : null}
                </tr>
              ))}
            </tbody>
            {showTotals ? (
              <tfoot>
                <tr className="border-t-2 border-[var(--brand-deep)] font-bold">
                  <td className={`${cell}`}>Total</td>
                  {examColumns.map((c) => (
                    <td key={c.id} />
                  ))}
                  {partCodes.map((pc) => (
                    <td key={pc.code} />
                  ))}
                  <td className={`${cell} text-right tabular-nums`}>{card.totalMax}</td>
                  <td className={`${cell} text-right tabular-nums`}>{card.totalObtained}</td>
                  <td className="py-2 text-right">{p.showOverallGrade ? card.overallGrade : ""}</td>
                  {hasSubjectRemarks ? <td /> : null}
                </tr>
              </tfoot>
            ) : null}
          </table>
        )}

        {partCodes.length > 0 && !gradesOnly ? (
          <p className="mt-2 text-[10px] text-[var(--muted)]">
            {partCodes.map((pc) => `${pc.code} = ${pc.label}`).join(" · ")}
            {card.lines.some((l) => l.parts.some((x) => x.failed)) ? " · * below the pass line in that part" : ""}
          </p>
        ) : null}
        {examColumns.length > 0 ? (
          <p className="mt-2 text-[10px] text-[var(--muted)]">
            {[...new Map(card.components.map((c) => [c.examCode, c])).values()]
              .map((c) => `${c.examCode} = ${c.examLabel} (weight ${c.weight})`)
              .join(" · ")}
          </p>
        ) : null}

        {p.showComponents && !termwise && card.aggregateMode !== "none" && card.components.length > 0 && !hpc ? (
          <div className="mt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Component exams ({card.aggregateMode === "hy" ? "Half-yearly" : "Final"} aggregate)
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
                  const sub = card.lines.find((l) => l.subjectId === c.subjectId);
                  return (
                    <tr key={`${c.examTermId}-${c.subjectId}`} className="border-b border-[rgba(32,48,80,0.06)]">
                      <td className="py-1.5 pr-2 font-medium">
                        {c.examCode}
                        {c.requiredOnMarksheet ? "" : " *"}
                      </td>
                      <td className="py-1.5 pr-2 text-[var(--muted)]">{sub?.subjectName ?? "—"}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{c.weight}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{c.maxMarks}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.marksObtained == null ? "—" : c.marksObtained}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className={`mt-4 flex flex-wrap gap-6 ${text}`}>
          {showTotals && p.showPercent ? (
            <div>
              <span className="text-[var(--muted)]">Percentage </span>
              <span className="font-bold text-[var(--brand-deep)]">{card.percent}%</span>
            </div>
          ) : null}
          {showTotals && p.showOverallGrade && card.overallGrade !== "—" ? (
            <div>
              <span className="text-[var(--muted)]">Overall grade </span>
              <span className="font-bold text-[var(--brand-deep)]">{card.overallGrade}</span>
            </div>
          ) : null}
          {card.rank != null ? (
            <div>
              <span className="text-[var(--muted)]">Rank </span>
              <span className="font-bold text-[var(--brand-deep)]">
                {card.rank}
                {card.classSize ? ` of ${card.classSize}` : ""}
              </span>
            </div>
          ) : null}
          {card.classAverage != null ? (
            <div>
              <span className="text-[var(--muted)]">Class average </span>
              <span className="font-bold text-[var(--brand-deep)]">{card.classAverage}%</span>
            </div>
          ) : null}
          {card.result ? (
            <div>
              <span className="text-[var(--muted)]">Result </span>
              <span className="font-bold text-[var(--brand-deep)]">{card.result}</span>
            </div>
          ) : null}
          {p.showAttendance && card.attendance ? (
            <div>
              <span className="text-[var(--muted)]">Attendance </span>
              <span className="font-bold text-[var(--brand-deep)]">
                {card.attendance.presentDays}/{card.attendance.workingDays} ({card.attendance.percent}%)
              </span>
            </div>
          ) : null}
        </div>

        {legend.length > 0 ? (
          <p className="mt-3 text-[10px] text-[var(--muted)]">
            {legend.map(([g, l]) => `${g} = ${l}`).join(" · ")}
          </p>
        ) : null}

        {p.showCoScholastic && card.coScholastic.length > 0 ? (
          <div className={compact ? "mt-3" : "mt-5"}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Co-scholastic areas</p>
            <div className={`mt-2 flex flex-wrap gap-x-6 gap-y-1 ${text}`}>
              {card.coScholastic.map((c) => (
                <div key={c.domain}>
                  <span className="text-[var(--muted)]">{c.domainLabel} </span>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {c.rating ?? "—"}
                    {c.rating ? ` — ${c.ratingLabel}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!hpc ? remarksBlock : null}

        {p.footerNote ? <p className="mt-4 text-[11px] italic text-[var(--muted)]">{p.footerNote}</p> : null}

        {p.showSignatures && p.signatureLabels.length > 0 ? (
          <div
            className={`${compact ? "mt-6" : "mt-10"} grid gap-4 text-center text-[11px] text-[var(--muted)]`}
            style={{ gridTemplateColumns: `repeat(${p.signatureLabels.length}, minmax(0, 1fr))` }}
          >
            {p.signatureLabels.map((l, i) => (
              <div key={`${l}-${i}`} className="border-t border-[rgba(32,48,80,0.25)] pt-2">
                {l}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
