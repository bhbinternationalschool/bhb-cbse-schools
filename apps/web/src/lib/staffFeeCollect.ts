/**
 * Rules the staff phone's fee counter shares with the server that checks it.
 *
 * Pure (no server imports) so the self-test can pin them:
 *   - a reference is required for every payment mode except cash;
 *   - a "total paying now" is split across dues in the web counter's order
 *     (`allocateCollectionToDues`), and the server re-derives that split from
 *     its own dues — the phone's figures are checked, never trusted;
 *   - a discount the server could not read is "not loaded", never ₹0.
 *
 * Test: npm run test:staff-fee-collect
 */

import {
  TENDER_MODES,
  allocateCollectionToDues,
  compareDuesForAllocation,
  formatConcessionDetailLine,
  formatInr,
  type FeeDueLine,
} from "./fees";

/**
 * Why this tender cannot be accepted for want of a reference, or null.
 *
 * Cash needs none; every other mode does (UTR, cheque no., card auth no.,
 * deposit slip). Stated as "not cash" rather than read off `needsRef` so a
 * mode added later cannot slip through without a reference by default — the
 * two agree for every mode today.
 */
export function tenderReferenceProblem(mode: string, ref: string | null | undefined): string | null {
  const m = (mode || "").trim();
  if (!m || m === "cash") return null;
  if ((ref ?? "").trim()) return null;
  const meta = TENDER_MODES.find((t) => t.value === m);
  const label = meta?.label ?? m;
  const refLabel = (meta?.refLabel ?? "reference").toLowerCase();
  return `${label}: enter the ${refLabel} — a reference is required for every payment that is not cash`;
}

export function dueRefKey(studentId: string, dueKey: string): string {
  return `${studentId}|${dueKey}`;
}

/**
 * Each due's position in the order a part payment fills them (0 = first).
 * Sent to the phone so it does not have to re-implement `localeCompare`.
 */
export function allocationRanks(
  dues: Pick<FeeDueLine, "studentId" | "dueKey" | "dueOn">[],
): Map<string, number> {
  const sorted = [...dues].sort(compareDuesForAllocation);
  const out = new Map<string, number>();
  sorted.forEach((d, i) => out.set(dueRefKey(d.studentId, d.dueKey), i));
  return out;
}

export type PayingNowCheck =
  | { ok: true; amounts: Map<string, number> }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Re-derive a "total paying now" split and compare it with what the phone
 * posted.
 *
 * `selected` are the server's OWN open dues for the keys the phone posted
 * (in household order). The split comes from `allocateCollectionToDues`, the
 * web counter's function, so part payment is accepted and anything above
 * the selected balance is refused. A posted per-due amount that differs from
 * the server's split is refused too (409: the dues changed under the phone)
 * — money is never settled off the phone's arithmetic.
 */
export function checkPayingNowSplit(input: {
  selected: FeeDueLine[];
  payingNowPaise: number;
  posted: Map<string, number>;
}): PayingNowCheck {
  const total = Math.round(Number(input.payingNowPaise) || 0);
  if (total <= 0) return { ok: false, status: 400, error: "Enter the amount being paid now" };
  const alloc = allocateCollectionToDues(input.selected, total, () => "");
  if (!alloc.ok) return { ok: false, status: 400, error: alloc.error };
  const amounts = new Map<string, number>();
  for (const l of alloc.lines) amounts.set(dueRefKey(l.studentId, l.dueKey), l.amountPaise);

  const keys = new Set<string>([...input.posted.keys(), ...amounts.keys()]);
  for (const k of keys) {
    const mine = amounts.get(k) ?? 0;
    const theirs = Math.max(0, Math.round(input.posted.get(k) ?? 0));
    if (mine !== theirs) {
      return {
        ok: false,
        status: 409,
        error: "The dues changed since the counter loaded — reload and enter the amount again",
      };
    }
  }
  return { ok: true, amounts };
}

export type DueDiscountOut = {
  billedPaise: number;
  /** null = the server could not read every discount source; show "not loaded". */
  discountPaise: number | null;
  discountLabel: string;
  /** One line per concession / counter discount, as the web counter lists them. */
  discountLines: string[];
};

/**
 * The discount on one due, read from the same `FeeDueLine` fields the web
 * counter's `DueBreakupPicker` shows (`concessionPaise` = standing Masters
 * concessions plus any counter waiver; `concessionDetails` itemises them).
 */
export function dueDiscountOut(
  d: Pick<FeeDueLine, "billedPaise" | "concessionPaise" | "concessionDetails">,
  known: boolean,
): DueDiscountOut {
  if (!known) {
    return {
      billedPaise: Math.max(0, d.billedPaise || 0),
      discountPaise: null,
      discountLabel: "not loaded",
      discountLines: [],
    };
  }
  const paise = Math.max(0, d.concessionPaise || 0);
  return {
    billedPaise: Math.max(0, d.billedPaise || 0),
    discountPaise: paise,
    discountLabel: paise > 0 ? `−${formatInr(paise)}` : "none",
    discountLines: (d.concessionDetails ?? []).map(formatConcessionDetailLine),
  };
}
