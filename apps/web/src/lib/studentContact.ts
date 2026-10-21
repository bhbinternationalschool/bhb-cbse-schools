/**
 * A student's family, reached from the staff app — pure.
 *
 * Requests mr_mv9ze8pqksu2 (Students: Call + Message beside merit /
 * discipline / sick) and mr_mv9zkoot06df (My class: tap a name → change the
 * WhatsApp number, call, send a WhatsApp message), approved 20 Oct 2026.
 *
 *  - Which number a Call dials: the primary guardian's mobile on the
 *    family record, else the family's WhatsApp number. A placeholder
 *    (0000000000, 9999999999 …) is never dialled — it is "no number on
 *    record" (PR #377: placeholders once merged unrelated families).
 *  - What a teacher's WhatsApp message to one family looks like: the
 *    school's approved "School notice" template (comms_notice) with the
 *    teacher's words as the notice, because free text reaches only a number
 *    that wrote to the school in the last 24 hours (lib/classNoticeWa).
 *
 * Self-tested in studentContact.selftest.ts.
 */

import { flattenTemplateParam, TEMPLATE_PARAM_MAX } from "@/lib/classNoticeWa";
import { isPlaceholderMobile } from "@/lib/sis";
import { mobile10 } from "@/lib/sisClassTeacher";

/** A real 10-digit Indian mobile, or "" for a missing / malformed / placeholder one. */
export function realMobile10(raw: string | undefined | null): string {
  const m = mobile10(raw || "");
  return m && !isPlaceholderMobile(m) ? m : "";
}

export type FamilyNumbers = {
  /** Household guardian mobile. */
  mobile?: string;
  whatsappMobile?: string;
};

export type CallTarget = { number: string; source: "guardian" | "whatsapp" } | { number: ""; source: "none" };

/** The number a Call dials: the guardian's mobile, else the WhatsApp number, else none. */
export function callTargetFor(h: FamilyNumbers | null | undefined): CallTarget {
  const guardian = realMobile10(h?.mobile);
  if (guardian) return { number: guardian, source: "guardian" };
  const wa = realMobile10(h?.whatsappMobile);
  if (wa) return { number: wa, source: "whatsapp" };
  return { number: "", source: "none" };
}

/** The number the school messages: WhatsApp, else the guardian's mobile (as class-students reads it). */
export function messageTargetFor(h: FamilyNumbers | null | undefined): string {
  return realMobile10(h?.whatsappMobile) || realMobile10(h?.mobile);
}

/** "98•••••210" — enough for the teacher to recognise, nothing to copy. */
export function maskMobile(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 2)}${"•".repeat(5)}${d.slice(7)}` : "";
}

/**
 * A new WhatsApp number typed by a class teacher. The same rules the class
 * teacher's form follows (lib/sisClassTeacher) plus "that is already the
 * number", so a save that changes nothing is not audited as a change.
 */
export function checkNewWhatsAppNumber(
  raw: string,
  current: string,
): { ok: true; number: string } | { ok: false; error: string } {
  const typed = (raw || "").trim();
  if (!typed) return { ok: false, error: "Type the family's 10-digit WhatsApp number" };
  const m = mobile10(typed);
  if (!m) return { ok: false, error: "Enter a 10-digit Indian mobile number (starting 6–9)" };
  if (isPlaceholderMobile(m)) return { ok: false, error: `${m} is a placeholder, not the family's number` };
  if (mobile10(current || "") === m) return { ok: false, error: "That is already the family's WhatsApp number" };
  return { ok: true, number: m };
}

export const STUDENT_MESSAGE_MIN = 5;

/**
 * The notice the family reads: title names the teacher and the class, the
 * body is the teacher's own words on one line (Meta refuses new lines in a
 * template parameter). `tooLong` when the words would be cut.
 */
export function composeStudentMessage(input: {
  teacherName: string;
  classLabel: string;
  childName: string;
  text: string;
}): { ok: true; title: string; body: string } | { ok: false; error: string } {
  const raw = (input.text || "").trim();
  if (raw.replace(/\s+/g, " ").length < STUDENT_MESSAGE_MIN) {
    return { ok: false, error: "Write the message first" };
  }
  const flat = flattenTemplateParam(raw, Number.MAX_SAFE_INTEGER);
  if (flat.length > TEMPLATE_PARAM_MAX) {
    return { ok: false, error: `Keep it under ${TEMPLATE_PARAM_MAX} characters` };
  }
  const who = (input.teacherName || "").trim() || "Your child's teacher";
  const cls = (input.classLabel || "").trim();
  const child = (input.childName || "").trim();
  const title = flattenTemplateParam(
    `${who}${cls ? ` (${cls})` : ""}${child ? ` — about ${child}` : ""}`,
    200,
  );
  return { ok: true, title, body: flat };
}

/** The template's text with its {{variables}} filled — what the family will read. */
export function renderTemplateText(text: string, values: Record<string, string>): string {
  return (text || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => values[k] ?? "—");
}
