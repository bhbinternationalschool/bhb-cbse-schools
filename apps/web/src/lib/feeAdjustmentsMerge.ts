/**
 * Fee adjustments — the rules for merging and for waiving many lines at once.
 * Pure, so both can be tested without a browser or a database.
 */

import type { FeeAdjustment, FeeAdjustmentStatus } from "@/lib/feeAdjustments";

/* ── Merging two copies of the book ──────────────────────────────── */

const STATUS_RANK: Record<FeeAdjustmentStatus, number> = {
  pending_approval: 0,
  posted: 1,
  rejected: 2,
  voided: 3,
};

/**
 * The later of two copies of the same adjustment.
 *
 * Every change to an adjustment after it is created — approve, reject,
 * void — stamps `decidedAt`, so the copy decided later is the truth. With
 * no decision on either side, the further-along status wins. A receipt link
 * is only ever added, so it is kept from whichever copy has it.
 */
function laterOf(a: FeeAdjustment, b: FeeAdjustment): FeeAdjustment {
  const da = a.decidedAt || "";
  const db = b.decidedAt || "";
  let win: FeeAdjustment;
  if (da !== db) win = da > db ? a : b;
  else win = (STATUS_RANK[a.status] ?? 0) >= (STATUS_RANK[b.status] ?? 0) ? a : b;
  const other = win === a ? b : a;
  return win.sourceVoucherId || !other.sourceVoucherId
    ? win
    : { ...win, sourceVoucherId: other.sourceVoucherId };
}

/**
 * The server's adjustments and a browser's, as one book.
 *
 * WHY (21 Sep 2026): the whole list was overwritten by whatever the last
 * browser sent. A PC that had the fee desk open since the morning, saving
 * one adjustment in the afternoon, erased every adjustment another PC had
 * posted in between — the failure that left 1 of 302 counter discounts
 * standing on 13 Sep. A "waive every line" button would have made one such
 * save cost a family its whole waiver.
 *
 * Union by id. Nothing is ever lost: an adjustment is never deleted, only
 * voided (a status), so a row missing from one side is simply one that side
 * has not seen yet. Newest first, as the desk shows them.
 */
export function mergeFeeAdjustmentRows(
  server: FeeAdjustment[],
  incoming: FeeAdjustment[],
): FeeAdjustment[] {
  const byId = new Map<string, FeeAdjustment>();
  for (const r of server) if (r?.id) byId.set(r.id, r);
  for (const r of incoming) {
    if (!r?.id) continue;
    const had = byId.get(r.id);
    byId.set(r.id, had ? laterOf(had, r) : r);
  }
  return [...byId.values()].sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""));
}

/* ── Waiving many lines at once ──────────────────────────────────── */

export type WaivableLine = {
  dueKey: string;
  label: string;
  balancePaise: number;
  dueOn: string;
};

/**
 * What a bulk waiver will do, before it does it — for the form to show and
 * for the writer to follow.
 *
 * The Principal limit is on the TOTAL. It is ₹10,000 per adjustment, and a
 * bulk waiver is many adjustments, each usually well under it: ₹40,000 of a
 * year's fees as twelve monthly lines of ₹3,300 would all auto-post and no
 * one with the authority to forgive ₹40,000 would ever see it. So when the
 * selection together passes the limit, every line of it waits for approval.
 */
export function bulkWaiverPlan(
  lines: WaivableLine[],
  selected: Set<string>,
  opts: { limitPaise: number; todayIso: string },
): {
  lines: WaivableLine[];
  totalPaise: number;
  current: number;
  future: number;
  needsApproval: boolean;
} {
  const chosen = lines.filter((l) => selected.has(l.dueKey) && l.balancePaise > 0);
  const totalPaise = chosen.reduce((s, l) => s + l.balancePaise, 0);
  const future = chosen.filter((l) => (l.dueOn || "") > opts.todayIso).length;
  return {
    lines: chosen,
    totalPaise,
    current: chosen.length - future,
    future,
    needsApproval: totalPaise > opts.limitPaise,
  };
}

/** A batch id shared by every line of one bulk waiver, so it is approved as one decision. */
export function newWaiverBatchId(now = Date.now()): string {
  return `fwb_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
