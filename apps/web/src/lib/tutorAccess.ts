/**
 * Who gets the tutor free, and at what price — the rules, pure.
 *
 * See the migration for why this exists. The two decisions this file makes
 * are read on every parent message, so they are written to be readable by
 * the person who has to answer "why was this child charged?".
 *
 * MOST GENEROUS WINS, deliberately. A child covered by both a whole-school
 * free week and a narrower class rule gets the free week. The alternative —
 * most specific wins — means a stale class rule silently cancels a grant
 * the owner made this morning for everybody, and nobody finds out until a
 * parent is asked to pay during the exam week they were promised free.
 *
 * DISCOUNTS DO NOT STACK. The best one applies. Two 50% rules are not 75%
 * off, and a school that wants 75% says 75.
 */

export type TutorRuleKind = "free" | "discount";
export type TutorRuleScope = "all" | "class" | "student";

export type TutorAccessRule = {
  id: string;
  kind: TutorRuleKind;
  scope: TutorRuleScope;
  /** class id or student id; "" when the scope is everybody */
  scopeId: string;
  /** inclusive last day (IST), for a free grant */
  freeUntil: string | null;
  discountPercent: number | null;
  note: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
};

export type TutorAccessFor = {
  /** The tutor is free for this child today. */
  free: boolean;
  /** The last day it stays free, when it is. */
  freeUntil: string | null;
  /** 0–100, already resolved to the best single rule. */
  discountPercent: number;
  /** Which rule decided it, for a screen that must explain itself. */
  freeRuleId: string | null;
  discountRuleId: string | null;
};

export const NO_ACCESS_RULES: TutorAccessFor = {
  free: false,
  freeUntil: null,
  discountPercent: 0,
  freeRuleId: null,
  discountRuleId: null,
};

function covers(rule: TutorAccessRule, child: { studentId: string; classId: string }): boolean {
  if (rule.scope === "all") return true;
  if (rule.scope === "class") return !!child.classId && rule.scopeId === child.classId;
  return !!child.studentId && rule.scopeId === child.studentId;
}

/**
 * What this child gets today.
 *
 * `todayIso` is an IST date; a free grant is inclusive of its last day,
 * because "free till 26th" said to a parent means the 26th is free.
 */
export function accessForChild(
  rules: TutorAccessRule[],
  child: { studentId: string; classId: string },
  todayIso: string,
): TutorAccessFor {
  let free: TutorAccessRule | null = null;
  let discount: TutorAccessRule | null = null;
  for (const r of rules) {
    if (!r.isActive) continue;
    if (!covers(r, child)) continue;
    if (r.kind === "free") {
      if (!r.freeUntil || r.freeUntil < todayIso) continue;
      // The one that lasts longest is the promise the school made.
      if (!free || (free.freeUntil ?? "") < r.freeUntil) free = r;
    } else {
      if (r.freeUntil && r.freeUntil < todayIso) continue;
      const pct = r.discountPercent ?? 0;
      if (pct <= 0) continue;
      if (!discount || (discount.discountPercent ?? 0) < pct) discount = r;
    }
  }
  return {
    free: !!free,
    freeUntil: free?.freeUntil ?? null,
    discountPercent: discount?.discountPercent ?? 0,
    freeRuleId: free?.id ?? null,
    discountRuleId: discount?.id ?? null,
  };
}

/**
 * The price a family actually pays.
 *
 * Rounded to whole rupees so a parent never sees ₹149.50 — and rounded
 * DOWN, because rounding a discount up is a school charging more than it
 * announced.
 */
export function priceAfterDiscount(pricePaise: number, discountPercent: number): number {
  const base = Math.max(0, Math.round(pricePaise));
  const pct = Math.min(100, Math.max(0, Math.round(discountPercent)));
  if (!pct) return base;
  const discounted = Math.floor((base * (100 - pct)) / 100);
  return Math.max(0, Math.floor(discounted / 100) * 100);
}

/** "Free till 26 Sep" / "Free till 26 सितंबर" — what the parent is told. */
export function freeUntilLabel(dateIso: string, hindi: boolean): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const months = hindi
    ? ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const when = `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  return hindi ? `${when} तक मुफ़्त` : `Free till ${when}`;
}
