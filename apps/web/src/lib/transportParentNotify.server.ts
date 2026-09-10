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
  templateButtonComponents,
  templateVariablePositions,
  type WaTemplatesState,
} from "@/lib/waTemplates";
import { signBusTrackToken } from "@/lib/waTransportTrackToken.server";
import { trackLinkUrl } from "@/lib/waTransportTrack";

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


/**
 * The public origin the tracking link points at.
 *
 * A tracking link that opens the wrong host is a dead link in a parent's
 * hand, so the deployed origin is read from the environment and the school's
 * own domain is the fallback rather than localhost.
 */
function publicOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ||
    "https://bhbinternational.school"
  );
}

/**
 * "Your child is on the bus" and "your child is off the bus".
 *
 * Both mirror notifyNotBoarded exactly — same resolution, same language
 * rule, same fail-loudly-on-a-missing-template behaviour — and differ in
 * two ways worth stating:
 *
 * 1. The PICKUP message carries a live tracking button; the drop message
 *    does not. Once a child is off the bus, the vehicle's position says
 *    nothing about their own child and everything about a bus full of other
 *    people's children.
 *
 * 2. A tracking token is only issued inside a run. Outside one — a late
 *    manual mark at 10pm, a backfilled register — there is no link to give,
 *    and the message is SKIPPED rather than sent with a dead button. Meta
 *    refuses a send whose button variable is missing anyway, so a silent
 *    default here would produce a failure the office could not read.
 */
export async function notifyBoardingMark(input: {
  kind: "boarded" | "dropped";
  studentId: string;
  routeId: string;
  stopId: string;
  at: string;
  transport: TransportState;
  sis: SisState;
  nowMs?: number;
}): Promise<NotifyOutcome> {
  const student = input.sis.students.find((s) => s.id === input.studentId);
  if (!student) return { sent: false, skipped: "student not found" };

  const household = input.sis.households.find((h) => h.id === student.householdId);
  const to = householdWhatsApp(household);
  if (!to) return { sent: false, skipped: "household has no WhatsApp number" };

  const route = input.transport.routes.find((r) => r.id === input.routeId);
  const stop = route?.stops.find((s) => s.id === input.stopId);
  const vehicle = route?.vehicleId
    ? (input.transport.vehicles ?? []).find((v) => v.id === route.vehicleId)
    : undefined;

  const language = waTemplateLanguageFor(household ?? undefined);

  const values: Record<string, string> = {
    guardianName: household?.guardianName?.trim() || "Parent",
    childName: student.fullName,
    busNo:
      route?.busNo?.trim() ||
      vehicle?.registrationNo?.trim() ||
      vehicle?.name?.trim() ||
      route?.name?.trim() ||
      "",
    stopName: stop?.name ?? "",
    time: input.at.slice(11, 16),
  };

  // Only the pickup message tracks, and only inside a run.
  let trackToken = "";
  if (input.kind === "boarded") {
    const signed = signBusTrackToken(input.studentId, input.nowMs ?? Date.now());
    if (!signed) {
      return {
        sent: false,
        skipped: "outside bus hours — no tracking link to send",
      };
    }
    trackToken = signed.token;
    values.trackToken = signed.token;
    values.trackLink = trackLinkUrl(publicOrigin(), signed.token);
  }

  const built = buildTransportMessage(input.kind, values, language);
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

  // The button's own variable, supplied separately: Meta refuses a send that
  // declares a dynamic URL button and omits it.
  const buttons = templateButtonComponents(resolved.template, { trackToken });
  if (buttons.missing.length) {
    return {
      sent: false,
      skipped: `tracking button needs ${buttons.missing[0]} — nothing sent`,
      templateName: resolved.template.metaName,
    };
  }

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
      ...buttons.components,
    ],
    // One send per child per mark per day: a re-mark must not message a
    // parent twice, and the trip is in the key because a child boards in the
    // morning and again at home time.
    clientMessageId: `${input.kind}:${input.studentId}:${input.at.slice(0, 13)}`,
  });

  return {
    sent: res.ok,
    error: res.ok ? undefined : res.error,
    templateName: resolved.template.metaName,
    toMasked: maskMobile(to),
  };
}
