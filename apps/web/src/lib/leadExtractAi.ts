/**
 * Free-text enquiry → structured lead fields. A counsellor pastes an
 * email, a WhatsApp thread or a call note; the model fills only what the
 * text actually says and lists what it could not find. Every value is
 * normalised here against the fixed code lists (board, concerns, language,
 * transport) — anything outside them is dropped, never guessed. Pure.
 */

import { LEAD_CONCERNS, PREVIOUS_BOARDS } from "@/lib/admissionsEnquiryForm";
import { normalizeHouseholdLanguage } from "@/lib/householdPrefs";

export type LeadExtract = {
  childName: string;
  dob: string;
  gender: string;
  classSoughtLabel: string;
  guardianName: string;
  motherName: string;
  mobile: string;
  email: string;
  locality: string;
  address: string;
  pincode: string;
  previousSchool: string;
  previousBoard: string;
  transportInterest: "" | "yes" | "no" | "undecided";
  preferredLanguage: string;
  concerns: string[];
  /** One-line summary of what the family asked, in their words */
  summary: string;
  /** Fields the text did not contain */
  missing: string[];
};

export const LEAD_EXTRACT_FIELDS = [
  "childName", "dob", "gender", "classSoughtLabel", "guardianName", "motherName", "mobile", "email", "locality", "address", "pincode", "previousSchool", "previousBoard", "transportInterest", "preferredLanguage", "concerns",
] as const;

export function buildLeadExtractSystemPrompt(classNames: string[]): string {
  return `You extract admission-enquiry details for an Indian school from pasted text (email, WhatsApp chat, call note). Output JSON only with exactly these keys:
{"childName":"","dob":"YYYY-MM-DD or empty","gender":"Male|Female|Other|empty","classSoughtLabel":"one of [${classNames.join(", ")}] or empty","guardianName":"","motherName":"","mobile":"10 digits or empty","email":"","locality":"","address":"","pincode":"6 digits or empty","previousSchool":"","previousBoard":"one of [${PREVIOUS_BOARDS.map((b) => b.id).join(", ")}] or empty","transportInterest":"yes|no|undecided|empty","preferredLanguage":"en|hi|bn|ur|mai|bho|empty","concerns":["subset of ${LEAD_CONCERNS.map((c) => c.id).join("|")}"],"summary":"one line of what the family asked","missing":["keys you could not find"]}
Rules: fill a field ONLY if the text states it; never infer a class from age, never guess a board or language; mobile = the parent's number, not the school's; put every key not found into "missing".`;
}

export function buildLeadExtractUserPrompt(text: string): string {
  return `Pasted text:\n"""\n${text.trim().slice(0, 6000)}\n"""`;
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function parseLeadExtract(text: string, classNames: string[]): LeadExtract | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const classLabel = str(j.classSoughtLabel, 40);
    const classOk = classNames.find((c) => c.toLowerCase() === classLabel.toLowerCase()) || "";
    const board = str(j.previousBoard, 40).toUpperCase();
    const ti = str(j.transportInterest, 12).toLowerCase();
    const concerns = Array.isArray(j.concerns)
      ? Array.from(new Set(j.concerns.map((c) => str(c, 40).toLowerCase()).filter((c) => LEAD_CONCERNS.some((x) => x.id === c))))
      : [];
    const mobile = str(j.mobile, 20).replace(/\D/g, "").slice(-10);
    const out: LeadExtract = {
      childName: str(j.childName, 80),
      dob: /^\d{4}-\d{2}-\d{2}$/.test(str(j.dob, 10)) ? str(j.dob, 10) : "",
      gender: ["Male", "Female", "Other"].includes(str(j.gender, 10)) ? str(j.gender, 10) : "",
      classSoughtLabel: classOk,
      guardianName: str(j.guardianName, 80),
      motherName: str(j.motherName, 80),
      mobile: mobile.length === 10 ? mobile : "",
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(j.email, 120)) ? str(j.email, 120) : "",
      locality: str(j.locality, 80),
      address: str(j.address, 200),
      pincode: /^\d{6}$/.test(str(j.pincode, 6)) ? str(j.pincode, 6) : "",
      previousSchool: str(j.previousSchool, 120),
      previousBoard: PREVIOUS_BOARDS.some((b) => b.id === board) ? board : "",
      transportInterest: ti === "yes" || ti === "no" || ti === "undecided" ? ti : "",
      preferredLanguage: normalizeHouseholdLanguage(j.preferredLanguage),
      concerns,
      summary: str(j.summary, 300),
      missing: [],
    };
    // Recompute "missing" from what actually survived normalisation.
    out.missing = LEAD_EXTRACT_FIELDS.filter((k) => {
      const v = out[k];
      return Array.isArray(v) ? v.length === 0 : !v;
    });
    const any = LEAD_EXTRACT_FIELDS.some((k) => {
      const v = out[k];
      return Array.isArray(v) ? v.length > 0 : !!v;
    });
    return any || out.summary ? out : null;
  } catch {
    return null;
  }
}
