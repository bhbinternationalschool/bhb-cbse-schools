import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import { loadAdmissions } from "@/lib/admissions";
import { fetchServerBlob } from "@/lib/serverBlob";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { resolveHouseholdByMobileServer } from "@/lib/parentHousehold.server";
import { isWithin24HourWindow } from "@/lib/waContactState.server";
import {
  normalizeWaTemplatesState,
  resolveTemplateForSend,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { TENANT } from "@/lib/types";
import {
  isRegisteredStage,
  leadMessageDraft,
  renderTemplatePreview,
} from "@/lib/staffAdmissionsApp";

export const runtime = "nodejs";

const FAMILY_KEY = "admissions_followup";

/**
 * GET /api/v1/staff/admissions/compose?leadId= — what the message icon shows
 * BEFORE anything is sent.
 *
 * Until now one tap on the icon sent the follow-up template straight away.
 * The phone now opens a composer with:
 *
 *   draft     — plain words the counsellor can edit. WhatsApp only delivers
 *               free text inside the 24 hours after the family last wrote to
 *               the school, so `inWindow` says whether it can go at all;
 *   template  — the school's approved follow-up, rendered with this family's
 *               names in the language the SEND will use (the family's own),
 *               so the preview is the message, not an approximation of it.
 *               It cannot be edited — Meta approved those exact words.
 *
 * Nothing is sent here; the composer's Send button posts to
 * /api/v1/staff/wa/send with the text (textOnly) or the template's values.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "admission_leads");
    const leadId = (new URL(request.url).searchParams.get("leadId") || "").trim();
    if (!leadId) throw new ApiError("bad_request", "leadId required", 400);

    await ensureSchoolMirrorHydrated();
    await ensureAdmissionsHydratedServer();
    const state = loadAdmissions();
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) throw new ApiError("not_found", "Lead not found", 404);

    const mobile = (lead.whatsapp || lead.mobile || "").replace(/\D/g, "").slice(-10);
    const classSought =
      ctx.masters.classes.find((c) => c.id === lead.classSoughtId)?.name || "";
    const variables = {
      guardianName: lead.guardianName.trim(),
      childName: lead.childName.trim(),
      schoolName: TENANT.name,
    };

    let template: { ok: true; body: string; language: string } | { ok: false; reason: string };
    const { state: rawState } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    if (!rawState) {
      template = { ok: false, reason: "WhatsApp templates could not be read" };
    } else {
      const found = mobile.length === 10 ? await resolveHouseholdByMobileServer(mobile) : null;
      const language = waTemplateLanguageFor(found?.household ?? undefined);
      const resolved = resolveTemplateForSend({
        state: normalizeWaTemplatesState(rawState),
        familyKey: FAMILY_KEY,
        language,
      });
      template = resolved.ok
        ? {
            ok: true,
            body: renderTemplatePreview(resolved.template.body, variables),
            language: resolved.template.language,
          }
        : { ok: false, reason: resolved.reason };
    }

    return apiOk({
      leadId,
      mobile,
      familyKey: FAMILY_KEY,
      draft: leadMessageDraft({
        guardianName: lead.guardianName,
        childName: lead.childName,
        classSought,
        schoolName: TENANT.name,
        registered: isRegisteredStage(lead.stage),
      }),
      inWindow: mobile.length === 10 ? await isWithin24HourWindow(mobile) : false,
      template,
      variables,
    });
  } catch (e) {
    return apiErr(e);
  }
}
