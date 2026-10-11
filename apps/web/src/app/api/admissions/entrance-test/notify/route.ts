/**
 * /api/admissions/entrance-test/notify — message families about the
 * entrance test (invitation with date/time/venue/roll no, or the result).
 *
 * POST { sessionId, kind: "invite"|"result", candidateIds, resend?, dryRun?, confirmCount? }
 *
 * `dryRun: true` returns the preview — every family's message in its own
 * language, and who is skipped and why. The screen requires it before it
 * will send, and the send must echo the count it was shown
 * (`confirmCount`); a roll or result change in between is refused.
 *
 * Templates only, approved in both languages, through the ERP's one template
 * sender. Nothing is sent while the template is pending — the preview says
 * so. Preview needs admissions:view; sending needs admissions:edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { EntranceTestError } from "@/lib/admissionEntranceTest.server";
import { previewNotify, sendNotify } from "@/lib/admissionEntranceNotify.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  let body: {
    sessionId?: string;
    kind?: string;
    candidateIds?: string[];
    resend?: boolean;
    dryRun?: boolean;
    confirmCount?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("Invalid JSON body", 400);
  }
  const dryRun = body.dryRun === true;
  const auth = await requireStaffPermission(request, "admissions", dryRun ? "view" : "edit");
  if (!auth.ok) return auth.response;

  const kind = body.kind === "invite" || body.kind === "result" ? body.kind : null;
  if (!kind) return fail('kind must be "invite" or "result"', 400);
  const sessionId = String(body.sessionId || "");
  const ids = Array.isArray(body.candidateIds) ? body.candidateIds.map(String) : [];
  const resend = body.resend === true;

  try {
    if (dryRun) {
      return NextResponse.json(
        { ok: true, mode: "dry_run", plan: await previewNotify(sessionId, kind, ids, resend) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (typeof body.confirmCount !== "number") {
      return fail("Preview the messages first (confirmCount missing).", 400);
    }
    const res = await sendNotify(sessionId, kind, ids, resend, body.confirmCount, request.url);
    return NextResponse.json({
      ok: res.failed === 0 && res.sent > 0,
      mode: "live",
      ...res,
    });
  } catch (e) {
    if (e instanceof EntranceTestError) {
      console.warn(`[entrance-test/notify] ${e.status}: ${e.message}`);
      return fail(e.message, e.status);
    }
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error(`[entrance-test/notify] unhandled: ${message}`);
    return fail("Something went wrong. Nothing was confirmed as sent — check before retrying.", 500);
  }
}
