/**
 * GET /api/transport/track?t=<token> — the public tracking feed.
 *
 * No session: the signed token IS the authorisation, the same way the receipt
 * link works. Three gates stand between a URL and a child's bus:
 *
 *   1. the signature — a forged or edited token is refused
 *   2. the expiry    — a link dies with the run it was issued in
 *   3. the verdict   — even a valid link shows nothing while the bus is not
 *                      on a run, or when the last fix is too old to trust
 *
 * The third is the one that matters most. A parent who bookmarks this page
 * must not be able to watch the bus park at the driver's home in the
 * evening, and the freshness bands mean a stale fix is refused rather than
 * dressed up as live.
 *
 * Always 200 with a reason. This is polled by a page a parent is looking at,
 * and an HTTP error there renders as a broken page rather than as the true
 * and useful sentence "the bus is not on a run right now".
 */

import { NextResponse } from "next/server";
import { busTrackFixForStudent } from "@/lib/parentBusLocation.server";
import { verifyBusTrackToken } from "@/lib/waTransportTrackToken.server";
import { trackRefusalText, type TrackRefusal } from "@/lib/waTransportTrack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refusal(reason: TrackRefusal, busLabel = "") {
  return NextResponse.json(
    { ok: false, reason, message: trackRefusalText(reason), busLabel },
    // No caching, ever: a refusal cached at a CDN would outlast the reason
    // for it, and a position cached would outlast its own freshness.
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") || "";
  const verdict = verifyBusTrackToken(token);
  if (!verdict.ok) {
    // "unconfigured" is a deployment fault, not the parent's. It reads as a
    // bad link to them and is logged loudly by the verifier for us.
    return refusal(verdict.reason === "expired" ? "expired" : "bad-link");
  }

  const fix = await busTrackFixForStudent(verdict.studentId);
  if (!fix.ok) {
    if (fix.reason === "desk-unreadable") {
      return NextResponse.json(
        {
          ok: false,
          reason: "desk-unreadable",
          message:
            "We could not read the transport records just now. Please try again in a minute, or call the transport desk.",
          busLabel: "",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return refusal(fix.reason, fix.busLabel);
  }

  return NextResponse.json(
    {
      ok: true,
      busLabel: fix.busLabel,
      stopName: fix.stopName,
      lat: fix.lat,
      lng: fix.lng,
      speedKmh: fix.speedKmh,
      motion: fix.motion,
      ageLabel: fix.ageLabel,
      at: fix.atIso,
      mapsUrl: fix.mapsUrl,
      freshness: fix.freshness,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
