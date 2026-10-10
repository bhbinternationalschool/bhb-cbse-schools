/**
 * GET — the office's UDISE+ 1(c) figures, by financial year.
 * PUT { year: "2025-26", figures: {...} } — save and confirm one year; the
 * signed-in staff member is recorded as the one who confirmed. The robot
 * fills profile section 1(c) only from a confirmed year
 * (lib/udiseSchoolFinance). Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { normalizeFinanceYear } from "@/lib/udiseSchoolFinance";
import { readFinanceStore, writeFinanceStore } from "@/lib/udiseSchoolFinance.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const store = await readFinanceStore();
  if (!store) return NextResponse.json({ ok: false, error: "Could not read the figures — try again." }, { status: 503 });
  return NextResponse.json({ ok: true, ...store });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { year?: string; figures?: unknown };
  const year = String(body.year || "").trim();
  if (!/^20\d{2}-\d{2}$/.test(year)) return NextResponse.json({ ok: false, error: "Which financial year? e.g. 2025-26" }, { status: 400 });
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "";
  if (!by) return NextResponse.json({ ok: false, error: "Your login has no name to record." }, { status: 400 });
  const store = await readFinanceStore();
  if (!store) return NextResponse.json({ ok: false, error: "Could not read the figures — nothing saved." }, { status: 503 });
  const y = normalizeFinanceYear({ ...(body.figures as object), confirmedBy: by, confirmedAt: new Date().toISOString() });
  if (!y.source) return NextResponse.json({ ok: false, error: "Say where the figures come from (e.g. audited accounts FY 2025-26)." }, { status: 400 });
  store.years[year] = y;
  const w = await writeFinanceStore(store);
  if (!w.ok) return NextResponse.json({ ok: false, error: w.error }, { status: 500 });
  return NextResponse.json({ ok: true, ...store });
}
