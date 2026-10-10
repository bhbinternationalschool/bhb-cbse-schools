import { NextResponse } from "next/server";
import { completeScreenPairing } from "@/lib/punchDevices.server";
import { campusGeofenceFromSettings, validateScreenLocation } from "@/lib/staffGeofence.server";
import { fetchStaffAttendanceSettingsFromDb } from "@/lib/staffAttendanceDeskAncillary.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/public/punch-screen/pair {code, lat, lng, acc} → {token}
 *
 * A gate phone becomes the punch QR screen with the office's one-time code
 * (director, 5 Oct 2026) — no ERP sign-in on a device that stays at the gate.
 * Not a login: the token it returns opens only /api/public/punch-screen.
 * The phone must be inside the school, as for every QR request; the code is
 * single-use, 10 minutes, and five wrong tries cancel it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    lat?: number | string;
    lng?: number | string;
    acc?: number | string;
  };
  const fence = campusGeofenceFromSettings(await fetchStaffAttendanceSettingsFromDb());
  const where = validateScreenLocation({ lat: body.lat, lng: body.lng, accuracyM: body.acc }, fence);
  if (!where.ok) {
    return NextResponse.json(
      { ok: false, outside: true, error: where.reason || "This phone must be inside the school to become the QR screen." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const r = await completeScreenPairing(body.code);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    { ok: true, token: r.token, label: r.label },
    { headers: { "Cache-Control": "no-store" } },
  );
}
