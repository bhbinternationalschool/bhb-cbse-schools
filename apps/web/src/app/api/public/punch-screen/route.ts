import { NextResponse } from "next/server";
import { punchCodeNow } from "@/lib/punchCode.server";
import { punchDisplayFor } from "@/lib/punchDevices.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/public/punch-screen — the code for an office QR screen.
 * Authorized by the screen's own token (Authorization: Bearer …), not a
 * login: a login idles out after 30 minutes and the screen is never
 * touched. A revoked or unknown token gets 401 and the screen says so.
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
  const now = Date.now();
  const code = punchCodeNow(now);
  if (!code) {
    return NextResponse.json({ ok: false, error: "Punch codes are not configured" }, { status: 503 });
  }
  return NextResponse.json(
    { ok: true, ...code, now, label: screen.label },
    { headers: { "Cache-Control": "no-store" } },
  );
}
