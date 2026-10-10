import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { fetchServerBlob } from "@/lib/serverBlob";
import {
  listApprovedTemplates,
  normalizeWaTemplatesState,
  WA_TEMPLATE_VARIABLES,
  type WaTemplatesState,
} from "@/lib/waTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/owner/templates — approved (unpaused) WhatsApp templates the
 * app's broadcast screen can send. Mirrors what the web BroadcastModal
 * offers: templates reach every recipient regardless of Meta's 24-hour
 * session window; free text does not.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "notifications", "edit");

    const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
    const state = normalizeWaTemplatesState(raw);
    const labels = new Map(WA_TEMPLATE_VARIABLES.map((v) => [v.key, v.label]));

    const templates = listApprovedTemplates(state)
      .filter((t) => t.metaName)
      .map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        metaName: t.metaName,
        metaLanguage: t.metaLanguage || t.language,
        module: t.module,
        headerText: t.headerText || "",
        body: t.body,
        footer: t.footer || "",
        variables: t.variables.map((key) => ({ key, label: labels.get(key) || key })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));

    const res = apiOk({ templates });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (e) {
    return apiErr(e);
  }
}
