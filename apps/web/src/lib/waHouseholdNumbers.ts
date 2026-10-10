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

/** The bare ten digits of an Indian mobile, from any of the forms we store. */
function last10(mobile: string): string {
  const d = String(mobile || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/**
 * Choose which of a family's numbers to write to.
 *
 * `knownNotOnWhatsApp` holds the numbers Meta has already told us have no
 * WhatsApp account. A number that has merely never been checked is NOT
 * skipped — unchecked is not the same as bad, and skipping on a guess would
 * silence a family whose number is perfectly good.
 *
 * Compared on the last ten digits, whatever form the set arrives in.
 * WHY (21 Sep 2026): the only thing that fills this set in production,
 * `listKnownNotOnWhatsApp`, returns E.164 — "918858784292" — and this used
 * to look up the bare "8858784292". The two never matched, so the daily
 * brief and the tutor, the only two callers, never skipped a single dead
 * number and never once fell back to the other parent. The selftest built
 * its sets from ten-digit strings and so passed throughout.
 */
export function pickWaNumbers(
  candidates: WaCandidateNumber[],
  knownNotOnWhatsApp: Set<string>,
): WaNumberChoice {
  const dead = new Set([...knownNotOnWhatsApp].map(last10).filter(Boolean));
  const usable: WaCandidateNumber[] = [];
  const skipped: WaCandidateNumber[] = [];
  for (const c of candidates) {
    if (dead.has(last10(c.mobile10))) skipped.push(c);
    else usable.push(c);
  }
  return {
    primary: usable[0] ?? null,
    fallback: usable[1] ?? null,
    skipped,
    usable,
  };
}

/**
 * Keep the number a sender already chose — unless it cannot receive
 * WhatsApp, and then the family's next number that can.
 *
 * For senders that settled on one number long before this (exam-eve, the
 * fee-reminder command card). A working number is never swapped: the office
 * saw it on the card, and a family's designated number is theirs to choose.
 * Only a number known dead, or one that is not a mobile at all
 * ("0000000000"), is replaced.
 *
 * `null` means the family has nothing that works. The caller must SAY so —
 * a skipped family that nobody hears about is the gap this closes.
 */
export function liveNumberInstead(
  planned: string,
  candidates: WaCandidateNumber[],
  knownNotOnWhatsApp: Set<string>,
): { mobile10: string; replaced: boolean; label: string } | null {
  const dead = new Set([...knownNotOnWhatsApp].map(last10).filter(Boolean));
  const plannedTen = last10(planned);
  if (plannedTen && /^[6-9]/.test(plannedTen) && !dead.has(plannedTen)) {
    return { mobile10: plannedTen, replaced: false, label: "" };
  }
  const next = pickWaNumbers(candidates, knownNotOnWhatsApp).primary;
  if (!next) return null;
  return { mobile10: next.mobile10, replaced: next.mobile10 !== plannedTen, label: next.label };
}
