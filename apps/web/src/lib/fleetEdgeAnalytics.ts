/**
 * Fleet Edge dashboard — pure scoring/aggregation logic (no I/O), matching
 * this codebase's established "heuristic score, clamped, documented,
 * monotonic" pattern (see paymentLikelihoodScore in lib/collectionsAi.ts,
 * leadConversionScore in lib/admissionsAi.ts). Nothing here is AI-invented
 * — it's a deterministic composite from real Fleet Edge signals. The one
 * genuinely AI-generated piece (the Director's Report narrative) is built
 * strictly on top of these already-computed numbers, never in place of them.
 *
 * "Offline" and "performance score" are deliberately orthogonal:
 * - Offline is a CURRENT/live status — last-seen time vs now, independent
 *   of whatever historical date range is selected for scoring.
 * - High/Average/Low are percentile ranks computed over the selected date
 *   range, among vehicles that are currently online. A vehicle offline
 *   right now never competes in that ranking, however well it drove last
 *   month — that's what "offline" as its own bucket means.
 */

/** No event of any kind in this long — vehicle is considered offline right
 * now. 24h (not e.g. 1h) deliberately: Fleet Edge's real heartbeat cadence
 * hasn't been observed yet (only one validation ping so far) and a school
 * bus sits parked overnight/weekends — a short threshold would flag a
 * perfectly fine parked bus as "offline". Tune once real traffic patterns
 * are known; don't treat this default as confirmed fact. */
export const OFFLINE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** A vehicle that hasn't sent anything in this long drops out of the
 * dashboard universe entirely, rather than sitting in "Offline" forever. */
export const FLEET_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** Vehicle refs known NOT to belong to this school's real fleet — excluded
 * from the dashboard/KPIs/reports (raw event viewer still shows them, for
 * debugging). "MATXXXXXXXX" is Tata's own demo/sandbox VIN, confirmed by
 * its real telemetry reporting GPS coordinates in Haryana while every real
 * vehicle in the Subscribed Vehicles Report is based at the school in
 * Varanasi — it's not a masked real vehicle, it never appears in that
 * report at all. */
export const NON_FLEET_VEHICLE_REFS = new Set<string>(["MATXXXXXXXX"]);

export type FaultDetail = { description: string; suggestedAction: string };

export type GeofenceVisit = {
  geofenceName: string;
  durationInSeconds: number;
  inDateTime: string | null;
  outDateTime: string | null;
};

export type VehicleFleetMetrics = {
  vehicleRef: string;
  registrationNumber: string | null;
  lastSeenAt: string | null;
  // Safety (summed across periodic-summary windows in the selected range)
  haCount: number;
  hbCount: number;
  rtCount: number;
  nightDrivingSeconds: number;
  coastingSeconds: number;
  overSpeedCount: number;
  sosCount: number;
  fuelDrainCount: number;
  fuelDrainedLiters: number;
  refuelCount: number;
  geofenceEventCount: number;
  // Efficiency
  distanceTravelledKm: number;
  fuelConsumed: number;
  averageSpeedSamples: number[];
  idlingSeconds: number;
  stoppageSeconds: number;
  engineLoadHeavySamples: number[];
  engineLoadLightSamples: number[];
  engineLoadMediumSamples: number[];
  geofenceVisits: GeofenceVisit[];
  // Health
  faultCritical: number;
  faultWarning: number;
  faultCriticalDetails: FaultDetail[];
  faultWarningDetails: FaultDetail[];
  lowFuelAlertCount: number;
  lowDefAlertCount: number;
  incidents: number;
  serviceDue: string | null;
  // Latest live telemetry snapshot (not bounded by the selected range)
  lastTelemetry: {
    lat: number | null;
    lng: number | null;
    speed: number | null;
    ignitionOn: boolean | null;
    fuelLevelPercent: number | null;
    odometer: number | null;
    at: string | null;
  } | null;
};

export function emptyVehicleMetrics(vehicleRef: string, registrationNumber: string | null): VehicleFleetMetrics {
  return {
    vehicleRef,
    registrationNumber,
    lastSeenAt: null,
    haCount: 0,
    hbCount: 0,
    rtCount: 0,
    nightDrivingSeconds: 0,
    coastingSeconds: 0,
    overSpeedCount: 0,
    sosCount: 0,
    fuelDrainCount: 0,
    fuelDrainedLiters: 0,
    refuelCount: 0,
    geofenceEventCount: 0,
    distanceTravelledKm: 0,
    fuelConsumed: 0,
    averageSpeedSamples: [],
    idlingSeconds: 0,
    stoppageSeconds: 0,
    engineLoadHeavySamples: [],
    engineLoadLightSamples: [],
    engineLoadMediumSamples: [],
    geofenceVisits: [],
    faultCritical: 0,
    faultWarning: 0,
    faultCriticalDetails: [],
    faultWarningDetails: [],
    lowFuelAlertCount: 0,
    lowDefAlertCount: 0,
    incidents: 0,
    serviceDue: null,
    lastTelemetry: null,
  };
}

export function averageSpeed(m: VehicleFleetMetrics): number | null {
  if (m.averageSpeedSamples.length === 0) return null;
  const sum = m.averageSpeedSamples.reduce((a, b) => a + b, 0);
  return sum / m.averageSpeedSamples.length;
}

/** Average engine-load mix (heavy/medium/light %) across the periodic
 * summaries in range — null when no details payload has carried it yet. */
export function averageEngineLoad(m: VehicleFleetMetrics): { heavy: number; medium: number; light: number } | null {
  if (m.engineLoadHeavySamples.length === 0) return null;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    heavy: avg(m.engineLoadHeavySamples),
    medium: avg(m.engineLoadMediumSamples),
    light: avg(m.engineLoadLightSamples),
  };
}

function clampContribution(value: number, min: number): number {
  return Math.max(min, value);
}

/**
 * 0-100 composite, 100 = no adverse signals recorded. Every deduction is
 * capped so one runaway metric (e.g. a data glitch reporting 500 harsh
 * brakes) can't single-handedly zero the score — each category still
 * shows up, but proportionally.
 */
export function computeFleetPerformanceScore(m: VehicleFleetMetrics): number {
  let score = 100;

  score += clampContribution(-(m.haCount + m.hbCount + m.rtCount) * 1.5, -30);
  score += clampContribution(-m.overSpeedCount * 3, -15);
  score += clampContribution(-m.sosCount * 20, -40);
  score += clampContribution(-m.faultCritical * 8, -32);
  score += clampContribution(-m.faultWarning * 2, -16);
  score += clampContribution(-m.incidents * 5, -20);
  score += clampContribution(-m.fuelDrainCount * 10, -20);

  // Idling ratio penalty — only meaningful once there's real driving to
  // compare against (avoids penalizing a vehicle that simply hasn't moved
  // much yet, e.g. a newly-onboarded one).
  const activeSeconds = m.idlingSeconds + m.stoppageSeconds;
  if (m.distanceTravelledKm > 5 && activeSeconds > 0) {
    const idlingRatio = m.idlingSeconds / (activeSeconds + m.distanceTravelledKm * 120);
    if (idlingRatio > 0.3) {
      score += clampContribution(-(idlingRatio - 0.3) * 40, -15);
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export type FleetBucket = "high" | "average" | "low" | "offline";

export function isVehicleOffline(lastSeenAt: string | null, asOfMs: number): boolean {
  if (!lastSeenAt) return true;
  const t = Date.parse(lastSeenAt);
  if (!Number.isFinite(t)) return true;
  return asOfMs - t > OFFLINE_THRESHOLD_MS;
}

export type OfflinePeriod = {
  vehicleRef: string;
  registrationNumber: string | null;
  from: string;
  /** null = still ongoing (vehicle is offline right now). */
  to: string | null;
  durationMs: number;
};

/** Fleet Edge sends no "offline log" of its own — this derives offline
 * periods from gaps in what we've actually received: any gap between two
 * consecutive events longer than OFFLINE_THRESHOLD_MS is a period the
 * vehicle was silent. A trailing gap up to `asOfMs` is an ongoing period
 * (to: null) exactly when isVehicleOffline would say so right now — the two
 * are kept consistent on purpose. */
export function computeOfflinePeriods(
  vehicleRef: string,
  registrationNumber: string | null,
  eventTimestamps: readonly string[],
  asOfMs: number = Date.now(),
): OfflinePeriod[] {
  const sorted = eventTimestamps
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const periods: OfflinePeriod[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > OFFLINE_THRESHOLD_MS) {
      periods.push({
        vehicleRef,
        registrationNumber,
        from: new Date(sorted[i - 1]).toISOString(),
        to: new Date(sorted[i]).toISOString(),
        durationMs: gap,
      });
    }
  }
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    const trailingGap = asOfMs - last;
    if (trailingGap > OFFLINE_THRESHOLD_MS) {
      periods.push({
        vehicleRef,
        registrationNumber,
        from: new Date(last).toISOString(),
        to: null,
        durationMs: trailingGap,
      });
    }
  }
  return periods;
}

/** Percentile rank of `score` among `allScores` (0-100). Ties split the
 * difference (standard "mean rank" percentile), so identical scores land
 * in the same bucket rather than arbitrarily ordering by array position. */
export function percentileRank(score: number, allScores: number[]): number {
  if (allScores.length === 0) return 50;
  const below = allScores.filter((s) => s < score).length;
  const equal = allScores.filter((s) => s === score).length;
  return ((below + 0.5 * equal) / allScores.length) * 100;
}

export function bucketForPercentile(pct: number): "high" | "average" | "low" {
  if (pct >= 60) return "high";
  if (pct >= 40) return "average";
  return "low";
}

export type VehicleDashboardRow = VehicleFleetMetrics & {
  score: number | null;
  percentile: number | null;
  bucket: FleetBucket;
};

/** Assigns every vehicle to exactly one of the 4 KPI buckets — offline
 * vehicles never enter the percentile ranking (see file header). */
export function buildFleetDashboard(
  metrics: VehicleFleetMetrics[],
  asOfMs: number = Date.now(),
): { rows: VehicleDashboardRow[]; kpis: Record<FleetBucket, number> } {
  const online: VehicleFleetMetrics[] = [];
  const offline: VehicleFleetMetrics[] = [];
  for (const m of metrics) {
    (isVehicleOffline(m.lastSeenAt, asOfMs) ? offline : online).push(m);
  }

  const scored = online.map((m) => ({ metrics: m, score: computeFleetPerformanceScore(m) }));
  const allScores = scored.map((s) => s.score);

  const rows: VehicleDashboardRow[] = [
    ...scored.map(({ metrics: m, score }) => {
      const pct = percentileRank(score, allScores);
      return { ...m, score, percentile: pct, bucket: bucketForPercentile(pct) };
    }),
    ...offline.map((m) => ({ ...m, score: null, percentile: null, bucket: "offline" as const })),
  ];

  const kpis: Record<FleetBucket, number> = { high: 0, average: 0, low: 0, offline: 0 };
  for (const r of rows) kpis[r.bucket] += 1;

  return { rows, kpis };
}
