import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { canvaStatus, disconnectCanva, saveCanvaClient } from "@/lib/canva.server";

export const runtime = "nodejs";

/**
 * The school's Canva connection (used for birthday cards).
 *   GET    → status; never returns the client secret or tokens.
 *   POST   { clientId, clientSecret } → save the integration's credentials.
 *   DELETE → forget the grant (the credentials stay; Connect again to re-grant).
 * Writing is a school-wide credential, so it needs Settings edit — the same
 * gate as the Google Drive connection.
 */
export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "students", "view");
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, ...(await canvaStatus()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireStaffPermission(request, "settings", "edit");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { clientId?: string; clientSecret?: string };
  const clientId = String(body.clientId || "").trim();
  const clientSecret = String(body.clientSecret || "").trim();
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(clientId) || clientSecret.length < 8 || clientSecret.length > 400) {
    return NextResponse.json({ ok: false, error: "Paste the Client ID and Client secret from the Canva Developer Portal" }, { status: 400 });
  }
  try {
    await saveCanvaClient(clientId, clientSecret);
    return NextResponse.json({ ok: true, ...(await canvaStatus()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireStaffPermission(request, "settings", "edit");
  if (!auth.ok) return auth.response;
  try {
    await disconnectCanva();
    return NextResponse.json({ ok: true, ...(await canvaStatus()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
