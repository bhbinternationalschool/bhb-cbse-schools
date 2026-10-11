/**
 * Bulk fee payment — one payment, several children, one receipt per child.
 *
 * Pure: the route hands in each child's OPEN dues as the server just priced
 * them, and this decides which dues the money settles. Nothing here writes;
 * the receipts are made by the ordinary counter engine (collectPayment) and
 * pushed in one transaction by the route.
 *
 * Rules that matter for money:
 *  - Never more than is owed. A bulk payment cannot create an advance: the
 *    amount must fit inside the open dues of the children chosen, or the plan
 *    is refused and nothing is posted.
 *  - Oldest dues first. Within a child, and across children for a single
 *    lump sum, the earliest due date is settled first (same order as
 *    allocateCollectionToDues at the counter).
 *  - A child picked twice is refused, not merged — that is a typing slip and
 *    would otherwise double the share silently.
 *  - A child that ends up with nothing gets no receipt (listed as skipped).
 */

export type BulkDue = {
  dueKey: string;
  label: string;
  kind: string;
  /** YYYY-MM-DD, or null when the due has no date (sorted last). */
  dueOn: string | null;
  balancePaise: number;
};

export type BulkChild = {
  studentId: string;
  studentName: string;
  householdId: string;
  dues: BulkDue[];
};

export type BulkStrategy =
  /** Settle every open due of every child. */
  | { kind: "full" }
  /** One lump sum, oldest due first across all the children. */
  | { kind: "oldest_first"; amountPaise: number }
  /** A stated amount per child, oldest due first within each child. */
  | { kind: "per_child"; amounts: Record<string, number> };

export type BulkReceiptLine = {
  dueKey: string;
  label: string;
  kind: string;
  amountPaise: number;
};

export type BulkReceiptPlan = {
  studentId: string;
  studentName: string;
  householdId: string;
  lines: BulkReceiptLine[];
  totalPaise: number;
  /** What the child still owes (in the dues shown) after this payment. */
  remainingPaise: number;
};

export type BulkPlan =
  | {
      ok: true;
      receipts: BulkReceiptPlan[];
      totalPaise: number;
      /** Children chosen who receive nothing under this strategy. */
      skipped: { studentId: string; studentName: string; why: string }[];
    }
  | { ok: false; error: string };

/** Upper bound on children per bulk payment — one request, one transaction. */
export const BULK_MAX_CHILDREN = 60;

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function sortDues(dues: BulkDue[]): BulkDue[] {
  return [...dues]
    .filter((d) => Math.round(d.balancePaise) > 0)
    .sort((a, b) => {
      const ad = a.dueOn || "9999-12-31";
      const bd = b.dueOn || "9999-12-31";
      if (ad !== bd) return ad.localeCompare(bd);
      return a.dueKey.localeCompare(b.dueKey);
    });
}

function openOf(child: BulkChild): number {
  return child.dues.reduce((n, d) => n + Math.max(0, Math.round(d.balancePaise)), 0);
}

function fill(dues: BulkDue[], amountPaise: number): { lines: BulkReceiptLine[]; left: number } {
  let left = amountPaise;
  const lines: BulkReceiptLine[] = [];
  for (const d of sortDues(dues)) {
    if (left <= 0) break;
    const take = Math.min(Math.round(d.balancePaise), left);
    if (take <= 0) continue;
    lines.push({ dueKey: d.dueKey, label: d.label, kind: d.kind, amountPaise: take });
    left -= take;
  }
  return { lines, left };
}

export function planBulkAllocation(children: BulkChild[], strategy: BulkStrategy): BulkPlan {
  if (children.length === 0) return { ok: false, error: "Choose at least one child" };
  if (children.length > BULK_MAX_CHILDREN) {
    return { ok: false, error: `At most ${BULK_MAX_CHILDREN} children in one bulk payment` };
  }
  const seen = new Set<string>();
  for (const c of children) {
    if (!c.studentId) return { ok: false, error: "A child without an id was chosen" };
    if (seen.has(c.studentId)) {
      return { ok: false, error: `${c.studentName || c.studentId} is chosen twice — remove one` };
    }
    seen.add(c.studentId);
    if (!c.householdId) {
      return { ok: false, error: `${c.studentName} has no family on record — a receipt needs one` };
    }
  }

  const totalOpen = children.reduce((n, c) => n + openOf(c), 0);
  const byChild = new Map<string, BulkReceiptLine[]>();

  if (strategy.kind === "full") {
    for (const c of children) byChild.set(c.studentId, fill(c.dues, openOf(c)).lines);
  } else if (strategy.kind === "per_child") {
    for (const c of children) {
      const raw = strategy.amounts[c.studentId];
      const amt = Math.round(Number(raw) || 0);
      if (amt < 0) return { ok: false, error: `${c.studentName}: amount cannot be negative` };
      const open = openOf(c);
      if (amt > open) {
        return {
          ok: false,
          error: `${c.studentName}: ${rupees(amt)} is more than the ${rupees(open)} owed in the dues shown — a bulk payment cannot create an advance`,
        };
      }
      byChild.set(c.studentId, fill(c.dues, amt).lines);
    }
  } else {
    const amount = Math.round(Number(strategy.amountPaise) || 0);
    if (amount <= 0) return { ok: false, error: "Enter the amount received" };
    if (amount > totalOpen) {
      return {
        ok: false,
        error: `${rupees(amount)} is more than the ${rupees(totalOpen)} these children owe in the dues shown — a bulk payment cannot create an advance`,
      };
    }
    // One queue of every child's dues, oldest first; ties keep the order the
    // children were picked in, then the due key, so the plan is stable.
    const queue = children.flatMap((c, ci) =>
      sortDues(c.dues).map((d) => ({ c, ci, d })),
    );
    queue.sort((a, b) => {
      const ad = a.d.dueOn || "9999-12-31";
      const bd = b.d.dueOn || "9999-12-31";
      if (ad !== bd) return ad.localeCompare(bd);
      if (a.ci !== b.ci) return a.ci - b.ci;
      return a.d.dueKey.localeCompare(b.d.dueKey);
    });
    let left = amount;
    for (const { c, d } of queue) {
      if (left <= 0) break;
      const take = Math.min(Math.round(d.balancePaise), left);
      if (take <= 0) continue;
      const lines = byChild.get(c.studentId) ?? [];
      lines.push({ dueKey: d.dueKey, label: d.label, kind: d.kind, amountPaise: take });
      byChild.set(c.studentId, lines);
      left -= take;
    }
    if (left > 0) return { ok: false, error: "Could not place the whole amount on open dues" };
  }

  const receipts: BulkReceiptPlan[] = [];
  const skipped: { studentId: string; studentName: string; why: string }[] = [];
  for (const c of children) {
    const lines = byChild.get(c.studentId) ?? [];
    const total = lines.reduce((n, l) => n + l.amountPaise, 0);
    if (total <= 0) {
      skipped.push({
        studentId: c.studentId,
        studentName: c.studentName,
        why: openOf(c) === 0 ? "Nothing owed in the dues shown" : "No share of this payment",
      });
      continue;
    }
    receipts.push({
      studentId: c.studentId,
      studentName: c.studentName,
      householdId: c.householdId,
      lines,
      totalPaise: total,
      remainingPaise: openOf(c) - total,
    });
  }
  if (receipts.length === 0) return { ok: false, error: "Nothing to collect — the children chosen owe nothing in the dues shown" };
  return {
    ok: true,
    receipts,
    totalPaise: receipts.reduce((n, r) => n + r.totalPaise, 0),
    skipped,
  };
}

/**
 * The idempotency key stamped on each receipt of a bulk payment (as the
 * voucher's transaction id). A retry of the same batch finds these and
 * returns the receipts already made instead of charging twice.
 */
export function bulkReceiptTransactionId(batchId: string, studentId: string): string {
  return `bulk:${batchId}:${studentId}`;
}

/**
 * What a plan would actually post, as a comparable string: every receipt's
 * child, due and amount. Post compares this with the preview's, so a plan
 * that moved (someone collected at the counter in between) is refused even
 * when the TOTAL is unchanged — which, for a lump sum or per-child amounts,
 * it always is.
 */
export function bulkPlanSignature(receipts: Pick<BulkReceiptPlan, "studentId" | "lines">[]): string {
  return receipts
    .flatMap((r) => r.lines.map((l) => `${r.studentId}|${l.dueKey}|${l.amountPaise}`))
    .sort()
    .join(";");
}

/**
 * A child carried across years has one roster row per session. Money and
 * concessions are taken against THIS session's row only; an id from another
 * year's row (a stale search result, an old link) is refused by name rather
 * than priced off last year's dues. null = all chosen rows are this session's.
 */
export function sessionRowProblem(
  rows: { id: string; fullName: string; academicYearCode: string }[],
  sessionAy: string,
): string | null {
  if (!sessionAy) return "The session (academic year) is not known — choose it in the header and reload";
  const stale = rows.find((r) => r.academicYearCode !== sessionAy);
  if (!stale) return null;
  return `${stale.fullName || stale.id} is ${stale.academicYearCode || "another session"}'s record, not ${sessionAy}'s — search again in this session`;
}

/**
 * What a receipt post (feeTools.server postReceiptsTogether) must do after
 * its desk push, decided from what it can see. Pure so the rules are pinned
 * by the selftest:
 *
 *  - every receipt asked for is live in the desk → success; if the push still
 *    reported a failure (the cheque register or the open-dues rebuild behind
 *    the receipts), the push is retried once and a failed retry becomes a
 *    WARNING the screen shows — never silent success;
 *  - otherwise the server's in-memory copies are ALWAYS dropped (and the fee
 *    state re-read from the database): a copy that did not land, or a race
 *    loser's duplicate, left in memory would ride along on every later
 *    whole-desk push from that instance and be refused by the unique index —
 *    blocking the counter and pay-link settlement until a restart. A receipt
 *    that DID land comes back on the next hydrate, because the database is
 *    the truth.
 */
export type PostOutcome =
  | { kind: "ok"; retryPush: boolean }
  | { kind: "not_saved"; dropMemory: true }
  | { kind: "uncertain"; dropMemory: true };

export function decidePostOutcome(input: {
  pushOk: boolean;
  /** Every receipt asked for is live in fee_desk_vouchers (null = could not look). */
  allLive: boolean | null;
  /** None of the receipts this call made is in the desk (null = could not look). */
  noneLanded: boolean | null;
}): PostOutcome {
  if (input.allLive === true) return { kind: "ok", retryPush: !input.pushOk };
  if (input.noneLanded === true) return { kind: "not_saved", dropMemory: true };
  return { kind: "uncertain", dropMemory: true };
}

export const ANCILLARY_WARNING =
  "Receipt made, but the cheque register / open dues did not update. Press Refresh; if the cheque is missing from Fees → Cheques, reload Fee Take before collecting again.";
