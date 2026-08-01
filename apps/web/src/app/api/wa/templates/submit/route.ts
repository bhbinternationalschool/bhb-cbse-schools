/**
 * Submit a WhatsApp template from ERP registry to Meta for approval.
 * POST { templateId, state? }
 */

import { NextResponse } from "next/server";
import {
  emptyWaTemplates,
  getTemplateById,
  markTemplateSubmittedToMeta,
  normalizeWaTemplatesState,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import {
  submitWaTemplateToMeta,
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

  if (template.status === "approved" && template.metaTemplateId) {
    return NextResponse.json(
      { error: "Template already approved on Meta. Edit creates a new version in Meta — duplicate as draft first." },
      { status: 400 },
    );
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
