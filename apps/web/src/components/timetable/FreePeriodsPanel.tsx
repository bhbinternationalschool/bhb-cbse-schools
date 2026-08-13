"use client";

import { useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";
import { WEEKDAY_SHORT, teachingPeriods, type TimetableState } from "@/lib/timetable";
import { computeFreeTeacherSlots } from "@/lib/timetableReportCatalog";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { field } from "@/components/ui/erp-ui";

/**
 * "Which teacher is free at period X on day Y?" — the computation already
 * existed for the export-only "Free-period register" report, but nothing
 * showed it on screen; an office had to run and open a spreadsheet just to
 * check one slot.
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

  const periods = useMemo(
    () => teachingPeriods(timetable.bellTemplate),
    [timetable.bellTemplate],
  );

  const slots = useMemo(
    () => computeFreeTeacherSlots(masters, timetable, ay, weekday),
    [masters, timetable, ay, weekday],
  );

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
                {p.label}
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
        <span className="text-[11px] text-[var(--muted)]">
          {filtered.length} free
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          No teacher is free for this selection.
        </div>
      ) : (
        <ErpTableShell>
          <ErpTable minWidth="min-w-[480px]">
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 font-semibold">Period</th>
                <th className="px-3 py-2 font-semibold">Emp code</th>
                <th className="px-3 py-2 font-semibold">Teacher</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {filtered.map((s) => (
                <tr key={`${s.periodNo}-${s.teacherId}`}>
                  <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                    {s.periodLabel}
                  </td>
                  <td className="px-3 py-2">{s.empCode}</td>
                  <td className="px-3 py-2">{s.teacherName}</td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}
    </div>
  );
}
