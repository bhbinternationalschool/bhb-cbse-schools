import { NextResponse } from "next/server";
import {
  requireJobSecret,
  requireStaffPermission,
} from "@/lib/apiRouteAuth.server";
import { syncWaTemplatesFromMeta } from "@/lib/waTemplateSync.server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Pull template status from Meta and SAVE it.
 *
 * The existing `/api/wa/templates/sync` returns the merged registry for the
 * browser to persist, which is exactly no use on a schedule — and a schedule
 * is what was missing. An approval that arrived while nobody had Masters open
 * was simply never noticed: `bhb_fee_receipt` sat APPROVED at Meta for days
 * while the ERP called it pending and refused to send a single fee receipt.
 *
 * Safe to run repeatedly — it merges rather than replaces, and refuses
 * outright if the stored registry cannot be read, because writing from an
 * empty one would wipe the 67 templates the school has configured.
 *
 *   POST /api/wa/templates/refresh   (x-cron-secret, or staff with wa_templates edit)
 */
export async function GET() {
  return NextResponse.json({
    service: "wa-template-refresh",
    note:
      "POST with x-cron-secret, or as staff with wa_templates edit. " +
      "Reads Meta, applies stored webhook events, and saves the registry.",
  });
}

export async function POST(req: Request) {
  const byJob = requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"]);
  if (!byJob) {
    const auth = await requireStaffPermission(req, "wa_templates", "edit");
    if (!auth.ok) return auth.response;
  }

  const r = await syncWaTemplatesFromMeta();
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    metaTemplates: r.metaTemplates,
    statusEvents: r.statusEvents,
    qualityEvents: r.qualityEvents,
    changed: r.changed,
    readyFamilies: r.readyFamilies,
  });
}
