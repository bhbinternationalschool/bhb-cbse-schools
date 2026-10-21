/**
 * The staff app's Broadcast screen (20 Oct 2026, requests mr_mva0gr5aop3y and
 * mr_mva0ik2uqmoy) — the pure half: who may aim at which audience, and how
 * a custom message is split between free text and the approved template.
 *
 * The send itself is the web's: resolveWaAudience → sendTemplateToAudience
 * / sendTextToAudience → /api/wa/dispatch. Nothing here sends.
 *
 * WhatsApp delivers free text only to a number that wrote to the school in
 * the last 24 hours. Everyone else must get an approved template, so a
 * custom message to them goes inside "School notice" (comms_notice,
 * bhb_school_notice, approved in Hindi and English, UTILITY) with the
 * sender's words as the notice body.
 */

import { flattenTemplateParam } from "@/lib/classNoticeWa";
import type { WaAudienceSpec } from "@/lib/waAudienceSpec";
import { rateFor, type WaBillCategory, type WaCostRates } from "@/lib/waUsageCost";

/** The approved generic template a custom message rides in outside the window. */
export const CUSTOM_MESSAGE_TEMPLATE_FAMILY = "comms_notice";

/** Longest custom message accepted (Meta's free-text cap is 4,096). */
export const CUSTOM_MESSAGE_MAX = 1000;

export type BroadcastAuthority = {
  /**
   * May aim at the whole school: the Broadcast app feature plus the web's
   * broadcast permission (notifications.edit).
   */
  schoolWide: boolean;
  /** For everyone else: may this person message this section's families? */
  mayMessageSection: (sectionId: string) => boolean;
  /** Sections of a class, to check a whole-class pick section by section. */
  sectionsOfClass: (classId: string) => string[];
  /** "Class 5 A", for the refusal message. */
  sectionLabel?: (sectionId: string) => string;
};

export type BroadcastAuthorization =
  | { ok: true }
  | { ok: false; status: 403; error: string };

const SCHOOL_WIDE_ONLY =
  "Only staff with the school's broadcast permission (Notifications → edit) can message this audience. You can message the families of your own sections.";

/**
 * Can this person send to this audience?
 *
 * The rule is the web's, applied to the phone: a school-wide audience —
 * all parents, staff, a route, fee defaulters, families without a language
 * — needs the broadcast permission. Without it, only parents of named
 * sections (or whole classes) can be picked, and EVERY one of those
 * sections must be one the person teaches. One foreign section refuses the
 * whole send; it is never quietly dropped.
 */
export function authorizeBroadcastAudience(
  spec: WaAudienceSpec,
  who: BroadcastAuthority,
): BroadcastAuthorization {
  if (spec.kind === "students") {
    return {
      ok: false,
      status: 403,
      error: "Hand-picked students are sent from the web ERP (Comms → WhatsApp).",
    };
  }
  if (who.schoolWide) return { ok: true };
  if (spec.kind !== "parents" || spec.languageUnset) {
    return { ok: false, status: 403, error: SCHOOL_WIDE_ONLY };
  }
  const sections = new Set<string>(spec.sectionIds ?? []);
  for (const classId of spec.classIds ?? []) {
    const under = who.sectionsOfClass(classId);
    // A class with no sections on record cannot be checked — refuse.
    if (!under.length) return { ok: false, status: 403, error: SCHOOL_WIDE_ONLY };
    for (const s of under) sections.add(s);
  }
  if (!sections.size) return { ok: false, status: 403, error: SCHOOL_WIDE_ONLY };
  const foreign = [...sections].filter((s) => !who.mayMessageSection(s));
  if (foreign.length) {
    const names = foreign.map((s) => who.sectionLabel?.(s) || s).join(", ");
    return {
      ok: false,
      status: 403,
      error: `You are not a teacher of ${names} — you can message only your own sections' families.`,
    };
  }
  return { ok: true };
}

/** The shape splitCustomMessage needs of a recipient. */
export type SplitRecipient = { mobile: string; fallbackMobile?: string };

/** 10-digit Indian mobile → 91XXXXXXXXXX, as wa_contact_state stores it. */
export function e164India(mobile: string): string {
  const d = (mobile || "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  return d;
}

/**
 * Which recipients get the custom message as free text and which inside the
 * approved template.
 *
 * Inside the window = the number the message goes to wrote to the school
 * recently (`openWindow`, E.164). A fallback number is kept for a free-text
 * recipient only when it is inside the window too — free text failed over
 * to a number outside it would just be refused.
 */
export function splitCustomMessage<R extends SplitRecipient>(
  recipients: R[],
  openWindow: Set<string>,
): { freeText: R[]; viaTemplate: R[] } {
  const freeText: R[] = [];
  const viaTemplate: R[] = [];
  for (const r of recipients) {
    if (openWindow.has(e164India(r.mobile))) {
      const fb = r.fallbackMobile;
      freeText.push(
        fb && !openWindow.has(e164India(fb)) ? { ...r, fallbackMobile: undefined } : r,
      );
    } else {
      viaTemplate.push(r);
    }
  }
  return { freeText, viaTemplate };
}

/** The free-text version: the words as typed, signed. */
export function customFreeText(text: string, senderName: string): string {
  const body = (text || "").trim().slice(0, CUSTOM_MESSAGE_MAX);
  const by = (senderName || "").trim();
  return by ? `${body}\n\n— ${by}` : body;
}

/**
 * The template version's variables. Meta refuses a parameter holding a new
 * line, a tab or a run of spaces, so the words are flattened to one line;
 * the title defaults to the first line when none was given.
 */
export function customTemplateVariables(
  text: string,
  title: string,
  senderName: string,
): { noticeTitle: string; noticeBody: string } {
  const body = (text || "").trim().slice(0, CUSTOM_MESSAGE_MAX);
  const firstLine = body.split(/\r?\n/)[0] || "";
  const noticeTitle = flattenTemplateParam((title || "").trim() || firstLine, 60);
  const by = (senderName || "").trim();
  const flat = flattenTemplateParam(body, CUSTOM_MESSAGE_MAX - 60);
  return { noticeTitle, noticeBody: by ? `${flat} — ${by}` : flat };
}

/** Template category as stored ("UTILITY") → the rate-card bucket. */
export function billCategoryOfTemplate(category: string): WaBillCategory {
  switch ((category || "").toUpperCase()) {
    case "UTILITY":
      return "utility";
    case "AUTHENTICATION":
      return "authentication";
    case "MARKETING":
      return "marketing";
    default:
      // Unknown is priced at the dearest rate — see rateFor.
      return "unknown";
  }
}

/**
 * An ESTIMATE in paise, before GST, from the school's own rate card. From
 * 1 Oct 2026 Meta charges free-form messages too (at the utility rate), so
 * free text is not free; only the app notification is.
 */
export function estimateBroadcastPaise(opts: {
  freeText: number;
  viaTemplate: number;
  templateCategory: WaBillCategory;
  rates: WaCostRates;
}): number {
  const paise =
    opts.freeText * rateFor(opts.rates, "service") +
    opts.viaTemplate * rateFor(opts.rates, opts.templateCategory);
  return Math.round(paise);
}

/** A client-made id for one confirmed send, used as its send-once claim. */
export function broadcastClaimKey(sendId: string): string | null {
  const id = String(sendId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return null;
  return `staff_app_broadcast:${id}`;
}
