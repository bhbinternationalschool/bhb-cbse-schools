"use client";

/**
 * Exam dashboard: one table per exam, one row per section — which class's
 * result is ready, and for a partial one exactly which subjects (and
 * co-scholastic areas) are still short. Clicking a row opens that section's
 * mark sheet for that exam (director, 5 Oct 2026).
 *
 * Every number comes from the same resolution the marks grid uses — the
 * section roster, each child's own subjects, the scheme's components for the
 * exam, Masters' co-scholastic areas — so "3 left in Maths" here is the same
 * three empty cells the teacher sees there.
 */

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import {
  coScholasticAreasForClass,
  componentsForSubject,
  findMarkSheet,
  schemeForClassId,
  subjectTakeMap,
  subjectsForMarkEntry,
  type ExamDeps,
  type ExamPolicy,
  type ExamSubject,
  type ExamTerm,
  type ExamsState,
} from "@/lib/exams";
import { rosterForSection } from "@/lib/attendance";
import type { MastersState } from "@/lib/masters";
import type { SisState } from "@/lib/sis";
import type { MyTeaching } from "@/components/staff/useMyTeaching";
import {
  readinessStatusLabel,
  sectionReadiness,
  type ReadinessStatus,
  type SectionReadiness,
} from "@/lib/examReadiness";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

type SectionInfo = {
  classId: string;
  sectionId: string;
  label: string;
  studentIds: string[];
  subjects: ExamSubject[];
  takes: Map<string, Set<string>>;
  /** A subject teacher who is not the class teacher grades no areas. */
  includeAreas: boolean;
};

const STATUS_STYLE: Record<ReadinessStatus, string> = {
  ready: "bg-[var(--success-soft)] text-[var(--success)]",
  partial: "bg-[var(--warning-soft)] text-[var(--warning)]",
  not_started: "bg-[var(--danger-soft)] text-[var(--danger)]",
  no_students: "bg-[var(--surface-sunken)] text-[var(--muted)]",
  nothing_to_enter: "bg-[var(--surface-sunken)] text-[var(--muted)]",
};

function dateRange(t: ExamTerm): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (t.startsOn && t.endsOn) return `${fmt(t.startsOn)} – ${fmt(t.endsOn)}`;
  if (t.startsOn) return `from ${fmt(t.startsOn)}`;
  return "";
}

export function ExamReadinessDashboard(props: {
  ay: string;
  terms: ExamTerm[];
  exams: ExamsState;
  masters: MastersState | null;
  sis: SisState | null;
  policy: ExamPolicy;
  /** Set for a teacher limited to their own sections and subjects. */
  teaching: MyTeaching | null;
  onOpen: (examTermId: string, classId: string, sectionId: string) => void;
}) {
  const { ay, terms, exams, masters, sis, policy, teaching, onOpen } = props;

  const sections = useMemo<SectionInfo[]>(() => {
    if (!masters || !sis) return [];
    const deps: ExamDeps = { state: exams, masters, sis };
    const classes = masters.classes
      .filter((c) => c.isActive !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const out: SectionInfo[] = [];
    for (const cls of classes) {
      const secs = masters.sections
        .filter((s) => s.classId === cls.id && s.isActive !== false)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const sec of secs) {
        const mine = teaching?.teaching.find((t) => t.classId === cls.id && t.sectionId === sec.id);
        if (teaching && !mine) continue;
        const roster = rosterForSection(sis.students, sec.id, { classId: cls.id, academicYearCode: ay });
        let subjects = subjectsForMarkEntry(cls.id, roster, exams, deps);
        if (mine && !mine.isClassTeacher) {
          const codes = new Set(mine.subjects.map((x) => x.code));
          subjects = subjects.filter((x) => codes.has(x.code.trim().toUpperCase()));
        }
        out.push({
          classId: cls.id,
          sectionId: sec.id,
          label: `${cls.name}${sec.name ? `-${sec.name}` : ""}`,
          studentIds: roster.map((s) => s.id),
          subjects,
          takes: subjectTakeMap(roster, subjects, exams, deps),
          includeAreas: !mine || mine.isClassTeacher,
        });
      }
    }
    return out;
  }, [ay, exams, masters, sis, teaching]);

  const boards = useMemo(() => {
    return terms.map((term) => {
      const rows = sections.map((sec) => {
        const scheme = schemeForClassId(sec.classId, policy);
        const columns = sec.subjects.flatMap((subject) => {
          const parts = scheme ? componentsForSubject(scheme, term.code, subject.code) : [];
          const name = subject.name || subject.code;
          return parts.length === 0
            ? [{ subjectId: subject.id, subjectName: name, component: "" }]
            : parts.map((p) => ({ subjectId: subject.id, subjectName: name, component: p.code }));
        });
        const readiness = sectionReadiness({
          studentIds: sec.studentIds,
          columns,
          takes: sec.takes,
          areas: sec.includeAreas ? coScholasticAreasForClass(sec.classId, policy, masters) : [],
          sheet: findMarkSheet(ay, term.id, sec.sectionId, exams) ?? null,
          entryMode: scheme && scheme.displayMode !== "marks_grade" ? "grades" : "marks",
        });
        return { sec, readiness };
      });
      const count = (s: ReadinessStatus) => rows.filter((r) => r.readiness.status === s).length;
      return {
        term,
        rows,
        ready: count("ready"),
        partial: count("partial"),
        notStarted: count("not_started"),
      };
    });
  }, [terms, sections, policy, masters, ay, exams]);

  if (!masters || !sis) {
    return <p className="text-sm text-[var(--muted)]">Loading classes…</p>;
  }
  if (terms.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-6 text-sm text-[var(--muted)]">
        No exams yet. Create one under <strong>Exams &amp; policy</strong>.
      </p>
    );
  }
  // Open the exams someone has started on; if none, the first one.
  const anyStarted = boards.some((b) => b.ready + b.partial > 0);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">Result readiness by exam</h2>
        <p className="text-xs text-[var(--muted)]">
          Ready = every mark and grade entered (absent counts as entered). Click a class to open its mark sheet.
        </p>
      </div>
      {boards.map((b, i) => (
        <details
          key={b.term.id}
          open={anyStarted ? b.ready + b.partial > 0 : i === 0}
          className="group rounded-2xl border border-[var(--border)] bg-[var(--card)]"
        >
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <ChevronRight className="size-4 text-[var(--muted)] transition-transform group-open:rotate-90" aria-hidden />
            <span className="font-semibold text-[var(--brand-deep)]">{b.term.label}</span>
            <span className="text-xs text-[var(--muted)]">
              {b.term.code}
              {dateRange(b.term) ? ` · ${dateRange(b.term)}` : ""}
            </span>
            <span className="ml-auto flex flex-wrap gap-1.5 text-xs font-semibold">
              <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE.ready}`}>{b.ready} ready</span>
              <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE.partial}`}>{b.partial} partial</span>
              <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE.not_started}`}>{b.notStarted} not started</span>
            </span>
          </summary>
          <div className="px-3 pb-3">
            <ErpTableShell density="compact" exportAs={`exam_readiness_${b.term.code}`} exportTitle={`${b.term.label} · result readiness`}>
              <ErpTable minWidth="min-w-[640px]">
                <ErpTableHead>
                  <tr>
                    <th className="px-3 py-2">Class</th>
                    <th className="px-3 py-2">Students</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Entered</th>
                    <th className="px-3 py-2">Pending</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody hoverable>
                  {b.rows.map(({ sec, readiness }) => (
                    <ReadinessRow
                      key={sec.sectionId}
                      sec={sec}
                      r={readiness}
                      onOpen={() => onOpen(b.term.id, sec.classId, sec.sectionId)}
                    />
                  ))}
                </ErpTableBody>
              </ErpTable>
            </ErpTableShell>
          </div>
        </details>
      ))}
    </section>
  );
}

function ReadinessRow({ sec, r, onOpen }: { sec: SectionInfo; r: SectionReadiness; onOpen: () => void }) {
  const pct = r.total > 0 ? Math.round((r.filled / r.total) * 100) : 0;
  const disabled = r.status === "no_students";
  return (
    <tr
      className={disabled ? "opacity-60" : "cursor-pointer"}
      onClick={disabled ? undefined : onOpen}
    >
      <td className="px-3 py-2">
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline disabled:no-underline"
        >
          {sec.label}
        </button>
      </td>
      <td className="px-3 py-2 tabular-nums">{sec.studentIds.length}</td>
      <td className="px-3 py-2">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>
          {readinessStatusLabel(r)}
        </span>
      </td>
      <td className="px-3 py-2">
        {r.total > 0 ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <div
                className={`h-full ${r.status === "ready" ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-[var(--muted)]">{pct}%</span>
          </div>
        ) : (
          <span className="text-xs text-[var(--muted)]">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {r.status === "partial" ? (
          <span className="flex flex-wrap gap-1">
            {r.pending.map((p) => (
              <span
                key={`${p.kind}:${p.key}`}
                className="rounded-md border border-[var(--border)] px-1.5 py-0.5"
                title={`${p.total - p.filled} of ${p.total} still to enter`}
              >
                {p.kind === "co_scholastic" ? "Co-sch · " : ""}
                {p.label} <b className="tabular-nums">{p.total - p.filled}</b> left
              </span>
            ))}
            <span className="self-center text-[var(--muted)]">· {r.studentsPending} students</span>
          </span>
        ) : r.status === "not_started" ? (
          <span className="text-[var(--muted)]">Nothing entered yet</span>
        ) : r.status === "ready" ? (
          <span className="text-[var(--muted)]">{r.locked ? "Locked" : "Complete · not locked"}</span>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </td>
    </tr>
  );
}
