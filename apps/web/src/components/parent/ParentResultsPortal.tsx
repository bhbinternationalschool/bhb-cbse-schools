"use client";

/**
 * Results & date sheet for the signed-in family — /parent "Results" tab.
 *
 * Reads /api/v1/parent/results and /api/v1/parent/datesheet, which take the
 * household from the session (never from this page) and list ONLY exams the
 * school released to parents. The printable card is the school's own
 * ReportCardSheet, so print / "Save as PDF" gives the parent exactly the
 * card the office prints.
 */

/* ratchet-allow: raw_table — a parent's own report card, read on a phone: one child, a handful of subjects, no row actions */

import { useEffect, useMemo, useState } from "react";
import { ReportCardSheet, printReportCard } from "@/components/exams/ReportCardSheet";
import type { ReportCard } from "@/lib/exams";
import type {
  ParentChildDateSheet,
  ParentChildResults,
  ParentReportCardView,
  ParentTermResult,
} from "@/lib/parentResults";
import { normalizeStudent } from "@/lib/sis";
import { withSignatureImages } from "@/lib/printSignatures";

type ResultsData = { releasedTermCount: number; children: ParentChildResults[]; signatureImages?: Record<string, string> };
type DateSheetData = { publishedTermCount: number; today: string; children: ParentChildDateSheet[] };

async function getData<T>(url: string): Promise<{ data: T } | { error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error?: { message?: string } }
      | null;
    if (!res.ok || !json || !json.ok) {
      return { error: (json && !json.ok && json.error?.message) || "Could not load. Please try again." };
    }
    return { data: json.data };
  } catch {
    return { error: "Could not reach the school server. Check your internet and try again." };
  }
}

function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function ParentResultsPortal() {
  const [results, setResults] = useState<ResultsData | null>(null);
  const [dateSheet, setDateSheet] = useState<DateSheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dsError, setDsError] = useState<string | null>(null);
  const [childId, setChildId] = useState<string | null>(null);
  const [termId, setTermId] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);

  async function load() {
    setError(null);
    setDsError(null);
    const [r, d] = await Promise.all([
      getData<ResultsData>("/api/v1/parent/results"),
      getData<DateSheetData>("/api/v1/parent/datesheet"),
    ]);
    if ("error" in r) setError(r.error);
    else setResults(r.data);
    if ("error" in d) setDsError(d.error);
    else setDateSheet(d.data);
  }

  useEffect(() => {
    void load();
  }, []);

  const child = useMemo(() => {
    const kids = results?.children ?? [];
    return kids.find((k) => k.studentId === childId) ?? kids[0] ?? null;
  }, [results, childId]);

  const term: ParentTermResult | null = useMemo(() => {
    if (!child || child.terms.length === 0) return null;
    // Newest released exam first by default.
    return child.terms.find((t) => t.termId === termId) ?? child.terms[child.terms.length - 1]!;
  }, [child, termId]);

  const childDates = dateSheet?.children.find((c) => c.studentId === child?.studentId) ?? null;

  const printable: ReportCard | null = useMemo(() => {
    const p = term?.printable;
    if (!p) return null;
    return { ...p, student: normalizeStudent({ ...p.student }) };
  }, [term]);

  if (error && !results) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--muted)]">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!results) return <p className="px-4 py-8 text-sm text-[var(--muted)]">Loading results…</p>;
  if (results.children.length === 0) {
    return (
      <p className="px-4 py-8 text-sm text-[var(--muted)]">
        We could not find your children on the school&apos;s roll. Please contact the school office.
      </p>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {results.children.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {results.children.map((c) => (
            <button
              key={c.studentId}
              type="button"
              onClick={() => {
                setChildId(c.studentId);
                setTermId(null);
                setShowSheet(false);
              }}
              className={`shrink-0 rounded-xl border px-3 py-2 text-left ${
                c.studentId === child?.studentId
                  ? "border-[var(--brand-deep)] bg-white"
                  : "border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)]"
              }`}
            >
              <div className="text-sm font-semibold text-[var(--brand-deep)]">{c.fullName}</div>
              <div className="text-[10px] text-[var(--muted)]">{c.classLabel}</div>
            </button>
          ))}
        </div>
      ) : null}

      <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Results · परिणाम {child ? `· ${child.fullName}` : ""}
        </p>
        {!child || child.terms.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Results not published yet. The school will publish them here after each exam.
            <span className="mt-1 block" lang="hi">
              परिणाम अभी प्रकाशित नहीं हुए हैं। हर परीक्षा के बाद स्कूल यहाँ प्रकाशित करेगा।
            </span>
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {child.terms.map((t) => (
                <button
                  key={t.termId}
                  type="button"
                  onClick={() => {
                    setTermId(t.termId);
                    setShowSheet(false);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    t.termId === term?.termId
                      ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white"
                      : "border-[rgba(32,48,80,0.15)] text-[var(--brand-deep)]"
                  }`}
                >
                  {t.termLabel}
                </button>
              ))}
            </div>
            {term && term.status !== "ready" ? (
              <p className="mt-3 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2 text-sm text-[var(--brand-deep)]">
                {term.message}
              </p>
            ) : term?.card ? (
              <ResultCardView card={term.card} />
            ) : null}
            {printable && term ? (
              <div className="mt-3">
                {!showSheet ? (
                  <button
                    type="button"
                    onClick={() => setShowSheet(true)}
                    className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                  >
                    Report card to print / save as PDF
                  </button>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => printReportCard(printable.student.id, printable.examTerm.id)}
                        className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
                      >
                        Print / Save as PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSheet(false)}
                        className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                      >
                        Close
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <div className="min-w-[640px]">
                        <ReportCardSheet card={printable} signatures={withSignatureImages(term?.printable?.signatures, results?.signatureImages)} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Date sheet · परीक्षा कार्यक्रम
        </p>
        {dsError && !dateSheet ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{dsError}</p>
        ) : !dateSheet ? (
          <p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
        ) : !childDates || childDates.exams.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No upcoming exams published for {child?.fullName ?? "your child"}.
            <span className="mt-1 block" lang="hi">
              अभी कोई आने वाली परीक्षा प्रकाशित नहीं हुई है।
            </span>
          </p>
        ) : (
          childDates.exams.map((ex) => (
            <div key={ex.termId} className="mt-2">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">{ex.termLabel}</p>
              <ul className="mt-1 divide-y divide-[rgba(32,48,80,0.08)]">
                {ex.rows.map((r, i) => (
                  <li key={`${r.date}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                    <span className="font-medium text-[var(--brand-deep)]">
                      {r.subjectName}
                      {r.note ? <span className="block text-[11px] font-normal text-[var(--muted)]">{r.note}</span> : null}
                    </span>
                    <span className="shrink-0 text-right text-xs text-[var(--muted)]">
                      {dateLabel(r.date)}
                      {r.startTime ? ` · ${r.startTime}` : ""}
                      {r.durationMinutes ? ` · ${r.durationMinutes} min` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function ResultCardView({ card }: { card: ParentReportCardView }) {
  return (
    <div className="mt-3">
      {card.absent ? (
        <p className="mb-2 rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]">
          Absent in this examination{card.absent.reason ? ` — ${card.absent.reason}` : ""}
        </p>
      ) : null}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[rgba(32,48,80,0.2)] text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
            <th className="py-1.5 pr-2">Subject</th>
            {!card.gradesOnly ? <th className="py-1.5 pr-2 text-right">Marks</th> : null}
            <th className="py-1.5 text-right">{card.descriptors ? "Assessment" : "Grade"}</th>
          </tr>
        </thead>
        <tbody>
          {card.subjects.map((s) => (
            <tr key={s.subjectId} className="border-b border-[rgba(32,48,80,0.08)] align-top">
              <td className="py-1.5 pr-2 font-medium text-[var(--brand-deep)]">
                {s.name}
                {s.parts.length > 0 ? (
                  <span className="block text-[10px] font-normal text-[var(--muted)]">
                    {s.parts.map((x) => `${x.label} ${x.obtained ?? "—"}/${x.maxMarks}`).join(" · ")}
                  </span>
                ) : null}
                {s.gradedParts.length > 0 ? (
                  <span className="block text-[10px] font-normal text-[var(--muted)]">
                    {s.gradedParts.map((g) => `${g.label}: ${g.grade ?? "—"}`).join(" · ")}
                  </span>
                ) : null}
                {s.remark ? <span className="block text-[11px] font-normal text-[var(--muted)]">{s.remark}</span> : null}
              </td>
              {!card.gradesOnly ? (
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {s.absent ? "AB" : `${s.obtained ?? "—"}/${s.maxMarks ?? "—"}`}
                </td>
              ) : null}
              <td className="py-1.5 text-right font-semibold">
                {card.descriptors ? s.gradeLabel || s.grade : s.grade}
              </td>
            </tr>
          ))}
        </tbody>
        {card.totals ? (
          <tfoot>
            <tr className="border-t-2 border-[var(--brand-deep)] font-bold">
              <td className="py-1.5 pr-2">Total</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {card.totals.obtained}/{card.totals.max}
              </td>
              <td className="py-1.5 text-right">{card.overallGrade ?? ""}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {card.percent != null ? <Fact label="Percentage" value={`${card.percent}%`} /> : null}
        {card.overallGrade ? <Fact label="Overall grade" value={card.overallGrade} /> : null}
        {card.rank != null ? (
          <Fact label="Rank" value={`${card.rank}${card.classSize ? ` of ${card.classSize}` : ""}`} />
        ) : null}
        {card.classAverage != null ? <Fact label="Class average" value={`${card.classAverage}%`} /> : null}
        {card.result ? <Fact label="Result" value={card.result} /> : null}
        {card.attendance ? (
          <Fact
            label="Attendance"
            value={`${card.attendance.presentDays}/${card.attendance.workingDays} (${card.attendance.percent}%)`}
          />
        ) : null}
      </div>
      {card.coScholastic.length > 0 ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          {card.coScholastic.map((c) => `${c.label}: ${c.rating ?? "—"}`).join(" · ")}
        </p>
      ) : null}
      {card.remark ? (
        <div className="mt-3 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Class teacher&apos;s remarks
          </p>
          {card.remark.textHi ? (
            <p className="mt-1 text-sm text-[var(--brand-deep)]" lang="hi">
              {card.remark.textHi}
            </p>
          ) : null}
          {card.remark.text ? <p className="mt-1 text-sm text-[var(--brand-deep)]">{card.remark.text}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-[var(--muted)]">{label} </span>
      <span className="font-bold text-[var(--brand-deep)]">{value}</span>
    </span>
  );
}
