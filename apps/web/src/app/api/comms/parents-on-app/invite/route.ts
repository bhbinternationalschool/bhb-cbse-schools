/**
 * Comms → Parents on app → Send app invite.
 *
 * POST { householdIds, dryRun?, confirmCount? } (notifications · edit — the
 * grant every WhatsApp send uses)
 *
 * The client names FAMILIES; the server decides who actually gets it, from
 * the same report the office sees (lib/parentsOnAppReport.server):
 *  - never signed in, not invited in the last 7 days, a real phone number
 *    (lib/parentsOnApp pickInviteFamilies);
 *  - a placeholder number is never messaged (realInviteNumbers);
 *  - one send-once claim per family per India day (wa_send_claims), so a
 *    second press, a second tab or a retry after a partial failure cannot
 *    message a family twice; a claim behind a real send is never released;
 *  - each family reached is written to parent_app_invites as its chunk
 *    returns, which keeps it out of the next invite for 7 days.
 * The message is the approved School notice template (lib/parentAppInvite),
 * in Hindi unless the family chose English. `dryRun` counts without sending;
 * a live send must echo the dry run's count (confirmCount).
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  APP_INVITE_BODY,
  APP_INVITE_TEMPLATE_FAMILY,
  APP_INVITE_TITLE,
  appInviteClaimKey,
  realInviteNumbers,
} from "@/lib/parentAppInvite";
import { istDay, pickInviteFamilies } from "@/lib/parentsOnApp";
import { loadParentsOnAppReport } from "@/lib/parentsOnAppReport.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { TENANT } from "@/lib/types";
import { resolveWaAudience, type WaAudienceRecipient } from "@/lib/waAudienceResolve.server";
import { sendTemplateToAudience } from "@/lib/waAudienceSend.server";
import { claimSendOnce, releaseSendClaim } from "@/lib/waSendClaim.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "notifications", "edit");
  if (!auth.ok) return auth.response;

  let body: { householdIds?: unknown; dryRun?: boolean; confirmCount?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const householdIds = Array.isArray(body.householdIds)
    ? [...new Set(body.householdIds.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, 2000)
    : [];
  if (!householdIds.length) return NextResponse.json({ error: "Pick at least one family" }, { status: 400 });

  const ay = auth.ctx.session.academicYearCode || "";
  const loaded = await loadParentsOnAppReport(ay);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (!loaded.invitesAvailable) {
    // The invite log is what stops a family being invited twice — without it, refuse.
    return NextResponse.json({ error: "Could not read who was already invited — nothing sent. Try again." }, { status: 503 });
  }

  const now = new Date();
  const pick = pickInviteFamilies(loaded.report.families, householdIds, now);
  const inviteIds = new Set(pick.invite.map((f) => f.householdId));

  const summary = {
    skippedSignedIn: pick.signedIn,
    skippedRecentlyInvited: pick.recentlyInvited,
    skippedNoPhone: pick.noPhone,
    skippedNotOnRoll: pick.notOnRoll,
  };
  if (!inviteIds.size) {
    return NextResponse.json({ ok: true, mode: body.dryRun ? "dry_run" : "live", recipientCount: 0, sent: 0, ...summary });
  }

  // The family's own numbers and language, as every WhatsApp send resolves
  // them — then only the picked families, and never a placeholder number.
  const resolved = await resolveWaAudience(
    { kind: "students", studentIds: [...new Set(pick.invite.flatMap((f) => f.children.map((c) => c.studentId)))] },
    { academicYearCode: ay },
  );
  if (!resolved.ok) return NextResponse.json({ error: resolved.error || "Could not work out the audience" }, { status: 502 });
  let placeholderOnly = 0;
  const recipients: WaAudienceRecipient[] = [];
  const seen = new Set<string>();
  for (const r of resolved.recipients) {
    if (!inviteIds.has(r.refId) || seen.has(r.refId)) continue;
    const nums = realInviteNumbers(r);
    if (!nums) {
      placeholderOnly++;
      continue;
    }
    seen.add(r.refId);
    recipients.push({ ...r, mobile: nums.mobile, fallbackMobile: nums.fallbackMobile });
  }
  const counts = {
    ...summary,
    skippedOptOut: resolved.skippedOptOut,
    skippedNotOnWhatsApp: resolved.skippedNotOnWhatsApp,
    skippedNoNumber: resolved.skippedNoNumber + placeholderOnly,
    sample: recipients.slice(0, 8).map((r) => r.name),
  };

  if (body.dryRun) return NextResponse.json({ ok: true, mode: "dry_run", recipientCount: recipients.length, ...counts });
  if (!recipients.length) return NextResponse.json({ error: "None of these families can be messaged", recipientCount: 0, ...counts }, { status: 400 });
  if (typeof body.confirmCount === "number" && body.confirmCount !== recipients.length) {
    return NextResponse.json(
      {
        error: `The families changed since you checked — now ${recipients.length}, you approved ${body.confirmCount}. Check again before sending.`,
        recipientCount: recipients.length,
        ...counts,
      },
      { status: 409 },
    );
  }

  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ error: "Database unavailable — nothing sent." }, { status: 503 });

  // One claim per family per India day; held or unavailable → not sent.
  const today = istDay(now.toISOString());
  const by = auth.ctx.session.fullName || "office";
  const claimed: WaAudienceRecipient[] = [];
  let skippedInProgress = 0;
  for (const r of recipients) {
    const claim = await claimSendOnce(appInviteClaimKey(r.refId, today), by, "parent app invite");
    if (claim.ok) claimed.push(r);
    else skippedInProgress++;
  }
  if (!claimed.length) {
    return NextResponse.json(
      { error: "These families are already being invited (or were today) — nothing sent again.", recipientCount: recipients.length, skippedInProgress, ...counts },
      { status: 409 },
    );
  }

  const reached = new Set<string>();
  /** Families the dispatcher explicitly did NOT send to (failed, deferred, no provider). */
  const notSent = new Set<string>();
  let recordFailed = 0;
  const result = await sendTemplateToAudience({
    recipients: claimed,
    familyKey: APP_INVITE_TEMPLATE_FAMILY,
    variables: { schoolName: TENANT.name, noticeTitle: APP_INVITE_TITLE, noticeBody: APP_INVITE_BODY },
    originUrl: req.url,
    audienceKind: "app_invite",
    onChunkResults: async (rows) => {
      const sent = rows.filter((x) => x.status === "sent" && x.refId).map((x) => x.refId);
      for (const id of sent) reached.add(id);
      for (const x of rows) if (x.refId && x.status !== "sent") notSent.add(x.refId);
      if (!sent.length) return;
      const at = new Date().toISOString();
      try {
        const { error } = await ctx.sb
          .from("parent_app_invites")
          .upsert(
            sent.map((household_id) => ({ tenant_id: ctx.tenantId, household_id, invited_at: at, invited_by: by })),
            { onConflict: "tenant_id,household_id" },
          );
        if (error) {
          recordFailed += sent.length;
          console.warn("[parents-on-app/invite] could not record invites:", error.message);
        }
      } catch (e) {
        recordFailed += sent.length;
        console.warn("[parents-on-app/invite] could not record invites:", e instanceof Error ? e.message : e);
      }
    },
  });

  // Give back the claims of families the dispatcher said it did not send to,
  // so a later press can try them. A claim behind a real send — or behind a
  // chunk whose outcome is unknown (the dispatch threw) — is kept for the day.
  for (const r of claimed) {
    if (notSent.has(r.refId) && !reached.has(r.refId)) await releaseSendClaim(appInviteClaimKey(r.refId, today)).catch(() => undefined);
  }

  return NextResponse.json({
    ok: result.sent > 0 && result.failed === 0,
    mode: "live",
    recipientCount: recipients.length,
    ...counts,
    skippedInProgress,
    sent: result.sent,
    failed: result.failed,
    deferred: result.deferred,
    skippedNoTemplate: result.skippedNoTemplate,
    recordFailed,
    error: result.error || undefined,
  });
}
