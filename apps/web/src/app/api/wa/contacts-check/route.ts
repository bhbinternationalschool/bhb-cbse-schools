import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  checkWhatsAppContacts,
  waOutboundConfigured,
  type WaContactCheckResult,
} from "@/lib/waSend";

export const runtime = "nodejs";

/**
 * Live WhatsApp number check (go-live).
 * Body: { mobiles: string[] } — up to 100 local/E.164 numbers.
 * Requires WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (or WA_BSP_CONTACTS_URL).
 */
export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "admissions", "view");
  if (!auth.ok) return auth.response;

  let body: { mobiles?: unknown };
  try {
    body = (await req.json()) as { mobiles?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const mobiles = Array.isArray(body.mobiles)
    ? body.mobiles.map((m) => String(m || "")).filter(Boolean)
    : [];

  if (!mobiles.length) {
    return NextResponse.json(
      { ok: false, error: "mobiles[] required" },
      { status: 400 },
    );
  }

  if (!waOutboundConfigured() && !process.env.WA_BSP_CONTACTS_URL) {
    return NextResponse.json({
      ok: false,
      configured: false,
      mode: "stub",
      results: [] as WaContactCheckResult[],
      error:
        "WhatsApp API not configured yet. After go-live, set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID to check which numbers are on WhatsApp.",
    });
  }

  const r = await checkWhatsAppContacts(mobiles);
  return NextResponse.json({
    ok: r.ok,
    configured: true,
    mode: r.mode,
    results: r.results,
    error: r.error,
  });
}

export async function GET() {
  return NextResponse.json({
    configured: waOutboundConfigured() || !!process.env.WA_BSP_CONTACTS_URL,
    hint: "POST { mobiles: string[] } to verify WhatsApp registration when online",
  });
}
