/**
 * Fleet Director's Report — reuses generateLeadershipDigestJson (built for
 * the principal daily digest) rather than a new LLM function: it already
 * takes a freeform schoolName + metricsSummary and forbids inventing any
 * number not given, which is exactly what a fleet summary needs too.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { generateLeadershipDigestJson } from "@/lib/aiLlm.server";
import { TENANT } from "@/lib/types";
import type { FleetBucket } from "@/lib/fleetEdgeAnalytics";

export const runtime = "nodejs";

type FleetReportInput = {
  from: string;
  to: string;
  kpis: Record<FleetBucket, number>;
  total: number;
  topVehicles: {
    label: string;
    score: number | null;
    bucket: FleetBucket;
    haCount: number;
    hbCount: number;
    rtCount: number;
    overSpeedCount: number;
    sosCount: number;
    faultCritical: number;
    distanceTravelledKm: number;
  }[];
};

function metricsSummary(input: FleetReportInput): string {
  const lines = [
    `Period: ${input.from.slice(0, 10)} to ${input.to.slice(0, 10)}`,
    `Fleet size: ${input.total} vehicles reporting in the last 30 days`,
    `High performing: ${input.kpis.high} · Average: ${input.kpis.average} · Low performing: ${input.kpis.low} · Offline: ${input.kpis.offline}`,
  ];
  for (const v of input.topVehicles) {
    lines.push(
      `Vehicle ${v.label}: score ${v.score ?? "n/a"} (${v.bucket}), ${v.distanceTravelledKm.toFixed(0)} km, ` +
        `${v.haCount + v.hbCount + v.rtCount} harsh events, ${v.overSpeedCount} overspeed, ${v.sosCount} SOS, ${v.faultCritical} critical faults`,
    );
  }
  return lines.join("\n");
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  let body: FleetReportInput;
  try {
    body = (await req.json()) as FleetReportInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.kpis || !Array.isArray(body.topVehicles)) {
    return NextResponse.json({ error: "kpis and topVehicles required" }, { status: 400 });
  }

  const result = await generateLeadershipDigestJson({
    schoolName: `${TENANT.nameDisplay} — Transport fleet`,
    metricsSummary: metricsSummary(body),
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, engine: result.engine }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    engine: result.engine,
    generationId: result.generationId,
    headline: result.headline,
    highlights: result.highlights,
  });
}
