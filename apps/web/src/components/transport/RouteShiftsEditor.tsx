"use client";

import { useMemo } from "react";
import { CLASS_GROUPS, type ClassGroupCode } from "@/lib/masters";
import type { SchoolTimingConfig } from "@/lib/schoolTiming";
import { WEEKDAY_LABELS } from "@/lib/schoolTiming";
import type { TransportShift, TransportShiftDirection } from "@/lib/transport";
import {
  checkRouteShiftFeasibility,
  listRouteShifts,
  suggestShiftsFromTiming,
} from "@/lib/transportShifts";

/**
 * The timed runs of one route.
 *
 * Two things this screen has to get across, because neither is obvious from a
 * list of times. First, the class groups on a run are not decoration — they
 * are what puts 168 children on the right journey without anybody assigning
 * them. Second, a route that has never been measured cannot be told whether
 * one bus can do two afternoon runs, so the feasibility line says "not
 * measured" rather than showing a reassuring tick.
 */

export type ShiftDraft = {
  key: string;
  id: string;
  name: string;
  direction: TransportShiftDirection;
  departTime: string;
  classGroups: ClassGroupCode[];
  weekdays: number[];
};

export function newShiftDraft(
  direction: TransportShiftDirection = "drop",
): ShiftDraft {
  return {
    key: `sd_${Math.random().toString(36).slice(2, 10)}`,
    id: "",
    name: "",
    direction,
    departTime: "",
    classGroups: [],
    weekdays: [],
  };
}

export function shiftDraftsFromRoute(shifts: TransportShift[]): ShiftDraft[] {
  return shifts.map((s) => ({
    key: `sd_${s.id}`,
    id: s.id,
    name: s.name,
    direction: s.direction,
    departTime: s.departTime,
    classGroups: s.classGroups,
    weekdays: s.weekdays,
  }));
}

export function RouteShiftsEditor({
  rows,
  onChange,
  timing,
  groupsRiding,
  roundTripMinutes,
  onNote,
}: {
  rows: ShiftDraft[];
  onChange: (next: ShiftDraft[]) => void;
  /** School timings, so runs can be drafted from the real dismissal times. */
  timing: SchoolTimingConfig | null;
  /** Class groups actually on this bus — so no run is proposed for nobody. */
  groupsRiding: ClassGroupCode[];
  /** Measured round trip, for the one-bus-two-runs check. 0 = never measured. */
  roundTripMinutes: number;
  onNote?: (message: string) => void;
}) {
  function patch(key: string, p: Partial<ShiftDraft>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  function remove(key: string) {
    onChange(rows.filter((r) => r.key !== key));
  }

  // The feasibility check reads the same shape the stored route does, so the
  // warning on this screen is the one the desk will show after saving.
  const feasibility = useMemo(
    () =>
      checkRouteShiftFeasibility({
        id: "draft",
        code: "",
        name: "",
        busNo: "",
        shifts: rows.map((r) => ({
          id: r.id || r.key,
          name: r.name || "Run",
          direction: r.direction,
          departTime: r.departTime,
          classGroups: r.classGroups,
          weekdays: r.weekdays,
          isActive: true,
        })),
        ...(roundTripMinutes > 0 ? { roundTripMinutes } : {}),
      }),
    [rows, roundTripMinutes],
  );

  const pickupCount = rows.filter((r) => r.direction === "pickup").length;
  const dropCount = rows.length - pickupCount;

  // A group no drop run carries is the failure that strands a child, so it is
  // computed here rather than waiting for somebody to open the coverage panel.
  const unservedDrop = useMemo(() => {
    if (dropCount === 0) return [];
    return groupsRiding.filter(
      (g) =>
        !rows.some((r) => r.direction === "drop" && r.classGroups.includes(g)),
    );
  }, [rows, groupsRiding, dropCount]);

  function applySuggestions() {
    if (!timing) {
      onNote?.("School timings have not loaded yet");
      return;
    }
    const drafts = suggestShiftsFromTiming({ timing, groupsRiding });
    if (drafts.length === 0) {
      onNote?.(
        "Nobody is on this bus yet, so there is nothing to work the runs out from. Assign riders first, or add the runs by hand.",
      );
      return;
    }
    onChange(
      drafts.map((d) => ({
        ...newShiftDraft(d.direction),
        name: d.name,
        departTime: d.departTime,
        classGroups: d.classGroups,
        weekdays: [],
      })),
    );
    onNote?.(
      `Drafted ${drafts.length} run${drafts.length === 1 ? "" : "s"} from the dismissal times — check the departures before saving.`,
    );
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-[var(--muted)]">
          No runs set up. This route does one journey each way, which is how it
          has always worked. Add runs only when the same bus goes out twice —
          the little ones at one time and the rest at another.
        </p>
      ) : null}

      {rows.map((row, i) => (
        <ShiftRow
          key={row.key}
          row={row}
          index={i}
          onPatch={(p) => patch(row.key, p)}
          onRemove={() => remove(row.key)}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-mid)]"
          onClick={() => onChange([...rows, newShiftDraft("pickup")])}
        >
          + Pick-up run
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-mid)]"
          onClick={() => onChange([...rows, newShiftDraft("drop")])}
        >
          + Drop run
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-mid)] disabled:opacity-40"
          onClick={applySuggestions}
          disabled={!timing || groupsRiding.length === 0}
          title={
            groupsRiding.length === 0
              ? "Assign riders to this bus first — the dismissal times of the classes actually on it are what the runs are drafted from"
              : "Draft runs from the school's dismissal times"
          }
        >
          Suggest from dismissal times
        </button>
      </div>

      {unservedDrop.length > 0 ? (
        <p className="rounded-lg border border-[var(--danger)] bg-[rgba(220,38,38,0.08)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
          No drop run carries{" "}
          {unservedDrop
            .map((g) => CLASS_GROUPS.find((x) => x.code === g)?.label ?? g)
            .join(", ")}
          . Children in {unservedDrop.length === 1 ? "that group" : "those groups"}{" "}
          ride this bus and would have no way home. Tick the group on a run
          above.
        </p>
      ) : null}

      {rows.length > 1 ? (
        <p
          className={`rounded-lg px-3 py-2 text-[11px] ${
            feasibility.verdict === "impossible"
              ? "border border-[var(--danger)] bg-[rgba(220,38,38,0.08)] font-semibold text-[var(--danger)]"
              : "bg-[var(--surface-sunken)] text-[var(--muted)]"
          }`}
        >
          {feasibility.verdict === "unknown-round-trip"
            ? "This route has never been measured, so whether one bus can do these runs back to back cannot be checked. Run “Suggest order” on the stops above to measure it."
            : feasibility.verdict === "unknown-times"
              ? "Set a departure time on at least two runs to check whether one bus can do them back to back."
              : feasibility.pairs.map((p) => p.detail).join(" ")}
        </p>
      ) : null}

      {pickupCount === 0 && dropCount > 0 ? (
        <p className="text-[10px] text-[var(--muted)]">
          Drop runs only — the morning stays one journey, which is usually
          right. Add a pick-up run only if the bus goes out twice in the
          morning too.
        </p>
      ) : null}
    </div>
  );
}

function ShiftRow({
  row,
  index,
  onPatch,
  onRemove,
}: {
  row: ShiftDraft;
  index: number;
  onPatch: (p: Partial<ShiftDraft>) => void;
  onRemove: () => void;
}) {
  function toggleGroup(code: ClassGroupCode) {
    onPatch({
      classGroups: row.classGroups.includes(code)
        ? row.classGroups.filter((g) => g !== code)
        : [...row.classGroups, code],
    });
  }

  function toggleDay(d: number) {
    onPatch({
      weekdays: row.weekdays.includes(d)
        ? row.weekdays.filter((x) => x !== d)
        : [...row.weekdays, d].sort(),
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2">
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-center text-[11px] font-bold tabular-nums text-[var(--muted)]">
          {index + 1}
        </span>

        <input
          className="field !py-1.5 min-w-[8rem] flex-1"
          value={row.name}
          placeholder={row.direction === "pickup" ? "Morning" : "Main drop"}
          onChange={(e) => onPatch({ name: e.target.value })}
          aria-label="Run name"
        />

        <select
          className="field !py-1.5 w-28"
          value={row.direction}
          onChange={(e) =>
            onPatch({ direction: e.target.value as TransportShiftDirection })
          }
          aria-label="Direction"
        >
          <option value="pickup">Pick-up</option>
          <option value="drop">Drop</option>
        </select>

        <label className="flex items-center gap-1">
          <span className="text-[10px] text-[var(--muted)]">Leaves</span>
          <input
            className="field !py-1.5 w-24"
            type="time"
            value={row.departTime}
            onChange={(e) => onPatch({ departTime: e.target.value })}
            aria-label="Departure time"
          />
        </label>

        <button
          type="button"
          className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-[11px] font-semibold text-[var(--danger)]"
          onClick={onRemove}
          aria-label={`Remove ${row.name || "run"}`}
        >
          Remove
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 pl-7">
        <span className="mr-1 text-[10px] text-[var(--muted)]">Carries</span>
        {CLASS_GROUPS.map((g) => {
          const on = row.classGroups.includes(g.code);
          return (
            <button
              key={g.code}
              type="button"
              onClick={() => toggleGroup(g.code)}
              aria-pressed={on}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                on
                  ? "border-[var(--brand-mid)] bg-[rgba(197,160,40,0.16)] text-[var(--brand-deep)]"
                  : "border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {g.shortLabel}
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1 pl-7">
        <span className="mr-1 text-[10px] text-[var(--muted)]">
          {row.weekdays.length === 0 ? "Every school day" : "Only on"}
        </span>
        {WEEKDAY_LABELS.map((label, d) => {
          const on = row.weekdays.includes(d);
          return (
            <button
              key={label}
              type="button"
              onClick={() => toggleDay(d)}
              aria-pressed={on}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                on
                  ? "border-[var(--brand-mid)] bg-[rgba(197,160,40,0.16)] text-[var(--brand-deep)]"
                  : "border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {row.classGroups.length === 0 ? (
        <p className="mt-1 pl-7 text-[10px] text-[var(--muted)]">
          No class group ticked — nobody reaches this run by rule, so it will
          only carry children placed on it by hand.
        </p>
      ) : null}
    </div>
  );
}

/** One line naming a route's runs, for a summary list. */
export function describeRouteShifts(shifts: TransportShift[]): string {
  const pickup = listRouteShifts({ shifts }, "pickup");
  const drop = listRouteShifts({ shifts }, "drop");
  if (pickup.length + drop.length === 0) return "One run each way";
  const part = (runs: TransportShift[], word: string) =>
    runs.length === 0
      ? ""
      : `${word}: ${runs.map((r) => `${r.name} ${r.departTime || "—"}`).join(", ")}`;
  return [part(pickup, "Pick-up"), part(drop, "Drop")]
    .filter(Boolean)
    .join(" · ");
}
