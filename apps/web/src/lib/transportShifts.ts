/**
 * Which timed run a child is on, and whether the runs add up.
 *
 * The morning is one journey — everybody starts school together. The
 * afternoon is not: dismissal is staggered by class group, so one bus goes
 * out at 13:40 for the little ones and again at 15:40 for the rest. Before
 * shifts existed both were recorded as `trip: "PM"`, one label for two
 * different journeys, and the attendant's list mixed them.
 *
 * WHY A CHILD IS NOT ASSIGNED A RUN BY HAND
 * There are 168 riders. Assigning each one a morning run and an afternoon run
 * is 336 decisions that are all the same decision — the class decides — and
 * every one of them goes stale the April the child moves up. So a run declares
 * which class groups it carries and the rider follows from their class. The
 * per-child override is for what the rule cannot know: the Class II child who
 * waits for an elder sister and goes home on the late run.
 *
 * WHAT THIS REFUSES TO DO
 * It never picks a run by falling back to "the first one" or "the only one
 * left". A child whose run cannot be decided is returned as unresolved with
 * the reason, because a wrong afternoon run does not read as an error on a
 * screen — it reads as a five-year-old getting off at the wrong time in the
 * wrong village. Every caller surfaces those; none of them guesses.
 */

import { CLASS_GROUPS, type ClassGroupCode } from "@/lib/masters";
import {
  resolveSchoolTiming,
  type SchoolTimingConfig,
} from "@/lib/schoolTiming";
import type {
  TransportRoute,
  TransportShift,
  TransportShiftDirection,
} from "@/lib/transport";

/** How long after dismissal the vehicle is actually rolling. */
export const LOADING_MINUTES = 10;

/** Slack below which two consecutive runs are possible but uncomfortable. */
const TIGHT_MINUTES = 10;

export function shiftMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function fromMinutes(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function shiftTimeLabel(shift: TransportShift): string {
  return shift.departTime || "time not set";
}

export function groupLabel(code: ClassGroupCode): string {
  return CLASS_GROUPS.find((g) => g.code === code)?.label ?? code;
}

/** Does this run operate on this weekday? Empty `weekdays` means every day. */
export function shiftRunsOn(shift: TransportShift, weekday: number): boolean {
  if (shift.weekdays.length === 0) return true;
  return shift.weekdays.includes(weekday);
}

/**
 * The live runs of a route in one direction, earliest first.
 *
 * A run with no time sorts last rather than first. Sorting "" as 00:00 would
 * put an unconfigured run at the head of the afternoon list, where it reads
 * as the early drop.
 */
export function listRouteShifts(
  route: Pick<TransportRoute, "shifts">,
  direction: TransportShiftDirection,
): TransportShift[] {
  return (route.shifts ?? [])
    .filter((s) => s.isActive && s.direction === direction)
    .slice()
    .sort((a, b) => {
      const am = shiftMinutes(a.departTime);
      const bm = shiftMinutes(b.departTime);
      if (am == null && bm == null) return a.name.localeCompare(b.name);
      if (am == null) return 1;
      if (bm == null) return -1;
      return am - bm || a.name.localeCompare(b.name);
    });
}

export type ShiftResolutionReason =
  /** The route has no runs configured — one implicit journey, as it always was. */
  | "no-shifts"
  /** The office pinned this child to this run. */
  | "override"
  /** One run in this direction, and it claims this child's group (or claims none). */
  | "only-run"
  /** One run, but it does not claim this child's group. Resolved, and flagged. */
  | "only-run-unclaimed"
  /** Matched by the child's class group. */
  | "class-group"
  /** Pinned to a run that has been deleted, deactivated or turned around. */
  | "override-missing"
  /** Several runs, none claiming this child's group. */
  | "no-run-for-group"
  /** Several runs claim this child's group — the configuration contradicts itself. */
  | "ambiguous-group"
  /** The child's class group is not known, so no rule can apply. */
  | "unknown-group";

export type ShiftResolution = {
  direction: TransportShiftDirection;
  /** The run, or null when it could not be decided. */
  shift: TransportShift | null;
  reason: ShiftResolutionReason;
  /** True when somebody in the office has to look at this. */
  needsAttention: boolean;
  detail: string;
};

/**
 * Which run this child is on, in one direction.
 *
 * `groupCode` is the child's class group, null when their class is unknown.
 * An unknown class cannot be resolved by rule and is reported as such — it is
 * not quietly put on the first run.
 */
export function resolveRiderShift(input: {
  route: Pick<TransportRoute, "shifts">;
  direction: TransportShiftDirection;
  /** The override stored on the assignment, "" when there is none. */
  overrideShiftId?: string;
  groupCode: ClassGroupCode | null;
}): ShiftResolution {
  const { direction } = input;
  const runs = listRouteShifts(input.route, direction);
  const word = direction === "pickup" ? "pick-up" : "drop";

  if (runs.length === 0) {
    return {
      direction,
      shift: null,
      reason: "no-shifts",
      needsAttention: false,
      detail: `This route has no ${word} runs set up, so it runs one journey as before.`,
    };
  }

  const overrideId = (input.overrideShiftId || "").trim();
  if (overrideId) {
    const pinned = runs.find((s) => s.id === overrideId);
    if (pinned) {
      return {
        direction,
        shift: pinned,
        reason: "override",
        needsAttention: false,
        detail: `Placed on ${pinned.name} by hand.`,
      };
    }
    // Deliberately NOT falling through to the class-group rule. A deleted run
    // silently replaced by the rule would move a child to a different journey
    // with nobody told — which is exactly the decision somebody made by hand.
    return {
      direction,
      shift: null,
      reason: "override-missing",
      needsAttention: true,
      detail: `This child was placed on a ${word} run that no longer exists. Choose one.`,
    };
  }

  if (!input.groupCode) {
    return {
      direction,
      shift: null,
      reason: "unknown-group",
      needsAttention: true,
      detail: `This child's class is not known, so their ${word} run cannot be worked out. Set the class, or choose a run by hand.`,
    };
  }

  if (runs.length === 1) {
    const only = runs[0];
    const claimed =
      only.classGroups.length === 0 || only.classGroups.includes(input.groupCode);
    return {
      direction,
      shift: only,
      reason: claimed ? "only-run" : "only-run-unclaimed",
      needsAttention: !claimed,
      detail: claimed
        ? `${only.name} is the only ${word} run on this route.`
        : `${only.name} is the only ${word} run on this route, but it is not marked as carrying ${groupLabel(input.groupCode)}. The child is on it — correct the run or the rider.`,
    };
  }

  const matches = runs.filter((s) => s.classGroups.includes(input.groupCode!));
  if (matches.length === 1) {
    return {
      direction,
      shift: matches[0],
      reason: "class-group",
      needsAttention: false,
      detail: `${matches[0].name} carries ${groupLabel(input.groupCode)}.`,
    };
  }
  if (matches.length === 0) {
    return {
      direction,
      shift: null,
      reason: "no-run-for-group",
      needsAttention: true,
      detail: `No ${word} run on this route carries ${groupLabel(input.groupCode)}. Add the group to a run, or place this child by hand.`,
    };
  }
  return {
    direction,
    shift: null,
    reason: "ambiguous-group",
    needsAttention: true,
    detail: `${matches.map((s) => s.name).join(" and ")} both carry ${groupLabel(input.groupCode)}. Only one may, or place this child by hand.`,
  };
}

/* ─── Coverage: does every rider have a run? ───────────────── */

export type ShiftRiderInput = {
  studentId: string;
  studentName: string;
  groupCode: ClassGroupCode | null;
  pickupShiftId?: string;
  dropShiftId?: string;
};

export type UnresolvedRider = {
  studentId: string;
  studentName: string;
  direction: TransportShiftDirection;
  reason: ShiftResolutionReason;
  detail: string;
};

export type RouteShiftCoverage = {
  routeId: string;
  routeLabel: string;
  riderCount: number;
  pickupRuns: number;
  dropRuns: number;
  /** Riders whose run could not be decided. Empty is the healthy state. */
  unresolved: UnresolvedRider[];
  /** Class groups that ride this route but no drop run carries. */
  unservedDropGroups: ClassGroupCode[];
  /** Class groups carried by more than one run in the same direction. */
  contestedGroups: ClassGroupCode[];
  /** Runs with no departure time set — unusable on a parent's screen. */
  untimedRuns: { id: string; name: string; direction: TransportShiftDirection }[];
};

/**
 * Everything wrong with one route's runs, in the order it matters.
 *
 * A route with no runs at all is not "wrong" — it is the pre-shift behaviour
 * and reports clean. What is wrong is a route that has runs and a child who
 * falls through them.
 */
export function routeShiftCoverage(
  route: Pick<TransportRoute, "id" | "code" | "name" | "busNo" | "shifts">,
  riders: ShiftRiderInput[],
): RouteShiftCoverage {
  const pickupRuns = listRouteShifts(route, "pickup");
  const dropRuns = listRouteShifts(route, "drop");
  const routeLabel = route.busNo || route.code || route.name;

  const unresolved: UnresolvedRider[] = [];
  for (const r of riders) {
    for (const direction of ["pickup", "drop"] as TransportShiftDirection[]) {
      const res = resolveRiderShift({
        route,
        direction,
        overrideShiftId:
          direction === "pickup" ? r.pickupShiftId : r.dropShiftId,
        groupCode: r.groupCode,
      });
      if (res.needsAttention) {
        unresolved.push({
          studentId: r.studentId,
          studentName: r.studentName,
          direction,
          reason: res.reason,
          detail: res.detail,
        });
      }
    }
  }

  const groupsRiding = new Set<ClassGroupCode>();
  for (const r of riders) if (r.groupCode) groupsRiding.add(r.groupCode);

  const unservedDropGroups =
    dropRuns.length === 0
      ? []
      : [...groupsRiding].filter(
          (g) => !dropRuns.some((s) => s.classGroups.includes(g)),
        );

  const contested: ClassGroupCode[] = [];
  for (const runs of [pickupRuns, dropRuns]) {
    if (runs.length < 2) continue;
    for (const g of CLASS_GROUPS.map((x) => x.code)) {
      const hits = runs.filter((s) => s.classGroups.includes(g)).length;
      if (hits > 1 && !contested.includes(g)) contested.push(g);
    }
  }

  const untimedRuns = [...pickupRuns, ...dropRuns]
    .filter((s) => !s.departTime)
    .map((s) => ({ id: s.id, name: s.name, direction: s.direction }));

  return {
    routeId: route.id,
    routeLabel,
    riderCount: riders.length,
    pickupRuns: pickupRuns.length,
    dropRuns: dropRuns.length,
    unresolved,
    unservedDropGroups,
    contestedGroups: contested,
    untimedRuns,
  };
}

/* ─── Can one vehicle actually do two runs? ────────────────── */

export type ShiftPairCheck = {
  earlierId: string;
  earlierName: string;
  earlierTime: string;
  laterId: string;
  laterName: string;
  laterTime: string;
  gapMinutes: number;
  roundTripMinutes: number;
  verdict: "ok" | "tight" | "impossible";
  detail: string;
};

export type RouteShiftFeasibility = {
  routeId: string;
  routeLabel: string;
  verdict:
    | "ok"
    | "tight"
    | "impossible"
    | "unknown-round-trip"
    | "unknown-times"
    | "single-run";
  detail: string;
  pairs: ShiftPairCheck[];
};

/**
 * Whether consecutive runs on one route can be done by one vehicle.
 *
 * Arithmetic, not judgement: the gap between two departures must exceed the
 * measured round trip. The round trip must be MEASURED (Directions, via
 * "Suggest order") — a route that has never been measured returns
 * `unknown-round-trip` rather than an estimate, because being ten minutes
 * optimistic here strands small children at the gate and a plausible number
 * would be believed.
 */
export function checkRouteShiftFeasibility(
  route: Pick<
    TransportRoute,
    "id" | "code" | "name" | "busNo" | "shifts" | "roundTripMinutes"
  >,
): RouteShiftFeasibility {
  const routeLabel = route.busNo || route.code || route.name;
  const base = { routeId: route.id, routeLabel, pairs: [] as ShiftPairCheck[] };

  const runs = [
    ...listRouteShifts(route, "pickup"),
    ...listRouteShifts(route, "drop"),
  ];
  if (runs.length < 2) {
    return {
      ...base,
      verdict: "single-run",
      detail: "One run or none — nothing to overlap.",
    };
  }

  const timed = runs
    .map((s) => ({ s, m: shiftMinutes(s.departTime) }))
    .filter((x): x is { s: TransportShift; m: number } => x.m != null)
    .sort((a, b) => a.m - b.m);

  if (timed.length < 2) {
    return {
      ...base,
      verdict: "unknown-times",
      detail:
        "Fewer than two runs have a departure time set, so they cannot be checked against each other.",
    };
  }

  const rt = Math.round(Number(route.roundTripMinutes) || 0);
  if (rt <= 0) {
    return {
      ...base,
      verdict: "unknown-round-trip",
      detail:
        "This route has never been measured, so there is no round trip to compare the gap against. Run “Suggest order” on the route to measure it.",
    };
  }

  const pairs: ShiftPairCheck[] = [];
  for (let i = 1; i < timed.length; i += 1) {
    const a = timed[i - 1];
    const b = timed[i];
    const gap = b.m - a.m;
    const verdict: ShiftPairCheck["verdict"] =
      gap < rt ? "impossible" : gap < rt + TIGHT_MINUTES ? "tight" : "ok";
    pairs.push({
      earlierId: a.s.id,
      earlierName: a.s.name,
      earlierTime: a.s.departTime,
      laterId: b.s.id,
      laterName: b.s.name,
      laterTime: b.s.departTime,
      gapMinutes: gap,
      roundTripMinutes: rt,
      verdict,
      detail:
        verdict === "impossible"
          ? `${a.s.name} takes ${rt} min but ${b.s.name} leaves ${gap} min later — one vehicle cannot do both. Put a second vehicle on ${b.s.name}, or move it later.`
          : verdict === "tight"
            ? `${gap} min for a ${rt} min round trip — it works with nothing to spare.`
            : `${gap} min for a ${rt} min round trip — comfortable.`,
    });
  }

  const worst = pairs.some((p) => p.verdict === "impossible")
    ? "impossible"
    : pairs.some((p) => p.verdict === "tight")
      ? "tight"
      : "ok";

  return {
    ...base,
    pairs,
    verdict: worst,
    detail:
      worst === "impossible"
        ? "At least one pair of runs cannot be done by the same vehicle."
        : worst === "tight"
          ? "Every pair is possible, but at least one has no slack."
          : "Every pair of runs is comfortably within the measured round trip.",
  };
}

/* ─── Proposing runs from the dismissal times ──────────────── */

export type SuggestedShift = {
  name: string;
  direction: TransportShiftDirection;
  departTime: string;
  classGroups: ClassGroupCode[];
  /** Where the time came from, shown so a clerk can argue with it. */
  detail: string;
};

/**
 * Draft a route's runs from the school's own timings.
 *
 * Groups that are let out at the same minute share one run; a distinct
 * dismissal gets its own. The vehicle rolls `LOADING_MINUTES` after the bell,
 * which is the difference between a schedule and a fiction.
 *
 * `groupsRiding` is the groups actually on this bus, so a route carrying only
 * Primary and Middle does not get a Pre-Primary run it will never use.
 *
 * These are a draft. Nothing is saved until somebody accepts them — the
 * school's real afternoon has assembly days and a late Saturday that no
 * config knows about.
 */
export function suggestShiftsFromTiming(input: {
  timing: SchoolTimingConfig;
  groupsRiding: ClassGroupCode[];
  /** Class ids per group, when known — a class override beats the group's. */
  classIdByGroup?: Partial<Record<ClassGroupCode, string>>;
}): SuggestedShift[] {
  const groups = input.groupsRiding.filter(
    (g, i, all) => all.indexOf(g) === i,
  );
  if (groups.length === 0) return [];

  const startBuckets = new Map<string, ClassGroupCode[]>();
  const endBuckets = new Map<string, ClassGroupCode[]>();

  for (const g of groups) {
    const { timing } = resolveSchoolTiming(input.timing, {
      groupCode: g,
      classId: input.classIdByGroup?.[g],
    });
    const s = timing.startTime;
    const e = timing.endTime;
    if (!startBuckets.has(s)) startBuckets.set(s, []);
    startBuckets.get(s)!.push(g);
    if (!endBuckets.has(e)) endBuckets.set(e, []);
    endBuckets.get(e)!.push(g);
  }

  const out: SuggestedShift[] = [];

  // Pick-up: the bus must ARRIVE by the bell, so the run is named for the
  // earliest start it serves and its departure is left to the office — the
  // journey out is the round trip, which only Directions knows.
  const starts = [...startBuckets.entries()].sort((a, b) =>
    (shiftMinutes(a[0]) ?? 0) - (shiftMinutes(b[0]) ?? 0),
  );
  starts.forEach(([start, gs], i) => {
    out.push({
      name: starts.length === 1 ? "Morning" : `Morning ${i + 1}`,
      direction: "pickup",
      departTime: "",
      classGroups: gs,
      detail: `${gs.map(groupLabel).join(", ")} start at ${start}. Set the departure so the bus reaches school before the bell — the round trip is the journey, and only a measured route knows it.`,
    });
  });

  const ends = [...endBuckets.entries()].sort((a, b) =>
    (shiftMinutes(a[0]) ?? 0) - (shiftMinutes(b[0]) ?? 0),
  );
  ends.forEach(([end, gs], i) => {
    const m = shiftMinutes(end);
    const depart = m == null ? "" : fromMinutes(m + LOADING_MINUTES);
    out.push({
      name:
        ends.length === 1
          ? "Afternoon"
          : i === 0
            ? "Early drop"
            : i === ends.length - 1
              ? "Main drop"
              : `Drop ${i + 1}`,
      direction: "drop",
      departTime: depart,
      classGroups: gs,
      detail: `${gs.map(groupLabel).join(", ")} are let out at ${end}; ${LOADING_MINUTES} minutes to load.`,
    });
  });

  return out;
}
