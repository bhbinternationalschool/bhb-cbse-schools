"use client";

import { useMemo, useState } from "react";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersTablesRow,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import {
  CLASS_GROUPS,
  classGroupCodeForName,
  type MastersState,
} from "@/lib/masters";
import {
  WEEKDAY_LABELS,
  defaultSchoolWeekTiming,
  describeTiming,
  normalizeSchoolTimingConfig,
  normalizeSchoolWeekTiming,
  type SchoolTimingConfig,
  type SchoolWeekTiming,
} from "@/lib/schoolTiming";

type Commit = (s: MastersState, msg?: string) => void;

function TimingFields({
  value,
  onChange,
}: {
  value: SchoolWeekTiming;
  onChange: (t: SchoolWeekTiming) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          <span className="mb-1 block text-[var(--muted)]">Start</span>
          <input
            type="time"
            className="field !py-1.5"
            value={value.startTime}
            onChange={(e) =>
              onChange({ ...value, startTime: e.target.value })
            }
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-[var(--muted)]">End</span>
          <input
            type="time"
            className="field !py-1.5"
            value={value.endTime}
            onChange={(e) => onChange({ ...value, endTime: e.target.value })}
          />
        </label>
        <div className="text-xs">
          <span className="mb-1 block text-[var(--muted)]">Working days</span>
          <div className="flex flex-wrap gap-1">
            {WEEKDAY_LABELS.map((label, i) => {
              const on = value.workingWeekdays.includes(i);
              return (
                <button
                  key={label}
                  type="button"
                  className={`rounded-md px-2 py-1 text-[10px] font-bold ${
                    on
                      ? "bg-[var(--brand-deep)] text-white"
                      : "bg-[rgba(32,48,80,0.08)] text-[var(--muted)]"
                  }`}
                  onClick={() => {
                    const set = new Set(value.workingWeekdays);
                    if (set.has(i)) set.delete(i);
                    else set.add(i);
                    onChange({
                      ...value,
                      workingWeekdays: [...set].sort(),
                    });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-[rgba(32,48,80,0.08)] pt-3">
        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={value.sundayExceptional}
            onChange={(e) =>
              onChange({ ...value, sundayExceptional: e.target.checked })
            }
          />
          Sunday exceptional
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-[var(--muted)]">Sunday start</span>
          <input
            type="time"
            className="field !py-1.5"
            value={value.sundayStartTime}
            disabled={!value.sundayExceptional}
            onChange={(e) =>
              onChange({ ...value, sundayStartTime: e.target.value })
            }
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-[var(--muted)]">Sunday end</span>
          <input
            type="time"
            className="field !py-1.5"
            value={value.sundayEndTime}
            disabled={!value.sundayExceptional}
            onChange={(e) =>
              onChange({ ...value, sundayEndTime: e.target.value })
            }
          />
        </label>
      </div>
    </div>
  );
}

/** School-wide + class-group / class overrides — used by student & staff. */
export function SchoolTimingPanel({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const config = useMemo(
    () => normalizeSchoolTimingConfig(state.schoolTiming),
    [state.schoolTiming],
  );

  const [defaultDraft, setDefaultDraft] = useState(() =>
    normalizeSchoolWeekTiming(config.default),
  );
  const [groupCode, setGroupCode] = useState(CLASS_GROUPS[0]?.code ?? "PRIMARY");
  const [groupTiming, setGroupTiming] = useState(defaultSchoolWeekTiming);
  const [classId, setClassId] = useState("");
  const [classTiming, setClassTiming] = useState(defaultSchoolWeekTiming);

  const classes = useMemo(
    () =>
      [...(state.classes ?? [])]
        .filter((c) => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [state.classes],
  );

  function saveConfig(next: SchoolTimingConfig, msg: string) {
    commit(
      { ...state, schoolTiming: normalizeSchoolTimingConfig(next) },
      msg,
    );
  }

  function saveDefault() {
    saveConfig(
      { ...config, default: normalizeSchoolWeekTiming(defaultDraft) },
      "School timing saved",
    );
  }

  function addGroupOverride() {
    const timing = normalizeSchoolWeekTiming(groupTiming);
    const existing = config.groupOverrides.find((g) => g.groupCode === groupCode);
    const groupOverrides = existing
      ? config.groupOverrides.map((g) =>
          g.groupCode === groupCode ? { ...g, timing } : g,
        )
      : [
          ...config.groupOverrides,
          {
            id: `stg_${Math.random().toString(36).slice(2, 9)}`,
            groupCode,
            timing,
          },
        ];
    saveConfig({ ...config, groupOverrides }, `Group timing · ${groupCode}`);
  }

  function removeGroup(id: string) {
    saveConfig(
      {
        ...config,
        groupOverrides: config.groupOverrides.filter((g) => g.id !== id),
      },
      "Group timing removed",
    );
  }

  function addClassOverride() {
    if (!classId) return;
    const timing = normalizeSchoolWeekTiming(classTiming);
    const existing = config.classOverrides.find((c) => c.classId === classId);
    const classOverrides = existing
      ? config.classOverrides.map((c) =>
          c.classId === classId ? { ...c, timing } : c,
        )
      : [
          ...config.classOverrides,
          {
            id: `stc_${Math.random().toString(36).slice(2, 9)}`,
            classId,
            timing,
          },
        ];
    saveConfig({ ...config, classOverrides }, "Class timing saved");
  }

  function removeClass(id: string) {
    saveConfig(
      {
        ...config,
        classOverrides: config.classOverrides.filter((c) => c.id !== id),
      },
      "Class timing removed",
    );
  }

  function classLabel(id: string) {
    const c = classes.find((x) => x.id === id);
    if (!c) return id;
    const g = classGroupCodeForName(c.name);
    return `${c.name}${g ? ` · ${g}` : ""}`;
  }

  function groupLabel(code: string) {
    return CLASS_GROUPS.find((g) => g.code === code)?.label ?? code;
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-4 py-3 text-sm text-[var(--muted)]">
        School day hours for <strong>students and staff</strong>. Resolution:
        class override → class-group override → school default. Staff attendance
        rules use the school default (or Sunday exceptional flags on the rule).
      </p>

      <MastersTablesRow cols={1}>
        <MastersTableCard title="Effective timings" maxHeight="max-h-[min(40vh,320px)]">
          <ul className="divide-y divide-[rgba(32,48,80,0.08)] text-sm">
            <li className="px-4 py-2.5">
              <span className="font-semibold text-[var(--brand-deep)]">
                School default
              </span>
              <div className="text-[11px] text-[var(--muted)]">
                {describeTiming(config.default)}
              </div>
            </li>
            {config.groupOverrides.map((g) => (
              <li
                key={g.id}
                className="flex items-start justify-between gap-2 px-4 py-2.5"
              >
                <div>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    Group · {groupLabel(g.groupCode)}
                  </span>
                  <div className="text-[11px] text-[var(--muted)]">
                    {describeTiming(g.timing)}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--danger)]"
                  onClick={() => removeGroup(g.id)}
                >
                  Remove
                </button>
              </li>
            ))}
            {config.classOverrides.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-2 px-4 py-2.5"
              >
                <div>
                  <span className="font-semibold text-[var(--brand-deep)]">
                    Class · {classLabel(c.classId)}
                  </span>
                  <div className="text-[11px] text-[var(--muted)]">
                    {describeTiming(c.timing)}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--danger)]"
                  onClick={() => removeClass(c.id)}
                >
                  Remove
                </button>
              </li>
            ))}
            {config.groupOverrides.length === 0 &&
            config.classOverrides.length === 0 ? (
              <li className="px-4 py-2 text-[11px] text-[var(--muted)]">
                No class / group overrides yet — everyone uses school default.
              </li>
            ) : null}
          </ul>
        </MastersTableCard>
      </MastersTablesRow>

      <MastersWorkCard
        title="School default timing"
        hint="Applies to staff and any class without a more specific override"
      >
        <TimingFields value={defaultDraft} onChange={setDefaultDraft} />
        <button
          type="button"
          className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
          onClick={saveDefault}
        >
          Save school default
        </button>
      </MastersWorkCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <MastersWorkCard
          title="Class-group timing"
          hint="e.g. Pre-Primary shorter day; Senior longer day"
        >
          <label className="mb-2 block text-xs">
            <span className="mb-1 block text-[var(--muted)]">Class group</span>
            <select
              className="field !py-1.5"
              value={groupCode}
              onChange={(e) => {
                setGroupCode(e.target.value as typeof groupCode);
                const hit = config.groupOverrides.find(
                  (g) => g.groupCode === e.target.value,
                );
                setGroupTiming(hit?.timing ?? defaultSchoolWeekTiming());
              }}
            >
              {CLASS_GROUPS.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label} ({g.shortLabel})
                </option>
              ))}
            </select>
          </label>
          <TimingFields value={groupTiming} onChange={setGroupTiming} />
          <button
            type="button"
            className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
            onClick={addGroupOverride}
          >
            Save group override
          </button>
        </MastersWorkCard>

        <MastersWorkCard
          title="Class-wise timing"
          hint="Overrides group and school default for one class"
        >
          <label className="mb-2 block text-xs">
            <span className="mb-1 block text-[var(--muted)]">Class</span>
            <select
              className="field !py-1.5"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                const hit = config.classOverrides.find(
                  (c) => c.classId === e.target.value,
                );
                setClassTiming(hit?.timing ?? defaultSchoolWeekTiming());
              }}
            >
              <option value="">Select class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {classes.length === 0 ? <MastersEmptyRow label="No classes yet" /> : null}
          <TimingFields value={classTiming} onChange={setClassTiming} />
          <button
            type="button"
            className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
            disabled={!classId}
            onClick={addClassOverride}
          >
            Save class override
          </button>
        </MastersWorkCard>
      </div>
    </div>
  );
}
