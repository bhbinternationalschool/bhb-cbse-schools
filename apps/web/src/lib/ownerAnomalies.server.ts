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

export async function buildOwnerAnomalies(
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
