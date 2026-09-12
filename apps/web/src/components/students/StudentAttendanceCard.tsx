"use client";

// ratchet-allow: raw_table — a detail table inside one child's record: three
// narrow columns in a scrollable 16rem box, sharing the page with five other
// cards. ErpTableShell is the roster shell (its own card, border and density)
// and would put a card inside a card.
// ratchet-allow: grids_without_row_menu — months of one child's attendance are
// a reading, not records: there is nothing to do to a row. Marking happens in
// the Attendance desk, against the class register.

/**
 * How often this child is actually in school, on the child's own page.
 *
 * Attendance lives in class registers, one per day, so the answer used to
 * require opening the Attendance desk and reading down a month. It is asked
 * on this page — by a teacher before a PTM, by the office before a fee
 * call, by the principal before signing a leaving certificate.
 *
 * The card refuses to invent a figure: an unmarked register reads "not
 * marked yet", never 0%. See lib/studentAttendance.ts.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, TriangleAlert } from "lucide-react";
import {
  attendanceStatusLabel,
  loadAttendance,
  type AttendanceRegister,
  type AttendanceStatus,
} from "@/lib/attendance";
import { loadSis, normalizeStudent, type SisStudent } from "@/lib/sis";
import {
  attendanceMonthLabel,
  studentAttendanceSummary,
} from "@/lib/studentAttendance";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; student: SisStudent; registers: AttendanceRegister[] }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** Recent days shown as a strip — about three school weeks. */
const RECENT_DAYS = 18;

const TONE: Record<AttendanceStatus, string> = {
  P: "bg-[var(--success-soft,rgba(22,132,80,0.16))] text-[var(--success,#16794f)]",
  L: "bg-[rgba(197,160,40,0.22)] text-[#7a5c00]",
  HD: "bg-[rgba(197,160,40,0.22)] text-[#7a5c00]",
  LE: "bg-[var(--surface-sunken)] text-[var(--muted)]",
  A: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

export function StudentAttendanceCard({ studentId }: { studentId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { ensureSisHydrated } = await import("@/lib/sisPersistence");
        const { ensureAttendanceHydrated } = await import(
          "@/lib/attendancePersistence"
        );
        const { withHydrationSlot } = await import("@/lib/deskHydrateGuard");
        await Promise.all([
          withHydrationSlot(() => ensureSisHydrated()),
          withHydrationSlot(() => ensureAttendanceHydrated()),
        ]);
        if (!alive) return;
        const raw = loadSis().students.find((s) => s.id === studentId);
        if (!raw) {
          setLoad({ kind: "missing" });
          return;
        }
        setLoad({
          kind: "ready",
          student: normalizeStudent(raw),
          registers: loadAttendance().registers || [],
        });
      } catch (e) {
        if (!alive) return;
        // A failed read is not a clean register. Say it could not be read
        // rather than draw a 0% nobody can defend.
        setLoad({
          kind: "error",
          message: e instanceof Error ? e.message : "Could not read attendance",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [studentId]);

  const summary = useMemo(() => {
    if (load.kind !== "ready") return null;
    return studentAttendanceSummary(load.registers, load.student.id, {
      academicYearCode: load.student.academicYearCode || undefined,
    });
  }, [load]);

  // The months arrive oldest first, which is the reading order, so that is
  // where the sort starts. A month sorts by its own key (2026-04), never by
  // the label — "April, August, December" is alphabetical nonsense.
  const monthSort = useTableSort(
    summary?.months ?? [],
    {
      month: (m) => m.month,
      marked: (m) => m.marked,
      absent: (m) => m.absent,
      percent: (m) => (m.percent === null ? -1 : m.percent),
    },
    "month",
    "asc",
  );

  if (load.kind === "missing") return null;

  const session =
    load.kind === "ready" ? load.student.academicYearCode || "" : "";

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <CalendarCheck className="size-4 text-[var(--brand-deep)]" aria-hidden />
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Attendance
        </h2>
        {session ? (
          <span className="text-[10px] text-[var(--muted)]">{session}</span>
        ) : null}
        <Link
          href="/attendance?tab=students"
          className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-bold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
        >
          Attendance desk
        </Link>
      </div>

      {load.kind === "loading" ? (
        <p className="px-3 py-3 text-xs text-[var(--muted)]">
          Reading registers…
        </p>
      ) : null}

      {load.kind === "error" ? (
        <p className="px-3 py-3 text-xs font-semibold text-[var(--danger)]">
          Attendance could not be read — {load.message}. This is not a clean
          record; check the Attendance desk.
        </p>
      ) : null}

      {summary ? (
        summary.percent === null ? (
          <p className="px-3 py-3 text-xs font-semibold text-[var(--muted)]">
            No attendance marked for this student yet
            {session ? ` in ${session}` : ""}. That is a register nobody has
            opened — not a day missed.
          </p>
        ) : (
          <>
            {summary.absentStreak >= 3 ? (
              <p className="flex items-center gap-1.5 border-b border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--danger)]">
                <TriangleAlert className="size-3.5" aria-hidden />
                Absent {summary.absentStreak} days running — last marked{" "}
                {summary.lastMarkedDate}. Worth a phone call.
              </p>
            ) : null}

            <div className="grid grid-cols-2 divide-x divide-[var(--border)] border-b border-[var(--border)] sm:grid-cols-4">
              <Stat
                label="Attendance"
                value={`${summary.percent}%`}
                hint={`${summary.presentDays} of ${summary.marked} days marked`}
                strong
                tone={summary.percent < 75 ? "danger" : undefined}
              />
              <Stat label="Present" value={String(summary.present)} />
              <Stat
                label="Absent"
                value={String(summary.absent)}
                tone={summary.absent > 0 ? "danger" : undefined}
              />
              <Stat
                label="Late / half / leave"
                value={`${summary.late} / ${summary.halfDay} / ${summary.leave}`}
              />
            </div>

            <div className="px-3 py-2">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Last {Math.min(RECENT_DAYS, summary.days.length)} marked days
              </p>
              <div className="flex flex-wrap gap-1">
                {summary.days.slice(0, RECENT_DAYS).map((d) => (
                  <span
                    key={d.date}
                    title={`${d.date} — ${attendanceStatusLabel(d.status)}${
                      d.note ? ` · ${d.note}` : ""
                    }`}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${TONE[d.status]}`}
                  >
                    {d.date.slice(8)}
                    <span className="ml-1 opacity-80">{d.status}</span>
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Day of month · P present, A absent, L late, HD half day, LE
                leave. Late counts a full day, half day counts half — the same
                arithmetic as the monthly report.
              </p>
            </div>

            {summary.months.length > 1 ? (
              <div className="border-t border-[var(--border)]">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-[var(--surface-sunken)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <ErpSortTh sort={monthSort} field="month">Month</ErpSortTh>
                      <ErpSortTh sort={monthSort} field="marked" align="right">Marked</ErpSortTh>
                      <ErpSortTh sort={monthSort} field="absent" align="right">Absent</ErpSortTh>
                      <ErpSortTh sort={monthSort} field="percent" align="right">%</ErpSortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {monthSort.rows.map((m) => (
                      <tr
                        key={m.month}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="px-3 py-1.5 text-[var(--brand-deep)]">
                          {attendanceMonthLabel(m.month)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[var(--muted)]">
                          {m.marked}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums ${
                            m.absent > 0 ? "text-[var(--danger)]" : ""
                          }`}
                        >
                          {m.absent}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right font-bold tabular-nums ${
                            m.percent !== null && m.percent < 75
                              ? "text-[var(--danger)]"
                              : "text-[var(--brand-deep)]"
                          }`}
                        >
                          {m.percent === null ? "—" : `${m.percent}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger";
  strong?: boolean;
}) {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p
        className={`tabular-nums ${strong ? "text-base font-extrabold" : "text-sm font-bold"} ${
          tone === "danger" ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="text-[10px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}
