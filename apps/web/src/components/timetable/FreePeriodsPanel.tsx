"use client";

import { useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";
import { WEEKDAY_SHORT, teachingPeriods, type TimetableState } from "@/lib/timetable";
import { computeFreeTeacherSlots, computeTeacherDayGrid } from "@/lib/timetableReportCatalog";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { field } from "@/components/ui/erp-ui";
import { RowActionMenu } from "@/components/ui/erp-grid";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

/**
 * "Which teacher is free at period X on day Y?" — the computation already
 * existed for the export-only "Free-period register" report, but nothing
 * showed it on screen; an office had to run and open a spreadsheet just to
 * check one slot.
 *
 * Grid view (director, 6 Oct 2026: "make free period also in table view for
 * easily see who is free in which period"): teachers down, the day's periods
 * across, each cell Free or the class they are in, with a free count under
 * every period. The list stays one click away for sorting and export.
 */
export function FreePeriodsPanel({
  masters,
  timetable,
  ay,
}: {
  masters: MastersState;
  timetable: TimetableState;
  ay: string;
}) {
  const todayWeekday = new Date().getDay();
  const workingWeekdays = timetable.workingWeekdays.length
    ? timetable.workingWeekdays
    : [1, 2, 3, 4, 5, 6];
  const [weekday, setWeekday] = useState(
    workingWeekdays.includes(todayWeekday) ? todayWeekday : workingWeekdays[0],
  );
  const [periodNo, setPeriodNo] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [onlyFree, setOnlyFree] = useState(false);

  const periods = useMemo(
    () => teachingPeriods(timetable.bellTemplate),
    [timetable.bellTemplate],
  );

  const slots = useMemo(
    () => computeFreeTeacherSlots(masters, timetable, ay, weekday),
    [masters, timetable, ay, weekday],
  );

  const dayGrid = useMemo(
    () => computeTeacherDayGrid(masters, timetable, ay, weekday),
    [masters, timetable, ay, weekday],
  );
  const gridRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dayGrid.rows.filter((r) => {
      if (q && !r.teacherName.toLowerCase().includes(q) && !r.empCode.toLowerCase().includes(q)) return false;
      if (onlyFree && periodNo !== "all" && !r.cells[periodNo]?.free) return false;
      return true;
    });
  }, [dayGrid, query, onlyFree, periodNo]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return slots.filter((s) => {
      if (periodNo !== "all" && s.periodNo !== periodNo) return false;
      if (!q) return true;
      return (
        s.teacherName.toLowerCase().includes(q) ||
        s.empCode.toLowerCase().includes(q)
      );
    });
  }, [slots, periodNo, query]);

  // Who is free when — by period to fill a slot, by teacher to check a person.
  const freeSort = useTableSort(
    filtered,
    {
      period: (s) => s.startTime,
      empCode: (s) => s.empCode,
      teacher: (s) => s.teacherName,
    },
    "period",
    "asc",
  );

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[var(--muted)]">
        Shows every teacher with no timetable slot at the chosen day/period —
        the same data behind Reports → Free-period register, live on screen.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Day</span>
          <select
            className={`${field} !py-1.5`}
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
          >
            {workingWeekdays.map((d) => (
              <option key={d} value={d}>
                {WEEKDAY_SHORT[d] ?? d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Period</span>
          <select
            className={`${field} !py-1.5`}
            value={periodNo}
            onChange={(e) =>
              setPeriodNo(e.target.value === "all" ? "all" : Number(e.target.value))
            }
          >
            <option value="all">All periods</option>
            {periods.map((p) => (
              <option key={p.no} value={p.no}>
                {p.label} · {p.startTime}–{p.endTime}
              </option>
            ))}
          </select>
        </label>
        <input
          className={`${field} max-w-xs`}
          placeholder="Search teacher…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)] text-sm" role="group" aria-label="View">
          {(["grid", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1.5 font-semibold ${view === v ? "bg-[var(--brand)] text-white" : "bg-[var(--card)] text-[var(--brand-deep)]"}`}
            >
              {v === "grid" ? "Grid" : "List"}
            </button>
          ))}
        </div>
        {view === "grid" && periodNo !== "all" ? (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
            Only teachers free in this period
          </label>
        ) : null}
        <span className="text-[11px] text-[var(--muted)]">
          {view === "grid" ? `${gridRows.length} teachers` : `${filtered.length} free`}
        </span>
      </div>

      {view === "grid" ? (
        gridRows.length === 0 || dayGrid.periods.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            {dayGrid.periods.length === 0 ? "No periods in the bell timetable yet." : "No teacher matches this selection."}
          </div>
        ) : (
          <ErpTableShell exportAs="free_periods_grid" exportTitle={`Free periods — ${WEEKDAY_SHORT[weekday] ?? weekday}`}>
            {/* The shell clips (overflow-hidden), so the grid scrolls in its
                own box: sideways for the day's periods, down for the staff,
                with the period row and the teacher column pinned. Without
                it the later periods were cut off and nothing scrolled. */}
            <div className="max-h-[70vh] overflow-auto overscroll-contain">
            <ErpTable minWidth="min-w-[640px]">
              <ErpTableHead sticky>
                <tr>
                  <th className="sticky left-0 z-20 bg-[var(--surface-sunken)] px-3 py-2 text-left font-semibold">Teacher</th>
                  {dayGrid.periods.map((p) => (
                    <th
                      key={p.no}
                      className={`px-2 py-2 text-center font-semibold ${periodNo === p.no ? "bg-[var(--brand)]/15" : ""}`}
                    >
                      <span className="block">{p.label}</span>
                      <span className="block text-[10px] font-normal text-[var(--muted)]">{p.startTime}–{p.endTime}</span>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center font-semibold">Free</th>
                  <th className="w-10 px-2 py-2" aria-label="Actions" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {gridRows.map((r) => (
                  <tr key={r.teacherId}>
                    <td className="sticky left-0 z-[1] bg-[var(--card)] px-3 py-1.5">
                      <span className="block font-medium text-[var(--brand-deep)]">{r.teacherName}</span>
                      {r.empCode ? <span className="block text-[10px] text-[var(--muted)]">{r.empCode}</span> : null}
                    </td>
                    {dayGrid.periods.map((p) => {
                      const c = r.cells[p.no];
                      const hl = periodNo === p.no ? "ring-2 ring-inset ring-[var(--brand)]/40" : "";
                      if (!c || c.free) {
                        return (
                          <td key={p.no} className={`px-1 py-1 text-center ${hl}`}>
                            <span className="inline-block rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                              Free
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={p.no}
                          className={`px-1 py-1 text-center text-[11px] leading-tight ${hl} ${c.clash ? "bg-amber-50 text-amber-900" : "text-[var(--muted)]"}`}
                          title={c.clash ? "Placed in two classes at once — fix in the timetable" : `${c.classSection} · ${c.subject}`}
                        >
                          <span className="block font-semibold text-[var(--foreground)]">{c.classSection}</span>
                          {c.subject ? <span className="block truncate">{c.subject}</span> : null}
                          {c.clash ? <span className="block font-semibold">⚠ clash</span> : null}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center font-semibold">{r.freeCount}</td>
                    <td className="px-2 py-1.5 text-right">
                      <RowActionMenu row={r} label="Teacher actions" actions={[{ id: "open", label: "Open staff record", onSelect: (x) => { window.location.href = `/staff/${encodeURIComponent(String(x.teacherId))}/edit`; } }]} />
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--border)]">
                  <td className="sticky left-0 z-[1] bg-[var(--surface-sunken)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Free teachers
                  </td>
                  {dayGrid.periods.map((p) => (
                    <td key={p.no} className="bg-[var(--surface-sunken)] px-2 py-2 text-center font-bold text-[var(--brand-deep)]">
                      {dayGrid.freeByPeriod[p.no] ?? 0}
                    </td>
                  ))}
                  <td className="bg-[var(--surface-sunken)]" colSpan={2} />
                </tr>
              </ErpTableBody>
            </ErpTable>
            </div>
          </ErpTableShell>
        )
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          No teacher is free for this selection.
        </div>
      ) : (
        <ErpTableShell exportAs="free_periods" exportTitle="Free periods">
          <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[480px]">
            <ErpTableHead>
              <tr>
                <ErpSortTh sort={freeSort} field="period" className="px-3 py-2 font-semibold">Period</ErpSortTh>
                <ErpSortTh sort={freeSort} field="empCode" className="px-3 py-2 font-semibold">Emp code</ErpSortTh>
                <ErpSortTh sort={freeSort} field="teacher" className="px-3 py-2 font-semibold">Teacher</ErpSortTh>
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {freeSort.rows.map((s) => (
                <tr key={`${s.periodNo}-${s.teacherId}`}>
                  <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                    {s.periodLabel} · {s.startTime}–{s.endTime}
                  </td>
                  <td className="px-3 py-2">{s.empCode}</td>
                  <td className="px-3 py-2">{s.teacherName}</td>
                  <td className="px-2 py-1.5 text-right">
                    <RowActionMenu row={s} label="Teacher actions" actions={[{ id: "open", label: "Open staff record", onSelect: (x) => { window.location.href = `/staff/${encodeURIComponent(String(x.teacherId))}/edit`; } }]} />
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
          </div>
        </ErpTableShell>
      )}
    </div>
  );
}
