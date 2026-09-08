/**
 * Submit a WhatsApp template from ERP registry to Meta for approval.
 * POST { templateId, state? }
 */

import { NextResponse } from "next/server";
import {
  emptyWaTemplates,
  getTemplateById,
  markTemplateEditedOnMeta,
  markTemplateSubmittedToMeta,
  normalizeWaTemplatesState,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  submitWaTemplateToMeta,
  updateWaTemplateOnMeta,
  waTemplatesMetaConfigured,
} from "@/lib/waTemplatesMeta.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    service: "wa-templates-submit",
    metaConfigured: waTemplatesMetaConfigured(),
    note: "POST { templateId, state } to create template on Meta WABA (pending review). No Meta UI needed.",
    permissions:
      "System user token needs whatsapp_business_management + whatsapp_business_messaging",
  });
}

export async function POST(req: Request) {
  await ensureSchoolMirrorHydrated();
  let body: { templateId?: string; state?: WaTemplatesState };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const templateId = body.templateId?.trim();
  if (!templateId) {
    return NextResponse.json({ error: "templateId required" }, { status: 400 });
  }

  let state = normalizeWaTemplatesState(body.state || emptyWaTemplates());
  const template = getTemplateById(state, templateId);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // Already on Meta: edit it in place. Meta keeps sending the approved
  // wording until the new one clears review, so the senders that name this
  // template keep working throughout — nothing to re-point, no second name.
  if (template.metaTemplateId && template.status !== "draft") {
    const edited = await updateWaTemplateOnMeta(template);
    if (!edited.ok) {
      return NextResponse.json(
        { ok: false, error: edited.error, warnings: edited.warnings, state },
        { status: 400 },
      );
    }
    state = markTemplateEditedOnMeta(state, templateId, "erp_submit");
    return NextResponse.json({
      ok: true,
      metaTemplateId: template.metaTemplateId,
      status: "PENDING",
      edited: true,
      warnings: edited.warnings,
      state,
      hint: "Sent to Meta as an edit. The previous wording keeps going out until the new one is approved.",
    });
  }

  const result = await submitWaTemplateToMeta(template);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        warnings: result.warnings,
        state,
      },
      { status: 400 },
    );
  }

  state = markTemplateSubmittedToMeta(
    state,
    templateId,
    result.metaTemplateId || "",
    "erp_submit",
  );

  return NextResponse.json({
    ok: true,
    metaTemplateId: result.metaTemplateId,
    status: result.status || "PENDING",
    warnings: result.warnings,
    state,
    hint: "Meta usually reviews in minutes–24h. Sync from Meta or wait for webhook message_template_status_update.",
  });
}
