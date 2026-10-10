"use client";

import type { ReactNode } from "react";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import type { RowAction } from "@/components/ui/erp-grid";
import type { Holiday } from "@/lib/foundationMasters";
import { appliesToLabel, WEEKDAY_LABELS, weeklyRuleIsWholeSession } from "@/lib/holidayPolicy";
import {
  compareWeeklyRules,
  duplicateHolidayIds,
  holidayDateLabel,
  holidayDayCount,
  holidaysByMonth,
  isWeeklyRule,
  weeklyRuleWhen,
} from "@/lib/holidayCalendarView";

function scopeLabel(h: Holiday): string {
  const scope = h.scope || "school";
  if (scope === "school") return "Whole school";
  if (scope === "class_group") return h.groupCode ? `Group ${h.groupCode}` : "Class group";
  return `${(h.classIds ?? []).length} class(es)`;
}

function Kind({ h }: { h: Holiday }) {
  return (
    <span className="text-[10px] font-semibold uppercase text-[var(--muted)]">
      {h.workingOverride ? "working day" : h.kind}
      {(h.dayType || "full") === "half" ? " · half day" : ""}
    </span>
  );
}

/**
 * Masters → Holidays, a session's holidays month by month in date order
 * (director, 8 Oct 2026), with the weekly offs on top. `actions` gives each
 * row its menu; `extra` renders a per-row control (e.g. the notify button).
 */
export function HolidayMonthTable({
  holidays,
  sessionStart,
  sessionEnd,
  actions,
  extra,
  emptyText,
}: {
  holidays: Holiday[];
  sessionStart: string;
  sessionEnd: string;
  actions: (h: Holiday) => RowAction<Holiday>[];
  extra?: (h: Holiday) => ReactNode;
  emptyText: string;
}) {
  const weekly = holidays.filter(isWeeklyRule).sort(compareWeeklyRules);
  const months = holidaysByMonth(holidays, sessionStart, sessionEnd);
  const dated = months.reduce((n, m) => n + m.holidays.length, 0);
  const totalDays = months.reduce((n, m) => n + m.days, 0);
  const dups = duplicateHolidayIds(holidays);

  if (weekly.length === 0 && dated === 0) {
    return <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{emptyText}</p>;
  }

  return (
    <div className="space-y-3 p-3">
      {weekly.length ? (
        <ErpTableShell density="compact">
          <div className="overflow-x-auto">
            <ErpTable minWidth="min-w-[700px]">
              <ErpTableHead>
                <tr>
                  <th className="px-3 py-2">Every week</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Holiday</th>
                  <th className="px-3 py-2">For</th>
                  <th className="px-3 py-2">Applies to</th>
                  <th className="w-10 px-2 py-2" aria-label="Actions" />
                </tr>
              </ErpTableHead>
              <ErpTableBody hoverable>
                {weekly.map((h) => (
                  <tr key={h.id}>
                    <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">
                      {typeof h.weekday === "number" ? WEEKDAY_LABELS[h.weekday] : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {weeklyRuleIsWholeSession(h) ? (
                        <span className="text-[var(--muted)]">Whole session</span>
                      ) : (
                        <span className="font-semibold text-[var(--brand-deep)]">{weeklyRuleWhen(h, false)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {h.title} <Kind h={h} />
                    </td>
                    <td className="px-3 py-2 text-xs">{scopeLabel(h)}</td>
                    <td className="px-3 py-2 text-xs">{appliesToLabel(h.appliesTo)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {extra?.(h)}
                        <RowActionMenu row={h} label={`${h.title} actions`} actions={actions(h)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      ) : null}

      <p className="px-1 text-[11px] text-[var(--muted)]">
        {dated} dated holiday(s) · {totalDays} day(s) off this session, besides the weekly offs.
        {dups.size ? (
          <span className="ml-1 font-semibold text-[var(--danger)]">
            {dups.size} entered twice — marked “duplicate” below; remove the extra one.
          </span>
        ) : null}
      </p>

      <ErpTableShell density="compact" exportAs="holidays_month_wise" exportTitle="Holidays month-wise">
        <div className="max-h-[70vh] overflow-auto">
          <ErpTable minWidth="min-w-[640px]">
            <ErpTableHead sticky>
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-center">Days</th>
                <th className="px-3 py-2">Holiday</th>
                <th className="px-3 py-2">For</th>
                <th className="px-3 py-2">Applies to</th>
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {months.map((m) => [
                <tr key={`m-${m.key}`} className="bg-[var(--surface-sunken)]">
                  <td colSpan={6} className="px-3 py-1.5 text-xs font-bold text-[var(--brand-deep)]">
                    {m.label}
                    <span className="ml-2 font-normal text-[var(--muted)]">
                      {m.holidays.length ? `${m.holidays.length} holiday(s) · ${m.days} day(s)` : "no holidays"}
                    </span>
                  </td>
                </tr>,
                ...m.holidays.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-[var(--brand-deep)]">{holidayDateLabel(h)}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{h.workingOverride ? "—" : holidayDayCount(h)}</td>
                    <td className="px-3 py-2">
                      {h.title} <Kind h={h} />
                      {dups.has(h.id) ? (
                        <span className="ml-1 rounded bg-[var(--danger-soft)] px-1 text-[10px] font-semibold text-[var(--danger)]">duplicate</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{scopeLabel(h)}</td>
                    <td className="px-3 py-2 text-xs">{appliesToLabel(h.appliesTo)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {extra?.(h)}
                        <RowActionMenu row={h} label={`${h.title} actions`} actions={actions(h)} />
                      </div>
                    </td>
                  </tr>
                )),
              ])}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>
    </div>
  );
}
