/**
 * POST { enabled } — the owner's Payouts switch (director, 7 Oct 2026: "toggle
 * off/on … because sometime wallet may be low"; owner/director only). ON is
 * refused until the ₹1 test transfer has succeeded.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { setPayoutsEnabled } from "@/lib/payouts.server";
import { isSuperAdminSession } from "@/lib/superAdmin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret || !isSuperAdminSession(auth.ctx.session)) {
    return NextResponse.json({ ok: false, error: "Only the owner can switch Payouts on or off." }, { status: 403 });
  }
  let body: { enabled?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "enabled must be true or false" }, { status: 400 });
  }
  const r = await setPayoutsEnabled(body.enabled, auth.ctx.session.fullName || auth.ctx.session.email || "owner");
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
