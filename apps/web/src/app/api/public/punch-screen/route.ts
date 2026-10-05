import { NextResponse } from "next/server";
import { punchCodeNow } from "@/lib/punchCode.server";
import { punchDisplayFor } from "@/lib/punchDevices.server";
import { loadPunchOptions } from "@/lib/punchOptions.server";
import { punchWindowState } from "@/lib/punchSchedule";
import { campusGeofenceFromSettings, validateScreenLocation } from "@/lib/staffGeofence.server";
import { fetchStaffAttendanceSettingsFromDb } from "@/lib/staffAttendanceDeskAncillary.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/public/punch-screen — the code for an office QR screen.
 * Authorized by the screen's own token (Authorization: Bearer …), not a
 * login: a login idles out after 30 minutes and the screen is never
 * touched. A revoked or unknown token gets 401 and the screen says so.
 *
 * ?lat=&lng=&acc= — the screen's own location, every time. Outside the
 * school the code is withheld (403, outside: true): the punch QR is shown
 * only on school premises (director, 3 Oct 2026; validateScreenLocation).
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const screen = await punchDisplayFor(token);
  if (screen === "unavailable") {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
  if (!screen) {
    return NextResponse.json({ ok: false, error: "This screen is switched off" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const fence = campusGeofenceFromSettings(await fetchStaffAttendanceSettingsFromDb());
  const where = validateScreenLocation(
    { lat: params.get("lat"), lng: params.get("lng"), accuracyM: params.get("acc") },
    fence,
  );
  if (!where.ok) {
    return NextResponse.json(
      { ok: false, outside: true, error: where.reason, distanceM: Math.round(where.distanceM), label: screen.label },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const now = Date.now();
  // Outside the gate's hours the screen shows a clock, not a code
  // (director, 5 Oct 2026). It keeps polling and opens by itself.
  const options = await loadPunchOptions();
  const gate = punchWindowState(options, now);
  if (!gate.open) {
    return NextResponse.json(
      {
        ok: true,
        closed: true,
        now,
        label: screen.label,
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        opensToday: gate.opensToday,
        reason: gate.reason,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const code = punchCodeNow(now);
  if (!code) {
    return NextResponse.json({ ok: false, error: "Punch codes are not configured" }, { status: 503 });
  }
  return NextResponse.json(
    { ok: true, ...code, now, label: screen.label, windowEnd: options.windowEnd },
    { headers: { "Cache-Control": "no-store" } },
  );
}
