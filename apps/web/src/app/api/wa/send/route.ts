/**
 * Send an approved template to a chosen audience.
 *
 * POST { audience, templateFamilyKey, variables?, dryRun? }
 *
 * One route for every audience the send screen offers — staff by stream,
 * department or designation; parents by class or section; families at a fee
 * stage; hand-picked students. Before this each audience meant another
 * route with its own idea of RBAC and its own opt-out handling, and the two
 * that existed between them covered "all parents", "all staff" and "my own
 * class".
 *
 * The client sends the AUDIENCE, never a list of numbers: a resolved list in
 * a request body is an audience anybody can edit.
 *
 * `dryRun: true` resolves and counts without sending, and returns a sample
 * of names. The screen requires that step before it will send, because on
 * this route the expensive mistake is aiming, not delivery.
 *
 * Staff route: RBAC on `notifications` edit — the grant the school-wide
 * broadcast has always used.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { parseWaAudienceSpec } from "@/lib/waAudienceSpec";
import { resolveWaAudience } from "@/lib/waAudienceResolve.server";
import { sendTemplateToAudience } from "@/lib/waAudienceSend.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "notifications", "edit");
  if (!auth.ok) return auth.response;

  let body: {
    audience?: unknown;
    templateFamilyKey?: string;
    variables?: Record<string, string>;
    dryRun?: boolean;
    /** Echoed back from the dry run, to prove the count was seen. */
    confirmCount?: number;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseWaAudienceSpec(body.audience);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const familyKey = String(body.templateFamilyKey || "").trim();
  if (!familyKey) {
    return NextResponse.json(
      { error: "templateFamilyKey is required — this route sends approved templates only" },
      { status: 400 },
    );
  }

  const resolved = await resolveWaAudience(parsed.spec);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error || "Could not work out the audience" },
      { status: 502 },
    );
  }

  const summary = {
    audienceLabel: resolved.label,
    wholeSchool: resolved.wholeSchool,
    recipientCount: resolved.recipients.length,
    skippedOptOut: resolved.skippedOptOut,
    skippedNotOnWhatsApp: resolved.skippedNotOnWhatsApp,
    skippedNoNumber: resolved.skippedNoNumber,
    sample: resolved.recipients.slice(0, 8).map((r) => r.name),
  };

  if (body.dryRun) {
    return NextResponse.json({ ok: true, mode: "dry_run", ...summary });
  }

  if (!resolved.recipients.length) {
    return NextResponse.json(
      { error: "Nobody in this audience can be messaged", ...summary },
      { status: 400 },
    );
  }

  // The count the office was shown must match what is about to be sent.
  // Between a dry run and a send, a fee payment or a roster edit can move
  // the audience; sending a different number of messages than the person
  // approved is how a "one class" send becomes a whole-school one.
  if (
    typeof body.confirmCount === "number" &&
    body.confirmCount !== resolved.recipients.length
  ) {
    return NextResponse.json(
      {
        error: `The audience changed since you checked it — now ${resolved.recipients.length} recipients, you approved ${body.confirmCount}. Check it again before sending.`,
        ...summary,
      },
      { status: 409 },
    );
  }

  const result = await sendTemplateToAudience({
    recipients: resolved.recipients,
    familyKey,
    variables: body.variables || {},
    originUrl: req.url,
    audienceKind: parsed.spec.kind,
  });

  return NextResponse.json({
    ok: result.failed === 0 && result.sent > 0,
    mode: "live",
    ...summary,
    sent: result.sent,
    failed: result.failed,
    deferred: result.deferred,
    skippedNoTemplate: result.skippedNoTemplate,
    error: result.error || undefined,
  });
}
