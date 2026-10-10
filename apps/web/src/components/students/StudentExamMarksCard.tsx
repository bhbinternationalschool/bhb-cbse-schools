"use client";

// ratchet-allow: raw_table — a detail table inside one child's record, see
// StudentAttendanceCard: a compact card table, not a roster.
// ratchet-allow: grids_without_row_menu — one child's marks term by term, built
// from buildReportCard. A row is a subject's score; marks are entered in Exams,
// against the class marksheet.

/**
 * This child's marks, term by term, on the child's own page.
 *
 * The marks were only ever visible inside Exams → marksheets, one term and
 * one class at a time. The people who need one child's row — a teacher
 * writing a PTM remark, the office answering "how is my son doing", the
 * principal signing a transfer certificate — were all opening a class sheet
 * and reading across it.
 *
 * Built from `buildReportCard`, the same function the marksheet and the
 * printed report card use, so the profile cannot drift from the document
 * the parent is handed.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GraduationCap, Lock } from "lucide-react";
import {
  buildReportCard,
  listAllExamTerms,
  loadExams,
  type ReportCard,
} from "@/lib/exams";
import { loadMasters } from "@/lib/masters";
import { classLabelForStudent } from "@/lib/parentPortal";
import { loadSis, normalizeStudent, type SisStudent } from "@/lib/sis";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; student: SisStudent; cards: ReportCard[] }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export function StudentExamMarksCard({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [openTerms, setOpenTerms] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        const { ensureExamsHydrated } = await import("@/lib/examsPersistence");
        const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
        await Promise.all([
          withHydrationSlot(() => ensureSisHydrated()),
          withHydrationSlot(() => ensureExamsHydrated()),
        ]);
        if (!alive) return;
        const raw = loadSis().students.find((s) => s.id === studentId);
        if (!raw) {
          setLoad({ kind: "missing" });
          return;
        }
        const student = normalizeStudent(raw);
        const masters = loadMasters();
        const ay = student.academicYearCode || "";
        const classLabel = classLabelForStudent(student, masters);
        const cards: ReportCard[] = [];
        for (const term of listAllExamTerms(ay, loadExams())) {
          const rc = buildReportCard({
            student,
            classLabel,
            examTermId: term.id,
            academicYearCode: ay,
          });
          if ("error" in rc) continue;
          // A term nobody has entered marks for is not a result. Listing it
          // with dashes reads as "scored nothing".
          if (!rc.lines.some((l) => l.marksObtained != null)) continue;
          cards.push(rc);
        }
        // Newest term first: the last exam is the one being asked about.
        cards.reverse();
        setLoad({ kind: "ready", student, cards });
        setOpenTerms(cards[0] ? [cards[0].examTerm.id] : []);
      } catch (e) {
        if (!alive) return;
        // A failed read is not "no marks". Say it could not be read.
        setLoad({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not read exam marks",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId]);

  const session =
    load.kind === "ready" ? load.student.academicYearCode || "" : "";
  const best = useMemo(() => {
    if (load.kind !== "ready" || !load.cards.length) return null;
    return load.cards[0]!;
  }, [load]);

  if (load.kind === "missing") return null;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <GraduationCap
          className="size-4 text-[var(--brand-deep)]"
          aria-hidden
        />
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Exam marks
        </h2>
        {session ? (
          <span className="text-[10px] text-[var(--muted)]">{session}</span>
        ) : null}
        {best ? (
          <span className="text-[11px] font-bold text-[var(--brand-mid)]">
            Latest: {best.examTerm.label} · {best.percent}%
            {best.overallGrade ? ` · ${best.overallGrade}` : ""}
          </span>
        ) : null}
        <Link
          href="/exams"
          className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
        >
          Exams desk
        </Link>
      </div>

      {load.kind === "loading" ? (
        <p className="px-3 py-3 text-xs text-[var(--muted)]">
          Reading marksheets…
        </p>
      ) : null}

      {load.kind === "error" ? (
        <p className="px-3 py-3 text-xs font-semibold text-[var(--danger)]">
          Marks could not be read — {load.message}. This is not an empty
          marksheet; check the Exams desk.
        </p>
      ) : null}

      {load.kind === "ready" && load.cards.length === 0 ? (
        <p className="px-3 py-3 text-xs text-[var(--muted)]">
          No marks entered for this student yet
          {session ? ` in ${session}` : ""}.
        </p>
      ) : null}

      {load.kind === "ready" && load.cards.length > 0 ? (
        <ul className="divide-y divide-[var(--border)]">
          {load.cards.map((rc) => {
            const id = rc.examTerm.id;
            const open = openTerms.includes(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-x-2 px-3 py-2 text-left hover:bg-[var(--surface-sunken)]"
                  onClick={() =>
                    setOpenTerms((ids) =>
                      ids.includes(id)
                        ? ids.filter((x) => x !== id)
                        : [...ids, id],
                    )
                  }
                  aria-expanded={open}
                >
                  <span className="text-[12px] font-bold text-[var(--brand-deep)]">
                    {rc.examTerm.label}
                  </span>
                  {rc.holdBlocked ? (
                    <span
                      className="inline-flex items-center gap-1 rounded bg-[var(--danger-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--danger)]"
                      title={
                        rc.holdMessage ||
                        "Result withheld — the parent cannot see this yet"
                      }
                    >
                      <Lock className="size-3" aria-hidden />
                      result on hold
                    </span>
                  ) : null}
                  <span className="ml-auto text-[11px] font-bold tabular-nums text-[var(--brand-mid)]">
                    {rc.totalObtained}/{rc.totalMax} · {rc.percent}%
                    {rc.overallGrade ? ` · ${rc.overallGrade}` : ""}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    {open ? "hide" : "subjects"}
                  </span>
                </button>

                {open ? (
                  <>
                    {rc.holdBlocked && rc.holdMessage ? (
                      <p className="px-3 pb-1 text-[10px] font-semibold text-[var(--danger)]">
                        {rc.holdMessage}
                      </p>
                    ) : null}
                    {rc.curriculumNote ? (
                      <p className="px-3 pb-1 text-[10px] text-[var(--muted)]">
                        {rc.curriculumNote}
                      </p>
                    ) : null}
                    <SubjectMarksTable lines={rc.lines} renderRow={(l) => (
                          <tr
                            key={l.subjectId}
                            className="border-t border-[var(--border)]"
                          >
                            <td className="px-3 py-1 text-[var(--brand-deep)]">
                              {l.subjectName}
                              {l.remark ? (
                                <span className="ml-1.5 text-[10px] text-[var(--muted)]">
                                  {l.remark}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-1 text-right tabular-nums">
                              {l.marksObtained == null ? (
                                <span
                                  className="text-[var(--muted)]"
                                  title="No mark entered for this subject"
                                >
                                  not entered
                                </span>
                              ) : (
                                <span className="font-bold">
                                  {l.marksObtained}
                                  <span className="font-normal text-[var(--muted)]">
                                    /{l.maxMarks}
                                  </span>
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1 text-right font-bold text-[var(--brand-mid)]">
                              {l.grade || "—"}
                            </td>
                          </tr>
                        )} />
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * One report card's subjects. Its own component because a hook cannot live
 * inside the `.map()` over report cards, and each card sorts on its own —
 * a parent comparing two terms wants them ordered the same way, and a
 * teacher looking for the weakest subject wants one of them by marks.
 *
 * Marks sort by the PERCENTAGE, not the raw number: 38/50 stands above
 * 40/100, and ordering by "38" would put it below. A subject with no mark
 * entered sorts last either way rather than pretending to be a zero.
 */
function SubjectMarksTable({
  lines,
  renderRow,
}: {
  lines: ReportCard["lines"];
  renderRow: (line: ReportCard["lines"][number]) => React.ReactNode;
}) {
  const sort = useTableSort(
    lines,
    {
      subject: (l) => l.subjectName,
      marks: (l) =>
        l.marksObtained == null || !l.maxMarks ? -1 : (l.marksObtained / l.maxMarks) * 100,
      grade: (l) => l.grade || "",
    },
    "subject",
    "asc",
  );
  return (
    <table className="w-full text-left text-[11px]">
      <thead className="bg-[var(--surface-sunken)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
        <tr>
          <ErpSortTh sort={sort} field="subject" className="px-3 py-1">Subject</ErpSortTh>
          <ErpSortTh sort={sort} field="marks" align="right" className="px-3 py-1">Marks</ErpSortTh>
          <ErpSortTh sort={sort} field="grade" align="right" className="px-3 py-1">Grade</ErpSortTh>
        </tr>
      </thead>
      <tbody>{sort.rows.map((l) => renderRow(l))}</tbody>
    </table>
  );
}
