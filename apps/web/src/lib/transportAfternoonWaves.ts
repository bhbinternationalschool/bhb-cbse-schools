/**
 * Afternoon planning: can one vehicle serve two dismissals?
 *
 * Mornings are simple — one start time, so every vehicle runs one wave and
 * everybody arrives together. The afternoon is where money is lost: dismissal
 * differs by class group, so a bus that waits for the last group leaves the
 * little ones sitting, and a bus per group means buying vehicles that stand
 * idle for most of the day.
 *
 * The question is arithmetic, not judgement: is the gap between two dismissals
 * longer than the route's round trip? If yes, one vehicle does both. If no, the
 * route needs a second vehicle for that wave, or the earlier children wait.
 *
 * The round trip must be MEASURED (Directions, via "Suggest order"). A route
 * that has never been measured returns `unknown` rather than an estimate —
 * being ten minutes optimistic here strands small children at the gate, and a
 * plausible number would be believed.
 */

import { CLASS_GROUPS, type ClassGroupCode, type MastersState } from "@/lib/masters";
import { resolveSchoolTiming } from "@/lib/schoolTiming";
import type { SisState } from "@/lib/sis";
import { listActiveRoutes, type TransportState } from "@/lib/transport";

export type DismissalWave = {
  /** HH:mm the group is let out. */
  endTime: string;
  groups: { code: ClassGroupCode; label: string; riders: number }[];
  riders: number;
};

export type RouteAfternoonPlan = {
  routeId: string;
  routeCode: string;
  routeLabel: string;
  riders: number;
  /** Measured round trip, or null when the route has never been measured. */
  roundTripMinutes: number | null;
  waves: DismissalWave[];
  verdict:
    | "single-wave"
    | "one-vehicle-two-trips"
    | "needs-second-vehicle"
    | "unknown-round-trip"
    | "no-riders";
  /** Minutes between the first and last dismissal this route serves. */
  gapMinutes: number | null;
  /** Plain-language explanation for the screen. */
  detail: string;
};

export type VehicleShareSuggestion = {
  earlyRouteId: string;
  earlyRouteLabel: string;
  lateRouteId: string;
  lateRouteLabel: string;
  earlyEndTime: string;
  lateEndTime: string;
  gapMinutes: number;
  earlyRoundTripMinutes: number;
  detail: string;
};

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

/** How long after dismissal the vehicle is actually rolling. */
const LOADING_MINUTES = 10;

export function planAfternoonWaves(
  state: TransportState,
  sis: SisState | null,
  masters: MastersState | null,
  academicYearCode: string,
): RouteAfternoonPlan[] {
  if (!sis || !masters) return [];

  const classById = new Map(masters.classes.map((c) => [c.id, c]));
  const groupOfClass = new Map<string, ClassGroupCode>();
  for (const g of CLASS_GROUPS) {
    for (const name of g.classNames) {
      const cls = masters.classes.find((c) => c.name === name);
      if (cls) groupOfClass.set(cls.id, g.code);
    }
  }

  const studentById = new Map(sis.students.map((s) => [s.id, s]));

  return listActiveRoutes(state).map((route) => {
    const riders = state.assignments.filter(
      (a) =>
        a.routeId === route.id &&
        a.academicYearCode === academicYearCode &&
        a.effectiveTo == null,
    );

    // Group the riders by the time their class group is let out.
    const byEnd = new Map<string, Map<ClassGroupCode, number>>();
    for (const a of riders) {
      const st = studentById.get(a.studentId);
      if (!st) continue;
      const cls = classById.get(st.classId || "");
      const groupCode = groupOfClass.get(st.classId || "") ?? null;
      const { timing } = resolveSchoolTiming(masters.schoolTiming, {
        classId: st.classId,
        className: cls?.name ?? null,
        groupCode,
      });
      const end = timing.endTime;
      if (!byEnd.has(end)) byEnd.set(end, new Map());
      const inner = byEnd.get(end)!;
      const key = (groupCode ?? "PRE_PRIMARY") as ClassGroupCode;
      inner.set(key, (inner.get(key) ?? 0) + 1);
    }

    const waves: DismissalWave[] = [...byEnd.entries()]
      .map(([endTime, groups]) => ({
        endTime,
        groups: [...groups.entries()].map(([code, n]) => ({
          code,
          label: CLASS_GROUPS.find((g) => g.code === code)?.shortLabel ?? code,
          riders: n,
        })),
        riders: [...groups.values()].reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => (toMinutes(a.endTime) ?? 0) - (toMinutes(b.endTime) ?? 0));

    const rt = route.roundTripMinutes && route.roundTripMinutes > 0
      ? route.roundTripMinutes
      : null;

    const base = {
      routeId: route.id,
      routeCode: route.code,
      routeLabel: route.busNo || route.code,
      riders: riders.length,
      roundTripMinutes: rt,
      waves,
    };

    if (riders.length === 0) {
      return { ...base, verdict: "no-riders" as const, gapMinutes: null, detail: "Nobody assigned to this bus yet." };
    }
    if (waves.length <= 1) {
      return {
        ...base,
        verdict: "single-wave" as const,
        gapMinutes: 0,
        detail: `All ${riders.length} riders leave at ${waves[0]?.endTime ?? "the same time"} — one afternoon trip.`,
      };
    }

    const first = toMinutes(waves[0].endTime);
    const last = toMinutes(waves[waves.length - 1].endTime);
    const gap = first != null && last != null ? last - first : null;

    if (rt == null) {
      return {
        ...base,
        verdict: "unknown-round-trip" as const,
        gapMinutes: gap,
        detail:
          "This route has never been measured, so whether one vehicle can do both trips is unknown. Run “Suggest order” on it first.",
      };
    }

    const needed = rt + LOADING_MINUTES;
    if (gap != null && gap >= needed) {
      return {
        ...base,
        verdict: "one-vehicle-two-trips" as const,
        gapMinutes: gap,
        detail: `${gap} min between ${waves[0].endTime} and ${waves[waves.length - 1].endTime}; the round trip takes ${rt} min plus loading. One vehicle can do both.`,
      };
    }
    return {
      ...base,
      verdict: "needs-second-vehicle" as const,
      gapMinutes: gap,
      detail: `Only ${gap ?? "?"} min between ${waves[0].endTime} and ${waves[waves.length - 1].endTime}, but the round trip needs ${needed} min with loading. Either a second vehicle, or the earlier group waits ${Math.max(0, needed - (gap ?? 0))} min.`,
    };
  });
}

/**
 * Pairs of routes whose dismissals are far enough apart that one vehicle could
 * cover both — the "shuffle" question.
 *
 * Only suggests where both routes are measured and both carry riders in a
 * single wave each. Anything more tangled is a decision for a person with a
 * timetable, not a heuristic.
 */
export function suggestVehicleSharing(
  plans: RouteAfternoonPlan[],
): VehicleShareSuggestion[] {
  const singles = plans.filter(
    (p) => p.verdict === "single-wave" && p.roundTripMinutes != null && p.riders > 0,
  );

  const out: VehicleShareSuggestion[] = [];
  for (const a of singles) {
    for (const b of singles) {
      if (a.routeId === b.routeId) continue;
      const ea = toMinutes(a.waves[0]?.endTime ?? "");
      const eb = toMinutes(b.waves[0]?.endTime ?? "");
      if (ea == null || eb == null || ea >= eb) continue;
      const gap = eb - ea;
      const needed = (a.roundTripMinutes ?? 0) + LOADING_MINUTES;
      if (gap < needed) continue;
      out.push({
        earlyRouteId: a.routeId,
        earlyRouteLabel: a.routeLabel,
        lateRouteId: b.routeId,
        lateRouteLabel: b.routeLabel,
        earlyEndTime: a.waves[0].endTime,
        lateEndTime: b.waves[0].endTime,
        gapMinutes: gap,
        earlyRoundTripMinutes: a.roundTripMinutes ?? 0,
        detail: `${a.routeLabel} finishes its ${a.waves[0].endTime} run in ${a.roundTripMinutes} min, and ${b.routeLabel} does not leave until ${b.waves[0].endTime} — ${gap} min later. One vehicle could cover both afternoons.`,
      });
    }
  }
  return out.sort((x, y) => y.gapMinutes - x.gapMinutes);
}
