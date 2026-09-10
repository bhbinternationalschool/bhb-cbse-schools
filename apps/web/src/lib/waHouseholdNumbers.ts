/**
 * Every number a family can be reached on, in the order to try them.
 *
 * The school stores up to five numbers per family — the designated WhatsApp
 * number, the guardian's, the father's, the mother's, and an alternate —
 * and every outbound path used exactly one of them. When that one number
 * turned out not to be a WhatsApp user, the family simply received nothing;
 * two households here have five and two enrolled children between them and
 * have never had a message land.
 *
 * The existing `sendWaWithFailover` does not save them either: it retries
 * only on a SYNCHRONOUS failure, and "not a WhatsApp user" (131026) comes
 * back later on the delivery webhook, long after that function returned. So
 * the choice has to be made BEFORE sending, from what we already know about
 * each number — which is what `pickWaNumbers` does.
 *
 * Pure, so the ordering is testable and identical everywhere.
 */

export type WaNumberSource =
  | "whatsapp"
  | "guardian"
  | "father"
  | "mother"
  | "alternate";

export type WaCandidateNumber = {
  /** Bare 10 digits. */
  mobile10: string;
  source: WaNumberSource;
  /** For the office: "Father's number". */
  label: string;
};

const LABELS: Record<WaNumberSource, string> = {
  whatsapp: "School's WhatsApp number for this family",
  guardian: "Guardian's number",
  father: "Father's number",
  mother: "Mother's number",
  alternate: "Alternate number",
};

/**
 * Emergency contacts are deliberately NOT here.
 *
 * `emergencyMobile` is often a neighbour or a relative down the road. It is
 * the right number for "your child has a fever" and the wrong one for a fee
 * reminder — that would put one family's dues on another person's phone. If
 * the school ever wants urgent-only messages to fall through to it, that
 * belongs behind an explicit per-module choice, not in the default order.
 */
export function householdCandidateNumbers(input: {
  household?: {
    whatsappMobile?: string;
    mobile?: string;
    altMobile?: string;
  } | null;
  /** Active children of this household — for the parents' own numbers. */
  students?: { fatherMobile?: string; motherMobile?: string }[];
}): WaCandidateNumber[] {
  const normalize = (raw?: string): string => {
    const d = (raw || "").replace(/\D/g, "");
    const ten =
      d.length === 12 && d.startsWith("91")
        ? d.slice(2)
        : d.length === 11 && d.startsWith("0")
          ? d.slice(1)
          : d.slice(-10);
    if (ten.length !== 10) return "";
    // An Indian mobile starts 6-9. "0000000000" is a placeholder somebody
    // typed to get past a required field, not a number, and offering it as
    // a candidate would have the sender burn a message on it every run.
    if (!/^[6-9]/.test(ten)) return "";
    return ten;
  };

  const out: WaCandidateNumber[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined, source: WaNumberSource) => {
    const mobile10 = normalize(raw);
    if (!mobile10 || seen.has(mobile10)) return;
    seen.add(mobile10);
    out.push({ mobile10, source, label: LABELS[source] });
  };

  const hh = input.household;
  push(hh?.whatsappMobile, "whatsapp");
  push(hh?.mobile, "guardian");
  for (const s of input.students ?? []) push(s.fatherMobile, "father");
  for (const s of input.students ?? []) push(s.motherMobile, "mother");
  push(hh?.altMobile, "alternate");
  return out;
}

export type WaNumberChoice = {
  /** The number to send to; null when every number is known unusable. */
  primary: WaCandidateNumber | null;
  /** Tried on a synchronous failure. Null when there is no second option. */
  fallback: WaCandidateNumber | null;
  /** Passed over because they are known not to be on WhatsApp. */
  skipped: WaCandidateNumber[];
  /** Every usable candidate, for "we tried N numbers" reporting. */
  usable: WaCandidateNumber[];
};

/**
 * Choose which of a family's numbers to write to.
 *
 * `knownNotOnWhatsApp` holds the 10-digit numbers Meta has already told us
 * have no WhatsApp account. A number that has merely never been checked is
 * NOT skipped — unchecked is not the same as bad, and skipping on a guess
 * would silence a family whose number is perfectly good.
 */
export function pickWaNumbers(
  candidates: WaCandidateNumber[],
  knownNotOnWhatsApp: Set<string>,
): WaNumberChoice {
  const usable: WaCandidateNumber[] = [];
  const skipped: WaCandidateNumber[] = [];
  for (const c of candidates) {
    if (knownNotOnWhatsApp.has(c.mobile10)) skipped.push(c);
    else usable.push(c);
  }
  return {
    primary: usable[0] ?? null,
    fallback: usable[1] ?? null,
    skipped,
    usable,
  };
}
