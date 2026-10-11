/**
 * Owner-dashboard anomaly aggregation. Each signal is computed independently
 * and only included on success — a source that fails to compute is omitted
 * entirely rather than reported as zero (a lookup failure is not the same
 * fact as "genuinely nothing wrong").
 */
import { buildPrincipalSnapshot } from "@/lib/principalSnapshot.server";
import { countRecentWaFailures } from "@/lib/waDeliveryLog.server";

export type OwnerAnomalies = {
  attendance?: { pending: number };
  waFailures?: { count: number };
};

/**
 * The scan builds the whole principal snapshot (several seconds) for two
 * counts that move slowly. Every owner's home page asks for it, so one scan
 * per year per minute is shared, and callers arriving while one runs wait
 * for that one instead of starting another. A scan that throws is never
 * cached; partial results (a signal omitted) are cached like any other.
 */
const ANOMALY_TTL_MS = 60_000;
const anomalyCache = new Map<string, { at: number; value: Promise<OwnerAnomalies> }>();

export function buildOwnerAnomalies(academicYearCode?: string): Promise<OwnerAnomalies> {
  const key = academicYearCode ?? "";
  const hit = anomalyCache.get(key);
  if (hit && Date.now() - hit.at < ANOMALY_TTL_MS) return hit.value;
  const value = scanOwnerAnomalies(academicYearCode);
  anomalyCache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (anomalyCache.get(key)?.value === value) anomalyCache.delete(key);
  });
  return value;
}

async function scanOwnerAnomalies(
  academicYearCode?: string,
): Promise<OwnerAnomalies> {
  const [attendanceResult, waFailuresResult] = await Promise.allSettled([
    buildPrincipalSnapshot(academicYearCode),
    countRecentWaFailures(24),
  ]);

  const out: OwnerAnomalies = {};

  if (attendanceResult.status === "fulfilled") {
    out.attendance = {
      pending: attendanceResult.value.alerts.attendanceRegistersPending,
    };
  } else {
    console.warn("[ownerAnomalies] attendance signal failed", attendanceResult.reason);
  }

  if (waFailuresResult.status === "fulfilled") {
    out.waFailures = { count: waFailuresResult.value };
  } else {
    console.warn("[ownerAnomalies] waFailures signal failed", waFailuresResult.reason);
  }

  return out;
}
