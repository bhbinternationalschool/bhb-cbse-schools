/**
 * Parent portal helpers — resolve demo household + fee summary.
 */

import {
  formatInr,
  loadFees,
  openFeeDues,
  type CollectionVoucher,
  type FeeDueLine,
} from "@/lib/fees";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  loadSis,
  type Household,
  type SisState,
  type SisStudent,
} from "@/lib/sis";

export const DEMO_PARENT_MOBILE = "9876543210";

export function resolveParentHousehold(
  sis?: SisState,
  hint?: { mobile?: string; guardianName?: string },
): Household | null {
  const s = sis ?? loadSis();
  const mobile = (hint?.mobile ?? "").replace(/\D/g, "").slice(-10);
  if (mobile.length === 10) {
    const byMobile = s.households.find(
      (h) =>
        h.mobile === mobile ||
        h.whatsappMobile === mobile ||
        h.altMobile === mobile,
    );
    if (byMobile) return byMobile;
  }
  const name = (hint?.guardianName ?? "").trim().toLowerCase();
  if (name) {
    const byName = s.households.find(
      (h) => h.guardianName.trim().toLowerCase() === name,
    );
    if (byName) return byName;
  }
  const byDemo = s.households.find((h) => h.mobile === DEMO_PARENT_MOBILE);
  if (byDemo) return byDemo;
  // Prefer household with the most active children
  let best: Household | null = null;
  let bestN = -1;
  for (const h of s.households) {
    const n = s.students.filter(
      (st) => st.householdId === h.id && st.status === "active",
    ).length;
    if (n > bestN) {
      bestN = n;
      best = h;
    }
  }
  return best;
}

export function classLabelForStudent(
  student: SisStudent,
  masters?: MastersState,
): string {
  const m = masters ?? loadMasters();
  const cls = m.classes.find((c) => c.id === student.classId)?.name ?? "";
  const sec = m.sections.find((s) => s.id === student.sectionId)?.name ?? "";
  return sec ? `${cls}-${sec}` : cls || "—";
}

export function parentOpenDueTotals(dues: FeeDueLine[]): {
  billedPaise: number;
  concessionPaise: number;
  balancePaise: number;
} {
  const open = openFeeDues(dues);
  return {
    billedPaise: open.reduce((s, d) => s + d.billedPaise, 0),
    concessionPaise: open.reduce((s, d) => s + d.concessionPaise, 0),
    balancePaise: open.reduce((s, d) => s + d.balancePaise, 0),
  };
}

export function householdReceipts(
  householdId: string,
  fees = loadFees(),
): CollectionVoucher[] {
  return fees.vouchers
    .filter((v) => v.householdId === householdId && !v.voidedAt)
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

export function formatParentDueHint(d: FeeDueLine): string {
  if (d.concessionPaise > 0 && d.billedPaise > 0) {
    return `Billed ${formatInr(d.billedPaise)} · discount ${formatInr(d.concessionPaise)}`;
  }
  if (d.paidPaise > 0) {
    return `${formatInr(d.paidPaise)} paid earlier`;
  }
  return `Due ${d.dueOn}`;
}
