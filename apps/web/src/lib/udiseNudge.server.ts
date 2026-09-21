import "server-only";

/**
 * After the bot has answered a parent, tell them what UDISE+ still needs.
 * See udiseNudge.ts for the wording and where every claim in it comes from.
 *
 * Runs after the reply, never instead of it, and never:
 *  - to a family whose children need nothing (PEN + APAAR, or nothing a
 *    parent can send);
 *  - more than once a week, or after UDISE_NUDGE_MAX messages — by then
 *    the office has to phone;
 *  - in the middle of an exam drill or a tutor session — a long message
 *    between a question and its answer is the bot breaking the child's work;
 *  - at night.
 * Every message sent is a row in household_message_log with the document
 * list, so the office can always answer "what did we ask this family for?".
 *
 * UDISE_PARENT_NUDGE=off stops it without a deploy.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { getServerTenantContext } from "@/lib/serverTenant";
import { childrenOfHousehold, loadSis } from "@/lib/sis";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { currentAcademicYearCode } from "@/lib/masters";
import { classLabel } from "@/lib/homework";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { computeStudentUdiseGaps } from "@/lib/udiseCompliance";
import { istHour } from "@/lib/parentChatClose";
import {
  composeUdiseNudge,
  udiseNudgeDue,
  udiseNudgeLogLine,
  udiseNudgeNeeds,
} from "@/lib/udiseNudge";

const PURPOSE = "udise_nudge";
const CONSENT_FILE = "apaar-consent-refusal-form.pdf";

/** Two messages from one parent a second apart must not buy two nudges. */
const inFlight = new Set<string>();

let consentCache: Buffer | null | undefined;
function consentForm(): Buffer | null {
  if (consentCache !== undefined) return consentCache;
  try {
    consentCache = readFileSync(path.join(process.cwd(), "public", "docs", CONSENT_FILE));
  } catch (e) {
    console.warn("[udise-nudge] consent form not found", (e as Error)?.message);
    consentCache = null;
  }
  return consentCache;
}

export async function maybeSendUdiseNudge(
  mobile10: string,
  now: Date = new Date(),
): Promise<{ sent: boolean; reason: string }> {
  if ((process.env.UDISE_PARENT_NUDGE || "").toLowerCase() === "off") return { sent: false, reason: "off" };
  if (!/^\d{10}$/.test(mobile10)) return { sent: false, reason: "no_mobile" };
  const hour = istHour(now);
  if (hour >= 20 || hour < 8) return { sent: false, reason: "night" };

  await ensureSisHydratedServer();
  const { findHouseholdByWaMobile } = await import("@/lib/waSisBotServer");
  const hh = findHouseholdByWaMobile(mobile10);
  if (!hh) return { sent: false, reason: "not_a_parent" };
  if (inFlight.has(hh.id)) return { sent: false, reason: "in_flight" };
  inFlight.add(hh.id);
  try {
    // Mid-practice, the next message has to be the next question.
    const [{ openDrillFor }, { mobilesInTutorSession }] = await Promise.all([
      import("@/lib/examDrill.server"),
      import("@/lib/waTutorBot.server"),
    ]);
    if (await openDrillFor(mobile10).catch(() => null)) return { sent: false, reason: "drill" };
    if ((await mobilesInTutorSession(now).catch(() => new Set<string>())).has(mobile10)) {
      return { sent: false, reason: "tutor" };
    }

    const masters = await loadServerMasters();
    const ay = currentAcademicYearCode(masters);
    const sis = loadSis();
    const kids = childrenOfHousehold(sis, hh.id, ay).filter((s) => s.status === "active");
    const hasHhAddress = !!(hh.address && hh.pincode);
    const language = waTemplateLanguageFor(hh);
    const needs = udiseNudgeNeeds(
      kids.map((s) => ({
        name: s.fullName,
        classLabel: classLabel(masters, s.classId, s.sectionId).replace(" · ", " "),
        gaps: computeStudentUdiseGaps(s),
        hasDob: !!s.dob,
        hasAddress: hasHhAddress || !!s.permanentAddress,
        // The portal rejected the Aadhaar we hold: ask for the card again,
        // and say why (udiseNudge.ts, recheckSection).
        aadhaarFailed: /validation failed/i.test(s.udiseAadhaarValidationStatus || "")
          ? { dob: s.dob || "", gender: s.gender || "", last4: s.aadhaarLast4 || "" }
          : null,
        dob: s.dob || "",
      })),
      language,
      new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10),
    );
    if (!needs.length) return { sent: false, reason: "nothing_needed" };

    // The ledger: this nudge, and the scheduled request, count the same.
    const ctx = await getServerTenantContext();
    if (!ctx) return { sent: false, reason: "no_db" };
    const { data, error } = await ctx.sb
      .from("household_message_log")
      .select("created_at, purpose, template_name, status")
      .eq("tenant_id", ctx.tenantId)
      .eq("household_id", hh.id)
      .or(`purpose.eq.${PURPOSE},template_name.eq.bhb_udise_docs_request`)
      .order("created_at", { ascending: false })
      .limit(20);
    // Unreadable is not "never asked": a family could be sent it daily.
    if (error) return { sent: false, reason: "ledger_unreadable" };
    const rows = (data ?? []) as { created_at: string; purpose: string; status: string }[];
    const sentRows = rows.filter((r) => r.status === "sent");
    const due = udiseNudgeDue({
      lastAtIso: sentRows[0]?.created_at ?? null,
      sentCount: sentRows.filter((r) => r.purpose === PURPOSE).length,
      now,
      istHour: hour,
    });
    if (!due.due) return { sent: false, reason: due.reason };

    const pdf = needs.some((n) => n.consent) ? consentForm() : null;
    // A child with no Aadhaar at all: the centres nearest the family's home
    // (its geocode), or the school when the home was never located.
    let centres: import("@/lib/aadhaarCentres").AadhaarCentre[] = [];
    const located = typeof hh.geoLat === "number" && typeof hh.geoLng === "number";
    if (needs.some((n) => n.enrol)) {
      const { nearbyAadhaarCentres } = await import("@/lib/aadhaarCentres.server");
      const { TENANT } = await import("@/lib/types");
      const from =
        typeof hh.geoLat === "number" && typeof hh.geoLng === "number"
          ? { lat: hh.geoLat, lng: hh.geoLng }
          : { lat: TENANT.schoolLat, lng: TENANT.schoolLng };
      centres = await nearbyAadhaarCentres(from, 3).catch(() => []);
    }
    const text = composeUdiseNudge({
      guardianName: hh.guardianName || "",
      needs,
      language,
      consentAttached: !!pdf,
      centres,
      centresNear: located ? "home" : "school",
    });
    const { sendWhatsAppText, sendWhatsAppDocument } = await import("@/lib/waSend");
    const { logHouseholdWaSend } = await import("@/lib/householdMessageLog.server");
    const sent = await sendWhatsAppText({
      toMobile: mobile10,
      body: text,
      clientMessageId: `udise_nudge_${hh.id}_${now.toISOString().slice(0, 10)}`,
    });
    await logHouseholdWaSend({
      mobile: mobile10,
      purpose: PURPOSE,
      via: "text",
      preview: udiseNudgeLogLine(needs),
      status: sent.ok ? "sent" : "failed",
      error: sent.error,
      waMessageId: sent.providerId,
    });
    if (!sent.ok) return { sent: false, reason: `send_failed: ${sent.error || ""}` };
    if (pdf) {
      const doc = await sendWhatsAppDocument({
        toMobile: mobile10,
        bytes: pdf,
        filename: "APAAR-Consent-Refusal-Form.pdf",
        mimeType: "application/pdf",
        caption:
          language === "hi"
            ? "शिक्षा मंत्रालय — APAAR ID सहमति / असहमति फ़ॉर्म (Annexure-1)। भरकर, हस्ताक्षर करके इसकी फ़ोटो भेजें।"
            : "Ministry of Education — APAAR ID consent / refusal form (Annexure-1). Please fill in, sign and send a photo.",
      });
      if (!doc.ok) console.warn("[udise-nudge] consent form not sent", hh.id, doc.error);
    }
    // The two nearest centres as real map pins — tap for directions.
    if (centres.length) {
      const { sendWhatsAppLocation } = await import("@/lib/waSend");
      for (const c of centres.slice(0, 2)) {
        const pin = await sendWhatsAppLocation({ toMobile: mobile10, latitude: c.lat, longitude: c.lng, name: c.name, address: c.address });
        if (!pin.ok) console.warn("[udise-nudge] centre pin not sent", hh.id, pin.error);
      }
    }
    return { sent: true, reason: "" };
  } finally {
    inFlight.delete(hh.id);
  }
}
