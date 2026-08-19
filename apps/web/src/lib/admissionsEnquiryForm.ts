/**
 * Public enquiry form — the conditional questions and fixed option lists.
 * Pure (no storage) so the website form, the WhatsApp flow and the desk
 * can ask the same things and store the same codes on the lead.
 *
 * Rules: every option is a fixed code (never free text the model later has
 * to interpret); "not asked" is "" / [] — the form never pre-selects an
 * answer the parent did not give.
 */

export const LEAD_CONCERNS: { id: string; label: string }[] = [
  { id: "transport", label: "School transport" },
  { id: "fees", label: "Fees & concessions" },
  { id: "academics", label: "Academics & results" },
  { id: "sports", label: "Sports & activities" },
  { id: "safety", label: "Safety & care" },
  { id: "timings", label: "Timings & distance" },
  { id: "medium", label: "Medium of instruction" },
  { id: "special_needs", label: "Special learning needs" },
];

export function concernLabel(id: string): string {
  return LEAD_CONCERNS.find((c) => c.id === id)?.label ?? id;
}

export const PREVIOUS_BOARDS: { id: string; label: string }[] = [
  { id: "CBSE", label: "CBSE" },
  { id: "ICSE", label: "ICSE / ISC" },
  { id: "UP_BOARD", label: "UP Board" },
  { id: "BIHAR_BOARD", label: "Bihar Board" },
  { id: "STATE_OTHER", label: "Other state board" },
  { id: "IB_IGCSE", label: "IB / IGCSE" },
  { id: "NONE", label: "First school / home-schooled" },
  { id: "OTHER", label: "Other" },
];

/**
 * Class VI and above — where "previous board" and "last result" are worth
 * asking. Works from the class name alone because the public form only
 * has {id, name}: Roman numerals, Arabic numerals, "Class 6", "Grade VII".
 */
export function isSeniorClassName(name: string): boolean {
  const n = (name || "").trim().toUpperCase().replace(/^(CLASS|GRADE|STD\.?|STANDARD)\s+/, "");
  const roman: Record<string, number> = { VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
  if (roman[n] != null) return true;
  const m = n.match(/^(\d{1,2})(ST|ND|RD|TH)?$/);
  if (m) return Number(m[1]) >= 6;
  return false;
}

/** Which optional blocks the form should show for the chosen class. */
export function enquiryQuestionsFor(className: string): {
  previousBoard: boolean;
  previousSchool: boolean;
} {
  const senior = isSeniorClassName(className);
  return { previousBoard: senior, previousSchool: senior };
}

/** DPDP Act 2023 — the notice shown next to the consent box on public capture. */
export function dpdpNoticeText(schoolName: string): string {
  return `I agree that ${schoolName} may store these details and contact me about this admission enquiry (phone, WhatsApp, SMS). The details are used only for admissions and are not shared outside the school. I can ask the school office to correct or delete them at any time.`;
}
