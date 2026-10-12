import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { normalizeStaffGeoSettings, type StaffGeoSettings } from "@/lib/staffGeo";
import { readStaffGeoState, writeStaffGeoState } from "@/lib/staffGeo.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

// Staff view / change, or the staff.gps_presence function (lib/rbacFeatureCatalog/people.ts).
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  const st = await readStaffGeoState();
  return NextResponse.json({ ok: true, settings: st.settings, consents: st.consents, school: { lat: TENANT.schoolLat, lng: TENANT.schoolLng } });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return NextResponse.json({ error: "Settings are changed by a person, not a service" }, { status: 403 });
  const session = auth.ctx.session;
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
