/**
 * Telling a parent their child did not board.
 *
 * This is the one transport message that fires by itself, because it is the
 * one with real safety value and the only one triggered by a fact the system
 * already holds: the attendant marked the child absent at their stop. Delays,
 * breakdowns and route changes need a human sentence and stay manual.
 *
 * Everything goes out as an APPROVED TEMPLATE. The fleet-edge alert path
 * proved what happens otherwise — 223 free-form notifications, every one
 * rejected with "Outside Meta's 24h session window". A send against a
 * template Meta has not approved fails loudly at Meta, which is the correct
 * outcome: better a logged failure than a parent who was never told and a
 * school that believes they were.
 *
 * The template is resolved through the registry like every other sender —
 * the family's language, the school's own routing of which number sends,
 * and the template's OWN variable order. Until 2026-09-08 this file posted
 * three positional parameters against a template whose registered text takes
 * five; Meta would have refused every send the day the template was approved.
 */

import { fetchServerBlob } from "@/lib/serverBlob";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { householdWhatsApp } from "@/lib/sis";
import type { SisState } from "@/lib/sis";
import type { TransportState } from "@/lib/transport";
import { buildTransportMessage } from "@/lib/transportParentMessages";
import { sendWhatsAppTemplate } from "@/lib/waSend";
import {
  normalizeWaTemplatesState,
  resolveTemplateForSend,
  templateVariablePositions,
  type WaTemplatesState,
} from "@/lib/waTemplates";

export type NotifyOutcome = {
  sent: boolean;
  skipped?: string;
  error?: string;
  templateName?: string;
  toMasked?: string;
};

function maskMobile(m: string): string {
  const d = m.replace(/\D/g, "");
  return d.length >= 4 ? `••••${d.slice(-4)}` : "••••";
}

/**
 * Fire the "did not board" message for one child.
 *
 * Every reason for not sending is returned rather than thrown, and the caller
 * logs it. A boarding mark must never fail because a message could not go
 * out: the mark is the record, the message is a courtesy on top of it.
 */
export async function notifyNotBoarded(input: {
  studentId: string;
  routeId: string;
  stopId: string;
  at: string;
  transport: TransportState;
  sis: SisState;
}): Promise<NotifyOutcome> {
  const student = input.sis.students.find((s) => s.id === input.studentId);
  if (!student) return { sent: false, skipped: "student not found" };

  const household = input.sis.households.find((h) => h.id === student.householdId);
  const to = householdWhatsApp(household);
  if (!to) {
    // Said plainly so the office can fix it, rather than counted as a send.
    return { sent: false, skipped: "household has no WhatsApp number" };
  }

  const route = input.transport.routes.find((r) => r.id === input.routeId);
  const stop = route?.stops.find((s) => s.id === input.stopId);
  const vehicle = route?.vehicleId
    ? (input.transport.vehicles ?? []).find((v) => v.id === route.vehicleId)
    : undefined;

  // The family's language, never the sender's; both languages must be
  // approved before the family gets either (resolveTemplateForSend enforces
  // it) so a Hindi household is never quietly sent English.
  const language = waTemplateLanguageFor(household ?? undefined);

  const built = buildTransportMessage(
    "not_boarded",
    {
      guardianName: household?.guardianName?.trim() || "Parent",
      childName: student.fullName,
      busNo:
        route?.busNo?.trim() ||
        vehicle?.registrationNo?.trim() ||
        vehicle?.name?.trim() ||
        route?.name?.trim() ||
        "",
      // A stop whose link is broken has no name. Rather than send "did not
      // board at" with a hole, the message is skipped and the reason recorded —
      // repairing the link is what fixes it.
      stopName: stop?.name ?? "",
      time: input.at.slice(11, 16),
    },
    language,
  );
  if (!built.ok) return { sent: false, skipped: built.error };

  const { state: raw } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
  const resolved = resolveTemplateForSend({
    state: normalizeWaTemplatesState(raw),
    familyKey: built.message.familyKey,
    language,
  });
  if (!resolved.ok) {
    return { sent: false, skipped: resolved.reason, templateName: built.message.templateName };
  }
  const positions = templateVariablePositions(resolved.template, built.message.values);

  const res = await sendWhatsAppTemplate({
    toMobile: to,
    name: resolved.template.metaName,
    language: resolved.template.metaLanguage || resolved.template.language,
    fromPhoneNumberId: resolved.sender?.phoneNumberId,
    components: [
      {
        type: "body",
        parameters: Object.keys(positions)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => ({ type: "text", text: positions[k]! })),
      },
    ],
    clientMessageId: `notboarded:${input.studentId}:${input.at.slice(0, 10)}`,
  });

  return {
    sent: res.ok,
    error: res.ok ? undefined : res.error,
    templateName: resolved.template.metaName,
    toMasked: maskMobile(to),
  };
}
