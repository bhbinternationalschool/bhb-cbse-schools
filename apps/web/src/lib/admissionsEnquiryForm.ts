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

/**
 * Photography and video — the wording the blanket consent actually rests on.
 *
 * The decision taken on 2026-08-30 was a BLANKET consent through the
 * admission terms rather than a tick per child, and the code already acts on
 * it: a pupil photograph defaults to `granted`, and `withdrawn` is the
 * per-family override that blocks it everywhere. Until now the terms did not
 * say any of that, so the school was publishing on the strength of a consent
 * it had never actually asked for. This is that missing half.
 *
 * Written to be usable as consent rather than as cover:
 *  - it says WHAT (photographs and video taken at school),
 *  - WHERE they may appear (the school's own website and printed material),
 *  - what will NOT happen (no sale, no advertising network, no naming a child
 *    without asking) — DPDP s.9 forbids targeted advertising to children, and
 *    a notice that stays silent on it invites the assumption,
 *  - and that a parent may refuse at any time, in one sentence, with no
 *    reason required and no effect on the child's place.
 *
 * Deliberately NOT added to the enquiry form. An enquiry is a family asking
 * about admission; no child is enrolled and no photograph will be taken, so
 * consent collected there would be for something that is not going to happen.
 *
 * NOTE FOR WHOEVER REVIEWS THIS: consent under the DPDP Act 2023 must be
 * free, specific, informed and unambiguous, and for a child it must come from
 * the parent. Bundling photography into the same mandatory tick as the
 * registration data makes it harder to call "free", because the family cannot
 * register without it. The wording below therefore states the refusal right
 * explicitly and promises it costs the child nothing — which is the strongest
 * form the blanket decision can take. A separate, genuinely optional tick
 * would be stronger still.
 */
export function photographyNoticeText(schoolName: string): string {
  return (
    `Photographs and video: ${schoolName} takes photographs and video at school ` +
    `activities and may use them on the school's own website, notice boards, ` +
    `prospectus and printed material. They are not sold, not given to ` +
    `advertisers, and a child is not named alongside a picture without asking ` +
    `you first. If you would rather your child did not appear, tell the school ` +
    `office at any time — you need not give a reason, it will be applied to ` +
    `pictures already published as well as new ones, and it makes no ` +
    `difference to your child's place at the school.`
  );
}
