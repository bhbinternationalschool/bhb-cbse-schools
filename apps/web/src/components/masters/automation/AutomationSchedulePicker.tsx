"use client";

import { useEffect, useMemo, useState } from "react";
import type { AutomationTriggerType } from "@/lib/automation";
import {
  AUTOMATION_EVENT_OPTIONS,
  INTERVAL_PRESETS,
  SCHEDULE_DAY_OPTIONS,
  buildCronExpr,
  describeCronExpr,
  describeIntervalMinutes,
  formatTime24,
  parseCronExpr,
  parseTime24,
  type FriendlySchedule,
  type ScheduleDayPattern,
} from "@/lib/automationSchedule";
import { autoInp } from "./automationUi";

export function AutomationSchedulePicker({
  triggerType,
  cronExpr,
  intervalMinutes,
  eventKey,
  readOnly,
  onCronChange,
  onIntervalChange,
  onEventChange,
  onTriggerTypeChange,
}: {
  triggerType: AutomationTriggerType;
  cronExpr: string;
  intervalMinutes: number;
  eventKey: string;
  readOnly: boolean;
  onCronChange: (expr: string) => void;
  onIntervalChange: (minutes: number) => void;
  onEventChange: (key: string) => void;
  onTriggerTypeChange?: (type: AutomationTriggerType) => void;
}) {
  const initial = useMemo(
    () =>
      parseCronExpr(cronExpr) || {
        hour: 10,
        minute: 0,
        dayPattern: "school_days_mon_sat" as ScheduleDayPattern,
        cronDow: "1-6",
      },
    [cronExpr],
  );

  const [time, setTime] = useState(formatTime24(initial.hour, initial.minute));
  const [dayPattern, setDayPattern] = useState<ScheduleDayPattern>(
    initial.dayPattern,
  );
  const [showAdvanced, setShowAdvanced] = useState(
    initial.dayPattern === "custom",
  );
  const [advancedCron, setAdvancedCron] = useState(cronExpr);

  useEffect(() => {
    const parsed = parseCronExpr(cronExpr);
    if (parsed) {
      setTime(formatTime24(parsed.hour, parsed.minute));
      setDayPattern(parsed.dayPattern);
      setShowAdvanced(parsed.dayPattern === "custom");
    }
    setAdvancedCron(cronExpr);
  }, [cronExpr]);

  function applyFriendlySchedule(
    nextTime: string,
    nextDay: ScheduleDayPattern,
  ) {
    const t = parseTime24(nextTime);
    if (!t) return;
    const sched: FriendlySchedule = {
      hour: t.hour,
      minute: t.minute,
      dayPattern: nextDay,
      cronDow:
        SCHEDULE_DAY_OPTIONS.find((d) => d.id === nextDay)?.cronDow || "*",
    };
    onCronChange(buildCronExpr(sched));
  }

  const triggerOptions: { id: AutomationTriggerType; label: string; hint: string }[] =
    [
      {
        id: "schedule",
        label: "Fixed time",
        hint: "Runs once per day on chosen days (e.g. 10 AM weekdays)",
      },
      {
        id: "interval",
        label: "Repeating",
        hint: "Checks every few hours (e.g. admission follow-ups)",
      },
      {
        id: "event",
        label: "When something happens",
        hint: "Runs when ERP fires an event (homework, absent, etc.)",
      },
    ];

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <div>
        <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
          When should this run?
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">
          No cron syntax needed — pick a simple option below.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {triggerOptions.map((opt) => (
          <button
            key={opt.id}
            type="button"
            disabled={readOnly}
            className={`rounded-lg border px-3 py-2 text-left text-[11px] disabled:opacity-50 ${
              triggerType === opt.id
                ? "border-[#0f766e] bg-[rgba(15,118,110,0.08)] font-semibold text-[var(--brand-deep)]"
                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
            }`}
            onClick={() => onTriggerTypeChange?.(opt.id)}
          >
            <span className="block font-semibold text-[var(--brand-deep)]">
              {opt.label}
            </span>
            <span className="text-[10px]">{opt.hint}</span>
          </button>
        ))}
      </div>

      {triggerType === "schedule" ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Time (24h, IST)
              <input
                type="time"
                className={`${autoInp} mt-1`}
                value={time}
                disabled={readOnly}
                onChange={(e) => {
                  setTime(e.target.value);
                  applyFriendlySchedule(e.target.value, dayPattern);
                }}
              />
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Days
              <select
                className={`${autoInp} mt-1`}
                value={dayPattern === "custom" ? "school_days_mon_sat" : dayPattern}
                disabled={readOnly}
                onChange={(e) => {
                  const next = e.target.value as ScheduleDayPattern;
                  setDayPattern(next);
                  setShowAdvanced(false);
                  applyFriendlySchedule(time, next);
                }}
              >
                {SCHEDULE_DAY_OPTIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-[#0f766e]">
            {describeCronExpr(cronExpr)}
          </p>
          <button
            type="button"
            className="text-[10px] font-semibold text-[var(--muted)] underline"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide advanced cron" : "Advanced: edit cron directly"}
          </button>
          {showAdvanced ? (
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Cron expression
              <input
                className={`${autoInp} mt-1 font-mono text-[11px]`}
                value={advancedCron}
                disabled={readOnly}
                onChange={(e) => {
                  setAdvancedCron(e.target.value);
                  onCronChange(e.target.value);
                }}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {triggerType === "interval" ? (
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            How often?
            <select
              className={`${autoInp} mt-1`}
              value={intervalMinutes || 240}
              disabled={readOnly}
              onChange={(e) =>
                onIntervalChange(Math.max(1, Number(e.target.value) || 240))
              }
            >
              {INTERVAL_PRESETS.map((p) => (
                <option key={p.minutes} value={p.minutes}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-[#0f766e]">
            {describeIntervalMinutes(intervalMinutes)}
          </p>
        </div>
      ) : null}

      {triggerType === "event" ? (
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            ERP event
            <select
              className={`${autoInp} mt-1`}
              value={eventKey}
              disabled={readOnly}
              onChange={(e) => onEventChange(e.target.value)}
            >
              <option value="">— select event —</option>
              {AUTOMATION_EVENT_OPTIONS.map((ev) => (
                <option key={ev.key} value={ev.key}>
                  {ev.label}
                </option>
              ))}
            </select>
          </label>
          {eventKey ? (
            <p className="text-[10px] text-[var(--muted)]">
              {
                AUTOMATION_EVENT_OPTIONS.find((e) => e.key === eventKey)
                  ?.description
              }
            </p>
          ) : (
            <p className="text-[10px] text-[var(--muted)]">
              Or enter a custom key below if your developer added a new event.
            </p>
          )}
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Custom event key (optional)
            <input
              className={`${autoInp} mt-1 font-mono text-[11px]`}
              value={eventKey}
              disabled={readOnly}
              placeholder="homework.published"
              onChange={(e) => onEventChange(e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
