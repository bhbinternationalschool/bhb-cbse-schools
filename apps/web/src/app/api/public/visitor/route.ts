/**
 * Public (no login) endpoint behind the gate QR — /visit page.
 * POST { action: "lookup" | "checkin" | "checkout" | "status", ... }
 * Rate-limited per IP; reveals only what a gate needs (child first names,
 * class, admission stage) and only for the mobile the visitor typed.
 */

import { NextResponse } from "next/server";
import {
  lookupVisitorMobile,
  selfServiceCheckIn,
  selfServiceCheckOut,
  visitStatus,
} from "@/lib/visitorSelfService.server";
import { VISITOR_PURPOSES, type VisitorPurpose } from "@/lib/visitors";

export const runtime = "nodejs";

/**
 * GET → { whatsapp: "91XXXXXXXXXX" | null, startText } — the school WhatsApp
 * number for the poster's second QR (wa.me link). WHATSAPP_GATE_NUMBER
 * overrides; otherwise the Meta phone's display number (cached 10 min).
 */
let waNumberCache: { value: string | null; at: number } | null = null;
export async function GET() {
  const override = (process.env.WHATSAPP_GATE_NUMBER || "").replace(/\D/g, "");
  let value: string | null = override || null;
  if (!value) {
    if (waNumberCache && Date.now() - waNumberCache.at < 10 * 60_000) {
      value = waNumberCache.value;
    } else {
      try {
        const { fetchWhatsAppPhoneHealth } = await import("@/lib/waMeta.server");
        const h = await fetchWhatsAppPhoneHealth();
        value = h.displayNumber ? h.displayNumber.replace(/\D/g, "") : null;
      } catch {
        value = null;
      }
      waNumberCache = { value, at: Date.now() };
    }
  }
  const { WA_GATE_START_TEXT } = await import("@/lib/waGateVisit.server");
  return NextResponse.json(
    { ok: true, whatsapp: value, startText: WA_GATE_START_TEXT },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

const hits = new Map<string, { n: number; at: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now - cur.at > 60_000) {
    hits.set(ip, { n: 1, at: now });
    return false;
  }
  cur.n += 1;
  return cur.n > 40;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action || "");
  if (action === "lookup") {
    const r = await lookupVisitorMobile(String(body.mobile || ""));
    if (!r) return NextResponse.json({ ok: false, error: "Enter a valid 10-digit mobile number" }, { status: 400 });
    return NextResponse.json({ ok: true, ...r });
  }
  if (action === "checkin") {
    const purpose = String(body.purpose || "other") as VisitorPurpose;
    const valid = VISITOR_PURPOSES.some((p) => p.value === purpose) ? purpose : "other";
    const r = await selfServiceCheckIn({
      mobile: String(body.mobile || ""),
      visitorName: String(body.visitorName || ""),
      purpose: valid,
      personToMeet: typeof body.personToMeet === "string" ? body.personToMeet : "",
      linkedTo: typeof body.linkedTo === "string" ? body.linkedTo : "",
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "checkout") {
    const r = await selfServiceCheckOut({
      id: typeof body.id === "string" ? body.id : undefined,
      mobile: typeof body.mobile === "string" ? body.mobile : undefined,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  }
  if (action === "status") {
    const entry = await visitStatus(String(body.id || ""));
    return NextResponse.json({ ok: !!entry, entry });
  }
  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
