"use client";

/* ratchet-allow: raw_table — printed document: ErpTableShell brings a card shadow, rounded border, hover
 * tint and theme-aware colours, all of which are wrong on paper — a sheet that
 * followed dark mode would print white ink on white stock. */

import {
  promotionDecisionLabel,
  type ClassResultSheet,
} from "@/lib/exams";
import {
  schoolAddressLine,
  schoolPrintName,
  schoolShortName,
  schoolStatutoryLine,
} from "@/lib/schoolIdentity";

export function printClassResultSheet(sheetId: string) {
  const sheet = document.getElementById(sheetId);
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

export function ClassResultSheetView({
  sheet,
}: {
  sheet: ClassResultSheet;
}) {
  const sheetId = `class-result-${sheet.examTerm.id}-${sheet.sectionId}`;
  const subjects =
    sheet.rows.find((r) => r.card)?.card?.lines.map((l) => ({
      id: l.subjectId,
      name: l.subjectName,
    })) ?? [];

  return (
    <div
      id={sheetId}
      className="certificate-sheet relative overflow-hidden rounded-xl border border-[rgba(32,48,80,0.18)] bg-white"
    >
      <div className="certificate-watermark pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="select-none text-5xl font-bold uppercase tracking-[0.2em] text-[rgba(32,48,80,0.06)] sm:text-6xl">
          {schoolShortName()}
        </span>
      </div>

      <div className="certificate-inner relative px-4 py-5 sm:px-6 sm:py-7">
        <header className="border-b-2 border-[var(--brand-gold)] pb-3 text-center">
          <p className="font-brand-name text-sm tracking-[0.12em] text-[var(--brand-deep)] sm:text-base">
            {schoolPrintName()}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {[schoolAddressLine(), schoolStatutoryLine()]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <h1 className="mt-3 text-lg font-bold uppercase tracking-wide text-[var(--brand-deep)]">
            Class result sheet
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {sheet.examTerm.label}
            {sheet.rows.some((r) => r.card?.aggregateMode !== "none")
              ? " (weighted aggregate)"
              : ""}{" "}
            · {sheet.classLabel} · Session {sheet.academicYearCode}
          </p>
        </header>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
          <span>
            Strength{" "}
            <strong className="text-[var(--brand-deep)]">
              {sheet.summary.total}
            </strong>
          </span>
          <span>
            With marks{" "}
            <strong className="text-[var(--brand-deep)]">
              {sheet.summary.withMarks}
            </strong>
          </span>
          <span>
            Pass{" "}
            <strong className="text-[var(--brand-deep)]">
              {sheet.summary.passed}
            </strong>
          </span>
          <span>
            Fail{" "}
            <strong className="text-[var(--brand-deep)]">
              {sheet.summary.failed}
            </strong>
          </span>
          <span>
            Promoted {sheet.summary.promoted} · Detained{" "}
            {sheet.summary.detained} · Conditional{" "}
            {sheet.summary.conditional}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[11px] sm:text-xs">
            <thead>
              <tr className="border-b border-[rgba(32,48,80,0.2)] text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Student</th>
                {subjects.map((s) => (
                  <th key={s.id} className="py-2 px-1 text-right">
                    {s.name.length > 8 ? s.name.slice(0, 6) + "…" : s.name}
                  </th>
                ))}
                <th className="py-2 px-1 text-right">%</th>
                <th className="py-2 px-1 text-right">Gr</th>
                <th className="py-2 px-1">Result</th>
                <th className="py-2 pl-1">Decision</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, i) => {
                const decision =
                  row.record?.decision ??
                  (row.card ? row.suggested : "pending");
                return (
                  <tr
                    key={row.student.id}
                    className="border-b border-[rgba(32,48,80,0.08)]"
                  >
                    <td className="py-1.5 pr-2 tabular-nums text-[var(--muted)]">
                      {row.student.rollNo || i + 1}
                    </td>
                    <td className="py-1.5 pr-2 font-medium text-[var(--brand-deep)]">
                      {row.student.fullName}
                      <div className="text-[10px] font-normal text-[var(--muted)]">
                        {row.student.admissionNo}
                      </div>
                    </td>
                    {subjects.map((s) => {
                      const line = row.card?.lines.find(
                        (l) => l.subjectId === s.id,
                      );
                      return (
                        <td
                          key={s.id}
                          className="py-1.5 px-1 text-right tabular-nums"
                        >
                          {line?.marksObtained == null
                            ? "—"
                            : line.marksObtained}
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-1 text-right tabular-nums font-semibold">
                      {row.card ? `${row.card.percent}` : "—"}
                    </td>
                    <td className="py-1.5 px-1 text-right font-semibold">
                      {row.card?.overallGrade ?? "—"}
                    </td>
                    <td className="py-1.5 px-1">
                      {row.error ? (
                        <span className="text-[var(--muted)]">N/A</span>
                      ) : row.passed ? (
                        <span className="font-semibold text-[#15803d]">
                          Pass
                        </span>
                      ) : (
                        <span className="font-semibold text-[#b45309]">
                          Fail
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pl-1 font-medium">
                      {promotionDecisionLabel(decision)}
                      {row.record?.decision === "promoted" &&
                      row.nextClass ? (
                        <span className="block text-[10px] font-normal text-[var(--muted)]">
                          → {row.nextClass.name}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
