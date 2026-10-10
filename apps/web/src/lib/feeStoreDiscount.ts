/**
 * Discounts at the fee counter, split by who owns the due (director, 10 Oct
 * 2026: a 10% discount on two store dues was saved as fee waivers, the
 * collection then failed, and the store never heard of it).
 *
 * A fee head's discount is a fee waiver, as before. A store due's discount
 * belongs to the store — it lowers the sale itself (inv_discount_on_sale),
 * after the receipt exists, under the receipt's number. Until then the
 * counter works on a projection: the dues as they will stand once every
 * discount is in, so the payment is checked BEFORE anything is saved. Pure.
 */

export type DiscountSlice = { dueKey: string; amountPaise: number };

export function isStoreDueKey(dueKey: string): boolean {
  return dueKey.startsWith("store:");
}

/** The sale id inside a store due key ("store:<studentId>:<saleId>"). */
export function storeSaleIdOf(dueKey: string): string {
  return isStoreDueKey(dueKey) ? dueKey.split(":")[2] || "" : "";
}

export function splitDiscountSlices<T extends DiscountSlice>(slices: T[]): { fee: T[]; store: T[] } {
  return {
    fee: slices.filter((s) => !isStoreDueKey(s.dueKey)),
    store: slices.filter((s) => isStoreDueKey(s.dueKey) && s.amountPaise > 0),
  };
}

/** Dues as they will stand once these discounts are in (never below zero). */
export function projectDuesAfterDiscount<D extends { dueKey: string; balancePaise: number }>(dues: D[], slices: DiscountSlice[]): D[] {
  const off = new Map<string, number>();
  for (const s of slices) off.set(s.dueKey, (off.get(s.dueKey) ?? 0) + Math.max(0, s.amountPaise));
  return dues.map((d) => {
    const cut = off.get(d.dueKey) ?? 0;
    return cut > 0 ? { ...d, balancePaise: Math.max(0, d.balancePaise - cut) } : d;
  });
}
