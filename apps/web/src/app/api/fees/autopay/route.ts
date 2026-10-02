import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  autopayOverview,
  cancelMandate,
  createMandate,
  retryCharge,
  runAutopayTick,
  saveAutopaySettings,
  sendAutopayInvite,
  syncMandate,
} from "@/lib/feeAutopay.server";
import { publicAppOrigin } from "@/lib/waSisBotServer";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Fee auto-pay, from the Accounts desk.
 *
 * GET                       every mandate, the recent debits, the setting
 * POST {action:"create", householdId, maxPaise?, sendInvite?}
 *      {action:"invite", subscriptionId}
 *      {action:"sync",   subscriptionId}
 *      {action:"cancel", subscriptionId}
 *      {action:"retry",  subscriptionId}        a failed month, once more
 *      {action:"preview"}                       what this month would debit
 *      {action:"settings", enabled?, chargeDay?, defaultMaxPaise?}
 *
 * PERMISSION. Setting a family up, sending the link and stopping auto-pay
 * are fee-desk work (`fees: edit`). Turning debits on and retrying a debit
 * take money from a family on the school's say-so, so they need `fees: void`
 * — the same authority a refund needs.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, ...(await autopayOverview()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not load auto-pay" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action || "");
  const subscriptionId = String(body.subscriptionId || "").trim();
  const highRisk = action === "settings" || action === "retry";
  const auth = await requireStaffPermission(req, "fees", highRisk ? "void" : "edit");
  if (!auth.ok) return auth.response;
  const origin = publicAppOrigin();
  const who = auth.ctx.session.fullName || "fee desk";

  try {
    switch (action) {
      case "create": {
        const householdId = String(body.householdId || "").trim();
        if (!householdId) return NextResponse.json({ ok: false, error: "householdId required" }, { status: 400 });
        const maxPaise = body.maxPaise === undefined ? undefined : Number(body.maxPaise);
        const created = await createMandate({ householdId, maxPaise, createdBy: who, origin });
        if (!created.ok) return NextResponse.json(created, { status: 400 });
        const invite = body.sendInvite === false ? null : await sendAutopayInvite(created.mandate.subscriptionId, origin);
        return NextResponse.json({ ...created, invite });
      }
      case "invite": {
        const r = await sendAutopayInvite(subscriptionId, origin);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "sync": {
        const m = await syncMandate(subscriptionId);
        return m
          ? NextResponse.json({ ok: true, mandate: m })
          : NextResponse.json({ ok: false, error: "No such auto-pay" }, { status: 404 });
      }
      case "cancel": {
        const r = await cancelMandate(subscriptionId);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "retry": {
        const r = await retryCharge(subscriptionId);
        return NextResponse.json({ ok: r.outcome === "raised", result: r }, { status: r.outcome === "error" ? 400 : 200 });
      }
      case "preview": {
        // Never raises anything: a dry run of today's tick.
        return NextResponse.json({ ok: true, report: await runAutopayTick({ dryRun: true }) });
      }
      case "settings": {
        const patch: Record<string, unknown> = {};
        if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
        if (body.chargeDay !== undefined) patch.chargeDay = Number(body.chargeDay);
        if (body.defaultMaxPaise !== undefined) patch.defaultMaxPaise = Number(body.defaultMaxPaise);
        const r = await saveAutopaySettings(patch);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Auto-pay failed" }, { status: 500 });
  }
}
