/**
 * One fee reminder per FAMILY, naming every child and every kind of due.
 *
 * WHY (director, 21 Sep 2026): "i want to send due messages by household
 * family wise in which all students dues show … including transport and
 * store dues … live actual due amount". It was built per child and then
 * cut to one message per phone number — the first child's row kept, the
 * siblings' dropped. So on 21 Sep:
 *
 *   - 29 families had two or more children in arrears, and each reminder
 *     named one of them. 42 children's dues, about ₹2.56 lakh, appeared in
 *     no message at all.
 *   - The ₹2,000 floor was tested per CHILD, so a family owing ₹1,500 for
 *     each of two children was never reminded at all (three such families).
 *   - Store dues — ₹31,548 across 12 children, some from April — were in no
 *     reminder, because only the fee counter ever fetched them.
 *
 * This is pure: the caller hands it each child's dues by kind, already
 * computed live; it decides what the family is told.
 *
 * It writes into the template the school already has approved with Meta
 * (`{{childName}}`, `{{classLabel}}`, `{{feeDue}}`), so nothing needs
 * re-approving: "AARAV और ANAYA का विद्यालय शुल्क बकाया है … बकाया राशि:
 * ₹5,500 — AARAV ₹3,500 · ANAYA ₹2,000". Two hard limits shape it, both
 * Meta's: a template parameter may not contain a newline (#132000 — the
 * whole send fails), and the filled-in message may not pass 1,024
 * characters (#132005). Every value here is one line and capped.
 */

export type FamilyChildDue = {
  name: string;
  classLabel: string;
  /** Tuition and every other academic head, overdue (or open, for "due soon"). */
  feesPaise: number;
  transportPaise: number;
  /** Open store credit sales — books, uniform. */
  storePaise: number;
};

export function childTotal(c: FamilyChildDue): number {
  return Math.max(0, c.feesPaise) + Math.max(0, c.transportPaise) + Math.max(0, c.storePaise);
}

export function familyTotal(children: FamilyChildDue[]): number {
  return children.reduce((s, c) => s + childTotal(c), 0);
}

function inr(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

/** "A", "A और B", "A, B और C". */
function joinNames(names: string[], hindi: boolean): string {
  const and = hindi ? " और " : " and ";
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")}${and}${names[names.length - 1]}`;
}

/** First name only, for the breakdown — the full names are already in {{childName}}. */
function firstName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[0] || full.trim();
}

/** A value for a template parameter: one line, and bounded. */
export function oneLine(text: string, max: number): string {
  const flat = String(text || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Caps chosen so the fullest template (Hindi stage reminder, ~430 chars) stays under 1,024. */
export const CHILD_NAME_MAX = 160;
export const CLASS_LABEL_MAX = 60;
export const FEE_DUE_MAX = 280;
/** Past this many children the list says "+N more" rather than grow the message. */
export const NAMED_CHILDREN_MAX = 4;

/**
 * The template values for one family.
 *
 * Children are listed by what they owe, largest first — the order a parent
 * reading "₹8,000" needs in order to see where it comes from. A child who
 * owes nothing is not in the list: this is a reminder about dues, not a
 * roll call.
 */
export function familyReminderValues(input: {
  children: FamilyChildDue[];
  hindi: boolean;
}): { childName: string; classLabel: string; feeDue: string; totalPaise: number } {
  const owing = input.children
    .filter((c) => childTotal(c) > 0)
    .sort((a, b) => childTotal(b) - childTotal(a));
  const total = familyTotal(owing);
  const shown = owing.slice(0, NAMED_CHILDREN_MAX);
  const more = owing.length - shown.length;
  const moreWord = input.hindi ? `और ${more}` : `+${more} more`;

  const names = shown.map((c) => c.name.trim());
  const childName = oneLine(
    more > 0 ? `${names.join(", ")} ${moreWord}` : joinNames(names, input.hindi),
    CHILD_NAME_MAX,
  );
  const classLabel = oneLine(
    [...new Set(shown.map((c) => c.classLabel.trim()).filter(Boolean))].join(", "),
    CLASS_LABEL_MAX,
  );

  // What the total is made of. Per child when there is more than one — the
  // parent's first question is "for whom?" — and per kind when anything
  // other than school fee is in it, so a bus fee or a book bill is never a
  // surprise inside a figure called "school fee".
  const parts: string[] = [];
  if (owing.length > 1) {
    const perChild = shown.map((c) => `${firstName(c.name)} ${inr(childTotal(c))}`);
    if (more > 0) perChild.push(moreWord);
    parts.push(perChild.join(" · "));
  }
  const transport = owing.reduce((s, c) => s + Math.max(0, c.transportPaise), 0);
  const store = owing.reduce((s, c) => s + Math.max(0, c.storePaise), 0);
  if (transport > 0 || store > 0) {
    const kinds = [
      transport > 0 ? `${input.hindi ? "बस" : "transport"} ${inr(transport)}` : "",
      store > 0 ? `${input.hindi ? "स्टोर" : "store"} ${inr(store)}` : "",
    ].filter(Boolean);
    parts.push(`${input.hindi ? "इसमें" : "incl."} ${kinds.join(", ")}`);
  }
  let feeDue = parts.length ? `${inr(total)} — ${parts.join("; ")}` : inr(total);
  // Too long: keep the total and the kinds, drop the per-child list first —
  // the names are still in {{childName}}.
  if (feeDue.length > FEE_DUE_MAX && owing.length > 1) {
    feeDue = parts.length > 1 ? `${inr(total)} — ${parts[parts.length - 1]}` : inr(total);
  }
  return { childName, classLabel, feeDue: oneLine(feeDue, FEE_DUE_MAX), totalPaise: total };
}
