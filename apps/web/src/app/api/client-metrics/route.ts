import { NextResponse } from "next/server";
import {
  MAX_BODY_BYTES,
  MetricRateLimiter,
  metricLogLine,
  parseMetricBody,
  readBodyCapped,
  sessionFromRequest,
} from "@/lib/clientMetrics.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/client-metrics — one measurement from a signed-in page or phone
 * (data-layer 1.2). Writes ONE structured log line
 * `{event:'client-metric', build, platform, persona, roleCode, route, metric,
 * key, ms, bytes, rows}` and nothing else: no database write.
 *
 *   401  no valid session cookie (sendBeacon sends cookies; the app sends its own)
 *   429  more than 60 reports a minute from one session
 *   413  body over 2 KB
 *   400  unknown event, or a field out of range
 *   204  logged
 *
 * The rules are lib/clientMetrics.server.ts; the senders are
 * lib/clientMetrics.ts (web) and core/api/api_client.dart (Flutter).
 */
const limiter = new MetricRateLimiter();

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = sessionFromRequest(req);
  if (!auth) return fail(401, "sign in first");
  if (!limiter.take(MetricRateLimiter.keyFor(auth.raw))) return fail(429, "too many reports");

  const body = await readBodyCapped(req, MAX_BODY_BYTES);
  if (!body.ok) return body.tooLarge ? fail(413, `body over ${MAX_BODY_BYTES} bytes`) : fail(400, "body unreadable");

  const parsed = parseMetricBody(body.text);
  if (!parsed.ok) return fail(400, parsed.error);

  console.log(JSON.stringify(metricLogLine(parsed.metric, auth.session)));
  return new NextResponse(null, { status: 204 });
}
