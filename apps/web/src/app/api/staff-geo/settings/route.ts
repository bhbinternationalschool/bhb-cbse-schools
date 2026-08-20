import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { normalizeStaffGeoSettings, type StaffGeoSettings } from "@/lib/staffGeo";
import { readStaffGeoState, writeStaffGeoState } from "@/lib/staffGeo.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  if (!hasPermission(session, loadMasters(), "staff", "view")) return NextResponse.json({ error: "Staff module access required" }, { status: 403 });
  const st = await readStaffGeoState();
  return NextResponse.json({ ok: true, settings: st.settings, consents: st.consents, school: { lat: TENANT.schoolLat, lng: TENANT.schoolLng } });
}

export async function PUT(req: Request) {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") return NextResponse.json({ error: "Staff login required" }, { status: 403 });
  if (!hasPermission(session, loadMasters(), "staff", "edit")) return NextResponse.json({ error: "Staff edit access required" }, { status: 403 });
  let body: Partial<StaffGeoSettings>;
  try {
    body = (await req.json()) as Partial<StaffGeoSettings>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const st = await readStaffGeoState();
  const settings = normalizeStaffGeoSettings({ ...body, updatedBy: session.fullName }, { lat: TENANT.schoolLat, lng: TENANT.schoolLng });
  const r = await writeStaffGeoState({ settings, consents: st.consents });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, settings });
}
