/**
 * GET — Cashfree Payouts, as the screens need it: is it configured, is the
 * owner's switch on (and has the ₹1 test passed), and what is left in the
 * prefunded wallet. Director, 7 Oct 2026: a switch, because the wallet may be
 * low. Staff who pay people (Payroll / Staff advances / Accounts view).
 */

import { NextResponse } from "next/server";
import { requireAnyStaffPermission } from "@/lib/apiRouteAuth.server";
import { getPayoutSettings, payoutBalance, payoutKeysPresent, payoutsEnabled } from "@/lib/payouts.server";
import { isSuperAdminSession } from "@/lib/superAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAnyStaffPermission(req, [
    { module: "payroll", action: "view" },
    { module: "staff_advances", action: "view" },
    { module: "accounts", action: "view" },
  ]);
  if (!auth.ok) return auth.response;
  const configured = payoutKeysPresent();
  const [settings, gate] = await Promise.all([getPayoutSettings(), payoutsEnabled()]);
  const balance = configured ? await payoutBalance() : null;
  return NextResponse.json({
    ok: true,
    configured,
    enabled: gate.ok,
    why: gate.why,
    switchOn: settings.enabled,
    testPassedAt: settings.testPassedAt,
    updatedBy: settings.updatedBy,
    updatedAt: settings.updatedAt,
    // null = could not be read: a screen must not take that as zero or as plenty.
    balancePaise: balance && balance.ok ? balance.availablePaise : null,
    balanceError: balance && !balance.ok ? balance.error : "",
    canToggle: !auth.viaMirrorSecret && isSuperAdminSession(auth.ctx.session),
  });
}
