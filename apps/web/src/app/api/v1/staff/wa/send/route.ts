import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import type { MobileFeatureId } from "@/lib/mobileFeatures";
import { fetchServerBlob } from "@/lib/serverBlob";
import { isInQuietHours, quietHoursLabel, waTemplateLanguageFor } from "@/lib/householdPrefs";
import { resolveHouseholdByMobileServer } from "@/lib/parentHousehold.server";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { sendWaWithFailover } from "@/lib/waSend";
import {
  resolveTemplateForSend,
  templateVariablePositions,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { writeAudit } from "@/lib/audit.server";

export const runtime = "nodejs";

/**
 * The staff app's one way to message a family.
 *
 * Until 2026-09-07 the app had none: five screens — fee defaulters, principal
 * lists, staff roster, admission leads, transport requests — opened
 * `https://wa.me/…`, so a parent heard from whichever teacher happened to be
 * holding a phone, on a number the school does not control and has no record
 * of. The web had the same problem and was fixed the same day; this is the
 * endpoint that lets the app follow.
 *
 * Three things are decided HERE and not by the app, on purpose:
 *
 *   the LANGUAGE, from the household's own choice — never from a field the
 *     app could set, because the family owns that;
 *   the TEMPLATE, resolved by family key so a template added in Masters is
 *     the one that goes out;
 *   the NUMBER, resolved per template, else per module, else the school
 *     default — so routing is a Masters decision, not an app release.
 *
 * An app that only sends `{ to, text }` cannot get any of them wrong, and
 * cannot drift from the web when the rules change.
 */

type Body = {
  /** 10-digit or E.164. The household is resolved from it for the log. */
  mobile?: string;
  /** Free text for the 24h window; ignored when a template is named. */
  text?: string;
  /** Template family (e.g. "fees_receipt"). Preferred — works outside 24h. */
  familyKey?: string;
  /** Values for the template's declared variables, by NAME not position. */
  variables?: Record<string, string>;
  /** Attendance, transport, health and safety. Skips quiet hours. */
  urgent?: boolean;
};

/**
 * Which app feature each caller must hold.
 *
 * Keyed by family so a screen cannot borrow another's permission: the
 * defaulter chaser may message about fees, and nothing else.
 */
const FEATURE_BY_FAMILY: Record<string, MobileFeatureId> = {
  fees_receipt: "fee_take",
  fees_reminder: "fee_defaulters",
  fees_soft_reminder: "fee_defaulters",
  fees_pay_link: "fee_defaulters",
  admissions_followup: "admission_leads",
  admissions_registration: "admission_leads",
  transport_request: "fee_defaulters",
};

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);

    const body = (await request.json().catch(() => ({}))) as Body;
    const mobile = (body.mobile || "").replace(/\D/g, "");
    const familyKey = (body.familyKey || "").trim();
    const text = (body.text || "").trim();

    if (mobile.length < 10) {
      throw new ApiError("bad_request", "A 10-digit mobile is required", 400);
    }
    if (!familyKey && !text) {
      throw new ApiError("bad_request", "Give a familyKey or some text", 400);
    }

    // The permission is the SCREEN's, not the endpoint's. A staff member who
    // cannot see the defaulter list cannot message a family about their dues
    // by calling this directly.
    const feature = FEATURE_BY_FAMILY[familyKey];
    if (familyKey && !feature) {
      throw new ApiError("bad_request", `Unknown template family ${familyKey}`, 400);
    }
    assertMobileFeature(ctx, feature ?? "fee_defaulters");

    const found = await resolveHouseholdByMobileServer(mobile);
    const household = found?.household ?? null;

    // Quiet hours belong to the family. Urgent is for attendance, transport
    // and safety — not for a fee reminder somebody wants sent tonight.
    if (household && !body.urgent && isInQuietHours(household)) {
      return apiOk({
        sent: false,
        deferred: true,
        reason: `Held until after the family's quiet hours (${quietHoursLabel(household)})`,
      });
    }

    let template:
      | { name: string; language: string; components?: never }
      | undefined;
    let fromPhoneNumberId: string | undefined;
    let variables: Record<string, string> | undefined;

    if (familyKey) {
      const { state } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
      if (!state) {
        throw new ApiError("server_error", "WhatsApp templates unavailable", 503);
      }
      // The FAMILY's language. There is deliberately no way for the app to
      // ask for a different one.
      const language = waTemplateLanguageFor(household ?? undefined);
      const resolved = resolveTemplateForSend({ state, familyKey, language });
      if (!resolved.ok) {
        throw new ApiError("bad_request", resolved.reason, 400);
      }
      template = {
        name: resolved.template.metaName,
        language: resolved.template.metaLanguage || resolved.template.language,
      };
      variables = templateVariablePositions(resolved.template, body.variables ?? {});
      fromPhoneNumberId = resolved.sender?.phoneNumberId;
    }

    const r = await sendWaWithFailover({
      primaryMobile: mobile,
      fallbackMobile: household?.altMobile || undefined,
      body: text || undefined,
      template: template
        ? {
            name: template.name,
            language: template.language,
            components: variables
              ? [
                  {
                    type: "body",
                    parameters: Object.keys(variables)
                      .sort((a, b) => Number(a) - Number(b))
                      .map((k) => ({ type: "text", text: variables![k] })),
                  },
                ]
              : undefined,
          }
        : undefined,
      fromPhoneNumberId,
    });

    if (household) {
      await logHouseholdWaSend({
        mobile,
        purpose: familyKey || "staff_message",
        via: template ? "template" : "text",
        templateName: template?.name,
        preview: (text || `[${familyKey}]`).slice(0, 200),
        status: r.ok ? "sent" : "failed",
        error: r.error,
        waMessageId: r.providerId,
      }).catch(() => undefined);
    }

    const { ip, userAgent } = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "notifications",
      entityType: "wa_staff_send",
      entityId: household?.id || mobile,
      action: "create",
      summary:
        `${r.ok ? "Sent" : "Failed to send"} ${familyKey || "a message"} to ` +
        `${household?.guardianName || mobile} from the school's WhatsApp` +
        (r.error ? ` — ${r.error}` : ""),
      ip,
      userAgent,
    }).catch(() => undefined);

    if (!r.ok) {
      // Said plainly so the app can show it. The old behaviour — opening the
      // staff member's own WhatsApp — is exactly what this replaces, so
      // failing loudly is the point.
      throw new ApiError(
        "server_error",
        r.error || "The school's WhatsApp could not send this",
        502,
      );
    }
    return apiOk({ sent: true, deferred: false });
  } catch (e) {
    return apiErr(e);
  }
}
