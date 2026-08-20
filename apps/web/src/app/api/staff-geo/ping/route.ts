import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { recordStaffPing, readStaffGeoState } from "@/lib/staffGeo.server";
import { inTrackingWindow } from "@/lib/staffGeo";

export const runtime = "nodejs";

/**
 * Staff device → GPS ping. Requires a staff session WITH a linked staffId
 * (so one staff cannot ping for another) and recorded consent (first call
 * carries consent:true after the on-screen consent text).
 */
export async function GET() {
  const st = await readStaffGeoState();
  return NextResponse.json({
    service: "staff-geo-ping",
    enabled: st.settings.enabled,
    tracking: inTrackingWindow(st.settings, new Date()),
    pingIntervalMin: st.settings.pingIntervalMin,
    window: `${st.settings.startTime}–${st.settings.endTime} IST`,
  });
}

export async function POST(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  if (!session.staffId) return NextResponse.json({ error: "Your login is not linked to a staff record — ask the office to link it (Staff → Login)" }, { status: 400 });
  let body: { lat?: number; lng?: number; accuracyM?: number; consent?: boolean; device?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const r = await recordStaffPing({
    staffId: session.staffId,
    lat: Number(body.lat),
    lng: Number(body.lng),
    accuracyM: Number(body.accuracyM) || 0,
    device: String(body.device || "").slice(0, 120),
    consent: body.consent === true,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, needsConsent: r.needsConsent }, { status: r.needsConsent ? 428 : 400 });
  return NextResponse.json({ ok: true, inside: r.inside, distanceM: r.distanceM, tracking: r.tracking });
}
