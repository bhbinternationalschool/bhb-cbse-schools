"use client";

import { Fragment } from "react";

/* ratchet-allow: raw_table — printed document: ErpTableShell brings a card shadow, rounded border, hover
 * tint and theme-aware colours, all of which are wrong on paper — a sheet that
 * followed dark mode would print white ink on white stock. */

import { SchoolLetterhead } from "@/components/shared/SchoolLetterhead";
import { reportLinePartsText, type ReportCard } from "@/lib/exams";
import { StudentAvatar } from "@/components/students/StudentAvatar";
import { SignatureOnLine } from "@/components/shared/SignatureOnLine";
import { signatureForLabel, type PrintSignatureSet } from "@/lib/printSignatures";
import {
  schoolCrestUrl,
  schoolIdentity,
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
export function ReportCardSheet({
  card,
  signatures = null,
}: {
  card: ReportCard;
  /** Staff signatures for the signing lines (lib/printSignatures); null = blank lines. */
  signatures?: PrintSignatureSet | null;
}) {
  const p = card.presentation;
  const compact = p.layout === "compact";
  const hpc = p.layout === "hpc";
  const termwise = p.layout === "termwise" && card.aggregateMode !== "none" && card.components.length > 0;
  // What the class's scheme says the card shows: numbers and a grade,
  // a grade alone, or a descriptor. HPC never shows numbers.
  const gradesOnly = hpc || card.displayMode !== "marks_grade";
  const descriptors = hpc || card.displayMode === "descriptors";
  const hasSubjectRemarks = p.showSubjectRemarks && card.lines.some((l) => l.remark.trim());
  // Every part code any subject uses, in first-seen order. Subjects split
  // differently (English Written + Oral, Science Theory + Practical) each
  // fill their own columns and show — in the others'.
  const partCodes =
    p.showComponents && !termwise
      ? [...new Map(card.lines.flatMap((l) => l.parts).map((x) => [x.code, { code: x.code, label: x.label }])).values()]
      : [];
  const showTotals = !gradesOnly && card.totalMax > 0;
  const examColumns = termwise
    ? [...new Map(card.components.map((c) => [c.examTermId, { id: c.examTermId, code: c.examCode }])).values()]
    : [];
  // The legend prints the scheme's full scale (not only the grades this
  // student happened to earn) so a parent can place any grade on it; cards
  // assembled before the band list existed fall back to the used grades.
  const legend: [string, string][] = p.showGradeLegend
    ? card.gradeBands?.length
      ? card.gradeBands.map((b) => [b.grade, b.label])
      : [...new Map(card.lines.filter((l) => l.grade !== "—" && l.grade !== "AB").map((l) => [l.grade, l.gradeLabel])).entries()].filter(
          ([, label]) => label,
        )
    : [];
  // Under each subject: its graded parts (Handwriting: A — never in the
  // total) and, when the card has no part columns, its marks parts.
  const partsLine = (line: ReportCard["lines"][number], includeMarksParts: boolean) =>
    reportLinePartsText(line, { includeMarksParts });
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
  // The playful pre-primary look: rounded pastel frame, decorations and
  // chip section headers. Only ever on an HPC template that asks for it.
  const kids = hpc && p.cardTheme === "kids";
  const headClass = (bg: string) =>
    kids
      ? `inline-block rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--brand-deep)] ${bg}`
      : "text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]";
  // HPC on a Half-yearly / Final aggregate card: one descriptor column per
  // contributing exam (UT1, Half-yearly …), each graded on its own exam.
  const hpcExamColumns =
    hpc && card.aggregateMode !== "none"
      ? [...new Map(card.components.map((c) => [c.examTermId, { id: c.examTermId, label: c.examLabel }])).values()]
      : [];
  // The approved boxed design: bordered identity grid, bordered marks table
  // with per-exam Max/Obt columns and split sub-rows, bordered summary strip
  // and co-scholastic table. Only on templates that ask for it.
  const grid = !hpc && p.gridTables;
  const gridExams =
    grid && card.aggregateMode !== "none" && card.components.length > 0
      ? [...new Map(card.components.map((c) => [c.examTermId, { id: c.examTermId, label: c.examLabel }])).values()]
      : [];
  const gridB = "border border-[rgba(32,48,80,0.35)]";
  const gridTh = `${gridB} bg-[var(--brand-deep)] px-2 py-1 text-left text-[9.5px] font-bold uppercase tracking-wide text-white`;
  const gridThC = `${gridB} bg-[var(--brand-deep)] px-2 py-1 text-center text-[9.5px] font-bold uppercase tracking-wide text-white`;
  const gridTd = `${gridB} px-2 py-[2px]`;
  const sumK = `${gridB} bg-[var(--print-rc-cream)] px-2 py-[3px] text-center text-[9px] font-bold uppercase tracking-wide text-[var(--muted)]`;
  const sumV = `${gridB} px-2 py-[3px] text-center font-bold text-[var(--brand-deep)]`;
  const perExam = gridExams.length > 0 || hpcExamColumns.length > 0;
  // Marks parts of one subject: from the contributing exams' sheets on an
  // aggregate card, else from the card's own sheet.
  const partsForLine = (line: ReportCard["lines"][number]) => {
    if (perExam) {
      const seen = new Map<string, { code: string; label: string }>();
      for (const c of card.components)
        if (c.subjectId === line.subjectId)
          for (const pt of c.parts) if (!seen.has(pt.code)) seen.set(pt.code, { code: pt.code, label: pt.label });
      return [...seen.values()];
    }
    return line.parts.map((pt) => ({ code: pt.code, label: pt.label }));
  };
  const gradedForLine = (line: ReportCard["lines"][number]) => {
    if (perExam) {
      const seen = new Map<string, { code: string; label: string }>();
      for (const c of card.components)
        if (c.subjectId === line.subjectId)
          for (const g of c.gradedParts) if (!seen.has(g.code)) seen.set(g.code, { code: g.code, label: g.label });
      return [...seen.values()];
    }
    return (line.gradedParts ?? []).map((g) => ({ code: g.code, label: g.label }));
  };
  const gridHasParts = card.lines.some((l) => partsForLine(l).length > 0 || gradedForLine(l).length > 0);
  // Rank: the template can cap it to a topper list (top 3), without "of N".
  const rankShown = card.rank != null && (p.rankTopOnly == null || card.rank <= p.rankTopOnly);
  // Watermark: existing templates keep the classic centered initials they
  // have always printed — masters brand settings never restyle a card whose
  // template did not ask for it (the saved "tile school display name"
  // option drives the PDF page background, not the HTML card). A template
  // that asks for the tiled watermark prints the saved masters watermark
  // image centered when one exists, as the PDF background does; otherwise
  // the school name tiles in horizontal rows over a faint crest.
  const brand = p.watermarkStyle === "tile" ? schoolIdentity() : null;
  const masterWatermarkImage = brand?.watermarkUrl?.trim() ? brand.watermarkUrl.trim() : null;
  const tileWatermark = p.watermarkStyle === "tile" && !masterWatermarkImage;
  // Bordered identity grid (grid classic and kids HPC): the fields the
  // template asks for, paired two per row; attendance lives here on these
  // designs instead of the summary strip.
  const idFields: { label: string; value: React.ReactNode }[] = [];
  idFields.push({ label: "Student", value: st.fullName });
  idFields.push({
    label: "Class",
    value: `${card.classLabel}${p.showRollNo && st.rollNo ? ` · Roll ${st.rollNo}` : ""}`,
  });
  if (p.showAdmissionNo) idFields.push({ label: "Admission no.", value: st.admissionNo });
  if (p.showDob && st.dob) idFields.push({ label: "Date of birth", value: fmtDob(st.dob) });
  if (p.showParents)
    idFields.push({
      label: "Father / Mother",
      value: `${st.fatherName || "—"}${st.motherName ? ` / ${st.motherName}` : ""}`,
    });
  if (health.length > 0) idFields.push({ label: "Health", value: health.join(" · ") });
  if (p.showAttendance && card.attendance)
    idFields.push({
      label: "Attendance",
      value: `${card.attendance.presentDays}/${card.attendance.workingDays} (${card.attendance.percent}%)`,
    });
  const idRows: { label: string; value: React.ReactNode }[][] = [];
  for (let i = 0; i < idFields.length; i += 2) idRows.push(idFields.slice(i, i + 2));

  const remarksBlock =
    p.showRemarks && card.overallRemark ? (
      <div className={compact || kids || grid ? "mt-2" : "mt-5"}>
        <p className={headClass("bg-[var(--print-rc-mint)]")}>Class teacher&apos;s remarks</p>
        {card.overallRemark.text ? (
          <p className={`${kids || grid ? "mt-1" : "mt-1.5"} ${grid ? "leading-snug" : "leading-relaxed"} text-[var(--brand-deep)] ${grid ? "text-xs" : text}`}>{card.overallRemark.text}</p>
        ) : null}
        {card.overallRemark.textHi ? (
          <p className={`${kids || grid ? "mt-1" : "mt-1.5"} ${grid ? "leading-snug" : "leading-relaxed"} text-[var(--brand-deep)] ${grid ? "text-xs" : text}`} lang="hi">
            {card.overallRemark.textHi}
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <div
      id={`report-card-${card.student.id}-${card.examTerm.id}`}
      className={`certificate-sheet relative overflow-hidden bg-white ${
        kids
          ? "certificate-kids rounded-3xl border-2 border-[var(--print-rc-kids-sky)]"
          : "rounded-xl border border-[rgba(32,48,80,0.18)]"
      }`}
    >
      {p.showWatermark ? (
        masterWatermarkImage ? (
          <div className="certificate-watermark pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- saved masters watermark */}
            <img src={masterWatermarkImage} alt="" className="max-h-[45%] max-w-[45%] object-contain opacity-[0.12]" />
          </div>
        ) : tileWatermark ? (
          <div className="certificate-watermark pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 flex flex-col justify-between py-3">
              {Array.from({ length: 14 }).map((_, i) => (
                <div
                  key={i}
                  className="select-none whitespace-nowrap text-center text-[13px] font-extrabold uppercase tracking-[0.3em] text-[rgba(32,48,80,0.045)]"
                >
                  {`${schoolPrintName()}\u00A0\u00A0·\u00A0\u00A0${schoolPrintName()}\u00A0\u00A0·\u00A0\u00A0${schoolPrintName()}`}
                </div>
              ))}
            </div>
            {/* The crest sits in the first printed page's centre so a long
                card never slices it across a page break; the name rows tile
                down the whole sheet. */}
            <div className="absolute inset-x-0 top-0 flex h-[297mm] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- print watermark, not content */}
              <img src={schoolCrestUrl()} alt="" className="h-52 w-52 object-contain opacity-[0.06]" />
            </div>
          </div>
        ) : (
          <div className="certificate-watermark pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="select-none text-5xl font-bold uppercase tracking-[0.2em] text-[rgba(32,48,80,0.06)] sm:text-6xl">
              {schoolShortName()}
            </span>
          </div>
        )
      ) : null}
      {kids ? (
        <>
          <div className="pointer-events-none absolute inset-2 rounded-2xl border border-dashed border-[var(--print-rc-kids-dash)]" />
          <svg className="pointer-events-none absolute left-4 top-4 h-9 w-14" viewBox="0 0 70 42" aria-hidden="true">
            <g fill="#dceffb" stroke="#8fc8e8" strokeWidth="2">
              <ellipse cx="24" cy="28" rx="16" ry="11" />
              <ellipse cx="42" cy="24" rx="14" ry="12" />
              <ellipse cx="54" cy="30" rx="11" ry="8" />
            </g>
          </svg>
          <svg className="pointer-events-none absolute right-4 top-4 h-12 w-12" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="10" fill="#f6c86e" stroke="#e0a83e" strokeWidth="2" />
            <g stroke="#e0a83e" strokeWidth="2" strokeLinecap="round">
              <path d="M24 4v7M24 37v7M4 24h7M37 24h7M10 10l5 5M33 33l5 5M38 10l-5 5M15 33l-5 5" />
            </g>
          </svg>
          <svg className="pointer-events-none absolute bottom-1 right-1 h-14 w-9" viewBox="0 0 70 120" aria-hidden="true">
            <ellipse cx="20" cy="26" rx="13" ry="16" fill="#ff9db8" stroke="#e06a8e" strokeWidth="1.5" />
            <path d="M20 42 q-4 20 2 40" stroke="#e06a8e" strokeWidth="1.5" fill="none" />
            <ellipse cx="48" cy="18" rx="12" ry="15" fill="#8fd3a9" stroke="#57a877" strokeWidth="1.5" />
            <path d="M48 33 q6 22 0 46" stroke="#57a877" strokeWidth="1.5" fill="none" />
            <ellipse cx="36" cy="52" rx="11" ry="14" fill="#8fc8e8" stroke="#5b9cc4" strokeWidth="1.5" />
            <path d="M36 66 q-3 16 2 30" stroke="#5b9cc4" strokeWidth="1.5" fill="none" />
          </svg>
          <svg className="pointer-events-none absolute bottom-1 left-1 h-9 w-14" viewBox="0 0 120 66" aria-hidden="true">
            <g fill="none" strokeWidth="7">
              <path d="M10 62 A50 50 0 0 1 110 62" stroke="#f28b8b" />
              <path d="M17 62 A43 43 0 0 1 103 62" stroke="#f6c86e" />
              <path d="M24 62 A36 36 0 0 1 96 62" stroke="#f7e07a" />
              <path d="M31 62 A29 29 0 0 1 89 62" stroke="#9ed6a4" />
              <path d="M38 62 A22 22 0 0 1 82 62" stroke="#8fc8e8" />
            </g>
            <ellipse cx="14" cy="60" rx="13" ry="8" fill="#fff" stroke="#cfe0ee" strokeWidth="1.5" />
            <ellipse cx="106" cy="60" rx="13" ry="8" fill="#fff" stroke="#cfe0ee" strokeWidth="1.5" />
          </svg>
        </>
      ) : null}

      <div className={`certificate-inner relative ${compact ? "px-4 py-4 sm:px-6 sm:py-5" : grid ? "px-5 py-3 sm:px-7 sm:py-4" : kids ? "px-5 py-2 sm:px-7 sm:py-3" : "px-5 py-6 sm:px-8 sm:py-8"}`}>
        <SchoolLetterhead size={compact ? "sm" : "md"} nameSans={kids || grid} />
        <header className={`border-b-2 border-[var(--brand-gold)] ${grid ? "pb-2" : "pb-3"} text-center`}>
          {schoolStatutoryLine() ? (
            <p className="mt-1 text-[10px] text-[var(--muted)]">{schoolStatutoryLine()}</p>
          ) : null}
          <h1 className={`${grid ? "mt-2" : "mt-3"} font-bold uppercase tracking-wide text-[var(--brand-deep)] ${compact || grid ? "text-base" : "text-lg"}`}>
            {p.title}
          </h1>
          {p.subtitle ? <p className="mt-0.5 text-xs text-[var(--muted)]">{p.subtitle}</p> : null}
          <p className={`${grid ? "mt-0.5 text-xs" : "mt-1 text-sm"} text-[var(--muted)]`}>
            {grid || kids ? (
              <>
                <span className="rounded bg-[rgba(197,160,40,0.16)] px-1.5 py-0.5 font-bold text-[var(--brand-deep)]">
                  {card.examTerm.label}
                  {card.aggregateMode !== "none" ? " (weighted aggregate)" : ""}
                </span>
                {` · Session ${card.academicYearCode}`}
              </>
            ) : (
              <>
                {card.examTerm.label}
                {card.aggregateMode !== "none" ? " (weighted aggregate)" : ""} · Session {card.academicYearCode}
              </>
            )}
          </p>
        </header>

        {grid || kids ? (
          <div className={`${grid ? "mt-3" : "mt-4"} flex gap-4 ${grid ? "text-[11px]" : text}`}>
            <table className="flex-1 border-collapse">
              <tbody>
                {idRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((f, fi) => (
                      <Fragment key={fi}>
                        <td
                          className={`${gridB} bg-[var(--print-rc-cream)] px-2 ${grid ? "py-[2px]" : "py-1"} text-[9px] font-bold uppercase tracking-wide text-[var(--muted)]`}
                          style={{ width: "16%" }}
                        >
                          {f.label}
                        </td>
                        <td
                          className={`${gridB} px-2 ${grid ? "py-[2px]" : "py-1"} font-semibold text-[var(--brand-deep)]`}
                          colSpan={row.length === 1 ? 3 : 1}
                          style={row.length === 1 ? undefined : { width: "34%" }}
                        >
                          {f.value}
                        </td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {p.showPhoto ? (
              <div className="shrink-0">
                <StudentAvatar student={st} size={compact ? 56 : 80} />
              </div>
            ) : null}
          </div>
        ) : (
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
        )}

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

        {hpc && p.remarksPosition === "first" ? remarksBlock : null}

        {hpc ? (
          <div className={kids ? "mt-2" : "mt-5"}>
            <p className={headClass("bg-[var(--print-rc-sky-bg)]")}>Learning areas</p>
            {hpcExamColumns.length > 0 ? (
              <table className={`mt-2 w-full ${text} ${kids ? "border-separate border-spacing-0 overflow-hidden rounded-xl border-[1.5px] border-[var(--print-rc-kids-sky)]" : "border-collapse"}`}>
                <thead>
                  <tr className={kids ? "" : "border-b border-[rgba(32,48,80,0.2)] text-left text-[10px] uppercase tracking-wide text-[var(--muted)]"}>
                    <th className={kids ? "border-b border-r border-[var(--print-rc-kids-sky-soft)] bg-[var(--brand-deep)] px-2 py-[2px] text-left text-[9.5px] font-bold uppercase tracking-wide text-white" : cell}>Learning area</th>
                    {hpcExamColumns.map((c) => (
                      <th key={c.id} className={kids ? "border-b border-r border-[var(--print-rc-kids-sky-soft)] bg-[var(--brand-deep)] px-2 py-[2px] text-center text-[9.5px] font-bold uppercase tracking-wide text-white last:border-r-0" : `${cell} text-center`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {card.lines.map((line, li) => (
                    <Fragment key={line.subjectId}>
                      <tr className={kids ? (li % 2 === 1 ? "bg-[var(--print-rc-sky-row)]" : "") : "border-b border-[rgba(32,48,80,0.08)]"}>
                        <td className={kids ? "border-b border-r border-[var(--print-rc-kids-sky-soft)] px-2 py-[2px] font-bold text-[var(--brand-deep)]" : `${cell} font-medium text-[var(--brand-deep)]`}>
                          {line.subjectName}
                          <span className="block text-[10px] font-normal text-[var(--muted)]">
                            {partsForLine(line).map((pt) => pt.label).join(" · ")}
                          </span>
                        </td>
                        {hpcExamColumns.map((c) => {
                          const comp = card.components.find((x) => x.examTermId === c.id && x.subjectId === line.subjectId);
                          return (
                            <td key={c.id} className={kids ? "border-b border-r border-[var(--print-rc-kids-sky-soft)] px-2 py-[2px] text-center last:border-r-0" : `${cell} text-center`}>
                              {comp ? (
                                <>
                                  <span className="font-bold text-[var(--brand-deep)]">{comp.grade}</span>
                                  {comp.gradeLabel ? (
                                    <span className="block text-[10px] font-normal text-[var(--muted)]">{comp.gradeLabel}</span>
                                  ) : null}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {gradedForLine(line).map((g) => (
                        <tr key={g.code} className={kids ? "bg-[var(--print-rc-parchment)]" : "border-b border-[rgba(32,48,80,0.08)]"}>
                          <td className={kids ? "border-b border-r border-[var(--print-rc-kids-sky-soft)] px-2 py-[2px] pl-5 text-[var(--print-rc-kids-ink)]" : `${cell} pl-5 text-[var(--muted)]`}>&#8627; {g.label} (graded)</td>
                          {hpcExamColumns.map((c) => {
                            const cg = card.components
                              .find((x) => x.examTermId === c.id && x.subjectId === line.subjectId)
                              ?.gradedParts.find((y) => y.code === g.code);
                            return (
                              <td key={c.id} className={kids ? "border-b border-r border-[var(--print-rc-kids-sky-soft)] px-2 py-[2px] text-center font-semibold last:border-r-0" : `${cell} text-center font-semibold`}>
                                {cg?.grade ?? "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ) : (
            <ul className={`mt-2 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 ${text}`}>
              {card.lines.map((line) => (
                <li key={line.subjectId} className="flex items-baseline justify-between gap-3 border-b border-[rgba(32,48,80,0.08)] py-1">
                  <span className="font-medium text-[var(--brand-deep)]">
                    {line.subjectName}
                    {partsLine(line, false) ? (
                      <span className="block text-[10px] font-normal text-[var(--muted)]">{partsLine(line, false)}</span>
                    ) : null}
                  </span>
                  <span className="text-right font-semibold">
                    {line.absent ? "AB" : line.gradeLabel || line.grade}
                    {!line.absent && line.gradeLabel && line.grade !== "—" ? (
                      <span className="ml-1 font-normal text-[var(--muted)]">({line.grade})</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            )}
            <p className="mt-2 text-[10px] text-[var(--muted)]">
              No marks, percentage or rank are shown at this stage. Graded parts (e.g. Rhymes) are shown as a grade only.
            </p>
          </div>
        ) : grid ? (
          <table className={`mt-2 w-full border-collapse ${grid ? "text-[10.5px]" : text}`}>
            <thead>
              {gridExams.length > 0 ? (
                <>
                  <tr>
                    <th rowSpan={2} className={gridTh}>Subject</th>
                    {gridExams.map((c) => (
                      <th key={c.id} colSpan={2} className={gridThC}>
                        {c.label}
                      </th>
                    ))}
                    <th rowSpan={2} className={gridThC}>
                      Weighted total ({card.lines[0]?.maxMarks ?? 100})
                    </th>
                    <th rowSpan={2} className={gridThC}>Grade</th>
                  </tr>
                  <tr>
                    {gridExams.map((c) => (
                      <Fragment key={c.id}>
                        <th className={`${gridThC} !bg-[var(--muted)]`}>Max</th>
                        <th className={`${gridThC} !bg-[var(--muted)]`}>Obt.</th>
                      </Fragment>
                    ))}
                  </tr>
                </>
              ) : (
                <tr>
                  <th className={gridTh}>Subject</th>
                  {!gradesOnly ? <th className={`${gridThC}`}>Max</th> : null}
                  {!gradesOnly ? <th className={`${gridThC}`}>Obtained</th> : null}
                  <th className={gridThC}>{descriptors ? "Assessment" : "Grade"}</th>
                </tr>
              )}
            </thead>
            <tbody>
              {card.lines.map((line) => (
                <Fragment key={line.subjectId}>
                  <tr>
                    <td className={`${gridTd} font-semibold text-[var(--brand-deep)]`}>{line.subjectName}</td>
                    {gridExams.length > 0 ? (
                      <>
                        {gridExams.map((c) => {
                          const comp = card.components.find((x) => x.examTermId === c.id && x.subjectId === line.subjectId);
                          return (
                            <Fragment key={c.id}>
                              <td className={`${gridTd} text-center tabular-nums`}>{comp ? comp.maxMarks : "—"}</td>
                              <td className={`${gridTd} text-center tabular-nums`}>
                                {comp ? (comp.marksObtained == null ? "—" : comp.marksObtained) : "—"}
                              </td>
                            </Fragment>
                          );
                        })}
                        <td className={`${gridTd} text-center font-bold tabular-nums`}>
                          {line.absent ? "AB" : line.marksObtained == null ? "—" : line.marksObtained}
                        </td>
                        <td className={`${gridTd} text-center font-bold`}>{line.grade}</td>
                      </>
                    ) : (
                      <>
                        {!gradesOnly ? <td className={`${gridTd} text-right tabular-nums`}>{line.maxMarks}</td> : null}
                        {!gradesOnly ? (
                          <td className={`${gridTd} text-right tabular-nums`}>
                            {line.absent ? "AB" : line.marksObtained == null ? "—" : line.marksObtained}
                          </td>
                        ) : null}
                        <td className={`${gridTd} text-right font-semibold`}>
                          {descriptors ? line.gradeLabel || line.grade : gradesOnly && line.gradeLabel ? `${line.grade} · ${line.gradeLabel}` : line.grade}
                        </td>
                      </>
                    )}
                  </tr>
                  {partsForLine(line).map((pt) => (
                    <tr key={pt.code} className="bg-[var(--print-rc-cream-soft)]">
                      <td className={`${gridTd} pl-5 text-[var(--muted)]`}>&#8627; {pt.label}</td>
                      {gridExams.length > 0 ? (
                        <>
                          {gridExams.map((c) => {
                            const cp = card.components
                              .find((x) => x.examTermId === c.id && x.subjectId === line.subjectId)
                              ?.parts.find((y) => y.code === pt.code);
                            return (
                              <Fragment key={c.id}>
                                <td className={`${gridTd} text-center tabular-nums text-[var(--muted)]`}>{cp ? cp.maxMarks : "·"}</td>
                                <td className={`${gridTd} text-center tabular-nums`}>
                                  {cp ? (cp.marksObtained == null ? "—" : cp.marksObtained) : "·"}
                                </td>
                              </Fragment>
                            );
                          })}
                          <td className={`${gridTd} text-center text-[var(--muted)]`}>·</td>
                          <td className={`${gridTd} text-center text-[var(--muted)]`}>·</td>
                        </>
                      ) : (
                        <>
                          {(() => {
                            const lp = line.parts.find((y) => y.code === pt.code);
                            return (
                              <>
                                {!gradesOnly ? (
                                  <td className={`${gridTd} text-right tabular-nums text-[var(--muted)]`}>{lp ? lp.maxMarks : "·"}</td>
                                ) : null}
                                {!gradesOnly ? (
                                  <td className={`${gridTd} text-right tabular-nums`}>
                                    {lp ? (lp.marksObtained == null ? "—" : lp.marksObtained) : "·"}
                                  </td>
                                ) : null}
                                <td className={`${gridTd} text-right text-[var(--muted)]`}>·</td>
                              </>
                            );
                          })()}
                        </>
                      )}
                    </tr>
                  ))}
                  {gradedForLine(line).map((g) => (
                    <tr key={g.code} className="bg-[var(--print-rc-cream-soft)]">
                      <td className={`${gridTd} pl-5 text-[var(--muted)]`}>&#8627; {g.label} (graded)</td>
                      {gridExams.length > 0 ? (
                        <>
                          {gridExams.map((c) => {
                            const cg = card.components
                              .find((x) => x.examTermId === c.id && x.subjectId === line.subjectId)
                              ?.gradedParts.find((y) => y.code === g.code);
                            return (
                              <Fragment key={c.id}>
                                <td className={`${gridTd} text-center text-[var(--muted)]`}>·</td>
                                <td className={`${gridTd} text-center font-semibold`}>{cg?.grade ?? "—"}</td>
                              </Fragment>
                            );
                          })}
                          <td className={`${gridTd} text-center text-[var(--muted)]`}>·</td>
                          <td className={`${gridTd} text-center font-semibold`}>
                            {line.gradedParts?.find((y) => y.code === g.code)?.grade ?? "—"}
                          </td>
                        </>
                      ) : (
                        <>
                          {!gradesOnly ? <td className={`${gridTd} text-right text-[var(--muted)]`}>·</td> : null}
                          {!gradesOnly ? <td className={`${gridTd} text-right text-[var(--muted)]`}>·</td> : null}
                          <td className={`${gridTd} text-right font-semibold`}>
                            {line.gradedParts?.find((y) => y.code === g.code)?.grade ?? "—"}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {showTotals ? (
              <tfoot>
                <tr className="bg-[var(--print-rc-cream)] font-bold">
                  <td className={gridTd}>Total</td>
                  {gridExams.length > 0 ? (
                    <>
                      {gridExams.map((c) => (
                        <Fragment key={c.id}>
                          <td className={gridTd} />
                          <td className={gridTd} />
                        </Fragment>
                      ))}
                      <td className={`${gridTd} text-center tabular-nums`}>{card.totalObtained}</td>
                      <td className={`${gridTd} text-center`}>{p.showOverallGrade ? card.overallGrade : ""}</td>
                    </>
                  ) : (
                    <>
                      {!gradesOnly ? <td className={`${gridTd} text-right tabular-nums`}>{card.totalMax}</td> : null}
                      {!gradesOnly ? <td className={`${gridTd} text-right tabular-nums`}>{card.totalObtained}</td> : null}
                      <td className={`${gridTd} text-right`}>{p.showOverallGrade ? card.overallGrade : ""}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            ) : null}
          </table>
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
                  <td className={`${cell} font-medium text-[var(--brand-deep)]`}>
                    {line.subjectName}
                    {partsLine(line, !gradesOnly && partCodes.length === 0) ? (
                      <span className="block text-[10px] font-normal text-[var(--muted)]">
                        {partsLine(line, !gradesOnly && partCodes.length === 0)}
                      </span>
                    ) : null}
                  </td>
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
        {!grid && !gradesOnly && card.lines.some((l) => (l.gradedParts ?? []).length > 0) ? (
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            Graded parts (e.g. {card.lines.flatMap((l) => l.gradedParts ?? [])[0]?.label}) are shown as grades and are not counted in the marks or the total.
          </p>
        ) : null}
        {examColumns.length > 0 ? (
          <p className="mt-2 text-[10px] text-[var(--muted)]">
            {[...new Map(card.components.map((c) => [c.examCode, c])).values()]
              .map((c) => `${c.examCode} = ${c.examLabel} (weight ${c.weight})`)
              .join(" · ")}
          </p>
        ) : null}

        {p.showComponents && !termwise && !grid && card.aggregateMode !== "none" && card.components.length > 0 && !hpc ? (
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

        {grid ? (
          <table className="mt-2 w-full border-collapse text-xs break-inside-avoid">
            <tbody>
              <tr>
                {showTotals && p.showPercent ? (
                  <>
                    <td className={sumK}>Percentage</td>
                    <td className={sumV}>{card.percent}%</td>
                  </>
                ) : null}
                {showTotals && p.showOverallGrade && card.overallGrade !== "—" ? (
                  <>
                    <td className={sumK}>Overall grade</td>
                    <td className={sumV}>{card.overallGrade}</td>
                  </>
                ) : null}
                {rankShown ? (
                  <>
                    <td className={sumK}>Rank</td>
                    <td className={sumV}>
                      {card.rank}
                      {p.rankTopOnly == null && card.classSize ? ` of ${card.classSize}` : ""}
                    </td>
                  </>
                ) : null}
                {card.classAverage != null ? (
                  <>
                    <td className={sumK}>Class average</td>
                    <td className={sumV}>{card.classAverage}%</td>
                  </>
                ) : null}
                {card.result ? (
                  <>
                    <td className={sumK}>Result</td>
                    <td className={sumV}>{card.result}</td>
                  </>
                ) : null}
              </tr>
            </tbody>
          </table>
        ) : (
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
          {rankShown ? (
            <div>
              <span className="text-[var(--muted)]">Rank </span>
              <span className="font-bold text-[var(--brand-deep)]">
                {card.rank}
                {p.rankTopOnly == null && card.classSize ? ` of ${card.classSize}` : ""}
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
          {p.showAttendance && card.attendance && !kids ? (
            <div>
              <span className="text-[var(--muted)]">Attendance </span>
              <span className="font-bold text-[var(--brand-deep)]">
                {card.attendance.presentDays}/{card.attendance.workingDays} ({card.attendance.percent}%)
              </span>
            </div>
          ) : null}
        </div>
        )}
        {p.rankTopOnly != null && rankShown ? (
          <p className="mt-1 text-[10px] text-[var(--muted)]">Rank is shown only for the top {p.rankTopOnly} students of the class.</p>
        ) : null}
        {grid && gridHasParts ? (
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            Split subjects show their parts below the subject row; part marks add up to the subject total. Graded parts (e.g. Handwriting) carry a grade only and are not counted in marks, total or rank.
          </p>
        ) : null}

        {legend.length > 0 ? (
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            {legend.map(([g, l]) => `${g} = ${l}`).join(" · ")}
          </p>
        ) : null}

        {p.showCoScholastic && card.coScholastic.length > 0 ? (
          kids || grid ? (
            <div className={`${compact || kids ? "mt-2" : grid ? "mt-2" : "mt-5"} break-inside-avoid`}>
              <p className={headClass("bg-[var(--print-rc-kids-rose-bg)]")}>Co-scholastic areas</p>
              <table className={`mt-2 w-full ${grid ? "text-[11px]" : text} ${kids ? "border-separate border-spacing-0 overflow-hidden rounded-xl border-[1.5px] border-[var(--print-rc-kids-pink)]" : "border-collapse"}`}>
                <thead>
                  <tr>
                    <th className={kids ? "border-b border-r border-[var(--print-rc-kids-pink-soft)] bg-[var(--print-rc-kids-pink-bg)] px-2 py-[2px] text-left text-[9px] font-bold uppercase tracking-[0.06em] text-[var(--print-rc-kids-rose)]" : gridTh}>Area</th>
                    {(kids && card.coScholasticByExam?.length
                      ? card.coScholasticByExam
                      : [{ examTermId: card.examTerm.id, examLabel: kids ? card.examTerm.label : "Grade", ratings: card.coScholastic }]
                    ).map((x) => (
                      <th key={x.examTermId} className={kids ? "border-b border-[var(--print-rc-kids-pink-soft)] bg-[var(--print-rc-kids-pink-bg)] px-2 py-[2px] text-center text-[9px] font-bold uppercase tracking-[0.06em] text-[var(--print-rc-kids-rose)]" : gridThC}>
                        {x.examLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {card.coScholastic.map((cs) => (
                    <tr key={cs.domain}>
                      <td className={kids ? "border-b border-r border-[var(--print-rc-kids-pink-soft)] px-2 py-[2px] font-semibold text-[var(--brand-deep)]" : `${gridTd} font-medium text-[var(--brand-deep)]`}>{cs.domainLabel}</td>
                      {(kids && card.coScholasticByExam?.length
                        ? card.coScholasticByExam
                        : [{ examTermId: card.examTerm.id, examLabel: card.examTerm.label, ratings: card.coScholastic }]
                      ).map((x) => {
                        const r = x.ratings.find((y) => y.domain === cs.domain);
                        return (
                          <td key={x.examTermId} className={kids ? "border-b border-[var(--print-rc-kids-pink-soft)] px-2 py-[2px] text-center font-semibold" : `${gridTd} text-center font-semibold`}>
                            {r?.rating ?? "—"}
                            {!kids && r?.rating && r.ratingLabel ? ` — ${r.ratingLabel}` : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
          <div className={compact ? "mt-3" : "mt-5"}>
            <p className={headClass("bg-[var(--print-rc-kids-rose-bg)]")}>Co-scholastic areas</p>
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
          )
        ) : null}

        {!hpc || p.remarksPosition === "after_tables" ? remarksBlock : null}

        {p.footerNote ? <p className={`${kids ? "mt-1" : "mt-4"} text-[11px] italic text-[var(--muted)]`}>{p.footerNote}</p> : null}

        {p.showSignatures && p.signatureLabels.length > 0 ? (
          <div
            className={`${compact ? "mt-6" : grid || kids ? "mt-2" : "mt-10"} grid gap-4 break-inside-avoid text-center text-[11px] text-[var(--muted)]`}
            style={{ gridTemplateColumns: `repeat(${p.signatureLabels.length}, minmax(0, 1fr))` }}
          >
            {p.signatureLabels.map((l, i) => (
              <div key={`${l}-${i}`} className="flex flex-col justify-end">
                <SignatureOnLine sig={signatureForLabel(l, signatures)} heightClass={grid || kids ? "h-8" : "h-10"} />
                <div className="border-t border-[rgba(32,48,80,0.25)] pt-2">{l}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
