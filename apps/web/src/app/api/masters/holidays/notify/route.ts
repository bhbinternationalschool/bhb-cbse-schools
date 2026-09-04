/**
 * POST /api/masters/holidays/notify — announce a published holiday (or an
 * unplanned closure) to every family on WhatsApp, with the app-push
 * mirror the school-wide broadcast already does.
 *
 * The text comes from the Masters record through buildHolidayNotice; the
 * approved template family (holiday_notice / holiday_emergency) is used
 * when Meta has approved one, so the message reaches families outside
 * the 24h session; otherwise the bilingual free text goes out and only
 * families in a live session receive it. Defaults to a dry run so a
 * school-wide send never happens because a flag was omitted.
 */
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import { buildHolidayNotice, type ClosureReasonCode } from "@/lib/holidayNotice";
import { fetchServerBlob } from "@/lib/serverBlob";
import { TENANT } from "@/lib/types";
import { listApprovedTemplates, normalizeWaTemplatesState, type WaTemplatesState } from "@/lib/waTemplates";
import { POST as broadcastPost } from "@/app/api/v1/owner/broadcast/route";

export const runtime = "nodejs";

type Body = {
  holiday?: { id?: string; title?: string; startsOn?: string; endsOn?: string; kind?: string; note?: string };
  reason?: ClosureReasonCode;
  orderedBy?: string;
  reopenDate?: string;
  note?: string;
  dryRun?: boolean;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "edit");
  if (!auth.ok) return auth.response;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const h = body.holiday ?? {};
  const title = (h.title ?? "").trim();
  const startsOn = (h.startsOn ?? "").trim();
  const endsOn = (h.endsOn ?? "").trim() || startsOn;
  if (!title || !ISO_DAY.test(startsOn) || !ISO_DAY.test(endsOn)) {
    return NextResponse.json({ error: "holiday title, startsOn and endsOn (YYYY-MM-DD) required" }, { status: 400 });
  }
  if (body.reopenDate && !ISO_DAY.test(body.reopenDate)) {
    return NextResponse.json({ error: "reopenDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const dryRun = body.dryRun !== false;

  const notice = buildHolidayNotice({
    schoolName: TENANT.nameDisplay,
    title,
    startsOn,
    endsOn,
    kind: (h.kind ?? "school").trim(),
    note: (body.note ?? h.note ?? "").trim(),
    reason: body.reason,
    orderedBy: body.orderedBy,
    reopenDate: body.reopenDate,
  });

  // The approved template for this family, English first (one template
  // per broadcast; Hindi-preferring families still read the bilingual
  // free text when no template is approved).
  let template: { name: string; language: string; variables: Record<string, string> } | null = null;
  try {
    const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    const approved = listApprovedTemplates(normalizeWaTemplatesState(raw)).filter((t) => t.familyKey === notice.family);
    const tpl = approved.find((t) => t.language === "en") ?? approved[0];
    if (tpl) {
      template = {
        name: tpl.metaName,
        language: tpl.metaLanguage || tpl.language,
        variables: tpl.language === "hi" ? notice.variablesHi : notice.variables,
      };
    }
  } catch {
    template = null;
  }

  const text = `${notice.textEn}\n\n${notice.textHi}`;
  const inner = new Request(new URL("/api/v1/owner/broadcast", req.url).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(template ? { audience: "parents", template, dryRun } : { audience: "parents", body: text, dryRun }),
  });
  const res = await broadcastPost(inner);
  const result = (await res.json()) as { ok?: boolean; recipientCount?: number; sent?: number; failed?: number; skippedOptOut?: number; error?: string };
  if (!res.ok) return NextResponse.json(result, { status: res.status });

  if (!dryRun) {
    await writeAudit({
      session: auth.ctx.session,
      module: "masters",
      action: "holiday.notified",
      entityType: "holiday",
      entityId: h.id || title,
      summary: `${notice.family === "holiday_emergency" ? "Closure" : "Holiday"} "${title}" ${startsOn}–${endsOn} announced to ${result.recipientCount ?? 0} families via ${template ? `template ${template.name}` : "free text"}`,
    });
  }
  return NextResponse.json({
    ok: true,
    mode: dryRun ? "dry_run" : "live",
    family: notice.family,
    via: template ? "template" : "text",
    templateName: template?.name ?? null,
    preview: { en: notice.textEn, hi: notice.textHi },
    recipientCount: result.recipientCount ?? 0,
    sent: result.sent ?? 0,
    failed: result.failed ?? 0,
    skippedOptOut: result.skippedOptOut ?? 0,
    warning: template
      ? null
      : "No approved WhatsApp template for this holiday type yet — the message reaches only families who wrote to the school in the last 24 hours. Submit the holiday templates to Meta for full reach.",
  });
}
